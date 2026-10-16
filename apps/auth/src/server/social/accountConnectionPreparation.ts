import { randomBytes } from "node:crypto";
import type { DatabaseExecutor } from "../../db.js";
import { query } from "../../db.js";
import { verifyCurrentAccountSession } from "../browserSession.js";
import type { CognitoEmailPrincipal } from "../cognito/cognitoAuth.js";
import { requireAuthHandle } from "./attemptContract.js";
import { authHandleHash, type ClaimedAuthAttempt } from "./attemptStore.js";
import { authoritativeRealProviderEmail, type ProviderEnrollmentProof } from "./principalEnrollment.js";
import { connectionParameters, connectionReceipt } from "./accountConnectionStore.js";
import {
  AccountConnectionError, type ConnectionBinding, type ConnectionReceipt, type ConnectionRow, type ConnectionSuggestion, type ConnectionSession,
} from "./accountConnectionContract.js";

/** Call only with the exact authoritative mailbox prepared before the completion transaction. */
export async function captureConnectionSuggestionInExecutor(
  executor: DatabaseExecutor, attempt: Pick<ClaimedAuthAttempt, "handle" | "claimId" | "provider">,
  proof: ProviderEnrollmentProof, principal: CognitoEmailPrincipal | null,
): Promise<ConnectionSuggestion | null> {
  const email = authoritativeRealProviderEmail(proof);
  if (attempt.provider !== proof.provider || principal === null || email === null || email !== principal.email) return null;
  const suggestion = randomBytes(32).toString("base64url");
  const result = await executor.query<Readonly<{ expires_at: Date | null }>>(
    "SELECT auth.capture_account_connection_suggestion($1,$2,$3,$4,$5,$6) AS expires_at",
    [authHandleHash(suggestion), authHandleHash(attempt.handle), attempt.claimId,
      principal.cognitoSubject, principal.cognitoUsername, principal.email]);
  const row = result.rows[0];
  if (row === undefined) throw new Error("Connection capture returned no outcome");
  return row.expires_at === null ? null : { suggestion, expiresAt: row.expires_at.toISOString() };
}

/** The caller retains the original login browser secret/PKCE verifier through final confirmation.
 * Changing purpose to reauth does not mint a new binding. No target session is ever installed.
 */
export async function adoptConnectionSuggestion(
  sessionToken: string, binding: ConnectionBinding, suggestion: string, capability: "canonical-account-v1",
): Promise<ConnectionReceipt> {
  const current = await verifyCurrentAccountSession(sessionToken);
  return adoptConnectionSuggestionInExecutor({ query }, randomBytes(32).toString("base64url"), current, binding, suggestion, capability);
}

/** current must come from verifyCurrentAccountSession; account/subject fields never come from a request. */
export async function adoptConnectionSuggestionInExecutor(
  executor: DatabaseExecutor, operation: string, current: ConnectionSession, binding: ConnectionBinding,
  suggestion: string, capability: "canonical-account-v1",
): Promise<ConnectionReceipt> {
  requireAuthHandle(suggestion);
  if (capability !== "canonical-account-v1") throw new AccountConnectionError("ACCOUNT_CONNECTION_INVALID");
  const result = await executor.query<ConnectionRow>(
    "SELECT * FROM auth.adopt_account_connection_suggestion($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [...connectionParameters(operation, current, binding), authHandleHash(suggestion), capability]);
  return connectionReceipt(operation, result.rows[0]);
}
