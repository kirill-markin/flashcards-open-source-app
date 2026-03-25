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
}>;

export const CHAT_MODEL: ChatModelDef = {
  id: CHAT_MODEL_ID,
  label: CHAT_MODEL_LABEL,
  vendor: CHAT_VENDOR,
};

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
  };
}

export function isBackendOwnedChatEnabled(): boolean {
  const raw = process.env.AI_CHAT_V2_ENABLED;
  return raw === "1" || raw === "true";
}
