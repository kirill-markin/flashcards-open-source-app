import { createHash } from "node:crypto";
import { transactionWithUserScope, type DatabaseExecutor } from "../../database";
import { assertGuestAiFundingAllowed, isBrowserProductGuest } from "../../guestAuth/webPlatform";
import { HttpError } from "../../shared/errors";
import { browserGuestAiTrialEnabled, type BrowserGuestAiTrialFeature, type BrowserGuestTrialContext } from "./policy";
import { reserveBrowserGuestAiTrialInExecutor, startBrowserGuestAiTrialProviderInExecutor,
  type BrowserGuestTrialOperation } from "./repository";

export function resolveFundedBrowserGuestTrial(
  context: BrowserGuestTrialContext,
  hasOwnKey: boolean,
): BrowserGuestTrialContext | undefined {
  if (hasOwnKey || !isBrowserProductGuest(context)) return undefined;
  if (!browserGuestAiTrialEnabled) assertGuestAiFundingAllowed(context, null);
  return context;
}

export function createBrowserGuestTrialOperation(
  feature: BrowserGuestAiTrialFeature,
  identity: string,
  units: number,
  payload: string | Uint8Array,
): BrowserGuestTrialOperation {
  return { operationId: `${feature}:${identity}`, feature, units,
    payloadSha256: createHash("sha256").update(payload).digest("hex") };
}

export function createBrowserGuestChatOperation(sessionId: string, requestId: string): BrowserGuestTrialOperation {
  const identity = `${sessionId}:${requestId}`;
  return createBrowserGuestTrialOperation("chat", createHash("sha256").update(identity).digest("hex"), 1, identity);
}

export async function reserveNewBrowserGuestTrialOperation(
  executor: DatabaseExecutor,
  context: BrowserGuestTrialContext,
  operation: BrowserGuestTrialOperation,
): Promise<void> {
  const receipt = await reserveBrowserGuestAiTrialInExecutor(executor, context, operation);
  if (receipt.outcome === "duplicate") {
    throw new HttpError(409,
      "This AI operation was already admitted. Its provider outcome may be unknown; start a new operation to try again.",
      "BROWSER_GUEST_AI_TRIAL_PROVIDER_OUTCOME_UNKNOWN");
  }
}

export async function startBrowserGuestTrialProvider(
  context: BrowserGuestTrialContext,
  operation: BrowserGuestTrialOperation,
): Promise<void> {
  await transactionWithUserScope({ userId: context.userId }, async (executor) => {
    await startBrowserGuestAiTrialProviderInExecutor(executor, context, operation);
  });
}
