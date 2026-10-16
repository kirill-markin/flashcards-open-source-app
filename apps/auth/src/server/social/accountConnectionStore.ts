import { randomBytes } from "node:crypto";
import { query, type DatabaseExecutor } from "../../db.js";
import { verifyCurrentAccountSession } from "../browserSession.js";
import { requireAuthHandle } from "./attemptContract.js";
import { authAttemptBindingHash, authHandleHash } from "./attemptStore.js";
import {
  AccountConnectionError, type ConnectionBinding, type ConnectionReceipt, type ConnectionRow,
  type ConnectionSession, type ConnectionReplay, type ConnectionSqlParameters,
} from "./accountConnectionContract.js";

export function connectionParameters(operation: string, current: ConnectionSession, binding: ConnectionBinding): ConnectionSqlParameters {
  requireAuthHandle(operation);
  if (binding.purpose !== "reauth") throw new AccountConnectionError("ACCOUNT_CONNECTION_INVALID");
  return [authHandleHash(operation), current.subject, current.username, current.authTime,
    authAttemptBindingHash(binding), binding.client, binding.client === "web" ? binding.origin : null];
}

export function connectionReceipt(operation: string, row: ConnectionRow | undefined): ConnectionReceipt {
  if (row === undefined) throw new AccountConnectionError("ACCOUNT_CONNECTION_RESTART_REQUIRED");
  return { operation, state: row.state, account: row.source_account, targetAccount: row.target_account,
    expiresAt: row.expires_at.toISOString() };
}

/** Private until the public coordinator supplies its alias-aware capability and authenticated transport. */
export async function beginAccountConnectionProofs(
  sessionToken: string, binding: ConnectionBinding, sourceCompletion: string, capability: "canonical-account-v1",
): Promise<ConnectionReceipt> {
  requireAuthHandle(sourceCompletion);
  if (capability !== "canonical-account-v1") throw new AccountConnectionError("ACCOUNT_CONNECTION_INVALID");
  const current = await verifyCurrentAccountSession(sessionToken);
  const operation = randomBytes(32).toString("base64url");
  const result = await query<ConnectionRow>("SELECT * FROM auth.begin_account_connection($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [...connectionParameters(operation, current, binding), authHandleHash(sourceCompletion), capability]);
  return connectionReceipt(operation, result.rows[0]);
}

export async function loadAccountConnectionProofs(
  sessionToken: string, operation: string, binding: ConnectionBinding,
): Promise<ConnectionReceipt> {
  const current = await verifyCurrentAccountSession(sessionToken);
  const result = await query<ConnectionRow>("SELECT * FROM auth.load_account_connection($1,$2,$3,$4,$5,$6,$7)",
    connectionParameters(operation, current, binding));
  return connectionReceipt(operation, result.rows[0]);
}

export async function cancelAccountConnectionProofs(
  sessionToken: string, operation: string, binding: ConnectionBinding,
): Promise<void> {
  const current = await verifyCurrentAccountSession(sessionToken);
  await query("SELECT auth.cancel_account_connection($1,$2,$3,$4,$5,$6,$7)", connectionParameters(operation, current, binding));
}

/** Read-only replay accepts only the exact saved consent; 14b owns the atomic result writer. */
export async function replayAccountConnectionInExecutor(
  executor: DatabaseExecutor, operation: string, current: ConnectionSession, binding: ConnectionBinding, consentDigest: string,
): Promise<ConnectionReplay | null> {
  if (!/^[0-9a-f]{64}$/.test(consentDigest)) throw new AccountConnectionError("ACCOUNT_CONNECTION_INVALID");
  const result = await executor.query<Readonly<{ consent_digest: string; committed_result: string }>>(
    "SELECT * FROM auth.replay_account_connection($1,$2,$3,$4,$5,$6,$7,$8)",
    [...connectionParameters(operation, current, binding), consentDigest]);
  const row = result.rows[0];
  return row === undefined ? null : { consentDigest: row.consent_digest, result: row.committed_result };
}

/** The consent transaction must take retirement locks first and call this before changing ownership. */
export async function claimAccountConnectionProofsInExecutor(
  executor: DatabaseExecutor, operation: string, current: ConnectionSession, binding: ConnectionBinding,
): Promise<ConnectionReceipt> {
  const result = await executor.query<ConnectionRow>(
    "SELECT * FROM auth.claim_account_connection_proofs($1,$2,$3,$4,$5,$6,$7)",
    connectionParameters(operation, current, binding));
  return connectionReceipt(operation, result.rows[0]);
}
