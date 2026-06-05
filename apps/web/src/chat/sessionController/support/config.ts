import type { ChatConfig } from "../../../types";

const chatConfigStorageKey = "flashcards-ai-chat-config";

export const defaultChatConfig: ChatConfig = {
  features: {
    dictationEnabled: true,
    attachmentsEnabled: true,
  },
};

type StoredChatConfigObject = Readonly<Record<string, unknown>>;

function isStoredChatConfigObject(value: unknown): value is StoredChatConfigObject {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

function normalizeStoredChatConfig(value: unknown): ChatConfig {
  if (isStoredChatConfigObject(value) === false || isStoredChatConfigObject(value.features) === false) {
    return defaultChatConfig;
  }

  const dictationEnabled = value.features.dictationEnabled;
  const attachmentsEnabled = value.features.attachmentsEnabled;
  if (typeof dictationEnabled !== "boolean" || typeof attachmentsEnabled !== "boolean") {
    return defaultChatConfig;
  }

  return {
    features: {
      dictationEnabled,
      attachmentsEnabled,
    },
  };
}

export function loadStoredChatConfig(): ChatConfig {
  if (typeof window === "undefined" || typeof window.localStorage?.getItem !== "function") {
    return defaultChatConfig;
  }

  const rawValue = window.localStorage.getItem(chatConfigStorageKey);
  if (rawValue === null) {
    return defaultChatConfig;
  }

  try {
    return normalizeStoredChatConfig(JSON.parse(rawValue));
  } catch (error) {
    if (error instanceof SyntaxError) {
      return defaultChatConfig;
    }

    throw error;
  }
}

export function storeChatConfig(chatConfig: ChatConfig): void {
  if (typeof window === "undefined" || typeof window.localStorage?.setItem !== "function") {
    return;
  }

  window.localStorage.setItem(chatConfigStorageKey, JSON.stringify({
    features: {
      dictationEnabled: chatConfig.features.dictationEnabled,
      attachmentsEnabled: chatConfig.features.attachmentsEnabled,
    },
  }));
}
