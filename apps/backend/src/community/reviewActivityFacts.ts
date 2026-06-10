import { type DatabaseExecutor } from "../database";
import {
  ensurePublicProfileIdForCurrentUserInExecutor,
  type CurrentUserPublicProfileId,
} from "./publicProfiles";

/**
 * Reusable public review activity fact layer.
 *
 * Each raw review event projects into one immutable fact row per metric version
 * in community.public_review_activity_facts. Display names are never stored here;
 * they stay derived at read time from the public profile id and request locale.
 */

export const QUALIFIED_REVIEWS_METRIC_VERSION = "qualified_reviews_v1";

export const REVIEW_ACTIVITY_EXCLUSION_REASON_AGAIN = "again";

export type ReviewActivityFactClassification = Readonly<{
  metricVersion: string;
  isCountable: boolean;
  exclusionReason: string | null;
}>;

export type ReviewActivityFactInput = Readonly<{
  reviewEventId: string;
  rating: number;
  reviewedAtClient: string;
  reviewedAtServer: string;
}>;

/**
 * Classifies one review event for the qualified_reviews_v1 metric.
 *
 * A review counts unless its rating is 0 (again). The `<1s` answer guard is not
 * implemented yet; it will arrive later as a new exclusion reason and/or a new
 * metric version without changing this contract.
 */
export function classifyQualifiedReviewActivity(rating: number): ReviewActivityFactClassification {
  if (rating === 0) {
    return {
      metricVersion: QUALIFIED_REVIEWS_METRIC_VERSION,
      isCountable: false,
      exclusionReason: REVIEW_ACTIVITY_EXCLUSION_REASON_AGAIN,
    };
  }

  return {
    metricVersion: QUALIFIED_REVIEWS_METRIC_VERSION,
    isCountable: true,
    exclusionReason: null,
  };
}

async function upsertReviewActivityFactRowInExecutor(
  executor: DatabaseExecutor,
  profile: CurrentUserPublicProfileId,
  input: ReviewActivityFactInput,
  classification: ReviewActivityFactClassification,
): Promise<void> {
  await executor.query(
    [
      "INSERT INTO community.public_review_activity_facts",
      "(review_event_id, metric_version, public_profile_id, reviewed_by_user_id, rating,",
      "reviewed_at_client, reviewed_at_server, is_countable, exclusion_reason)",
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
      "ON CONFLICT (review_event_id, metric_version) DO NOTHING",
    ].join(" "),
    [
      input.reviewEventId,
      classification.metricVersion,
      profile.publicProfileId,
      profile.userId,
      input.rating,
      input.reviewedAtClient,
      input.reviewedAtServer,
      classification.isCountable,
      classification.exclusionReason,
    ],
  );
}

export type CurrentUserPublicProfileResolver = () => Promise<CurrentUserPublicProfileId>;

/**
 * Resolves and memoizes the scoped user's public profile id once per executor, so a
 * batch of review writes (sync push, review-history import, guest merge) ensures the
 * profile a single time instead of once per event. Resolution stays lazy: callers
 * invoke it only when a review event is actually stored, so a batch with no stored
 * review event never creates a public profile.
 */
export function createCurrentUserPublicProfileResolver(
  executor: DatabaseExecutor,
): CurrentUserPublicProfileResolver {
  let resolvedProfile: Promise<CurrentUserPublicProfileId> | null = null;
  return () => {
    if (resolvedProfile === null) {
      resolvedProfile = ensurePublicProfileIdForCurrentUserInExecutor(executor);
    }

    return resolvedProfile;
  };
}

/**
 * Records the qualified_reviews_v1 fact for one newly written review event in the
 * same transaction as the review event write, owned by the already-resolved public
 * profile of the authenticated author. Idempotent: replaying the same review event
 * never duplicates or recounts a fact.
 */
export async function recordQualifiedReviewActivityFactInExecutor(
  executor: DatabaseExecutor,
  reviewedBy: CurrentUserPublicProfileId,
  input: ReviewActivityFactInput,
): Promise<void> {
  const classification = classifyQualifiedReviewActivity(input.rating);
  await upsertReviewActivityFactRowInExecutor(executor, reviewedBy, input, classification);
}
