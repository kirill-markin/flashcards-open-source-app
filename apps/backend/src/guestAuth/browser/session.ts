import { hasCognitoIdentityMappingForUserInExecutor, resolveCanonicalAccountIdInExecutor } from "../../auth/userIdentities";
import { unsafeTransaction } from "../../database/unsafe";
import { createBrowserGuestSessionInExecutor } from "../session";
import { loadGuestSessionRecordInExecutor } from "../store/session";
import { loadGuestUpgradeReplayByGuestTokenInExecutor } from "../store/upgradeHistory";
import { loadGuestWorkspaceIdOrNullInExecutor } from "../store/workspace";
import type { GuestSessionSnapshot } from "../types";
import type { GuestBrowserChallengeDecision } from "./challenge";
import { insertGuestBrowserCheckInExecutor } from "./checkRecords";

export type BrowserGuestSession =
  | Readonly<{ status: "absent" | "invalid" | "revoked" }>
  | Readonly<{
    status: "active" | "pending_upgrade";
    sessionId: string;
    userId: string;
    workspaceId: string | null;
    purpose: "browser_product";
    platform: "web";
  }>
  | Readonly<{
    status: "pending_upgrade";
    sessionId: string;
    userId: string;
    workspaceId: null;
    purpose: null;
    platform: null;
    replayOnly: true;
  }>;

export function loadBrowserGuestSession(guestToken: string | undefined): Promise<BrowserGuestSession> {
  if (guestToken === undefined) {
    return Promise.resolve({ status: "absent" });
  }
  return unsafeTransaction<BrowserGuestSession>(async (executor) => {
    const session = await loadGuestSessionRecordInExecutor(executor, guestToken, false);
    if (session === null) {
      // History proves only a committed conversion, never a live product credential.
      const replay = await loadGuestUpgradeReplayByGuestTokenInExecutor(executor, guestToken);
      if (replay === null) return { status: "invalid" };
      return {
        status: "pending_upgrade",
        sessionId: replay.sourceGuestSessionId,
        userId: replay.sourceGuestUserId,
        workspaceId: null,
        purpose: null,
        platform: null,
        replayOnly: true,
      };
    }
    if (session.purpose !== "browser_product" || session.platform !== "web") {
      return { status: "invalid" };
    }
    if (session.revokedAt !== null) {
      return { status: "revoked" };
    }
    const canonicalUserId = await resolveCanonicalAccountIdInExecutor(executor, session.userId);
    const isAccount = canonicalUserId !== session.userId
      || await hasCognitoIdentityMappingForUserInExecutor(executor, session.userId);
    return {
      status: isAccount ? "pending_upgrade" : "active",
      sessionId: session.sessionId,
      userId: session.userId,
      workspaceId: isAccount ? null : await loadGuestWorkspaceIdOrNullInExecutor(executor, session.userId),
      purpose: "browser_product",
      platform: "web",
    };
  });
}

/** challengeDecision is null while the browser check is not configured, which records nothing. */
export function createBrowserGuestSession(
  idempotencyKey: string,
  challengeDecision: GuestBrowserChallengeDecision | null,
): Promise<GuestSessionSnapshot> {
  return unsafeTransaction(async (executor) => {
    const creation = await createBrowserGuestSessionInExecutor(executor, idempotencyKey);
    // A resumed guest was recorded by the attempt that created it.
    if (challengeDecision !== null && creation.minted) {
      await insertGuestBrowserCheckInExecutor(executor, {
        outcome: challengeDecision.outcome,
        flags: challengeDecision.flags,
        facts: challengeDecision.facts,
        failureReason: null,
        turnstileErrorCodes: null,
        guestUserId: creation.session.userId,
      });
    }
    return creation.session;
  });
}

export function forgetBrowserGuestSession(guestToken: string | undefined): Promise<void> {
  if (guestToken === undefined) {
    return Promise.resolve();
  }
  return unsafeTransaction(async (executor) => {
    const session = await loadGuestSessionRecordInExecutor(executor, guestToken, true);
    if (session === null || session.purpose !== "browser_product" || session.platform !== "web") return;
    // Retirement requires no account write scope: an upgraded/retired owner must remain forgettable.
    await executor.query(
      "UPDATE auth.guest_sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE session_id = $1",
      [session.sessionId],
    );
  });
}
