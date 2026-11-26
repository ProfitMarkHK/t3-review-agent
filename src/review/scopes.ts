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
];

export function findReviewScope(id: string): ReviewScope | null {
  return reviewScopes.find((scope) => scope.id === id) ?? null;
}
