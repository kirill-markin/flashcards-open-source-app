import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactElement } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAppData } from "../../../../appData";
import { useAppErrorDialog } from "../../../../appError/AppErrorContext";
import { ALL_CARDS_DECK_SLUG, buildDeckFilterDefinition } from "../../../../deckFilters";
import { useI18n } from "../../../../i18n";
import { buildSettingsDeckDetailRoute, settingsDecksRoute } from "../../../../routes";
import { CardFormTagsField } from "../../../cards/form/CardFormTagsField";
import { loadWorkspaceTagsSummary } from "../../../../localDb/cards/workspace";
import { captureAppOperationError } from "../../../../observability/appOperationObservation";
import type { TagSuggestion, UpdateDeckInput } from "../../../../types";
import { formatDeckFilterSummary } from "../../../shared/featureFormatting";

type FormState = Readonly<{
  name: string;
  tags: ReadonlyArray<string>;
}>;

function createInitialFormState(): FormState {
  return {
    name: "",
    tags: [],
  };
}

function hasDeckRules(formState: FormState): boolean {
  return formState.tags.length > 0;
}

export function DeckFormScreen(): ReactElement {
  const { deckId } = useParams();
  const navigate = useNavigate();
  const { showCapturedTechnicalError } = useAppErrorDialog();
  const { t } = useI18n();
  const {
    activeWorkspace,
    cloudSettings,
    createDeckItem,
    getDeckById,
    session,
    updateDeckItem,
    setErrorMessage,
    localReadVersion,
  } = useAppData();
  const [formState, setFormState] = useState<FormState>(createInitialFormState());
  const [tagSuggestions, setTagSuggestions] = useState<ReadonlyArray<TagSuggestion>>([]);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [screenErrorMessage, setScreenErrorMessage] = useState<string>("");
  const [formErrorMessage, setFormErrorMessage] = useState<string>("");
  const observationIdentityRef = useRef<Readonly<{
    userId: string | null;
    installationId: string | null;
  }>>({
    userId: null,
    installationId: null,
  });
  const filterDefinition = buildDeckFilterDefinition(formState.tags);
  const nameFieldId = "deck-name";
  const tagsFieldId = "deck-tags-input";
  const isCreateMode = deckId === undefined;
  const screenTitle = isCreateMode ? t("deckForm.title.new") : t("deckForm.title.edit");
  const backHref = isCreateMode || deckId === undefined ? settingsDecksRoute : buildSettingsDeckDetailRoute(deckId);
  const technicalErrorMessage = t("appError.technicalError.message");
  observationIdentityRef.current = {
    userId: session?.userId ?? null,
    installationId: cloudSettings?.installationId ?? null,
  };

  const loadScreenData = useCallback(async function loadScreenData(): Promise<void> {
    setIsLoading(true);
    setScreenErrorMessage("");
    setFormErrorMessage("");

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
          tags: loadedDeck.filterDefinition.tags,
        });
      }
    } catch (error) {
      if (activeWorkspace !== null && deckId !== ALL_CARDS_DECK_SLUG) {
        const observationIdentity = observationIdentityRef.current;
        const wasCaptured = captureAppOperationError(error, {
          feature: "settings",
          operation: "deck_detail_load",
          userId: observationIdentity.userId,
          workspaceId: activeWorkspace.workspaceId,
          installationId: observationIdentity.installationId,
          entityId: deckId ?? null,
        });
        if (wasCaptured) {
          showCapturedTechnicalError(error);
          setScreenErrorMessage(technicalErrorMessage);
          return;
        }
      }
      setScreenErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }, [activeWorkspace, deckId, getDeckById, t]);

  useEffect(() => {
    void loadScreenData();
  }, [loadScreenData, localReadVersion]);

  function updateField<Key extends keyof FormState>(key: Key, value: FormState[Key]): void {
    setFormErrorMessage("");
    setFormState((currentFormState) => ({
      ...currentFormState,
      [key]: value,
    }));
  }

  async function handleSubmit(): Promise<void> {
    setErrorMessage("");
    setFormErrorMessage("");

    if (hasDeckRules(formState) === false) {
      setFormErrorMessage(t("deckForm.errors.emptyRules"));
      return;
    }

    setIsSaving(true);

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
      const wasCaptured = captureAppOperationError(error, {
        feature: "settings",
        operation: "deck_save",
        userId: session?.userId ?? null,
        workspaceId: activeWorkspace?.workspaceId ?? null,
        installationId: cloudSettings?.installationId ?? null,
        entityId: deckId ?? null,
      });
      if (wasCaptured) {
        showCapturedTechnicalError(error);
        setErrorMessage(technicalErrorMessage);
      } else {
        setErrorMessage(error instanceof Error ? error.message : String(error));
      }
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

        {formErrorMessage !== "" ? <p className="error-banner" role="alert">{formErrorMessage}</p> : null}

        <div className="card-form-layout">
          <section className="card-form-panel">
            <section className="content-card content-card-section">
              <p className="subtitle">{t("deckForm.smartFilterExplanation")}</p>
            </section>

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
            <p className="subtitle">{t("deckForm.rulesPreviewHelp")}</p>
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
