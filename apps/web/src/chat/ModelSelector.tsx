import type { ReactElement } from "react";
import { CHAT_MODELS, type ChatModelVendor } from "../chatModels";

type Props = Readonly<{
  value: string;
  onChange: (modelId: string) => void;
  locked: boolean;
}>;

const VENDOR_LABELS: Record<ChatModelVendor, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
};

const VENDOR_ORDER: ReadonlyArray<ChatModelVendor> = ["openai", "anthropic"];

export function ModelSelector(props: Props): ReactElement {
  const { value, onChange, locked } = props;

  if (locked) {
    const model = CHAT_MODELS.find((item) => item.id === value);
    return <span className="chat-model-label">{model?.label ?? value}</span>;
  }

  return (
    <select
      className="chat-model-select"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {VENDOR_ORDER.map((vendor) => {
        const models = CHAT_MODELS.filter((model) => model.vendor === vendor);
        return (
          <optgroup key={vendor} label={VENDOR_LABELS[vendor]}>
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}
