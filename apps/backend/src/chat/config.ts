export const CHAT_VENDOR = "openai" as const;
export const CHAT_MODEL_ID = "gpt-6-sol" as const;
export const CHAT_MODEL_REASONING_EFFORT = "medium" as const;
export const CHAT_MODEL_REASONING_SUMMARY = "auto" as const;
export const CHAT_LOW_COST_MODEL_ID = "gpt-6-luna" as const;
export const CHAT_LOW_COST_MODEL_REASONING_EFFORT = "high" as const;
export const CHAT_COMPOSER_SUGGESTIONS_REASONING_EFFORT = "none" as const;
export const CHAT_MODEL_LABEL = "GPT-6 Sol" as const;
export const CHAT_PROVIDER_LABEL = "OpenAI" as const;
export const CHAT_MODEL_REASONING_LABEL = "Medium" as const;
export const CHAT_MODEL_BADGE_LABEL = `${CHAT_MODEL_LABEL} · ${CHAT_MODEL_REASONING_LABEL}` as const;

/**
 * The configured models support a 1.05M-token context
 * window, but requests above 272K input tokens use long-context pricing. Token
 * sizes are estimated from character length, which under-counts dense,
 * non-Latin, and encrypted content. Cyrillic, CJK, and base64 reasoning tokenize
 * far denser than 4 chars/token, so this is a deliberately conservative cap
 * rather than an exact token count.
 *
 * We keep replayed history well under a 272K operating envelope so that, even
 * when the char-based estimate under-counts, the system prompt, the current
 * turn (which is reserved separately and never truncated), within-run
 * tool-call/reasoning growth, and model output still fit. Budgeting history at
 * 110K leaves roughly 160K of headroom under 272K for that under-counting plus
 * output while avoiding the long-context pricing tier. Full history stays in
 * storage; only the provider input is windowed.
 */
export const CHAT_HISTORY_REPLAY_TOKEN_BUDGET = 110_000 as const;

/**
 * Conservative operating envelope in tokens. This intentionally stays below
 * the configured models' full context window to avoid crossing their
 * 272K input pricing threshold during long tool-driven runs.
 */
export const CHAT_MODEL_OPERATING_CONTEXT_WINDOW_TOKENS = 272_000 as const;

/**
 * In the Responses API this cap covers reasoning tokens plus visible output
 * combined. If the cap fires after visible output has streamed, the loop finishes
 * gracefully with the partial text instead of hard-failing the turn.
 *
 * `CHAT_HISTORY_REPLAY_TOKEN_BUDGET + CHAT_MAX_OUTPUT_TOKENS` (110K + 32K = 142K)
 * stays well under `CHAT_MODEL_OPERATING_CONTEXT_WINDOW_TOKENS` (272K), so the
 * input plus reserved output stays inside the configured operating envelope.
 * Reserving output headroom turns oversized input into a fast, deterministic
 * pre-flight `context_length_exceeded` rejection instead of a mid-generation
 * failure ~30s in. It also bounds within-run growth against the remaining
 * envelope so the loop diverts into the summary turn before base input,
 * continuation, and reserved output can exceed it.
 */
export const CHAT_MAX_OUTPUT_TOKENS = 32_000 as const;

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

/**
 * Returns backend-owned runtime configuration plus legacy client display metadata.
 * First-party AI clients newer than 1.5.0 no longer read `provider`, `model`,
 * `reasoning`, or `features.modelPickerEnabled`. Keep these response fields
 * only for released clients at 1.5.0 and older; clients can render them but
 * cannot override model/provider/reasoning selection.
 */
export function getChatConfig(): ChatConfig {
  return {
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
