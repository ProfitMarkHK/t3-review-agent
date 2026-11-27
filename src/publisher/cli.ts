import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { decideReview, isAlreadyReviewed } from "./decide";
import { parseFindingsFile } from "./findings";
import { getPullHeadSha, listReviewBodies, postReview } from "./github";
import { parseArguments } from "./options";
import type { PublisherEnvironment } from "./options";
import { renderReviewBody } from "./render";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readEnvironment(): PublisherEnvironment {
  const env: PublisherEnvironment = { HOME: homedir() };
  const localAppData = process.env["LOCALAPPDATA"];
  if (localAppData !== undefined) {
    env.LOCALAPPDATA = localAppData;
  }
  const xdgDataHome = process.env["XDG_DATA_HOME"];
  if (xdgDataHome !== undefined) {
    env.XDG_DATA_HOME = xdgDataHome;
  }
  return env;
}

async function readToken(tokenPath: string): Promise<string> {
  let contents: string;
  try {
    contents = await readFile(tokenPath, "utf8");
  } catch (error) {
    throw new Error(`cannot read token file ${tokenPath}: ${errorMessage(error)}`);
  }

  const token = contents.trim();
  if (token.length === 0) {
    throw new Error(`token file ${tokenPath} is empty`);
  }

  return token;
}

async function run(): Promise<number> {
  const parsed = parseArguments(process.argv.slice(2), readEnvironment());
  if (!parsed.ok) {
    for (const error of parsed.errors) {
      console.error(error);
    }
    return 2;
  }

  const options = parsed.value;
  let body: string | null = null;

  if (!options.check) {
    const findingsPath = options.findingsPath;
    if (findingsPath === undefined) {
      console.error("--findings is required");
      return 2;
    }

    let raw: string;
    try {
      raw = await readFile(findingsPath, "utf8");
    } catch (error) {
      console.error(`cannot read findings file ${findingsPath}: ${errorMessage(error)}`);
      return 2;
    }

    let input: unknown;
    try {
      input = JSON.parse(raw);
    } catch (error) {
      console.error(`findings file ${findingsPath} is not valid JSON: ${errorMessage(error)}`);
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

    body = rendered.body;

    if (options.dryRun) {
      console.log(body);
      return 0;
    }
  }

  const token = await readToken(options.tokenPath);
  const target = {
    token,
    owner: options.owner,
    repo: options.repo,
    pr: options.pr,
  };

  const existingReviewBodies = await listReviewBodies(target);

  if (isAlreadyReviewed(existingReviewBodies, options.sha)) {
    console.log(JSON.stringify({ outcome: "skipped", reason: "already-reviewed" }));
    return 0;
  }

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

  if (options.check) {
    console.log(JSON.stringify({ outcome: "would-post" }));
    return 0;
  }

  if (body === null) {
    console.error("no review body was rendered");
    return 1;
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
