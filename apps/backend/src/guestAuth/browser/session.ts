import { hasCognitoIdentityMappingForUserInExecutor, resolveCanonicalAccountIdInExecutor } from "../../auth/userIdentities";
import { unsafeTransaction } from "../../database/unsafe";
import { createBrowserGuestSessionInExecutor } from "../session";
import { loadGuestSessionRecordInExecutor } from "../store/session";
import { loadGuestWorkspaceIdOrNullInExecutor } from "../store/workspace";
import type { GuestSessionSnapshot } from "../types";

export type BrowserGuestSession =
  | Readonly<{ status: "absent" | "invalid" | "revoked" }>
  | Readonly<{
    status: "active" | "pending_upgrade";
    sessionId: string;
    userId: string;
    workspaceId: string | null;
    purpose: "browser_product";
    platform: "web";
  }>;

export function loadBrowserGuestSession(guestToken: string | undefined): Promise<BrowserGuestSession> {
  if (guestToken === undefined) {
    return Promise.resolve({ status: "absent" });
  }
  return unsafeTransaction<BrowserGuestSession>(async (executor) => {
    const session = await loadGuestSessionRecordInExecutor(executor, guestToken, false);
    if (session === null || session.purpose !== "browser_product" || session.platform !== "web") {
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

export function createBrowserGuestSession(idempotencyKey: string): Promise<GuestSessionSnapshot> {
  return unsafeTransaction((executor) => createBrowserGuestSessionInExecutor(executor, idempotencyKey));
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
