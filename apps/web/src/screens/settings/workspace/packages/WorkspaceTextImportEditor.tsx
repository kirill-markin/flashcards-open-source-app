import { useState, type ReactElement } from "react";
import { useI18n } from "../../../../i18n";
import type { TagSuggestion } from "../../../../types";
import { CardFormTagsField } from "../../../cards/form/CardFormTagsField";
import { parseTextImport, type TextImportCard } from "./textImport";

const maximumTextImportCards = 5_000;
const textImportPreviewPageSize = 25;

type FieldSeparatorChoice = "tab" | "comma" | "custom";
type CardSeparatorChoice = "newline" | "semicolon" | "custom";

type WorkspaceTextImportEditorProps = Readonly<{
  isDisabled: boolean;
  isImporting: boolean;
  errorMessage: string;
  successMessage: string;
  tagSuggestions: ReadonlyArray<TagSuggestion>;
  onImport: (
    cards: ReadonlyArray<TextImportCard>,
    tags: ReadonlyArray<string>,
  ) => Promise<boolean>;
}>;

function resolveFieldSeparator(choice: FieldSeparatorChoice, customSeparator: string): string {
  switch (choice) {
    case "tab":
      return "\t";
    case "comma":
      return ",";
    case "custom":
      return customSeparator;
  }
}

function resolveCardSeparator(choice: CardSeparatorChoice, customSeparator: string): string {
  switch (choice) {
    case "newline":
      return "\n";
    case "semicolon":
      return ";";
    case "custom":
      return customSeparator;
  }
}

function updateTextImportCard(
  cards: ReadonlyArray<TextImportCard>,
  cardId: string,
  fieldName: "frontText" | "backText",
  value: string,
): ReadonlyArray<TextImportCard> {
  return cards.map((card) => {
    if (card.id !== cardId) {
      return card;
    }

    const updatedCard = { ...card, [fieldName]: value };
    return {
      ...updatedCard,
      isValid: updatedCard.frontText.trim() !== "" && updatedCard.backText.trim() !== "",
    };
  });
}

export function WorkspaceTextImportEditor(props: WorkspaceTextImportEditorProps): ReactElement {
  const {
    isDisabled,
    isImporting,
    errorMessage,
    successMessage,
    tagSuggestions,
    onImport,
  } = props;
  const { t } = useI18n();
  const [sourceText, setSourceText] = useState<string>("");
  const [fieldSeparatorChoice, setFieldSeparatorChoice] = useState<FieldSeparatorChoice>("tab");
  const [cardSeparatorChoice, setCardSeparatorChoice] = useState<CardSeparatorChoice>("newline");
  const [customFieldSeparator, setCustomFieldSeparator] = useState<string>("");
  const [customCardSeparator, setCustomCardSeparator] = useState<string>("");
  const [cards, setCards] = useState<ReadonlyArray<TextImportCard>>([]);
  const [tags, setTags] = useState<ReadonlyArray<string>>([]);
  const [pageIndex, setPageIndex] = useState<number>(0);

  const fieldSeparator = resolveFieldSeparator(fieldSeparatorChoice, customFieldSeparator);
  const cardSeparator = resolveCardSeparator(cardSeparatorChoice, customCardSeparator);
  const hasMissingCustomSeparator = (fieldSeparatorChoice === "custom" && fieldSeparator === "")
    || (cardSeparatorChoice === "custom" && cardSeparator === "");
  const invalidCardCount = cards.filter((card) => card.isValid === false).length;
  const exceedsCardLimit = cards.length > maximumTextImportCards;
  const pageCount = Math.max(1, Math.ceil(cards.length / textImportPreviewPageSize));
  const normalizedPageIndex = Math.min(pageIndex, pageCount - 1);
  const visibleCards = cards.slice(
    normalizedPageIndex * textImportPreviewPageSize,
    (normalizedPageIndex + 1) * textImportPreviewPageSize,
  );
  const canImport = cards.length > 0
    && invalidCardCount === 0
    && !exceedsCardLimit
    && !hasMissingCustomSeparator
    && !isDisabled
    && !isImporting;

  function reparse(
    nextSourceText: string,
    nextFieldChoice: FieldSeparatorChoice,
    nextCardChoice: CardSeparatorChoice,
    nextCustomFieldSeparator: string,
    nextCustomCardSeparator: string,
  ): void {
    const nextFieldSeparator = resolveFieldSeparator(nextFieldChoice, nextCustomFieldSeparator);
    const nextCardSeparator = resolveCardSeparator(nextCardChoice, nextCustomCardSeparator);
    setPageIndex(0);
    if (nextFieldSeparator === "" || nextCardSeparator === "") {
      setCards([]);
      return;
    }
    setCards(parseTextImport(nextSourceText, {
      fieldSeparator: nextFieldSeparator,
      cardSeparator: nextCardSeparator,
    }));
  }

  function updateSourceText(nextSourceText: string): void {
    setSourceText(nextSourceText);
    reparse(
      nextSourceText,
      fieldSeparatorChoice,
      cardSeparatorChoice,
      customFieldSeparator,
      customCardSeparator,
    );
  }

  function updateFieldChoice(nextChoice: FieldSeparatorChoice): void {
    setFieldSeparatorChoice(nextChoice);
    reparse(sourceText, nextChoice, cardSeparatorChoice, customFieldSeparator, customCardSeparator);
  }

  function updateCardChoice(nextChoice: CardSeparatorChoice): void {
    setCardSeparatorChoice(nextChoice);
    reparse(sourceText, fieldSeparatorChoice, nextChoice, customFieldSeparator, customCardSeparator);
  }

  async function importCards(): Promise<void> {
    if (!canImport) {
      return;
    }

    if (await onImport(cards, tags)) {
      setSourceText("");
      setCards([]);
      setTags([]);
      setPageIndex(0);
    }
  }

  function deleteInvalidCards(): void {
    const nextCards = cards.filter((card) => card.isValid);
    setCards(nextCards);
    setPageIndex(Math.min(
      normalizedPageIndex,
      Math.max(0, Math.ceil(nextCards.length / textImportPreviewPageSize) - 1),
    ));
  }

  return (
    <article className="content-card workspace-text-import-editor" data-testid="workspace-text-import-editor">
      <div className="settings-nav-card-copy">
        <strong className="panel-subtitle">{t("workspaceImport.textTitle")}</strong>
        <p className="subtitle">{t("workspaceImport.textDescription")}</p>
      </div>

      <label className="workspace-text-import-source">
        <span>{t("workspaceImport.textInputLabel")}</span>
        <textarea
          className="settings-input workspace-text-import-textarea"
          value={sourceText}
          placeholder={t("workspaceImport.textPlaceholder")}
          disabled={isDisabled || isImporting}
          data-testid="workspace-text-import-input"
          onChange={(event) => updateSourceText(event.currentTarget.value)}
        />
      </label>

      <div className="workspace-text-import-separators">
        <fieldset className="workspace-text-import-separator-group">
          <legend>{t("workspaceImport.fieldSeparatorLabel")}</legend>
          <label>
            <input
              type="radio"
              name="workspace-text-import-field-separator"
              checked={fieldSeparatorChoice === "tab"}
              disabled={isDisabled || isImporting}
              onChange={() => updateFieldChoice("tab")}
            />
            <span>{t("workspaceImport.separatorTab")}</span>
          </label>
          <label>
            <input
              type="radio"
              name="workspace-text-import-field-separator"
              checked={fieldSeparatorChoice === "comma"}
              disabled={isDisabled || isImporting}
              onChange={() => updateFieldChoice("comma")}
            />
            <span>{t("workspaceImport.separatorComma")}</span>
          </label>
          <label>
            <input
              type="radio"
              name="workspace-text-import-field-separator"
              checked={fieldSeparatorChoice === "custom"}
              disabled={isDisabled || isImporting}
              onChange={() => updateFieldChoice("custom")}
            />
            <span>{t("workspaceImport.separatorCustom")}</span>
          </label>
          {fieldSeparatorChoice === "custom" ? (
            <input
              className="settings-input workspace-text-import-custom-separator"
              type="text"
              value={customFieldSeparator}
              aria-label={t("workspaceImport.customFieldSeparatorLabel")}
              disabled={isDisabled || isImporting}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setCustomFieldSeparator(value);
                reparse(sourceText, fieldSeparatorChoice, cardSeparatorChoice, value, customCardSeparator);
              }}
            />
          ) : null}
        </fieldset>

        <fieldset className="workspace-text-import-separator-group">
          <legend>{t("workspaceImport.cardSeparatorLabel")}</legend>
          <label>
            <input
              type="radio"
              name="workspace-text-import-card-separator"
              checked={cardSeparatorChoice === "newline"}
              disabled={isDisabled || isImporting}
              onChange={() => updateCardChoice("newline")}
            />
            <span>{t("workspaceImport.separatorNewLine")}</span>
          </label>
          <label>
            <input
              type="radio"
              name="workspace-text-import-card-separator"
              checked={cardSeparatorChoice === "semicolon"}
              disabled={isDisabled || isImporting}
              onChange={() => updateCardChoice("semicolon")}
            />
            <span>{t("workspaceImport.separatorSemicolon")}</span>
          </label>
          <label>
            <input
              type="radio"
              name="workspace-text-import-card-separator"
              checked={cardSeparatorChoice === "custom"}
              disabled={isDisabled || isImporting}
              onChange={() => updateCardChoice("custom")}
            />
            <span>{t("workspaceImport.separatorCustom")}</span>
          </label>
          {cardSeparatorChoice === "custom" ? (
            <input
              className="settings-input workspace-text-import-custom-separator"
              type="text"
              value={customCardSeparator}
              aria-label={t("workspaceImport.customCardSeparatorLabel")}
              disabled={isDisabled || isImporting}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setCustomCardSeparator(value);
                reparse(sourceText, fieldSeparatorChoice, cardSeparatorChoice, customFieldSeparator, value);
              }}
            />
          ) : null}
        </fieldset>
      </div>

      <div className="workspace-text-import-tags form-label">
        <span>{t("cardForm.fields.tags")}</span>
        <CardFormTagsField
          value={tags}
          suggestions={tagSuggestions}
          inputId="workspace-text-import-tags-input"
          inputName="workspace-text-import-tags"
          triggerTestId="workspace-text-import-tags-trigger"
          disabled={isDisabled || isImporting}
          onChange={setTags}
        />
        <p className="subtitle">{t("workspaceImport.textTagsDescription")}</p>
      </div>

      <section className="workspace-text-import-preview" aria-live="polite">
        <div className="workspace-text-import-preview-heading">
          <div>
            <strong>{t("workspaceImport.textPreviewTitle")}</strong>
            <span className="subtitle">{t("workspaceImport.textPreviewCount", { count: cards.length })}</span>
          </div>
          {invalidCardCount === 0 ? null : (
            <span className="workspace-text-import-invalid-count" data-testid="workspace-text-import-invalid-count">
              {t("workspaceImport.textInvalidCount", { count: invalidCardCount })}
            </span>
          )}
        </div>

        {cards.length === 0 ? (
          <p className="subtitle workspace-text-import-empty">{t("workspaceImport.textPreviewEmpty")}</p>
        ) : (
          <div className="workspace-text-import-preview-list">
            {visibleCards.map((card, visibleIndex) => {
              const cardNumber = normalizedPageIndex * textImportPreviewPageSize + visibleIndex + 1;
              return (
                <article
                  key={card.id}
                  className={card.isValid
                    ? "workspace-text-import-preview-row"
                    : "workspace-text-import-preview-row workspace-text-import-preview-row-invalid"}
                  data-testid="workspace-text-import-preview-row"
                >
                  <span className="workspace-text-import-card-number">{cardNumber}</span>
                  <label>
                    <span>{t("cardForm.fields.front")}</span>
                    <textarea
                      value={card.frontText}
                      disabled={isDisabled || isImporting}
                      data-testid="workspace-text-import-front-input"
                      data-card-id={card.id}
                      onChange={(event) => setCards(updateTextImportCard(
                        cards,
                        card.id,
                        "frontText",
                        event.currentTarget.value,
                      ))}
                    />
                  </label>
                  <label>
                    <span>{t("cardForm.fields.back")}</span>
                    <textarea
                      value={card.backText}
                      disabled={isDisabled || isImporting}
                      data-testid="workspace-text-import-back-input"
                      data-card-id={card.id}
                      onChange={(event) => setCards(updateTextImportCard(
                        cards,
                        card.id,
                        "backText",
                        event.currentTarget.value,
                      ))}
                    />
                  </label>
                  <button
                    className="ghost-btn workspace-text-import-remove"
                    type="button"
                    disabled={isDisabled || isImporting}
                    data-testid="workspace-text-import-remove-card"
                    data-card-id={card.id}
                    onClick={() => {
                      const nextCards = cards.filter((candidate) => candidate.id !== card.id);
                      setCards(nextCards);
                      setPageIndex(Math.min(normalizedPageIndex, Math.max(0, Math.ceil(nextCards.length / textImportPreviewPageSize) - 1)));
                    }}
                  >
                    {t("common.delete")}
                  </button>
                </article>
              );
            })}
          </div>
        )}

        {pageCount <= 1 ? null : (
          <nav className="workspace-text-import-pagination" aria-label={t("workspaceImport.textPreviewPaginationLabel")}>
            <button
              className="ghost-btn"
              type="button"
              disabled={normalizedPageIndex === 0 || isDisabled || isImporting}
              onClick={() => setPageIndex(normalizedPageIndex - 1)}
            >
              {t("workspaceImport.previousPage")}
            </button>
            <span>{t("workspaceImport.pageStatus", { current: normalizedPageIndex + 1, total: pageCount })}</span>
            <button
              className="ghost-btn"
              type="button"
              disabled={normalizedPageIndex >= pageCount - 1 || isDisabled || isImporting}
              onClick={() => setPageIndex(normalizedPageIndex + 1)}
            >
              {t("workspaceImport.nextPage")}
            </button>
          </nav>
        )}

        {hasMissingCustomSeparator && sourceText !== "" ? (
          <p className="error-banner">{t("workspaceImport.customSeparatorRequired")}</p>
        ) : null}
        {invalidCardCount === 0 ? null : (
          <div className="error-banner workspace-text-import-invalid-actions">
            <p>{t("workspaceImport.textInvalidHelp")}</p>
            <button
              className="ghost-btn"
              type="button"
              disabled={isDisabled || isImporting}
              data-testid="workspace-text-import-delete-invalid"
              onClick={deleteInvalidCards}
            >
              {t("workspaceImport.textDeleteInvalid")}
            </button>
          </div>
        )}
        {exceedsCardLimit ? (
          <p className="error-banner">{t("workspaceImport.textTooManyCards", { count: maximumTextImportCards })}</p>
        ) : null}
      </section>

      <div className="workspace-export-actions">
        <button
          className="primary-btn"
          type="button"
          disabled={!canImport}
          data-testid="workspace-text-import-confirm-button"
          onClick={() => void importCards()}
        >
          {isImporting
            ? t("workspaceImport.textImporting")
            : t("workspaceImport.textImportButton", { count: cards.length })}
        </button>
      </div>
      {errorMessage === "" ? null : (
        <p className="error-banner" role="alert" data-testid="workspace-import-error">{errorMessage}</p>
      )}
      {successMessage === "" ? null : (
        <p className="subtitle" data-testid="workspace-import-success">{successMessage}</p>
      )}
    </article>
  );
}
