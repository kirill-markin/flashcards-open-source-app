/**
 * Server-owned chat configuration shared by backend routes and clients that only need display metadata.
 * This module is the canonical source for the fixed provider, model, and reasoning settings.
 */
export const CHAT_VENDOR = "openai" as const;
export const CHAT_MODEL_ID = "gpt-5.4" as const;
export const CHAT_MODEL_REASONING_EFFORT = "medium" as const;
export const CHAT_MODEL_REASONING_SUMMARY = "auto" as const;
export const CHAT_MODEL_LABEL = "GPT-5.4" as const;
export const CHAT_PROVIDER_LABEL = "OpenAI" as const;
export const CHAT_MODEL_REASONING_LABEL = `${CHAT_MODEL_REASONING_EFFORT.slice(0, 1).toUpperCase()}${CHAT_MODEL_REASONING_EFFORT.slice(1)}` as const;
export const CHAT_MODEL_BADGE_LABEL = `${CHAT_MODEL_LABEL} · ${CHAT_MODEL_REASONING_LABEL}` as const;

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
 * Returns the fixed backend-owned chat configuration that clients can render but not override.
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
    // First-party clients at 1.1.3 no longer read chatConfig.liveUrl at
    // runtime. Keep returning it temporarily for backward compatibility with
    // older released clients, and remove it in a future legacy chat cleanup.
    liveUrl: process.env.CHAT_LIVE_URL || null,
  };
}
