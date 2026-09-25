import {
  resolveEntitlementLimits,
  type AccountKind,
} from "../billing/limits";
import { resolveEntitlementSnapshotForUser } from "../billing/snapshot";
import {
  freeEntitlementTier,
  type EntitlementTier,
} from "../billing/tiers";
import { unsafeQuery } from "../database/unsafe";
import {
  captureBackendRuntimeWarning,
  createBackendRuntimeObservationScope,
} from "../observability/runtime";
import {
  getBackendErrorLogDetails,
  type BackendWarningEvent,
} from "../observability/sentry";
import { HttpError } from "../shared/errors";
import type { AiUsageCounters } from "./record";

/**
 * The error code a refused chat turn carries for a signed-in account.
 */
export const aiLimitReachedCode: string = "AI_LIMIT_REACHED";

/**
 * The error code a refused chat turn carries for a guest, with the same status and body. Guests keep it
 * because released iOS and Android builds recognise only this code for the create-account prompt; the
 * guest branch can go once no supported mobile release depends on it.
 */
export const guestAiLimitReachedCode: string = "GUEST_AI_LIMIT_REACHED";

/**
 * Carried under both codes, verbatim from the original guest quota. A client that only knows the guest
 * code falls back to showing this string, so changing it would change what already-released clients say.
 */
const aiLimitReachedMessage =
  "Your free monthly AI limit is used up on this device. Create an account to keep going.";

/**
 * How raw counters become the one number the heavy-spend warning and the usage report read. Output
 * tokens weigh six times an input token. Nothing is refused on this number: the allowance is counted in
 * chat messages.
 *
 * Only the two token counters take part. `cache_read_tokens`, `cache_write_tokens` and
 * `reasoning_tokens` are breakdowns of those two on the OpenAI APIs this repository calls, so weighting
 * them as well would count the same token twice. `audio_seconds` and `image_count` carry no weight
 * because every surface here reports tokens today.
 *
 * A row that carries none of the weighted counters therefore weighs zero until a weight is decided for
 * the counter it does carry. That is the standing decision for the duration-billed transcription shape
 * in particular: a `{ type: "duration" }` dictation report is recorded, is priceable against
 * `ai.model_prices`, and adds nothing to the weighted total. No weight is invented for it here, because
 * the weight of a second of audio is a pricing decision rather than an arithmetic one. It is not silent
 * either: `appendAiUsageEvent` warns on every such row through `countersCarryWeightedAiUsage` below, so
 * the gap is countable while it lasts.
 */
export const aiWeightedOutputTokenMultiplier: number = 6;

/**
 * Whether a counters object carries anything the weighting above turns into a number. It lives beside
 * that weighting on purpose: the predicate and the SQL that weighs the rows must never disagree about
 * which counters count.
 */
export function countersCarryWeightedAiUsage(counters: AiUsageCounters): boolean {
  return counters.inputTokens !== null || counters.outputTokens !== null;
}

const MONTHLY_WEIGHTED_TOKENS_SQL = [
  "SELECT COALESCE(SUM(",
  "COALESCE(input_tokens, 0)",
  `+ (${String(aiWeightedOutputTokenMultiplier)} * COALESCE(output_tokens, 0))`,
  "), 0)::bigint AS weighted_tokens",
  "FROM ai.usage_events",
  "WHERE user_id = $1 AND occurred_at >= $2 AND occurred_at < $3 AND user_supplied_key = false",
].join(" ");

type MonthlyWeightedTokensRow = Readonly<{
  weighted_tokens: string | number;
}>;

/**
 * One message is one chat turn that reached the model: every model call a turn makes appends a `chat`
 * row carrying the run's `request_id`, so the turn is the distinct `request_id`, however many calls it
 * took. Composer suggestions, dictation and card images are other surfaces and are never counted.
 */
const MONTHLY_MESSAGES_SQL = [
  "SELECT",
  "COUNT(DISTINCT request_id) FILTER (WHERE user_supplied_key = false)::int AS platform_key_messages,",
  "COUNT(DISTINCT request_id) FILTER (WHERE user_supplied_key = true)::int AS own_key_messages",
  "FROM ai.usage_events",
  "WHERE user_id = $1 AND occurred_at >= $2 AND occurred_at < $3 AND surface = 'chat'",
].join(" ");

type MonthlyMessagesRow = Readonly<{
  platform_key_messages: number;
  own_key_messages: number;
}>;

/**
 * This month's chat messages, split by whose key paid for them. Only `platformKeyMessages` counts
 * against the allowance.
 */
export type AiUsageMonthlyMessages = Readonly<{
  platformKeyMessages: number;
  ownKeyMessages: number;
}>;

/**
 * At or above this many weighted tokens on the platform key in one month, an admitted chat turn is
 * reported so that unusually heavy spend is seen. It refuses nothing.
 */
const aiUsageHeavyWeightedTokensThreshold = 5_000_000;

/**
 * The window a monthly allowance is measured over: `[startsAt, endsAt)`.
 */
export type AiUsageMonthWindow = Readonly<{
  startsAt: Date;
  endsAt: Date;
}>;

/**
 * What this person may spend this month, resolved rather than inferred. `monthlyMessages` is `null`
 * when no cap is enforced for them, which is how the limits table expresses "uncapped" - it is not a
 * missing value and must never be read as zero.
 */
export type AiUsageAllowance = Readonly<{
  tier: EntitlementTier;
  accountKind: AccountKind;
  monthlyMessages: number | null;
}>;

/**
 * The AI spend window is a calendar month in UTC for everybody, whatever timezone they are in. This is
 * the rule's only home in code.
 *
 * It deliberately differs from the progress and streak endpoints, which resolve a day in the caller's
 * timezone and echo it back (`apps/backend/src/progress/timeZone.ts`). Those answer "what did I do
 * today", a question about the person's day; this answers "how much have we paid for", a question about
 * our month. The two must not be unified.
 */
export function getAiUsageMonthWindow(now: Date): AiUsageMonthWindow {
  return {
    startsAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    endsAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}

/**
 * Sums the facts themselves, on the platform key only. A monthly total is never stored: it is derived
 * from the rows every call appended, so a correction is a new row and nothing has to be rewritten, which
 * is what lets `ai.usage_events` stay append-only in the counters: they carry no `UPDATE` grant at all.
 * The columns that name somebody are the exception, and the only one —
 * `db/migrations/0154_ai_usage_identity_rewrites.sql` grants `UPDATE (user_id, workspace_id, request_id)`
 * so an upgrade can move a row and a deletion can anonymise it (`identity.ts`).
 *
 * `SUM` of `bigint` comes back as `numeric`, which the driver hands over as a string.
 */
export async function loadAiUsageWeightedTokensForMonth(
  userId: string,
  window: AiUsageMonthWindow,
): Promise<number> {
  const result = await unsafeQuery<MonthlyWeightedTokensRow>(
    MONTHLY_WEIGHTED_TOKENS_SQL,
    [userId, window.startsAt.toISOString(), window.endsAt.toISOString()],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("The AI monthly usage sum returned no row.");
  }

  const weightedTokens = typeof row.weighted_tokens === "number"
    ? row.weighted_tokens
    : Number.parseInt(row.weighted_tokens, 10);
  if (!Number.isSafeInteger(weightedTokens)) {
    throw new Error(`The AI monthly usage sum is not a readable integer: ${String(row.weighted_tokens)}`);
  }

  return weightedTokens;
}

/**
 * Counts from `ai.usage_events` rather than from the chat tables, because a guest upgrade moves usage
 * rows to the account (`identity.ts`) while the guest's chat sessions are deleted, and an upgrade must
 * not reset the month.
 */
export async function loadAiUsageMessagesForMonth(
  userId: string,
  window: AiUsageMonthWindow,
): Promise<AiUsageMonthlyMessages> {
  const result = await unsafeQuery<MonthlyMessagesRow>(
    MONTHLY_MESSAGES_SQL,
    [userId, window.startsAt.toISOString(), window.endsAt.toISOString()],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("The AI monthly message count returned no row.");
  }

  return {
    platformKeyMessages: row.platform_key_messages,
    ownKeyMessages: row.own_key_messages,
  };
}

/**
 * The person's allowance, read through the billing module so that no surface re-derives a tier or maps
 * one to a number of its own (docs/premium-entitlements.md, "Limits resolve on the backend").
 */
export async function resolveAiUsageAllowance(
  userId: string,
  accountKind: AccountKind,
  now: Date,
): Promise<AiUsageAllowance> {
  const entitlement = await resolveEntitlementSnapshotForUser(userId, accountKind, now);
  return {
    tier: entitlement.tier,
    accountKind,
    monthlyMessages: entitlement.limits.aiMonthlyMessages,
  };
}

/**
 * Refuses the next chat turn once this month's platform-key messages reach the allowance. Only the chat
 * turn is refused: dictation, card images and composer suggestions are never refused here.
 *
 * On an already-resolved allowance this is the half that is safe to call inside somebody else's
 * transaction: it reads `ai.usage_events` and writes nothing, and on an uncapped allowance it returns
 * before reading anything at all.
 */
export async function assertAiUsageAllowanceNotReached(
  allowance: AiUsageAllowance,
  userId: string,
  now: Date,
): Promise<void> {
  const monthlyMessages = allowance.monthlyMessages;
  if (monthlyMessages === null) {
    return;
  }

  const messages = await loadAiUsageMessagesForMonth(userId, getAiUsageMonthWindow(now));
  if (messages.platformKeyMessages >= monthlyMessages) {
    throw new HttpError(
      429,
      aiLimitReachedMessage,
      allowance.accountKind === "guest" ? guestAiLimitReachedCode : aiLimitReachedCode,
    );
  }
}

/**
 * Reports an admitted chat turn from a person whose platform-key weighted tokens this month are at or
 * above the heavy-spend threshold. It refuses nothing, so it never rejects: a failed read is a warning
 * too, and the turn it describes goes on regardless.
 */
export async function reportHeavyAiUsageWeightedTokens(
  allowance: AiUsageAllowance,
  userId: string,
  now: Date,
): Promise<void> {
  let usedWeightedTokens: number;
  try {
    usedWeightedTokens = await loadAiUsageWeightedTokensForMonth(userId, getAiUsageMonthWindow(now));
  } catch (error) {
    const errorDetails = getBackendErrorLogDetails(error);
    captureContainedAiUsageWarning({
      action: "ai_usage_weighted_tokens_read_failed",
      message: "This month's weighted AI usage could not be read for an admitted chat turn.",
      scope: { ...createBackendRuntimeObservationScope(), userId },
      details: {
        tier: allowance.tier,
        accountKind: allowance.accountKind,
        errorClass: errorDetails.errorClass,
        errorMessage: errorDetails.errorMessage,
      },
    });
    return;
  }

  if (usedWeightedTokens < aiUsageHeavyWeightedTokensThreshold) {
    return;
  }

  captureContainedAiUsageWarning({
    action: "ai_usage_weighted_tokens_heavy",
    message: "A chat turn was admitted for a person whose platform-key AI usage this month is unusually heavy.",
    scope: { ...createBackendRuntimeObservationScope(), userId },
    details: {
      tier: allowance.tier,
      accountKind: allowance.accountKind,
      usedWeightedTokens,
      thresholdWeightedTokens: aiUsageHeavyWeightedTokensThreshold,
    },
  });
}

/**
 * The tier a fact is attributed to when the allowance could not be resolved at all. It is the tier
 * everybody holds until a purchase or a grant says otherwise, so the guess understates rather than
 * inventing a paid tier, and it is only ever reached together with the warning beside it.
 */
const fallbackAiUsageTier: EntitlementTier = freeEntitlementTier;

/**
 * Resolves the allowance, or reports that it could not be resolved and returns `null`.
 *
 * `resolveAiUsageAllowance` reads the billing tables and can reject for reasons that have nothing to do
 * with metering - an unreadable stored timestamp, a tier outside the catalogue, a write transaction on a
 * snapshot cache miss - and on the paths below the fallback tier could not have refused the call anyway.
 * Turning that into the caller's answer would fail a request, or abandon a claimed run, over a label.
 */
async function resolveAiUsageAllowanceOrReportFailure(
  userId: string,
  accountKind: AccountKind,
  now: Date,
): Promise<AiUsageAllowance | null> {
  try {
    return await resolveAiUsageAllowance(userId, accountKind, now);
  } catch (error) {
    reportAiUsageAllowanceResolutionFailure(userId, accountKind, error);
    return null;
  }
}

/**
 * Reports a metering warning and cannot fail in its turn. That `resolveAiUsageTierForFacts` and the
 * heavy-spend report never reject, that a caller the fallback tier leaves uncapped is never failed by a
 * billing read, and that the chat route's deferred failure below is recorded whichever way the request
 * ends, all rest on these calls, so each is
 * contained the way `appendAiUsageEvent` contains the same one: on the worker's path a throw here would
 * strand a run that is already claimed until stale-run recovery, over a warning. A reporting failure has
 * nowhere left to be reported, because the sink is what just failed, so it is swallowed rather than
 * rethrown.
 */
function captureContainedAiUsageWarning(event: BackendWarningEvent): void {
  try {
    captureBackendRuntimeWarning(event);
  } catch {
    // Deliberately empty: nothing can be reported about a reporting failure.
  }
}

function reportAiUsageAllowanceResolutionFailure(
  userId: string,
  accountKind: AccountKind,
  error: unknown,
): void {
  const errorDetails = getBackendErrorLogDetails(error);
  captureContainedAiUsageWarning({
    action: "ai_usage_allowance_resolution_failed",
    message: "An AI usage allowance could not be resolved, so the call was attributed to the fallback tier.",
    scope: { ...createBackendRuntimeObservationScope(), userId },
    details: {
      accountKind,
      fallbackTier: fallbackAiUsageTier,
      errorClass: errorDetails.errorClass,
      errorMessage: errorDetails.errorMessage,
    },
  });
}

/**
 * Reports a resolution whose failure a surface captured instead of answering, for a caller the fallback
 * tier caps - today only a guest - who therefore has no allowance to fall back to.
 *
 * It is called where the failure is captured rather than where it is consumed, because one consumer
 * discards it by design: the chat route holds the failure until `prepareChatRun` has told it whether this
 * request is a new turn or a replay of one already persisted. A new turn fails closed and the error is
 * visible in the response; a replay is admitted, correctly - the run exists and nothing is metered twice
 * - and without this report nothing would record that billing was unreadable for it. Reporting here also
 * means no later consumer of that captured outcome has to remember to.
 */
export function reportDeferredAiUsageAllowanceResolutionFailure(
  userId: string,
  accountKind: AccountKind,
  error: unknown,
): void {
  const errorDetails = getBackendErrorLogDetails(error);
  captureContainedAiUsageWarning({
    action: "ai_usage_allowance_resolution_deferred",
    message:
      "An AI usage allowance could not be resolved for a caller the fallback tier caps, so the failure was "
      + "held until the request's outcome was known.",
    scope: { ...createBackendRuntimeObservationScope(), userId },
    details: {
      accountKind,
      errorClass: errorDetails.errorClass,
      errorMessage: errorDetails.errorMessage,
    },
  });
}

/**
 * The tier a surface that only appends attributes its facts to. Never rejects.
 *
 * Dictation and card image generation are never refused, so this is all they resolve. The chat worker
 * resolves it once per claimed run and wants nothing else from it: the allowance was enforced when the
 * turn was accepted, and refusing here would abandon a run the caller is waiting on. An async retry
 * would find the claim and skip, so the turn would hang until stale-run recovery - which is why this
 * path may not reject even when the billing tables are unreadable.
 */
export async function resolveAiUsageTierForFacts(
  userId: string,
  accountKind: AccountKind,
  now: Date,
): Promise<EntitlementTier> {
  const allowance = await resolveAiUsageAllowanceOrReportFailure(userId, accountKind, now);
  return allowance?.tier ?? fallbackAiUsageTier;
}

/**
 * The first half of the enforcement point: what this caller is allowed this month, resolved and nothing
 * else. It is separate from the refusal because the two have different homes when the surface enforcing
 * them is inside a transaction: resolving reads the billing tables and can refresh the derived
 * `billing.entitlement_snapshots` row in a transaction of its own, which must not sit inside somebody
 * else's, while the refusal is a read of already-appended facts and belongs wherever the decision does
 * (`prepareChatRun` in apps/backend/src/chat/runs/lifecycleService.ts).
 *
 * When the fallback tier leaves this account kind uncapped - a free signed-in account today - a failed
 * read is a warning and the call proceeds uncapped on that tier: failing it would protect nothing,
 * because the fallback could never refuse it. A caller the fallback tier caps - a guest - has a refusal
 * that depends on the billing tables being readable, and there a failed read still propagates rather
 * than silently admitting the call.
 */
export async function resolveAiUsageAllowanceForEnforcement(
  userId: string,
  accountKind: AccountKind,
  now: Date,
): Promise<AiUsageAllowance> {
  if (resolveEntitlementLimits(fallbackAiUsageTier, accountKind).aiMonthlyMessages === null) {
    const resolved = await resolveAiUsageAllowanceOrReportFailure(userId, accountKind, now);
    return resolved ?? { tier: fallbackAiUsageTier, accountKind, monthlyMessages: null };
  }

  return resolveAiUsageAllowance(userId, accountKind, now);
}
