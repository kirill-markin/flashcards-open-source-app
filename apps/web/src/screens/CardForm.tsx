import { type ChangeEvent, type ReactElement } from "react";
import { useI18n } from "../i18n";
import { CardFormTagsField } from "./CardFormTagsField";
import type { Card, EffortLevel, TagSuggestion } from "../types";
import { formatEffortLevelLabel, formatNullableDateTime } from "./featureFormatting";

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
  const { t, formatDateTime } = useI18n();
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
          <span>{t("cardForm.fields.front")}</span>
          <textarea
            id={frontFieldId}
            name="frontText"
            className="settings-input form-textarea"
            rows={7}
            value={formState.frontText}
            data-testid="card-form-front-text"
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => updateField("frontText", event.target.value)}
          />
        </label>

        <label className="form-label content-card content-card-section" htmlFor={backFieldId}>
          <span>{t("cardForm.fields.back")}</span>
          <textarea
            id={backFieldId}
            name="backText"
            className="settings-input form-textarea"
            rows={9}
            value={formState.backText}
            data-testid="card-form-back-text"
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => updateField("backText", event.target.value)}
          />
        </label>

        <div className="form-label content-card content-card-section">
          <label htmlFor={tagsFieldId}>
            <span>{t("cardForm.fields.tags")}</span>
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
          <span>{t("cardForm.fields.effort")}</span>
          <select
            id={effortFieldId}
            name="effortLevel"
            className="settings-select"
            value={formState.effortLevel}
            data-testid="card-form-effort-select"
            onChange={(event) => updateField("effortLevel", event.target.value as EffortLevel)}
          >
            <option value="fast">{formatEffortLevelLabel(t, "fast")}</option>
            <option value="medium">{formatEffortLevelLabel(t, "medium")}</option>
            <option value="long">{formatEffortLevelLabel(t, "long")}</option>
          </select>
        </label>
      </section>

      <aside className="card-meta-panel">
        <h2 className="panel-subtitle">{t("cardForm.meta.title")}</h2>
        <dl className="meta-list">
          <div className="meta-row">
            <dt>{t("cardForm.meta.cardId")}</dt>
            <dd className="meta-value-mono">{currentCard?.cardId ?? t("common.newItem")}</dd>
          </div>
          <div className="meta-row">
            <dt>{t("cardForm.meta.due")}</dt>
            <dd className="meta-value-mono">{formatNullableDateTime(currentCard?.dueAt ?? null, formatDateTime, t)}</dd>
          </div>
          <div className="meta-row">
            <dt>{t("cardForm.meta.reps")}</dt>
            <dd className="meta-value-mono">{currentCard?.reps ?? 0}</dd>
          </div>
          <div className="meta-row">
            <dt>{t("cardForm.meta.lapses")}</dt>
            <dd className="meta-value-mono">{currentCard?.lapses ?? 0}</dd>
          </div>
          <div className="meta-row">
            <dt>{t("cardForm.meta.updated")}</dt>
            <dd className="meta-value-mono">{formatNullableDateTime(currentCard?.updatedAt ?? null, formatDateTime, t)}</dd>
          </div>
        </dl>
      </aside>
    </div>
  );
}
