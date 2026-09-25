import { randomBytes } from "node:crypto";
import type { EntitlementTier } from "../billing/tiers";
import { unsafeQuery } from "../database/unsafe";
import {
  captureBackendRuntimeWarning,
  createBackendRuntimeObservationScope,
} from "../observability/runtime";
import {
  getBackendErrorLogDetails,
  type AiUsageMeteringDetails,
  type BackendObservationScope,
} from "../observability/sentry";
import { countersCarryWeightedAiUsage } from "./cap";

/**
 * The surfaces that spend provider money, in the vocabulary the `usage_events_surface_valid` check
 * constraint fixes (db/migrations/0152_ai_usage_facts.sql). A new surface is a migration, not a new
 * string here.
 */
export type AiUsageSurface = "chat" | "dictation" | "card_image" | "composer_suggestion";

export type AiUsageProvider = "openai";

/**
 * What one provider call reported, raw and unweighted, with one field per stored counter column.
 * Every field is nullable because no surface reports all of them, and a counter a call did not report
 * is NULL rather than zero.
 *
 * `cacheWriteTokens` is recorded even though every price this repository would multiply it by is zero
 * today: the pinned OpenAI SDK reports it (`usage.input_tokens_details.cache_write_tokens` on the
 * Responses API), and what a fact table stores is what the provider said, not what it costs. Pricing it
 * at zero is a row in `ai.model_prices`, not a column left NULL by the writer.
 *
 * `cacheReadTokens`, `cacheWriteTokens` and `reasoningTokens` are breakdowns of `inputTokens` and
 * `outputTokens` on the OpenAI APIs this repository calls, not additions to them, so nothing may sum
 * them all.
 */
export type AiUsageCounters = Readonly<{
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  reasoningTokens: number | null;
  audioSeconds: number | null;
}>;

/**
 * One provider call, ready to append. `counters` is `null` when the provider's response carried no
 * usage object at all: the row is still written, with every counter NULL, and the gap is reported.
 * Nothing here is ever estimated.
 *
 * `imageCount`, `imageSize` and `imageQuality` sit beside `counters` rather than inside it because
 * they are facts of the call rather than of the provider's usage report: an image surface knows what
 * it asked for and what came back even when the provider reports no tokens.
 *
 * `userSuppliedKey` is true when the call was paid with an API key the person supplied rather than the
 * platform key; such a row never counts against the monthly allowance (`cap.ts`).
 */
export type AiUsageEvent = Readonly<{
  userId: string;
  workspaceId: string | null;
  occurredAt: Date;
  surface: AiUsageSurface;
  provider: AiUsageProvider;
  modelId: string;
  requestId: string | null;
  tierAtCall: EntitlementTier;
  counters: AiUsageCounters | null;
  imageCount: number | null;
  imageSize: string | null;
  imageQuality: string | null;
  userSuppliedKey: boolean;
}>;

/** The append selects nothing back, and the query helper still needs a row shape for its generic. */
type NoReturnedRow = Record<string, never>;

/**
 * What a surface that is handed its identity rather than reading it from a request needs in order to
 * attribute the fact it appends. The chat worker resolves the tier once per run and passes it down,
 * because resolving it per model call would read the billing tables thirty times for one turn.
 */
export type AiUsageCallAttribution = Readonly<{
  workspaceId: string | null;
  requestId: string | null;
  tierAtCall: EntitlementTier;
}>;

const uuidByteCount = 16;
const uuidVersionByteIndex = 6;
const uuidVariantByteIndex = 8;

const APPEND_AI_USAGE_EVENT_SQL = [
  "INSERT INTO ai.usage_events (",
  "usage_event_id, user_id, workspace_id, occurred_at, surface, provider, model_id, request_id,",
  "tier_at_call, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,",
  "reasoning_tokens, audio_seconds, image_count, image_size, image_quality, user_supplied_key",
  ") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)",
].join(" ");

/**
 * UUID version 7, ported from `createAnalyticsUuidV7` in `apps/web/src/analytics/identity.ts` the way
 * `createAuthAnalyticsUuidV7` in `apps/auth/src/server/analytics/catalog.ts` already ports it, because
 * no module is shared across these apps. `randomUUID()` is version 4 and not time-ordered, and
 * `ai.usage_events.usage_event_id` has no database default, so the writer mints the id and a
 * time-ordered one keeps an append-only table's inserts at the end of its primary key.
 */
function createAiUsageEventId(occurredAtMs: number): string {
  const bytes = randomBytes(uuidByteCount);
  bytes[0] = Math.floor(occurredAtMs / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(occurredAtMs / 2 ** 32) & 0xff;
  bytes[2] = Math.floor(occurredAtMs / 2 ** 24) & 0xff;
  bytes[3] = Math.floor(occurredAtMs / 2 ** 16) & 0xff;
  bytes[4] = Math.floor(occurredAtMs / 2 ** 8) & 0xff;
  bytes[5] = occurredAtMs & 0xff;
  bytes[uuidVersionByteIndex] = (bytes[uuidVersionByteIndex] & 0x0f) | 0x70;
  bytes[uuidVariantByteIndex] = (bytes[uuidVariantByteIndex] & 0x3f) | 0x80;

  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

/**
 * The runtime scope carries the service the process was initialized as, which is what tells a chat
 * worker's metering gap apart from an API one. It is built through the runtime emitter rather than the
 * Sentry one on purpose: the Sentry helper refuses to build a scope before initialization, and nothing
 * in this file may throw.
 */
function createAiUsageScope(event: AiUsageEvent): BackendObservationScope {
  return {
    ...createBackendRuntimeObservationScope(),
    requestId: event.requestId,
    userId: event.userId,
    workspaceId: event.workspaceId,
  };
}

function createAiUsageMeteringDetails(event: AiUsageEvent): AiUsageMeteringDetails {
  return {
    surface: event.surface,
    provider: event.provider,
    modelId: event.modelId,
    tierAtCall: event.tierAtCall,
  };
}

/**
 * Appends one row per provider call and never rejects.
 *
 * A failed append is reported as a warning rather than thrown, and this is the one place in the
 * metering path where a failure is not propagated: the provider has already been paid by the time
 * this runs, so throwing would lose the row and the caller's answer instead of only the row. The
 * warning carries the surface, the provider and the model, so an unmetered call is visible and
 * countable rather than silent.
 */
export async function appendAiUsageEvent(event: AiUsageEvent): Promise<void> {
  const counters = event.counters;
  try {
    // Inside the try, and before the append, because `captureBackendRuntimeWarning` is the only other
    // statement in this function that could throw: a warning that fails must not fail the caller's turn,
    // and if it does fail here the append never ran, which is exactly what the catch below reports.
    if (counters === null) {
      captureBackendRuntimeWarning({
        action: "ai_usage_counters_missing",
        message: "An AI provider call reported no usage, so its usage fact was stored with null counters.",
        scope: createAiUsageScope(event),
        details: createAiUsageMeteringDetails(event),
      });
    } else if (!countersCarryWeightedAiUsage(counters)) {
      captureBackendRuntimeWarning({
        action: "ai_usage_counters_unweighted",
        message:
          "An AI provider call reported only counters the weighted total gives no weight, so it adds zero to it.",
        scope: createAiUsageScope(event),
        details: createAiUsageMeteringDetails(event),
      });
    }

    await unsafeQuery<NoReturnedRow>(APPEND_AI_USAGE_EVENT_SQL, [
      createAiUsageEventId(event.occurredAt.getTime()),
      event.userId,
      event.workspaceId,
      event.occurredAt.toISOString(),
      event.surface,
      event.provider,
      event.modelId,
      event.requestId,
      event.tierAtCall,
      counters?.inputTokens ?? null,
      counters?.outputTokens ?? null,
      counters?.cacheReadTokens ?? null,
      counters?.cacheWriteTokens ?? null,
      counters?.reasoningTokens ?? null,
      counters?.audioSeconds ?? null,
      event.imageCount,
      event.imageSize,
      event.imageQuality,
      event.userSuppliedKey,
    ]);
  } catch (error) {
    const errorDetails = getBackendErrorLogDetails(error);
    captureBackendRuntimeWarning({
      action: "ai_usage_event_write_failed",
      message: "An AI provider call was paid for but its usage fact could not be stored.",
      scope: createAiUsageScope(event),
      details: {
        ...createAiUsageMeteringDetails(event),
        errorClass: errorDetails.errorClass,
        errorMessage: errorDetails.errorMessage,
      },
    });
  }
}
