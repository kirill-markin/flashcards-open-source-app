import type { AiUsageCounters } from "./record";

/**
 * What OpenAI reports per call, declared structurally rather than imported from the SDK so that one
 * translation lives here for every surface instead of one per call site. The SDK's own usage types are
 * assignable to these, and the extra fields they carry - totals this repository never stores, because a
 * total is a sum of columns it already has - are simply not read.
 *
 * Every field is optional on purpose. A usage object that arrives without a field it normally carries
 * is a counter this repository does not have, and a missing counter is stored as NULL rather than
 * inferred from the others.
 */
export type OpenAIResponsesUsage = Readonly<{
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: Readonly<{
    cached_tokens?: number;
    cache_write_tokens?: number;
  }>;
  output_tokens_details?: Readonly<{ reasoning_tokens?: number }>;
}>;

/**
 * The audio transcription usage union: OpenAI bills a transcription model either by token or by audio
 * duration and reports whichever applies, discriminated by `type`. Both shapes are handled because the
 * model a surface calls decides which one arrives, and a model change must not silently stop metering.
 *
 * Which one arrives here, checked against the pinned `openai@7.22.0` types for the one call this
 * repository makes (`audio.transcriptions.create` with `model: "gpt-4o-transcribe"` and no
 * `response_format`, so the default `json` and the `Transcription` shape): `usage` is optional and typed
 * `Transcription.Tokens | Transcription.Duration`. `Tokens` is documented as the shape for "models
 * billed by token usage" and carries `input_tokens` and `output_tokens` as required fields;
 * `Duration` is the shape for "models billed by audio input duration" and is what the duration-billed
 * `whisper-1` reports. `gpt-4o-transcribe` is billed by token, so the token branch is the one this
 * surface receives, and a duration-shaped report here means the model changed - which is what makes
 * `appendAiUsageEvent`'s unweighted-counters warning an alarm rather than a formality.
 */
export type OpenAITranscriptionUsage =
  | Readonly<{
    type: "tokens";
    input_tokens?: number;
    output_tokens?: number;
  }>
  | Readonly<{
    type: "duration";
    seconds?: number;
  }>;

export type OpenAIImageUsage = Readonly<{
  input_tokens?: number;
  output_tokens?: number;
}>;

const emptyAiUsageCounters: AiUsageCounters = {
  inputTokens: null,
  outputTokens: null,
  cacheReadTokens: null,
  cacheWriteTokens: null,
  reasoningTokens: null,
  audioSeconds: null,
};

/**
 * Usage from the OpenAI Responses API, which both model-driven surfaces call. Cached input tokens,
 * cache-write tokens and reasoning tokens are recorded as the breakdowns they are: OpenAI counts the
 * first two inside `input_tokens` and the third inside `output_tokens`.
 */
export function toOpenAIResponsesUsageCounters(
  usage: OpenAIResponsesUsage | null | undefined,
): AiUsageCounters | null {
  if (usage === null || usage === undefined) {
    return null;
  }

  return {
    ...emptyAiUsageCounters,
    inputTokens: usage.input_tokens ?? null,
    outputTokens: usage.output_tokens ?? null,
    cacheReadTokens: usage.input_tokens_details?.cached_tokens ?? null,
    cacheWriteTokens: usage.input_tokens_details?.cache_write_tokens ?? null,
    reasoningTokens: usage.output_tokens_details?.reasoning_tokens ?? null,
  };
}

export function toOpenAITranscriptionUsageCounters(
  usage: OpenAITranscriptionUsage | null | undefined,
): AiUsageCounters | null {
  if (usage === null || usage === undefined) {
    return null;
  }

  if (usage.type === "duration") {
    return {
      ...emptyAiUsageCounters,
      audioSeconds: usage.seconds ?? null,
    };
  }

  return {
    ...emptyAiUsageCounters,
    inputTokens: usage.input_tokens ?? null,
    outputTokens: usage.output_tokens ?? null,
  };
}

export function toOpenAIImageUsageCounters(
  usage: OpenAIImageUsage | null | undefined,
): AiUsageCounters | null {
  if (usage === null || usage === undefined) {
    return null;
  }

  return {
    ...emptyAiUsageCounters,
    inputTokens: usage.input_tokens ?? null,
    outputTokens: usage.output_tokens ?? null,
  };
}
