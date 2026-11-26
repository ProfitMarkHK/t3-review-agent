import { join } from "node:path";

export interface PublisherEnvironment {
  LOCALAPPDATA?: string;
  XDG_DATA_HOME?: string;
  HOME?: string;
}

export interface PublisherOptions {
  findingsPath?: string;
  owner: string;
  repo: string;
  pr: number;
  sha: string;
  tokenPath: string;
  dryRun: boolean;
}

export type ParseArgumentsResult =
  | { ok: true; value: PublisherOptions }
  | { ok: false; errors: string[] };

const valueFlags = new Set(["--findings", "--repo", "--pr", "--sha", "--token-file"]);

export function defaultTokenPath(env: PublisherEnvironment): string {
  const localAppData = env.LOCALAPPDATA;
  if (localAppData !== undefined && localAppData.length > 0) {
    return join(localAppData, "t3-review-agent", "publisher.token");
  }

  const xdgDataHome = env.XDG_DATA_HOME;
  if (xdgDataHome !== undefined && xdgDataHome.length > 0) {
    return join(xdgDataHome, "t3-review-agent", "publisher.token");
  }

  const home = env.HOME !== undefined && env.HOME.length > 0 ? env.HOME : "";
  return join(home, ".local", "share", "t3-review-agent", "publisher.token");
}

export function parseArguments(args: string[], env: PublisherEnvironment): ParseArgumentsResult {
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

  if (errors.length > 0 || owner === null || repo === null || pr === null || sha === undefined) {
    return { ok: false, errors };
  }

  const options: PublisherOptions = {
    owner,
    repo,
    pr,
    sha,
    tokenPath: tokenFile ?? defaultTokenPath(env),
    dryRun,
  };

  if (findingsPath !== undefined) {
    options.findingsPath = findingsPath;
  }

  return { ok: true, value: options };
}
