import { findReviewScope } from "./scopes";
import { renderReviewerTask } from "./reviewer-task";

interface ParsedOptions {
  scopeId: string;
  owner: string;
  repo: string;
  pr: number;
  headSha: string;
  baseSha: string;
  checkoutPath: string;
}

type ParseResult =
  | { ok: true; value: ParsedOptions }
  | { ok: false; errors: string[] };

const valueFlags = new Set(["--scope", "--repo", "--pr", "--head", "--base", "--checkout"]);

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

  const scopeId = values.get("--scope");
  if (scopeId === undefined) {
    errors.push("--scope is required");
  } else if (findReviewScope(scopeId) === null) {
    errors.push(`--scope must be a known scope id`);
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

  const headSha = values.get("--head");
  if (headSha === undefined) {
    errors.push("--head is required");
  } else if (!/^[0-9a-f]{40}$/.test(headSha)) {
    errors.push("--head must be a 40-character lowercase hex SHA");
  }

  const baseSha = values.get("--base");
  if (baseSha === undefined) {
    errors.push("--base is required");
  } else if (!/^[0-9a-f]{40}$/.test(baseSha)) {
    errors.push("--base must be a 40-character lowercase hex SHA");
  }

  const checkoutValue = values.get("--checkout");
  let checkoutPath: string | null = null;
  if (checkoutValue === undefined) {
    errors.push("--checkout is required");
  } else {
    const forbidden = /["`$%!^&|;<>\n\r\t\0-\x1f\x7f]/;
    if (checkoutValue.length > 400) {
      errors.push("--checkout must be at most 400 characters");
    } else if (!/^(?:[A-Za-z]:[\\/]|\/)/.test(checkoutValue)) {
      errors.push("--checkout must be an absolute path");
    } else if (forbidden.test(checkoutValue)) {
      errors.push("--checkout contains a forbidden character");
    } else {
      checkoutPath = checkoutValue;
    }
  }

  if (
    errors.length > 0 ||
    scopeId === undefined ||
    owner === null ||
    repo === null ||
    pr === null ||
    headSha === undefined ||
    baseSha === undefined ||
    checkoutPath === null
  ) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: { scopeId, owner, repo, pr, headSha, baseSha, checkoutPath },
  };
}

function run(): number {
  const parsed = parseArguments(process.argv.slice(2));
  if (!parsed.ok) {
    for (const error of parsed.errors) {
      console.error(error);
    }
    return 2;
  }

  const options = parsed.value;
  const scope = findReviewScope(options.scopeId);
  if (scope === null) {
    console.error(`--scope must be a known scope id`);
    return 2;
  }

  console.log(
    renderReviewerTask({
      scope,
      repository: `${options.owner}/${options.repo}`,
      pr: options.pr,
      headSha: options.headSha,
      baseSha: options.baseSha,
      checkoutPath: options.checkoutPath,
    }),
  );
  return 0;
}

try {
  process.exitCode = run();
} catch (error) {
  console.error(errorMessage(error));
  process.exitCode = 1;
}
