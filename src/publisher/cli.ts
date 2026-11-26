import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { decideReview } from "./decide";
import { parseFindingsFile } from "./findings";
import { getPullHeadSha, listReviewBodies, postReview } from "./github";
import { renderReviewBody } from "./render";

interface ParsedOptions {
  findingsPath: string;
  owner: string;
  repo: string;
  pr: number;
  sha: string;
  tokenFile?: string;
  dryRun: boolean;
}

type ParseResult =
  | { ok: true; value: ParsedOptions }
  | { ok: false; errors: string[] };

const valueFlags = new Set(["--findings", "--repo", "--pr", "--sha", "--token-file"]);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseArguments(args: string[]): ParseResult {
  const errors: string[] = [];
  const values = new Map<string, string>();
  let dryRun = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) {
      continue;
    }

    if (arg === "--dry-run") {
      if (dryRun) {
        errors.push("--dry-run was given more than once");
      }
      dryRun = true;
      continue;
    }

    if (!arg.startsWith("--")) {
      errors.push(`unexpected argument: ${arg}`);
      continue;
    }

    if (!valueFlags.has(arg)) {
      errors.push(`unknown option: ${arg}`);
      continue;
    }

    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      errors.push(`${arg} requires a value`);
      continue;
    }

    if (values.has(arg)) {
      errors.push(`${arg} was given more than once`);
      index += 1;
      continue;
    }

    values.set(arg, value);
    index += 1;
  }

  const findingsPath = values.get("--findings");
  if (findingsPath === undefined) {
    errors.push("--findings is required");
  }

  const repoValue = values.get("--repo");
  let owner: string | null = null;
  let repo: string | null = null;
  if (repoValue === undefined) {
    errors.push("--repo is required");
  } else if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repoValue)) {
    errors.push("--repo must be owner/name");
  } else {
    const slash = repoValue.indexOf("/");
    owner = repoValue.slice(0, slash);
    repo = repoValue.slice(slash + 1);
  }

  const prValue = values.get("--pr");
  let pr: number | null = null;
  if (prValue === undefined) {
    errors.push("--pr is required");
  } else if (!/^[1-9][0-9]*$/.test(prValue)) {
    errors.push("--pr must be a positive integer");
  } else {
    const parsed = Number(prValue);
    if (!Number.isSafeInteger(parsed)) {
      errors.push("--pr must be a positive integer");
    } else {
      pr = parsed;
    }
  }

  const sha = values.get("--sha");
  if (sha === undefined) {
    errors.push("--sha is required");
  } else if (!/^[0-9a-f]{40}$/.test(sha)) {
    errors.push("--sha must be a 40-character lowercase hex SHA");
  }

  const tokenFile = values.get("--token-file");
  if (tokenFile !== undefined && tokenFile.trim().length === 0) {
    errors.push("--token-file must not be empty");
  }

  if (
    errors.length > 0 ||
    findingsPath === undefined ||
    owner === null ||
    repo === null ||
    pr === null ||
    sha === undefined
  ) {
    return { ok: false, errors };
  }

  const options: ParsedOptions = {
    findingsPath,
    owner,
    repo,
    pr,
    sha,
    dryRun,
  };

  if (tokenFile !== undefined) {
    options.tokenFile = tokenFile;
  }

  return { ok: true, value: options };
}

function defaultTokenPath(): string {
  const localAppData = process.env["LOCALAPPDATA"];
  if (localAppData !== undefined && localAppData.length > 0) {
    return join(localAppData, "t3-review-agent", "publisher.token");
  }

  const xdgDataHome = process.env["XDG_DATA_HOME"];
  if (xdgDataHome !== undefined && xdgDataHome.length > 0) {
    return join(xdgDataHome, "t3-review-agent", "publisher.token");
  }

  return join(homedir(), ".local", "share", "t3-review-agent", "publisher.token");
}

async function readToken(tokenFile: string | undefined): Promise<string> {
  const path = tokenFile ?? defaultTokenPath();
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`cannot read token file ${path}: ${errorMessage(error)}`);
  }

  const token = contents.trim();
  if (token.length === 0) {
    throw new Error(`token file ${path} is empty`);
  }

  return token;
}

async function run(): Promise<number> {
  const parsed = parseArguments(process.argv.slice(2));
  if (!parsed.ok) {
    for (const error of parsed.errors) {
      console.error(error);
    }
    return 2;
  }

  const options = parsed.value;

  let raw: string;
  try {
    raw = await readFile(options.findingsPath, "utf8");
  } catch (error) {
    console.error(`cannot read findings file ${options.findingsPath}: ${errorMessage(error)}`);
    return 2;
  }

  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch (error) {
    console.error(`findings file ${options.findingsPath} is not valid JSON: ${errorMessage(error)}`);
    return 2;
  }

  const findings = parseFindingsFile(input);
  if (!findings.ok) {
    for (const error of findings.errors) {
      console.error(error);
    }
    return 2;
  }

  const rendered = renderReviewBody({
    sha: options.sha,
    owner: options.owner,
    repo: options.repo,
    findings: findings.value.findings,
    incompleteScopes: findings.value.incompleteScopes,
  });

  if (!rendered.ok) {
    console.error(rendered.error);
    return 1;
  }

  const body = rendered.body;

  if (options.dryRun) {
    console.log(body);
    return 0;
  }

  const token = await readToken(options.tokenFile);
  const target = {
    token,
    owner: options.owner,
    repo: options.repo,
    pr: options.pr,
  };

  const existingReviewBodies = await listReviewBodies(target);
  const currentHeadSha = await getPullHeadSha(target);
  const decision = decideReview({
    headSha: options.sha,
    currentHeadSha,
    existingReviewBodies,
  });

  if (decision.action === "skip") {
    console.log(JSON.stringify({ outcome: "skipped", reason: decision.reason }));
    return 0;
  }

  const review = await postReview(target, options.sha, body);
  console.log(JSON.stringify({ outcome: "posted", reviewId: review.id, url: review.url }));
  return 0;
}

try {
  process.exitCode = await run();
} catch (error) {
  console.error(errorMessage(error));
  process.exitCode = 1;
}
