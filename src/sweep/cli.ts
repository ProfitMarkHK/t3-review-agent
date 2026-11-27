import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import os from "node:os";
import {
  normalizePath,
  parseWorktreeList,
  planSweep,
  planTargetSweep,
  type SweepPlan,
} from "./plan";

interface SweepOptions {
  apply: boolean;
  staleHours: number;
  targets: string[];
}

type ParseResult =
  | { ok: true; value: SweepOptions }
  | { ok: false; errors: string[] };

export function parseArguments(args: string[]): ParseResult {
  const errors: string[] = [];
  let apply = false;
  let staleHours = 6;
  let staleHoursSet = false;
  const targets: string[] = [];

  function isValidTarget(value: string): boolean {
    if (value.length === 0) {
      return false;
    }
    const isWindowsAbs = /^[a-zA-Z]:[\\/]/.test(value) || /^\\\\/.test(value);
    const isPosixAbs = value.startsWith("/");
    if (!isWindowsAbs && !isPosixAbs) {
      return false;
    }
    if (value.includes('"') || value.includes("`") || value.includes("$")) {
      return false;
    }
    for (let i = 0; i < value.length; i += 1) {
      const code = value.charCodeAt(i);
      if (code < 0x20 || code === 0x7f) {
        return false;
      }
    }
    return true;
  }

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

    if (arg === "--target") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        errors.push("--target requires a value");
        index += 1;
        continue;
      }
      if (targets.length >= 10) {
        errors.push("--target may be given at most 10 times");
        index += 1;
        continue;
      }
      if (!isValidTarget(value)) {
        errors.push("--target must be an absolute Windows or POSIX path");
        index += 1;
        continue;
      }
      targets.push(value);
      index += 1;
      continue;
    }

    errors.push(`unknown option: ${arg}`);
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, value: { apply, staleHours, targets } };
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

function readGitdirAdminDir(worktreePath: string): string | null {
  try {
    const content = readFileSync(join(worktreePath, ".git"), "utf8").trim();
    const match = content.match(/^gitdir:\s*(.+)$/i);
    if (match === null) {
      return null;
    }
    const value = (match[1] ?? "").trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function listTarget(
  target: string,
  staleAfterMs: number,
): { target: string; error: string } | { target: string; plan: SweepPlan } {
  const listResult = spawnSync("git", ["-C", target, "worktree", "list", "--porcelain"], {
    encoding: "utf8",
  });
  if (listResult.status !== 0) {
    const stderr = (listResult.stderr ?? "").trim();
    return { target, error: stderr.length > 0 ? stderr : "failed to list worktrees" };
  }
  const entries = parseWorktreeList(listResult.stdout ?? "");
  const facts = entries.map((entry) => {
    const adminDir = readGitdirAdminDir(entry.path);
    let createdAtMs: number | null = null;
    if (adminDir !== null) {
      try {
        createdAtMs = statSync(adminDir).mtimeMs;
      } catch {
        createdAtMs = null;
      }
    }
    return { path: entry.path, branch: entry.branch, createdAtMs };
  });
  const plan = planTargetSweep({
    worktrees: facts,
    runRoot: join(os.tmpdir(), "t3-review-agent"),
    nowMs: Date.now(),
    staleAfterMs,
  });
  return { target, plan };
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

  const staleAfterMs = options.staleHours * 60 * 60 * 1000;

  const plan = planSweep({
    worktrees,
    currentPath: process.cwd(),
    nowMs: Date.now(),
    staleAfterMs,
  });
  const targetResultsDry: unknown[] = [];
  for (const target of options.targets) {
    const result = listTarget(target, staleAfterMs);
    if ("error" in result) {
      targetResultsDry.push({ target: result.target, error: result.error });
    } else {
      targetResultsDry.push({
        target: result.target,
        remove: result.plan.remove,
        keep: result.plan.keep,
      });
    }
  }

  if (!options.apply) {
    console.log(
      JSON.stringify({
        dryRun: true,
        remove: plan.remove,
        keep: plan.keep,
        targets: targetResultsDry,
      }),
    );
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

  const targetResultsApply: unknown[] = [];
  for (const target of options.targets) {
    const result = listTarget(target, staleAfterMs);
    if ("error" in result) {
      targetResultsApply.push({ target: result.target, error: result.error });
      continue;
    }
    const targetPlan = result.plan;
    const targetRemoved: Array<{
      path: string;
      branch: string | null;
      reason: string;
      leftoverDirectory: boolean;
    }> = [];
    const targetFailed: Array<{ path: string; branch: string | null; error: string }> = [];
    for (const entry of targetPlan.remove) {
      const removeResult = spawnSync(
        "git",
        ["-C", target, "worktree", "remove", "--force", entry.path],
        { encoding: "utf8" },
      );
      let leftoverDirectory = false;
      if (removeResult.status !== 0) {
        spawnSync("git", ["-C", target, "worktree", "prune"], { encoding: "utf8" });
        const relist = spawnSync("git", ["-C", target, "worktree", "list", "--porcelain"], {
          encoding: "utf8",
        });
        const stillRegistered =
          relist.status !== 0 ||
          parseWorktreeList(relist.stdout ?? "").some(
            (worktree) => normalizePath(worktree.path) === normalizePath(entry.path),
          );
        if (stillRegistered) {
          const stderr = (removeResult.stderr ?? "").trim();
          targetFailed.push({
            path: entry.path,
            branch: entry.branch,
            error: stderr.length > 0 ? stderr : "worktree remove failed",
          });
          continue;
        }
        leftoverDirectory = true;
      }
      targetRemoved.push({
        path: entry.path,
        branch: entry.branch,
        reason: entry.reason,
        leftoverDirectory,
      });
    }
    spawnSync("git", ["-C", target, "worktree", "prune"], { encoding: "utf8" });
    targetResultsApply.push({
      target,
      removed: targetRemoved,
      failed: targetFailed,
      keep: targetPlan.keep,
    });
  }

  console.log(
    JSON.stringify({
      dryRun: false,
      removed,
      failed,
      keep: plan.keep,
      targets: targetResultsApply,
    }),
  );
  return 0;
}

try {
  process.exitCode = await run();
} catch (error) {
  console.error(errorMessage(error));
  process.exitCode = 1;
}