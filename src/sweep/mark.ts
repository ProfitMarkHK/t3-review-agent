import { writeFileSync } from "node:fs";
import { join } from "node:path";

export type MarkMode = "started" | "finished";

export type ParseResult =
  | { ok: true; mode: MarkMode }
  | { ok: false; errors: string[] };

export function parseArguments(args: string[]): ParseResult {
  const errors: string[] = [];
  let started = false;
  let finished = false;

  for (const arg of args) {
    if (arg === "--started") {
      started = true;
    } else if (arg === "--finished") {
      finished = true;
    } else {
      errors.push(`unknown argument: ${arg}`);
    }
  }

  if (started && finished) {
    errors.push("--started and --finished cannot be used together");
  }
  if (!started && !finished) {
    errors.push("exactly one of --started or --finished is required");
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, mode: started ? "started" : "finished" };
}

export const parseMarkArguments = parseArguments;
export const parseMarkRunArguments = parseArguments;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function run(): Promise<number> {
  const parsed = parseArguments(process.argv.slice(2));
  if (!parsed.ok) {
    for (const error of parsed.errors) {
      console.error(error);
    }
    return 2;
  }

  const filename =
    parsed.mode === "started" ? ".t3-review-run" : ".t3-review-run-finished";
  try {
    writeFileSync(join(process.cwd(), filename), `${new Date().toISOString()}\n`, "utf8");
  } catch (error) {
    console.error(`cannot write ${filename}: ${errorMessage(error)}`);
    return 1;
  }
  return 0;
}

try {
  process.exitCode = await run();
} catch (error) {
  console.error(errorMessage(error));
  process.exitCode = 1;
}