import { type ChangeEvent, type ReactElement } from "react";
import { CardFormTagsField } from "./CardFormTagsField";
import type { Card, EffortLevel, TagSuggestion } from "../types";

export type CardFormState = Readonly<{
  frontText: string;
  backText: string;
  tags: ReadonlyArray<string>;
  effortLevel: EffortLevel;
}>;

type Props = Readonly<{
  tagSuggestions: ReadonlyArray<TagSuggestion>;
  currentCard: Card | null;
  formState: CardFormState;
  formIdPrefix: string;
  isSaving: boolean;
  onChange: (nextFormState: CardFormState) => void;
}>;

function formatTimestamp(value: string | null): string {
  if (value === null) {
    return "new";
  }

  return new Date(value).toLocaleString();
}

export function toCardFormState(card: Card | null): CardFormState {
  if (card === null) {
    return {
      frontText: "",
      backText: "",
      tags: [],
      effortLevel: "fast",
    };
  }

  return {
    frontText: card.frontText,
    backText: card.backText,
    tags: card.tags,
    effortLevel: card.effortLevel,
  };
}

export function isCardFormStateDirty(card: Card | null, formState: CardFormState): boolean {
  const currentState = toCardFormState(card);
  return currentState.frontText !== formState.frontText
    || currentState.backText !== formState.backText
    || currentState.effortLevel !== formState.effortLevel
    || currentState.tags.length !== formState.tags.length
    || currentState.tags.some((tag, index) => tag !== formState.tags[index]);
}

export function CardFormFields(props: Props): ReactElement {
  const { tagSuggestions, currentCard, formState, formIdPrefix, isSaving, onChange } = props;
  const frontFieldId = `${formIdPrefix}-front-text`;
  const backFieldId = `${formIdPrefix}-back-text`;
  const tagsFieldId = `${formIdPrefix}-tags-input`;
  const effortFieldId = `${formIdPrefix}-effort-level`;

  function updateField<Key extends keyof CardFormState>(key: Key, value: CardFormState[Key]): void {
    onChange({
      ...formState,
      [key]: value,
    });
  }

  return (
    <div className="card-form-layout">
      <section className="card-form-panel">
        <label className="form-label content-card content-card-section" htmlFor={frontFieldId}>
          <span>Front</span>
          <textarea
            id={frontFieldId}
            name="frontText"
            className="settings-input form-textarea"
            rows={7}
            value={formState.frontText}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => updateField("frontText", event.target.value)}
          />
        </label>

        <label className="form-label content-card content-card-section" htmlFor={backFieldId}>
          <span>Back</span>
          <textarea
            id={backFieldId}
            name="backText"
            className="settings-input form-textarea"
            rows={9}
            value={formState.backText}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => updateField("backText", event.target.value)}
          />
        </label>

        <div className="form-label content-card content-card-section">
          <label htmlFor={tagsFieldId}>
            <span>Tags</span>
          </label>
          <CardFormTagsField
            value={formState.tags}
            suggestions={tagSuggestions}
            inputId={tagsFieldId}
            inputName="tags"
            onChange={(nextValue) => updateField("tags", nextValue)}
            disabled={isSaving}
          />
        </div>

        <label className="form-label content-card content-card-section" htmlFor={effortFieldId}>
          <span>Effort</span>
          <select
            id={effortFieldId}
            name="effortLevel"
            className="settings-select"
            value={formState.effortLevel}
            onChange={(event) => updateField("effortLevel", event.target.value as EffortLevel)}
          >
            <option value="fast">fast</option>
            <option value="medium">medium</option>
            <option value="long">long</option>
          </select>
        </label>
      </section>

      <aside className="card-meta-panel">
        <h2 className="panel-subtitle">Read-only metadata</h2>
        <dl className="meta-list">
          <div className="meta-row">
            <dt>Card ID</dt>
            <dd className="meta-value-mono">{currentCard?.cardId ?? "new"}</dd>
          </div>
          <div className="meta-row">
            <dt>Due</dt>
            <dd className="meta-value-mono">{formatTimestamp(currentCard?.dueAt ?? null)}</dd>
          </div>
          <div className="meta-row">
            <dt>Reps</dt>
            <dd className="meta-value-mono">{currentCard?.reps ?? 0}</dd>
          </div>
          <div className="meta-row">
            <dt>Lapses</dt>
            <dd className="meta-value-mono">{currentCard?.lapses ?? 0}</dd>
          </div>
          <div className="meta-row">
            <dt>Updated</dt>
            <dd className="meta-value-mono">{formatTimestamp(currentCard?.updatedAt ?? null)}</dd>
          </div>
        </dl>
      </aside>
    </div>
  );
}
