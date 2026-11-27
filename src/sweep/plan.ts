export interface WorktreeFacts {
  path: string;
  branch: string | null;
  startedMarker: boolean;
  finishedMarker: boolean;
  startedAtMs: number | null;
}

export interface SweepInput {
  worktrees: WorktreeFacts[];
  currentPath: string;
  nowMs: number;
  staleAfterMs: number;
}

export interface SweepRemoveEntry {
  path: string;
  branch: string | null;
  reason: "finished" | "stale";
}

export interface SweepKeepEntry {
  path: string;
  reason: string;
}

export interface TargetWorktreeFacts {
  path: string;
  branch: string | null;
  createdAtMs: number | null;
}

export interface TargetSweepInput {
  worktrees: TargetWorktreeFacts[];
  runRoot: string;
  nowMs: number;
  staleAfterMs: number;
}

export interface SweepPlan {
  remove: SweepRemoveEntry[];
  keep: SweepKeepEntry[];
}

export function normalizePath(value: string): string {
  let result = value.trim();
  result = result.replace(/[\\/]+$/, "");
  result = result.toLowerCase().replace(/\\/g, "/");
  return result;
}

export function parseWorktreeList(
  porcelain: string,
): Array<{ path: string; branch: string | null }> {
  const blocks: string[][] = [];
  let buffer: string[] = [];
  for (const line of porcelain.split(/\r?\n/)) {
    if (line.trim() === "") {
      if (buffer.length > 0) {
        blocks.push(buffer);
        buffer = [];
      }
    } else {
      buffer.push(line);
    }
  }
  if (buffer.length > 0) {
    blocks.push(buffer);
  }

  const result: Array<{ path: string; branch: string | null }> = [];
  for (const block of blocks) {
    let path: string | null = null;
    let branch: string | null = null;
    let detached = false;
    for (const line of block) {
      if (line.startsWith("worktree ")) {
        path = line.slice("worktree ".length);
      } else if (line.startsWith("branch ")) {
        const reference = line.slice("branch ".length);
        const match = reference.match(/^refs\/heads\/(.*)$/);
        branch = match === null ? reference : match[1] ?? null;
      } else if (line.trim() === "detached") {
        detached = true;
        branch = null;
      }
    }
    if (path !== null) {
      result.push({ path, branch: detached ? null : branch });
    }
  }
  return result;
}

export function planSweep(input: SweepInput): SweepPlan {
  const remove: SweepRemoveEntry[] = [];
  const keep: SweepKeepEntry[] = [];
  const currentNormalized = normalizePath(input.currentPath);

  input.worktrees.forEach((worktree, index) => {
    if (index === 0) {
      keep.push({ path: worktree.path, reason: "main" });
      return;
    }
    if (normalizePath(worktree.path) === currentNormalized) {
      keep.push({ path: worktree.path, reason: "current" });
      return;
    }
    if (worktree.branch === null || !worktree.branch.startsWith("t3/")) {
      keep.push({ path: worktree.path, reason: "not-a-t3-branch" });
      return;
    }
    if (!worktree.startedMarker) {
      keep.push({ path: worktree.path, reason: "not-a-review-run" });
      return;
    }
    if (worktree.finishedMarker) {
      remove.push({ path: worktree.path, branch: worktree.branch, reason: "finished" });
      return;
    }
    if (
      worktree.startedAtMs !== null &&
      input.nowMs - worktree.startedAtMs > input.staleAfterMs
    ) {
      remove.push({ path: worktree.path, branch: worktree.branch, reason: "stale" });
      return;
    }
    keep.push({ path: worktree.path, reason: "in-progress" });
  });

  return { remove, keep };
}

export function planTargetSweep(input: TargetSweepInput): SweepPlan {
  const remove: SweepRemoveEntry[] = [];
  const keep: SweepKeepEntry[] = [];
  const rootNormalized = normalizePath(input.runRoot);

  input.worktrees.forEach((worktree, index) => {
    if (index === 0) {
      keep.push({ path: worktree.path, reason: "main" });
      return;
    }
    if (worktree.branch !== null) {
      keep.push({ path: worktree.path, reason: "not-detached" });
      return;
    }
    const pathNormalized = normalizePath(worktree.path);
    const strictlyInside =
      pathNormalized !== rootNormalized &&
      pathNormalized.startsWith(`${rootNormalized}/`);
    if (!strictlyInside) {
      keep.push({ path: worktree.path, reason: "outside-run-root" });
      return;
    }
    const lastSegment = pathNormalized.split("/").pop() ?? "";
    if (!/^checkout-[a-z]+$/.test(lastSegment)) {
      keep.push({ path: worktree.path, reason: "not-a-reviewer-checkout" });
      return;
    }
    if (worktree.createdAtMs === null) {
      keep.push({ path: worktree.path, reason: "unknown-age" });
      return;
    }
    if (input.nowMs - worktree.createdAtMs > input.staleAfterMs) {
      remove.push({ path: worktree.path, branch: worktree.branch, reason: "stale" });
      return;
    }
    keep.push({ path: worktree.path, reason: "in-progress" });
  });

  return { remove, keep };
}
