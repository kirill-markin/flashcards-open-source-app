/**
 * Server-owned chat configuration shared by backend routes and clients that only need display metadata.
 * This module is the canonical source for the fixed provider, model, and reasoning settings.
 */
export const CHAT_VENDOR = "openai" as const;
export const CHAT_MODEL_ID = "gpt-5.4" as const;
export const CHAT_MODEL_REASONING_EFFORT = "medium" as const;
export const CHAT_MODEL_REASONING_SUMMARY = "auto" as const;
export const CHAT_LOW_COST_MODEL_ID = "gpt-5.4-nano" as const;
export const CHAT_LOW_COST_MODEL_REASONING_EFFORT = "low" as const;
export const CHAT_MODEL_LABEL = "GPT-5.4" as const;
export const CHAT_PROVIDER_LABEL = "OpenAI" as const;
export const CHAT_MODEL_REASONING_LABEL = `${CHAT_MODEL_REASONING_EFFORT.slice(0, 1).toUpperCase()}${CHAT_MODEL_REASONING_EFFORT.slice(1)}` as const;
export const CHAT_MODEL_BADGE_LABEL = `${CHAT_MODEL_LABEL} · ${CHAT_MODEL_REASONING_LABEL}` as const;

/**
 * Maximum estimated token size of replayed chat history sent to the model.
 *
 * gpt-5.4 exposes a standard 272K-token context window (the ~1M window is an
 * experimental opt-in we do not enable). We keep replayed history well under
 * that so the system prompt, the current turn, within-run tool-call/reasoning
 * growth, and model output always fit. Full history stays in storage; only the
 * provider input is windowed. Token sizes are estimated from character length,
 * so this is a conservative cap rather than an exact token count.
 */
export const CHAT_HISTORY_REPLAY_TOKEN_BUDGET = 150_000 as const;

export type ChatRuntimeModelId =
  | typeof CHAT_MODEL_ID
  | typeof CHAT_LOW_COST_MODEL_ID;

export type ChatRuntimeReasoningEffort =
  | typeof CHAT_MODEL_REASONING_EFFORT
  | typeof CHAT_LOW_COST_MODEL_REASONING_EFFORT;

export type ChatModelDef = Readonly<{
  id: typeof CHAT_MODEL_ID;
  label: typeof CHAT_MODEL_LABEL;
  vendor: typeof CHAT_VENDOR;
}>;

export type ChatConfig = Readonly<{
  provider: Readonly<{
    id: typeof CHAT_VENDOR;
    label: typeof CHAT_PROVIDER_LABEL;
  }>;
  model: Readonly<{
    id: typeof CHAT_MODEL_ID;
    label: typeof CHAT_MODEL_LABEL;
    badgeLabel: typeof CHAT_MODEL_BADGE_LABEL;
  }>;
  reasoning: Readonly<{
    effort: typeof CHAT_MODEL_REASONING_EFFORT;
    label: typeof CHAT_MODEL_REASONING_LABEL;
  }>;
  features: Readonly<{
    modelPickerEnabled: false;
    dictationEnabled: true;
    attachmentsEnabled: true;
  }>;
  liveUrl: string | null;
}>;

export const CHAT_MODEL: ChatModelDef = {
  id: CHAT_MODEL_ID,
  label: CHAT_MODEL_LABEL,
  vendor: CHAT_VENDOR,
};

export function parseChatRuntimeModelId(value: string): ChatRuntimeModelId {
  if (value === CHAT_MODEL_ID || value === CHAT_LOW_COST_MODEL_ID) {
    return value;
  }

  throw new Error(`Unsupported persisted chat model_id: ${value}`);
}

export function parseChatRuntimeReasoningEffort(value: string): ChatRuntimeReasoningEffort {
  if (value === CHAT_MODEL_REASONING_EFFORT || value === CHAT_LOW_COST_MODEL_REASONING_EFFORT) {
    return value;
  }

  throw new Error(`Unsupported persisted chat reasoning_effort: ${value}`);
}

/**
 * Returns backend-owned runtime configuration plus legacy client display metadata.
 * First-party AI clients newer than 1.5.0 no longer read `provider`, `model`,
 * `reasoning`, or `features.modelPickerEnabled`. Keep these response fields
 * only for released clients at 1.5.0 and older; clients can render them but
 * cannot override model/provider/reasoning selection.
 */
export function getChatConfig(): ChatConfig {
  return {
    // Legacy response metadata for released clients at 1.5.0 and older. The
    // backend remains the runtime authority for provider, model, and reasoning.
    provider: {
      id: CHAT_VENDOR,
      label: CHAT_PROVIDER_LABEL,
    },
    model: {
      id: CHAT_MODEL_ID,
      label: CHAT_MODEL_LABEL,
      badgeLabel: CHAT_MODEL_BADGE_LABEL,
    },
    reasoning: {
      effort: CHAT_MODEL_REASONING_EFFORT,
      label: CHAT_MODEL_REASONING_LABEL,
    },
    features: {
      // Legacy response metadata for released clients at 1.5.0 and older;
      // model selection is intentionally not client-selectable.
      modelPickerEnabled: false,
      dictationEnabled: true,
      attachmentsEnabled: true,
    },
    // First-party AI clients newer than 1.5.0 no longer read chatConfig.liveUrl
    // at runtime. Keep returning it temporarily for released clients at 1.5.0
    // and older, and remove it in a future legacy chat cleanup.
    liveUrl: process.env.CHAT_LIVE_URL || null,
  };
}
