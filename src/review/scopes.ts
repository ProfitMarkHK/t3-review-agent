export interface ReviewScope {
  id: string;
  name: string;
  focus: string[];
}

export const reviewScopes: ReviewScope[] = [
  {
    id: "correctness",
    name: "correctness & architecture",
    focus: [
      "logic errors and wrong edge-case handling",
      "broken contracts between callers and callees",
      "error handling and resource cleanup",
      "concurrency and ordering",
      "architecture: misplaced responsibilities, leaky abstractions, needless coupling",
      "tests: changed behaviour without matching test changes, tests that cannot fail, migrations or data changes that are unsafe to roll out or roll back, regressions to existing behaviour",
    ],
  },
  {
    id: "security",
    name: "security & input boundaries",
    focus: [
      "injection (SQL, command, path traversal, template, prompt injection into LLM calls)",
      "authentication and authorisation checks that are missing, weakened or bypassable",
      "secrets, tokens or credentials committed, logged or exposed in errors",
      "validation of untrusted input at trust boundaries (HTTP handlers, CLI args, env, files, webhooks, third-party API responses)",
      "unsafe deserialisation, eval or dynamic code loading",
      "SSRF, open redirects and unsafe URL handling",
      "dependency changes that add risk (new packages, loosened version pins, install scripts)",
      "insecure defaults (CORS, TLS verification off, debug modes, permissive file modes)",
    ],
  },
];

export function findReviewScope(id: string): ReviewScope | null {
  return reviewScopes.find((scope) => scope.id === id) ?? null;
}
