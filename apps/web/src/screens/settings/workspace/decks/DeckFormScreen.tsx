import { useCallback, useEffect, useState, type ChangeEvent, type ReactElement } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAppData } from "../../../../appData";
import { ALL_CARDS_DECK_SLUG, buildDeckFilterDefinition, EFFORT_LEVELS } from "../../../../deckFilters";
import { useI18n } from "../../../../i18n";
import { buildSettingsDeckDetailRoute, settingsDecksRoute } from "../../../../routes";
import { CardFormTagsField } from "../../../cards/CardFormTagsField";
import { loadWorkspaceTagsSummary } from "../../../../localDb/workspace";
import type { EffortLevel, TagSuggestion, UpdateDeckInput } from "../../../../types";
import { formatDeckFilterSummary, formatEffortLevelLabel } from "../../../shared/featureFormatting";

type FormState = Readonly<{
  name: string;
  effortLevels: ReadonlyArray<EffortLevel>;
  tags: ReadonlyArray<string>;
}>;

function createInitialFormState(): FormState {
  return {
    name: "",
    effortLevels: [],
    tags: [],
  };
}

function toggleEffortLevel(
  effortLevels: ReadonlyArray<EffortLevel>,
  effortLevel: EffortLevel,
): ReadonlyArray<EffortLevel> {
  if (effortLevels.includes(effortLevel)) {
    return effortLevels.filter((value) => value !== effortLevel);
  }

  return [...effortLevels, effortLevel];
}

export function DeckFormScreen(): ReactElement {
  const { deckId } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const {
    activeWorkspace,
    createDeckItem,
    getDeckById,
    updateDeckItem,
    setErrorMessage,
    localReadVersion,
  } = useAppData();
  const [formState, setFormState] = useState<FormState>(createInitialFormState());
  const [tagSuggestions, setTagSuggestions] = useState<ReadonlyArray<TagSuggestion>>([]);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [screenErrorMessage, setScreenErrorMessage] = useState<string>("");
  const filterDefinition = buildDeckFilterDefinition(formState.effortLevels, formState.tags);
  const nameFieldId = "deck-name";
  const tagsFieldId = "deck-tags-input";
  const isCreateMode = deckId === undefined;
  const screenTitle = isCreateMode ? t("deckForm.title.new") : t("deckForm.title.edit");
  const backHref = isCreateMode || deckId === undefined ? settingsDecksRoute : buildSettingsDeckDetailRoute(deckId);

  const loadScreenData = useCallback(async function loadScreenData(): Promise<void> {
    setIsLoading(true);
    setScreenErrorMessage("");

    try {
      if (activeWorkspace === null) {
        throw new Error("Workspace is unavailable");
      }

      const [tagsSummary, loadedDeck] = await Promise.all([
        loadWorkspaceTagsSummary(activeWorkspace.workspaceId),
        deckId === undefined
          ? Promise.resolve(null)
          : deckId === ALL_CARDS_DECK_SLUG
            ? Promise.reject(new Error(t("deckForm.systemDeckReadonly")))
            : getDeckById(deckId),
      ]);

      setTagSuggestions(tagsSummary.tags.map((tagSummary) => ({
        tag: tagSummary.tag,
        countState: "ready",
        cardsCount: tagSummary.cardsCount,
      })));
      if (loadedDeck === null) {
        setFormState(createInitialFormState());
      } else {
        setFormState({
          name: loadedDeck.name,
          effortLevels: loadedDeck.filterDefinition.effortLevels,
          tags: loadedDeck.filterDefinition.tags,
        });
      }
    } catch (error) {
      setScreenErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }, [activeWorkspace, deckId, getDeckById, t]);

  useEffect(() => {
    void loadScreenData();
  }, [loadScreenData, localReadVersion]);

  function updateField<Key extends keyof FormState>(key: Key, value: FormState[Key]): void {
    setFormState((currentFormState) => ({
      ...currentFormState,
      [key]: value,
    }));
  }

  async function handleSubmit(): Promise<void> {
    setIsSaving(true);
    setErrorMessage("");

    try {
      const payload: UpdateDeckInput = {
        name: formState.name,
        filterDefinition,
      };

      if (isCreateMode) {
        const createdDeck = await createDeckItem(payload);
        navigate(buildSettingsDeckDetailRoute(createdDeck.deckId));
      } else if (deckId !== undefined) {
        const updatedDeck = await updateDeckItem(deckId, payload);
        navigate(buildSettingsDeckDetailRoute(updatedDeck.deckId));
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return (
      <main className="container">
        <section className="panel">
          <h1 className="title">{screenTitle}</h1>
          <p className="subtitle">{t("loading.deckEditor")}</p>
        </section>
      </main>
    );
  }

  if (screenErrorMessage !== "") {
    return (
      <main className="container">
        <section className="panel">
          <h1 className="title">{screenTitle}</h1>
          <p className="error-banner">{screenErrorMessage}</p>
          <button className="primary-btn" type="button" onClick={() => void loadScreenData()}>
            {t("common.retry")}
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="container">
      <section className="panel">
        <div className="screen-head">
          <div>
            <h1 className="title">{screenTitle}</h1>
            <p className="subtitle">{isCreateMode ? t("deckForm.subtitles.new") : t("deckForm.subtitles.edit")}</p>
          </div>
          <div className="screen-actions">
            <Link className="ghost-btn" to={backHref}>{t("deckForm.actions.back")}</Link>
            <button
              type="button"
              className="primary-btn"
              disabled={isSaving}
              onClick={() => void handleSubmit()}
              data-testid="deck-form-save"
            >
              {isSaving ? t("deckForm.actions.saving") : isCreateMode ? t("deckForm.actions.saveDeck") : t("deckForm.actions.saveChanges")}
            </button>
          </div>
        </div>

        <div className="card-form-layout">
          <section className="card-form-panel">
            <label className="form-label content-card content-card-section" htmlFor={nameFieldId}>
              <span>{t("deckForm.fields.name")}</span>
              <input
                id={nameFieldId}
                name="name"
                className="settings-input"
                value={formState.name}
                data-testid="deck-form-name-input"
                onChange={(event: ChangeEvent<HTMLInputElement>) => updateField("name", event.target.value)}
              />
            </label>

            <div className="form-label content-card content-card-section deck-form-fieldset">
              <span className="deck-form-label">{t("deckForm.fields.effort")}</span>
              <div className="deck-checkbox-list">
                {EFFORT_LEVELS.map((effortLevel) => (
                  <label key={effortLevel} className="deck-checkbox-option">
                    <input
                      id={`deck-effort-${effortLevel}`}
                      name="effortLevels"
                      type="checkbox"
                      checked={formState.effortLevels.includes(effortLevel)}
                      onChange={() => updateField("effortLevels", toggleEffortLevel(formState.effortLevels, effortLevel))}
                    />
                    <span>{formatEffortLevelLabel(t, effortLevel)}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="form-label content-card content-card-section">
              <label htmlFor={tagsFieldId}>
                <span>{t("deckForm.fields.tags")}</span>
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
          </section>

          <aside className="card-meta-panel">
            <h2 className="panel-subtitle">{t("deckForm.filterPreview")}</h2>
            <dl className="meta-list">
              <div className="meta-row">
                <dt>{t("deckForm.fields.summary")}</dt>
                <dd>{formatDeckFilterSummary(filterDefinition, t)}</dd>
              </div>
            </dl>
          </aside>
        </div>
      </section>
    </main>
  );
}
