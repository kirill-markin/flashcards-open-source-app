import { transaction, type DatabaseExecutor } from "../../db.js";
import { verifyCurrentAccountSession } from "../browserSession.js";
import {
  beginAccountConnectionProofs, cancelAccountConnectionProofs, connectionParameters, loadAccountConnectionProofs,
} from "./accountConnectionStore.js";
import { adoptConnectionSuggestion } from "./accountConnectionPreparation.js";
import {
  beginConnectionEmailProof, beginConnectionProviderProof, completeConnectionEmailProof, completeConnectionProviderProof,
} from "./accountConnectionProof.js";
import type {
  ConnectionAction, ConnectionActionResult, ConnectionBinding, ConnectionPreview, ConnectionCommitted, ConnectionReceipt, ConnectionSession,
} from "./accountConnectionContract.js";
import { AccountConnectionError, connectionConsequences } from "./accountConnectionContract.js";
import { requireSignInProvider } from "./publicMethods.js";

function receiptResult(receipt: ConnectionReceipt): ConnectionActionResult {
  if (receipt.outcome === "already_connected") return { status: "already_connected", operation: receipt.operation };
  if (receipt.state === "cancelled") return { status: "cancelled", operation: receipt.operation };
  return { status: receipt.state === "proved" ? "proved" : "proof_required", receipt };
}

/** current is verified by the coordinator; this seam also serves the real PostgreSQL module fixture. */
export async function connectionConsentInExecutor(
  executor: DatabaseExecutor, current: ConnectionSession, binding: ConnectionBinding,
  action: Extract<ConnectionAction, { action: "preview" | "confirm" }>,
): Promise<ConnectionActionResult> {
  await executor.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED", []);
  await executor.query("SET LOCAL statement_timeout = '10s'", []);
  const parameters = [...connectionParameters(action.operation, current, binding), action.omittedWorkspaceIds];
  if (action.action === "preview") {
    const response = await executor.query<Readonly<{ preview: ConnectionPreview }>>(
      "SELECT auth.preview_account_connection($1,$2,$3,$4,$5,$6,$7,$8::uuid[]) AS preview", parameters);
    const preview = response.rows[0]?.preview;
    if (preview === undefined) throw new AccountConnectionError("ACCOUNT_CONNECTION_RESTART_REQUIRED");
    return { status: "preview", operation: action.operation, ...preview, consequences: connectionConsequences };
  }
  const response = await executor.query<Readonly<{ result: ConnectionCommitted }>>(
    "SELECT auth.confirm_account_connection($1,$2,$3,$4,$5,$6,$7,$8::uuid[],$9,$10) AS result",
    [...parameters, action.previewDigest, action.accepted]);
  const result = response.rows[0]?.result;
  if (result === undefined) throw new AccountConnectionError("ACCOUNT_CONNECTION_RESTART_REQUIRED");
  return result;
}

export async function accountConnectionAction(
  sessionToken: string, binding: ConnectionBinding, action: ConnectionAction, source: string,
  browser: Readonly<{ origin: string; secret: string }> | null, authOrigin: string,
): Promise<ConnectionActionResult> {
  switch (action.action) {
    case "begin":
      return receiptResult(await beginAccountConnectionProofs(sessionToken, binding, action.sourceCompletion, action.capability));
    case "adopt":
      return receiptResult(await adoptConnectionSuggestion(sessionToken, binding, action.suggestion, action.capability));
    case "load":
      return receiptResult(await loadAccountConnectionProofs(sessionToken, action.operation, binding));
    case "cancel":
      await cancelAccountConnectionProofs(sessionToken, action.operation, binding);
      return { status: "cancelled", operation: action.operation };
    case "provider_begin": {
      requireSignInProvider(action.provider, binding.client);
      const proof = await beginConnectionProviderProof(sessionToken, action.operation, binding,
        { provider: action.provider, client: binding.client, purpose: "login", codeChallenge: action.codeChallenge }, browser, authOrigin);
      return { status: "provider_required", proof };
    }
    case "provider_complete":
      return receiptResult(await completeConnectionProviderProof(sessionToken, action.operation, binding, action.attempt, action.submission));
    case "email_send": {
      const result = await beginConnectionEmailProof(sessionToken, action.operation, binding, action.email, source);
      return "operation" in result ? receiptResult(result) : { status: "email_required", ...result };
    }
    case "email_verify":
      return receiptResult(await completeConnectionEmailProof(sessionToken, action.operation, binding, action.code));
    case "preview":
    case "confirm": {
      const current = await verifyCurrentAccountSession(sessionToken);
      return transaction((executor) => connectionConsentInExecutor(executor, current, binding, action));
    }
  }
}
