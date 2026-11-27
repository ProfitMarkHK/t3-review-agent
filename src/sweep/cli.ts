import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { normalizePath, parseWorktreeList, planSweep } from "./plan";

interface SweepOptions {
  apply: boolean;
  staleHours: number;
}

type ParseResult =
  | { ok: true; value: SweepOptions }
  | { ok: false; errors: string[] };

export function parseArguments(args: string[]): ParseResult {
  const errors: string[] = [];
  let apply = false;
  let staleHours = 6;
  let staleHoursSet = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) {
      continue;
    }

    if (arg === "--apply") {
      if (apply) {
        errors.push("--apply was given more than once");
      }
      apply = true;
      continue;
    }

    if (arg === "--stale-hours") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        errors.push("--stale-hours requires a value");
        index += 1;
        continue;
      }
      if (staleHoursSet) {
        errors.push("--stale-hours was given more than once");
        index += 1;
        continue;
      }
      if (!/^[1-9][0-9]*$/.test(value)) {
        errors.push("--stale-hours must be a positive integer");
        index += 1;
        continue;
      }
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed) || parsed > 168) {
        errors.push("--stale-hours must be a positive integer <= 168");
        index += 1;
        continue;
      }
      staleHours = parsed;
      staleHoursSet = true;
      index += 1;
      continue;
    }

    errors.push(`unknown option: ${arg}`);
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, value: { apply, staleHours } };
}

export const parseSweepArguments = parseArguments;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readStartedAtMs(startedPath: string): number | null {
  if (!existsSync(startedPath)) {
    return null;
  }
  try {
    const raw = readFileSync(startedPath, "utf8").trim();
    const parsed = Date.parse(raw);
    return Number.isNaN(parsed) ? null : parsed;
  } catch {
    return null;
  }
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

  const listResult = spawnSync("git", ["worktree", "list", "--porcelain"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  if (listResult.status !== 0) {
    const stderr = (listResult.stderr ?? "").trim();
    console.error(stderr.length > 0 ? stderr : "failed to list worktrees");
    return 1;
  }

  const porcelain = listResult.stdout ?? "";
  const entries = parseWorktreeList(porcelain);

  const worktrees = entries.map((entry) => {
    const startedPath = `${entry.path}/.t3-review-run`;
    const finishedPath = `${entry.path}/.t3-review-run-finished`;
    return {
      path: entry.path,
      branch: entry.branch,
      startedMarker: existsSync(startedPath),
      finishedMarker: existsSync(finishedPath),
      startedAtMs: readStartedAtMs(startedPath),
    };
  });

  const plan = planSweep({
    worktrees,
    currentPath: process.cwd(),
    nowMs: Date.now(),
    staleAfterMs: options.staleHours * 60 * 60 * 1000,
  });

  if (!options.apply) {
    console.log(JSON.stringify({ dryRun: true, remove: plan.remove, keep: plan.keep }));
    return 0;
  }

  const removed: Array<{
    path: string;
    branch: string | null;
    reason: string;
    leftoverDirectory: boolean;
  }> = [];
  const failed: Array<{ path: string; branch: string | null; error: string }> = [];

  for (const entry of plan.remove) {
    const removeResult = spawnSync(
      "git",
      ["worktree", "remove", "--force", entry.path],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    let leftoverDirectory = false;
    if (removeResult.status !== 0) {
      spawnSync("git", ["worktree", "prune"], { cwd: process.cwd(), encoding: "utf8" });
      const relist = spawnSync("git", ["worktree", "list", "--porcelain"], {
        cwd: process.cwd(),
        encoding: "utf8",
      });
      const stillRegistered =
        relist.status !== 0 ||
        parseWorktreeList(relist.stdout ?? "").some(
          (worktree) => normalizePath(worktree.path) === normalizePath(entry.path),
        );
      if (stillRegistered) {
        const stderr = (removeResult.stderr ?? "").trim();
        failed.push({
          path: entry.path,
          branch: entry.branch,
          error: stderr.length > 0 ? stderr : "worktree remove failed",
        });
        continue;
      }
      leftoverDirectory = true;
    }
    if (entry.branch !== null && entry.branch.startsWith("t3/")) {
      spawnSync("git", ["branch", "-D", entry.branch], {
        cwd: process.cwd(),
        encoding: "utf8",
      });
    }
    removed.push({
      path: entry.path,
      branch: entry.branch,
      reason: entry.reason,
      leftoverDirectory,
    });
  }

  spawnSync("git", ["worktree", "prune"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  console.log(
    JSON.stringify({ dryRun: false, removed, failed, keep: plan.keep }),
  );
  return 0;
}

try {
  process.exitCode = await run();
} catch (error) {
  console.error(errorMessage(error));
  process.exitCode = 1;
}