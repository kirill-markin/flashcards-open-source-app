import { query, type DatabaseExecutor } from "../../db.js";

export type PrincipalSessionStatus = "valid" | "pending" | "revoked" | "deleted";
type SessionErrorCode = "PRINCIPAL_SIGNOUT_PENDING" | "SESSION_REVOKED" | "ACCOUNT_DELETED";

export class PrincipalSessionError extends Error {
  readonly code: SessionErrorCode;
  readonly statusCode: 401 | 410 | 503;

  constructor(status: Exclude<PrincipalSessionStatus, "valid">) {
    const code = status === "pending" ? "PRINCIPAL_SIGNOUT_PENDING"
      : status === "deleted" ? "ACCOUNT_DELETED" : "SESSION_REVOKED";
    super(status === "pending" ? "Session signout is still pending. Retry sign-in after cleanup completes."
      : status === "deleted" ? "This account has already been deleted." : "This session was revoked. Sign in again.");
    this.name = "PrincipalSessionError";
    this.code = code;
    this.statusCode = status === "pending" ? 503 : status === "deleted" ? 410 : 401;
  }
}

/** Pass only claims returned by the configured Cognito signature/issuer/audience verifier. */
export async function assertVerifiedPrincipalSession(payload: Readonly<{ sub: string; auth_time?: unknown }>): Promise<void> {
  if (typeof payload.sub !== "string" || payload.sub.trim() === "") throw new PrincipalSessionError("revoked");
  const originalAuthTime = typeof payload.auth_time === "number" && Number.isSafeInteger(payload.auth_time)
    && payload.auth_time >= 0 && payload.auth_time <= Math.floor(Date.now() / 1_000) + 30
    ? payload.auth_time : null;
  const result = await query<Readonly<{ status: PrincipalSessionStatus }>>(
    "SELECT auth.principal_session_status($1, $2) AS status", [payload.sub, originalAuthTime],
  );
  const status = result.rows[0]?.status;
  if (status === undefined) throw new Error("Principal session validation returned no result");
  if (status !== "valid") throw new PrincipalSessionError(status);
}

/** Caller freshly authorizes this action and keeps its stable operation id for transaction retries. */
export async function invalidatePrincipalSessionsInExecutor(
  executor: DatabaseExecutor, cognitoSubject: string, operationId: string,
): Promise<void> {
  await executor.query("SELECT auth.invalidate_principal_sessions($1, $2)", [cognitoSubject, operationId]);
}
