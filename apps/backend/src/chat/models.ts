export type ChatModelVendor = "openai" | "anthropic";

export type ChatModelDef = Readonly<{
  id: string;
  label: string;
  vendor: ChatModelVendor;
}>;

export const CHAT_MODELS: ReadonlyArray<ChatModelDef> = [
  { id: "claude-opus-4-6", label: "Claude Opus 4.6", vendor: "anthropic" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", vendor: "anthropic" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", vendor: "anthropic" },
  { id: "gpt-5.2", label: "GPT-5.2", vendor: "openai" },
  { id: "gpt-4.1", label: "GPT-4.1", vendor: "openai" },
  { id: "gpt-4.1-mini", label: "GPT-4.1 Mini", vendor: "openai" },
  { id: "gpt-4.1-nano", label: "GPT-4.1 Nano", vendor: "openai" },
];

export const DEFAULT_MODEL_ID = "claude-opus-4-6";
