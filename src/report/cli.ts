import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseFindingsFile } from "../publisher/findings";
import type { Finding, IncompleteScope } from "../publisher/findings";
import { renderFindingsReport } from "./render";
import type { ReportOutcome } from "./render";

interface ParsedOptions {
  owner: string;
  repo: string;
  pr: number;
  sha: string;
  outcome: ReportOutcome;
  findingsPath?: string;
  reviewUrl?: string;
  note?: string;
  outPath: string;
}

type ParseResult =
  | { ok: true; value: ParsedOptions }
  | { ok: false; errors: string[] };

const valueFlags = new Set([
  "--repo",
  "--pr",
  "--sha",
  "--outcome",
  "--findings",
  "--review-url",
  "--note",
  "--out",
]);

const outcomes = new Set<string>([
  "posted",
  "already-reviewed",
  "superseded",
  "would-post",
  "failed",
]);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseArguments(args: string[]): ParseResult {
  const errors: string[] = [];
  const values = new Map<string, string>();

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) {
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

  const outcomeValue = values.get("--outcome");
  let outcome: ReportOutcome | null = null;
  if (outcomeValue === undefined) {
    errors.push("--outcome is required");
  } else if (!outcomes.has(outcomeValue)) {
    errors.push(
      "--outcome must be one of posted, already-reviewed, superseded, would-post, failed",
    );
  } else {
    outcome = outcomeValue as ReportOutcome;
  }

  const findingsPath = values.get("--findings");
  if (findingsPath !== undefined && findingsPath.trim().length === 0) {
    errors.push("--findings must not be empty");
  }

  const reviewUrl = values.get("--review-url");
  if (reviewUrl !== undefined && !reviewUrl.startsWith("https://github.com/")) {
    errors.push("--review-url must start with https://github.com/");
  }

  const note = values.get("--note");
  if (note !== undefined && note.trim().length === 0) {
    errors.push("--note must not be empty");
  }

  const outPath = values.get("--out");
  if (outPath === undefined) {
    errors.push("--out is required");
  } else if (outPath.trim().length === 0) {
    errors.push("--out must not be empty");
  }

  if (
    errors.length > 0 ||
    owner === null ||
    repo === null ||
    pr === null ||
    sha === undefined ||
    outcome === null ||
    outPath === undefined
  ) {
    return { ok: false, errors };
  }

  const options: ParsedOptions = {
    owner,
    repo,
    pr,
    sha,
    outcome,
    outPath,
  };

  if (findingsPath !== undefined) {
    options.findingsPath = findingsPath;
  }
  if (reviewUrl !== undefined) {
    options.reviewUrl = reviewUrl;
  }
  if (note !== undefined) {
    options.note = note;
  }

  return { ok: true, value: options };
}

async function readFindings(
  path: string | undefined,
): Promise<{ findings: Finding[]; incompleteScopes: IncompleteScope[] }> {
  if (path === undefined) {
    return { findings: [], incompleteScopes: [] };
  }

  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`cannot read findings file ${path}: ${errorMessage(error)}`);
  }

  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch (error) {
    throw new Error(`findings file ${path} is not valid JSON: ${errorMessage(error)}`);
  }

  const parsed = parseFindingsFile(input);
  if (!parsed.ok) {
    throw new Error(parsed.errors.join("\n"));
  }

  return {
    findings: parsed.value.findings,
    incompleteScopes: parsed.value.incompleteScopes,
  };
}

async function run(): Promise<number> {
  const parsedArguments = parseArguments(process.argv.slice(2));
  if (!parsedArguments.ok) {
    for (const error of parsedArguments.errors) {
      console.error(error);
    }
    return 2;
  }

  const options = parsedArguments.value;

  let collected: { findings: Finding[]; incompleteScopes: IncompleteScope[] };
  try {
    collected = await readFindings(options.findingsPath);
  } catch (error) {
    console.error(errorMessage(error));
    return 2;
  }

  const input = {
    owner: options.owner,
    repo: options.repo,
    pr: options.pr,
    sha: options.sha,
    outcome: options.outcome,
    findings: collected.findings,
    incompleteScopes: collected.incompleteScopes,
  };

  const html = renderFindingsReport({
    ...input,
    ...(options.reviewUrl === undefined ? {} : { reviewUrl: options.reviewUrl }),
    ...(options.note === undefined ? {} : { note: options.note }),
  });

  try {
    await writeFile(options.outPath, html, "utf8");
  } catch (error) {
    console.error(`cannot write report ${options.outPath}: ${errorMessage(error)}`);
    return 1;
  }

  console.log(resolve(options.outPath));
  return 0;
}

try {
  process.exitCode = await run();
} catch (error) {
  console.error(errorMessage(error));
  process.exitCode = 1;
}
