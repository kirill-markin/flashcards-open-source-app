import { type ChangeEvent, type ReactElement } from "react";
import { getTagSuggestionsFromCards } from "./CardTagsInput";
import { CardFormTagsField } from "./CardFormTagsField";
import type { Card, EffortLevel } from "../types";

export type CardFormState = Readonly<{
  frontText: string;
  backText: string;
  tags: ReadonlyArray<string>;
  effortLevel: EffortLevel;
}>;

type Props = Readonly<{
  cards: ReadonlyArray<Card>;
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

export function CardFormFields(props: Props): ReactElement {
  const { cards, currentCard, formState, formIdPrefix, isSaving, onChange } = props;
  const tagSuggestions = getTagSuggestionsFromCards(cards);
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
        <label className="form-label" htmlFor={frontFieldId}>
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

        <label className="form-label" htmlFor={backFieldId}>
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

        <div className="form-label">
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

        <label className="form-label" htmlFor={effortFieldId}>
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
            <dd>{currentCard?.cardId ?? "new"}</dd>
          </div>
          <div className="meta-row">
            <dt>Due</dt>
            <dd>{formatTimestamp(currentCard?.dueAt ?? null)}</dd>
          </div>
          <div className="meta-row">
            <dt>Reps</dt>
            <dd>{currentCard?.reps ?? 0}</dd>
          </div>
          <div className="meta-row">
            <dt>Lapses</dt>
            <dd>{currentCard?.lapses ?? 0}</dd>
          </div>
          <div className="meta-row">
            <dt>Updated</dt>
            <dd>{formatTimestamp(currentCard?.updatedAt ?? null)}</dd>
          </div>
        </dl>
      </aside>
    </div>
  );
}
