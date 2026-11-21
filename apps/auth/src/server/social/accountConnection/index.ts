import { transaction } from "../../../db.js";
import { verifyCurrentAccountSession } from "../../browserSession.js";
import {
  beginAccountConnectionProofs, cancelAccountConnectionProofs, connectionConsentInExecutor, loadAccountConnectionProofs,
} from "./store.js";
import { adoptConnectionSuggestion } from "./preparation.js";
import {
  beginConnectionEmailProof, beginConnectionProviderProof, completeConnectionEmailProof, completeConnectionProviderProof,
} from "./proof.js";
import type { ConnectionAction, ConnectionActionResult, ConnectionBinding, ConnectionReceipt } from "./contract.js";
import { requireSignInProvider } from "../publicMethods.js";

export {
  AccountConnectionError, type ConnectionAction, type ConnectionActionResult, type ConnectionBinding, type ConnectionSuggestion,
} from "./contract.js";
export { captureConnectionSuggestionInExecutor } from "./preparation.js";
export { completeConnectionBrowserProof } from "./proof.js";
export { loadConnectionProviderBrowserLaunch } from "../attemptStore.js";

function receiptResult(receipt: ConnectionReceipt): ConnectionActionResult {
  if (receipt.outcome === "already_connected") return { status: "already_connected", operation: receipt.operation };
  if (receipt.state === "cancelled") return { status: "cancelled", operation: receipt.operation };
  return { status: receipt.state === "proved" ? "proved" : "proof_required", receipt };
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
