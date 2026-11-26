import { isAlreadyReviewed } from "./render";

export interface ReviewDecisionInput {
  headSha: string;
  currentHeadSha: string;
  existingReviewBodies: string[];
}

export type ReviewDecision =
  | { action: "post" }
  | { action: "skip"; reason: "already-reviewed" | "superseded" };

export function decideReview(input: ReviewDecisionInput): ReviewDecision {
  if (isAlreadyReviewed(input.existingReviewBodies, input.headSha)) {
    return { action: "skip", reason: "already-reviewed" };
  }

  if (input.headSha !== input.currentHeadSha) {
    return { action: "skip", reason: "superseded" };
  }

  return { action: "post" };
}
