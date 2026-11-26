import { containsReviewMarker } from "./render";

export interface ReviewDecisionInput {
  headSha: string;
  currentHeadSha: string;
  existingReviewBodies: string[];
}

export type ReviewDecision =
  | { action: "post" }
  | { action: "skip"; reason: "already-reviewed" | "superseded" };

export function decideReview(input: ReviewDecisionInput): ReviewDecision {
  if (input.existingReviewBodies.some((body) => containsReviewMarker(body, input.headSha))) {
    return { action: "skip", reason: "already-reviewed" };
  }

  if (input.headSha !== input.currentHeadSha) {
    return { action: "skip", reason: "superseded" };
  }

  return { action: "post" };
}
