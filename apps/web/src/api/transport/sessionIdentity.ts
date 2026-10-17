import type { SessionInfo } from "../../types";

/** Only freshly authenticated server metadata can prove continuity with a stored local owner. */
export function hasLinkedAccountContinuity(
  verifiedSession: SessionInfo,
  localOwnerId: string | null,
): boolean {
  const { canonicalAccountId, linkedAccountIds } = verifiedSession;
  return localOwnerId !== null
    && canonicalAccountId !== undefined
    && linkedAccountIds !== undefined
    && linkedAccountIds.length > 1
    && linkedAccountIds.includes(canonicalAccountId)
    && linkedAccountIds.includes(verifiedSession.userId)
    && linkedAccountIds.includes(localOwnerId);
}

export function projectSessionToLocalOwner(
  verifiedSession: SessionInfo,
  localOwnerId: string | null,
): SessionInfo {
  if (localOwnerId === null || localOwnerId === verifiedSession.userId
    || hasLinkedAccountContinuity(verifiedSession, localOwnerId) === false) {
    return verifiedSession;
  }

  return { ...verifiedSession, userId: localOwnerId };
}
