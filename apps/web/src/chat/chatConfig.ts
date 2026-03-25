import type { ChatConfig } from "../types";

const chatConfigStorageKey = "flashcards-ai-chat-config";

export const defaultChatConfig: ChatConfig = {
  provider: {
    id: "openai",
    label: "OpenAI",
  },
  model: {
    id: "gpt-5.4",
    label: "GPT-5.4",
    badgeLabel: "GPT-5.4 · Medium",
  },
  reasoning: {
    effort: "medium",
    label: "Medium",
  },
  features: {
    modelPickerEnabled: false,
    dictationEnabled: true,
    attachmentsEnabled: true,
  },
};

export function loadStoredChatConfig(): ChatConfig {
  if (typeof window === "undefined" || typeof window.localStorage?.getItem !== "function") {
    return defaultChatConfig;
  }

  const rawValue = window.localStorage.getItem(chatConfigStorageKey);
  if (rawValue === null) {
    return defaultChatConfig;
  }

  try {
    return JSON.parse(rawValue) as ChatConfig;
  } catch {
    return defaultChatConfig;
  }
}

export function storeChatConfig(chatConfig: ChatConfig): void {
  if (typeof window === "undefined" || typeof window.localStorage?.setItem !== "function") {
    return;
  }

  window.localStorage.setItem(chatConfigStorageKey, JSON.stringify(chatConfig));
}
