import { transactionWithUserScope, type DatabaseExecutor } from "../../database";
import { isBrowserProductGuest } from "../../guestAuth/webPlatform";
import { HttpError } from "../../shared/errors";
import {
  browserGuestAiTrialEnabled,
  type BrowserGuestAiTrialFeature,
  type BrowserGuestAiTrialScope,
  type BrowserGuestTrialContext,
} from "./policy";
import {
  createBrowserGuestAiTrialQuotaError,
  createBrowserGuestAiTrialIneligibleError,
  type BrowserGuestAiTrialFeatureStatus,
  type BrowserGuestAiTrialStatus,
} from "./contract";

type BudgetRow = Readonly<{
  feature: BrowserGuestAiTrialFeature;
  lifetime_limit: number;
  lifetime_remaining: number;
  shared_daily_limit: number;
  shared_remaining: number;
  resets_at: Date;
  max_recording_seconds: number;
}>;

export type BrowserGuestTrialOperation = Readonly<{
  operationId: string;
  feature: BrowserGuestAiTrialFeature;
  units: number;
  payloadSha256: string;
}>;

export type BrowserGuestTrialReservation = Readonly<{
  outcome: "reserved" | "duplicate";
  state: "reserved" | "provider_started" | "released_no_call";
}>;

type ReservationRow = Readonly<{
  outcome: "reserved" | "duplicate" | "quota" | "conflict";
  reservation_state: BrowserGuestTrialReservation["state"] | null;
  quota_scope: BrowserGuestAiTrialScope | null;
  resets_at: Date | null;
}>;

function assertBrowserGuestContext(context: BrowserGuestTrialContext): void {
  if (!isBrowserProductGuest(context) || context.guestSessionId === null || context.guestSessionId.trim() === "") {
    throw createBrowserGuestAiTrialIneligibleError();
  }
}

async function assertScopedOwner(executor: DatabaseExecutor, context: BrowserGuestTrialContext): Promise<void> {
  assertBrowserGuestContext(context);
  const result = await executor.query<Readonly<{ matches: boolean }>>(
    "SELECT current_setting('app.user_id', true) = $1 AS matches", [context.userId],
  );
  if (result.rows[0]?.matches !== true) {
    throw new Error("Browser guest budget executor must already be scoped to the authenticated owner");
  }
}

function featureStatus(row: BudgetRow): BrowserGuestAiTrialFeatureStatus {
  return {
    lifetimeLimit: row.lifetime_limit,
    lifetimeRemaining: row.lifetime_remaining,
    sharedDailyLimit: row.shared_daily_limit,
    sharedAvailable: row.shared_remaining > 0,
  };
}

export async function readBrowserGuestAiTrialInExecutor(
  executor: DatabaseExecutor,
  context: BrowserGuestTrialContext,
): Promise<BrowserGuestAiTrialStatus> {
  await assertScopedOwner(executor, context);
  const result = await executor.query<BudgetRow>("SELECT * FROM ai.read_browser_guest_trial($1)", [context.guestSessionId]);
  const chat = result.rows.find((row) => row.feature === "chat");
  const dictation = result.rows.find((row) => row.feature === "dictation");
  const images = result.rows.find((row) => row.feature === "images");
  if (chat === undefined || dictation === undefined || images === undefined) {
    throw new Error("Browser guest budget policy did not return all three features");
  }
  return {
    version: 1,
    enabled: browserGuestAiTrialEnabled,
    sharedResetsAt: chat.resets_at.toISOString(),
    maxRecordingSeconds: chat.max_recording_seconds,
    chat: featureStatus(chat),
    dictation: featureStatus(dictation),
    images: featureStatus(images),
  };
}

export async function loadBrowserGuestAiTrialStatus(
  context: BrowserGuestTrialContext,
): Promise<BrowserGuestAiTrialStatus | null> {
  if (!isBrowserProductGuest(context)) return null;
  return transactionWithUserScope({ userId: context.userId },
    async (executor) => readBrowserGuestAiTrialInExecutor(executor, context));
}

// Caller owns the transaction: reserve alongside run creation, before dispatch, without another pool client.
// A duplicate is a receipt, never permission to start another provider invocation.
export async function reserveBrowserGuestAiTrialInExecutor(
  executor: DatabaseExecutor,
  context: BrowserGuestTrialContext,
  operation: BrowserGuestTrialOperation,
): Promise<BrowserGuestTrialReservation> {
  await assertScopedOwner(executor, context);
  const result = await executor.query<ReservationRow>(
    "SELECT * FROM ai.reserve_browser_guest_trial($1, $2, $3, $4, $5)",
    [context.guestSessionId, operation.operationId, operation.feature, operation.units, operation.payloadSha256],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("Browser guest reservation returned no receipt");
  if (row.outcome === "conflict") {
    throw new HttpError(409, "This AI operation ID is already bound to a different owner, feature, amount or payload.",
      "BROWSER_GUEST_AI_TRIAL_OPERATION_CONFLICT");
  }
  if (row.outcome === "quota") {
    if (row.quota_scope === null) throw new Error("Browser guest quota refusal has no scope");
    throw createBrowserGuestAiTrialQuotaError({
      feature: operation.feature, scope: row.quota_scope, resetsAt: row.resets_at?.toISOString() ?? null,
    });
  }
  if (row.reservation_state === null) throw new Error("Browser guest reservation has no state");
  return { outcome: row.outcome, state: row.reservation_state };
}

// Commit this marker before external work; a failed/unknown commit must prevent the call.
export async function startBrowserGuestAiTrialProviderInExecutor(
  executor: DatabaseExecutor,
  context: BrowserGuestTrialContext,
  operation: BrowserGuestTrialOperation,
): Promise<void> {
  await assertScopedOwner(executor, context);
  const result = await executor.query<Readonly<{ started: boolean }>>(
    "SELECT ai.start_browser_guest_trial_provider($1, $2, $3, $4, $5) AS started",
    [context.guestSessionId, operation.operationId, operation.feature, operation.units, operation.payloadSha256],
  );
  if (result.rows[0]?.started !== true) {
    throw new HttpError(409, "This AI operation cannot start again. A prior provider outcome may be unknown and its allowance remains reserved.",
      "BROWSER_GUEST_AI_TRIAL_PROVIDER_OUTCOME_UNKNOWN");
  }
}

// Valid only with proof that no provider invocation started. Unknown outcomes must retain spend.
export async function releaseBrowserGuestAiTrialOnProvenNoCallInExecutor(
  executor: DatabaseExecutor,
  context: BrowserGuestTrialContext,
  operation: BrowserGuestTrialOperation,
): Promise<void> {
  await assertScopedOwner(executor, context);
  const result = await executor.query<Readonly<{ released: boolean }>>(
    "SELECT ai.release_browser_guest_trial_no_call($1, $2, $3, $4) AS released",
    [operation.operationId, operation.feature, operation.units, operation.payloadSha256],
  );
  if (result.rows[0]?.released !== true) {
    throw new HttpError(409, "This AI reservation cannot be released: it is missing, changed, released, or may have reached a provider.",
      "BROWSER_GUEST_AI_TRIAL_RELEASE_REFUSED");
  }
}
