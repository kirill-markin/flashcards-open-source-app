import { unsafeQuery, unsafeTransaction } from "../database/unsafe";
import { applyUserDatabaseScopeInExecutor } from "../database";
import { resolveCanonicalAccountIdInExecutor } from "./userIdentities";
import { HttpError } from "../shared/errors";

type PrincipalSessionStatus = "valid" | "pending" | "revoked" | "deleted";
export type VerifiedPrincipalSessionClaims = Readonly<{ sub: string; auth_time?: unknown }>;

function assertSessionStatus(status: PrincipalSessionStatus): void {
  if (status === "valid") return;
  if (status === "pending") {
    throw new HttpError(503, "Session signout is still pending. Retry sign-in after cleanup completes.", "PRINCIPAL_SIGNOUT_PENDING", { retryAfterSeconds: 1 });
  }
  if (status === "deleted") throw new HttpError(410, "This account has already been deleted.", "ACCOUNT_DELETED");
  throw new HttpError(401, "This session was revoked. Sign in again.", "SESSION_REVOKED");
}

async function loadVerifiedPrincipalSessionStatus(payload: VerifiedPrincipalSessionClaims): Promise<PrincipalSessionStatus> {
  if (typeof payload.sub !== "string" || payload.sub.trim() === "") throw new HttpError(401, "Cognito token is missing its principal.", "SESSION_REVOKED");
  const originalAuthTime = typeof payload.auth_time === "number" && Number.isSafeInteger(payload.auth_time)
    && payload.auth_time >= 0 && payload.auth_time <= Math.floor(Date.now() / 1_000) + 30
    ? payload.auth_time : null;
  const result = await unsafeQuery<Readonly<{ status: PrincipalSessionStatus }>>(
    "SELECT auth.principal_session_status($1, $2) AS status", [payload.sub, originalAuthTime],
  );
  const status = result.rows[0]?.status;
  if (status === undefined) throw new Error("Principal session validation returned no result");
  return status;
}

/** Pass only claims returned by the configured Cognito signature/issuer/audience verifier. */
export async function assertVerifiedPrincipalSession(payload: VerifiedPrincipalSessionClaims): Promise<void> {
  assertSessionStatus(await loadVerifiedPrincipalSessionStatus(payload));
}

/** A tombstoned subject can only finish its existing request-driven Cognito deletion inventory. */
export async function assertVerifiedAccountDeletionSession(payload: VerifiedPrincipalSessionClaims): Promise<void> {
  const status = await loadVerifiedPrincipalSessionStatus(payload);
  if (status !== "deleted") assertSessionStatus(status);
}

/** Validate the original signed account/time before returning mutable authorization ownership. */
export async function assertAccountLiveSession(userId: string, originalIssuedAt: number): Promise<string> {
  return unsafeTransaction(async (executor) => {
    const result = await executor.query<Readonly<{ status: PrincipalSessionStatus }>>(
      "SELECT auth.account_live_session_status($1, $2) AS status", [userId, originalIssuedAt],
    );
    const status = result.rows[0]?.status;
    if (status === undefined) throw new Error("Chat live session validation returned no result");
    assertSessionStatus(status);
    const canonicalUserId = await resolveCanonicalAccountIdInExecutor(executor, userId);
    await applyUserDatabaseScopeInExecutor(executor, { userId: canonicalUserId });
    return canonicalUserId;
  });
}
