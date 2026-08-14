import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type ReactElement } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useAppData } from "../../../../appData";
import {
  markIndexedDbOpenRecoveryFailureAndCheckActive,
  type IndexedDbOpenRecoveryState,
  useAppErrorDialog,
} from "../../../../appError/AppErrorContext";
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

type DeckEditorIdentity = Readonly<{
  deckId: string | null;
  mode: "create" | "edit";
  workspaceId: string;
}>;

type RefreshOutcome = "accepted" | "failed" | "stale";

type RefreshBarrier = Readonly<{
  editorIdentity: DeckEditorIdentity;
  generation: number;
  promise: Promise<RefreshOutcome>;
  settle: (outcome: RefreshOutcome) => void;
}>;

async function runRecoveryGuardedLocalRead<ResultType>(
  createRead: () => Promise<ResultType>,
  indexedDbOpenRecoveryState: IndexedDbOpenRecoveryState,
): Promise<ResultType> {
  try {
    indexedDbOpenRecoveryState.throwIfFailed();
    const result = await createRead();
    indexedDbOpenRecoveryState.throwIfFailed();
    return result;
  } catch (error) {
    indexedDbOpenRecoveryState.throwIfFailed();
    indexedDbOpenRecoveryState.markFailed(error);
    indexedDbOpenRecoveryState.throwIfFailed();
    throw error;
  }
}

function createInitialFormState(): FormState {
  return {
    name: "",
    tags: [],
  };
}

function hasDeckRules(formState: FormState): boolean {
  return formState.tags.length > 0;
}

function areTagsEqual(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  return left.length === right.length && left.every((tag, index) => tag === right[index]);
}

function applyAuthoritativeFormState(
  draft: FormState,
  previousBaseline: FormState,
  authoritativeState: FormState,
): FormState {
  return {
    name: draft.name === previousBaseline.name ? authoritativeState.name : draft.name,
    tags: areTagsEqual(draft.tags, previousBaseline.tags) ? authoritativeState.tags : draft.tags,
  };
}

function areDeckEditorIdentitiesEqual(
  left: DeckEditorIdentity | null,
  right: DeckEditorIdentity | null,
): boolean {
  return left !== null
    && right !== null
    && left.deckId === right.deckId
    && left.mode === right.mode
    && left.workspaceId === right.workspaceId;
}

function createRefreshBarrier(
  editorIdentity: DeckEditorIdentity,
  generation: number,
): RefreshBarrier {
  let settlePromise: ((outcome: RefreshOutcome) => void) | undefined;
  const promise = new Promise<RefreshOutcome>((resolve) => {
    settlePromise = resolve;
  });
  if (settlePromise === undefined) {
    throw new Error("Refresh barrier initialization failed");
  }

  return {
    editorIdentity,
    generation,
    promise,
    settle: settlePromise,
  };
}

export function DeckFormScreen(): ReactElement {
  const { deckId } = useParams();
  const navigate = useNavigate();
  const { indexedDbOpenRecoveryState, showCapturedTechnicalError } = useAppErrorDialog();
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
  const [refreshErrorMessage, setRefreshErrorMessage] = useState<string>("");
  const [formErrorMessage, setFormErrorMessage] = useState<string>("");
  const formStateRef = useRef<FormState>(formState);
  const authoritativeFormStateRef = useRef<FormState>(formState);
  const isMountedRef = useRef<boolean>(true);
  const isSavingRef = useRef<boolean>(false);
  const editorIdentityRef = useRef<DeckEditorIdentity | null>(null);
  const renderedEditorIdentityRef = useRef<DeckEditorIdentity | null>(null);
  const loadRequestSequenceRef = useRef<number>(0);
  const latestRelevantRefreshRef = useRef<RefreshBarrier | null>(null);
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
  renderedEditorIdentityRef.current = activeWorkspace === null
    ? null
    : {
      deckId: deckId ?? null,
      mode: isCreateMode ? "create" : "edit",
      workspaceId: activeWorkspace.workspaceId,
    };
  const previousRenderedEditorIdentityRef = useRef<DeckEditorIdentity | null>(
    renderedEditorIdentityRef.current,
  );
  const isEditorInitialized = areDeckEditorIdentitiesEqual(
    editorIdentityRef.current,
    renderedEditorIdentityRef.current,
  );

  useLayoutEffect(() => {
    const previousEditorIdentity = previousRenderedEditorIdentityRef.current;
    const nextEditorIdentity = renderedEditorIdentityRef.current;
    const isSameEditorIdentity = previousEditorIdentity === null
      ? nextEditorIdentity === null
      : areDeckEditorIdentitiesEqual(previousEditorIdentity, nextEditorIdentity);
    if (isSameEditorIdentity) {
      return;
    }

    previousRenderedEditorIdentityRef.current = nextEditorIdentity;
    latestRelevantRefreshRef.current?.settle("stale");
    latestRelevantRefreshRef.current = null;
    editorIdentityRef.current = null;
    loadRequestSequenceRef.current += 1;
    const initialFormState = createInitialFormState();
    formStateRef.current = initialFormState;
    authoritativeFormStateRef.current = initialFormState;
    setFormState(initialFormState);
    setTagSuggestions([]);
    setIsLoading(true);
    setScreenErrorMessage("");
    setRefreshErrorMessage("");
    setFormErrorMessage("");
  }, [activeWorkspace?.workspaceId, deckId, isCreateMode]);

  const loadScreenData = useCallback(function loadScreenData(): Promise<void> {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return Promise.resolve();
    }

    const requestSequence = loadRequestSequenceRef.current + 1;
    loadRequestSequenceRef.current = requestSequence;
    const requestEditorIdentity = renderedEditorIdentityRef.current;
    const isCurrentLoadRequest = function isCurrentLoadRequest(): boolean {
      return loadRequestSequenceRef.current === requestSequence
        && (
          requestEditorIdentity === null
            ? renderedEditorIdentityRef.current === null
            : areDeckEditorIdentitiesEqual(
              renderedEditorIdentityRef.current,
              requestEditorIdentity,
            )
        );
    };
    const isBackgroundRefresh = areDeckEditorIdentitiesEqual(
      editorIdentityRef.current,
      requestEditorIdentity,
    );
    const refreshBarrier = isBackgroundRefresh
      && requestEditorIdentity !== null
      && requestEditorIdentity.mode === "edit"
      ? createRefreshBarrier(requestEditorIdentity, requestSequence)
      : null;
    if (refreshBarrier !== null) {
      latestRelevantRefreshRef.current?.settle("stale");
      latestRelevantRefreshRef.current = refreshBarrier;
    }
    if (isBackgroundRefresh === false) {
      setIsLoading(true);
      setScreenErrorMessage("");
      setRefreshErrorMessage("");
      setFormErrorMessage("");
    }

    return (async function performScreenDataLoad(): Promise<void> {
      let refreshOutcome: RefreshOutcome = "stale";
      try {
        if (activeWorkspace === null || requestEditorIdentity === null) {
          throw new Error("Workspace is unavailable");
        }

        const [tagsSummary, loadedDeck] = await Promise.all([
          runRecoveryGuardedLocalRead(
            () => loadWorkspaceTagsSummary(requestEditorIdentity.workspaceId),
            indexedDbOpenRecoveryState,
          ),
          runRecoveryGuardedLocalRead(
            () => deckId === undefined
              ? Promise.resolve(null)
              : deckId === ALL_CARDS_DECK_SLUG
                ? Promise.reject(new Error(t("deckForm.systemDeckReadonly")))
                : getDeckById(deckId),
            indexedDbOpenRecoveryState,
          ),
        ]);
        indexedDbOpenRecoveryState.throwIfFailed();
        if (isCurrentLoadRequest() === false) {
          return;
        }

        setTagSuggestions(tagsSummary.tags.map((tagSummary) => ({
          tag: tagSummary.tag,
          countState: "ready",
          cardsCount: tagSummary.cardsCount,
        })));
        setRefreshErrorMessage("");
        const authoritativeFormState = loadedDeck === null
          ? createInitialFormState()
          : {
            name: loadedDeck.name,
            tags: loadedDeck.filterDefinition.tags,
          };
        if (isBackgroundRefresh === false) {
          editorIdentityRef.current = requestEditorIdentity;
          formStateRef.current = authoritativeFormState;
          authoritativeFormStateRef.current = authoritativeFormState;
          setFormState(authoritativeFormState);
        } else {
          const nextFormState = applyAuthoritativeFormState(
            formStateRef.current,
            authoritativeFormStateRef.current,
            authoritativeFormState,
          );
          formStateRef.current = nextFormState;
          authoritativeFormStateRef.current = authoritativeFormState;
          setFormState(nextFormState);
        }
        refreshOutcome = "accepted";
      } catch (error) {
        if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
          return;
        }
        if (isCurrentLoadRequest() === false) {
          return;
        }

        refreshOutcome = "failed";
        let errorMessage: string;
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
            if (isBackgroundRefresh === false) {
              showCapturedTechnicalError(error);
            }
            errorMessage = technicalErrorMessage;
          } else {
            errorMessage = error instanceof Error ? error.message : String(error);
          }
        } else {
          errorMessage = error instanceof Error ? error.message : String(error);
        }
        if (isBackgroundRefresh) {
          setRefreshErrorMessage(errorMessage);
        } else {
          setScreenErrorMessage(errorMessage);
        }
      } finally {
        if (isCurrentLoadRequest() && indexedDbOpenRecoveryState.hasFailed() === false) {
          setIsLoading(false);
        }
        refreshBarrier?.settle(refreshOutcome);
      }
    })();
  }, [activeWorkspace, deckId, getDeckById, indexedDbOpenRecoveryState, showCapturedTechnicalError, t, technicalErrorMessage]);

  useLayoutEffect(() => {
    void loadScreenData();
    return () => {
      loadRequestSequenceRef.current += 1;
    };
  }, [loadScreenData, localReadVersion]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      latestRelevantRefreshRef.current?.settle("stale");
      latestRelevantRefreshRef.current = null;
    };
  }, []);

  function updateField<Key extends keyof FormState>(key: Key, value: FormState[Key]): void {
    setFormErrorMessage("");
    const nextFormState = {
      ...formStateRef.current,
      [key]: value,
    };
    formStateRef.current = nextFormState;
    setFormState(nextFormState);
  }

  async function readFormStateAfterLatestRefresh(
    submitEditorIdentity: DeckEditorIdentity,
  ): Promise<FormState | null> {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return null;
    }

    if (submitEditorIdentity.mode === "create") {
      return formStateRef.current;
    }

    const isSubmitEditorCurrent = function isSubmitEditorCurrent(): boolean {
      return isMountedRef.current
        && areDeckEditorIdentitiesEqual(renderedEditorIdentityRef.current, submitEditorIdentity);
    };

    while (isSubmitEditorCurrent()) {
      const refreshBarrier = latestRelevantRefreshRef.current;
      if (
        refreshBarrier === null
        || areDeckEditorIdentitiesEqual(refreshBarrier.editorIdentity, submitEditorIdentity) === false
      ) {
        return formStateRef.current;
      }

      const refreshOutcome = await refreshBarrier.promise;
      if (indexedDbOpenRecoveryState.hasFailed()) {
        return null;
      }
      if (isSubmitEditorCurrent() === false) {
        return null;
      }

      const latestRefreshBarrier = latestRelevantRefreshRef.current;
      if (
        latestRefreshBarrier !== null
        && areDeckEditorIdentitiesEqual(latestRefreshBarrier.editorIdentity, submitEditorIdentity)
        && latestRefreshBarrier.generation !== refreshBarrier.generation
      ) {
        continue;
      }
      if (refreshOutcome !== "accepted") {
        return null;
      }

      return formStateRef.current;
    }

    return null;
  }

  async function handleSubmit(): Promise<void> {
    if (indexedDbOpenRecoveryState.hasFailed() || isSavingRef.current) {
      return;
    }

    isSavingRef.current = true;
    setIsSaving(true);
    setErrorMessage("");
    setFormErrorMessage("");

    try {
      const submitEditorIdentity = renderedEditorIdentityRef.current;
      if (submitEditorIdentity === null) {
        throw new Error("Deck editor is unavailable");
      }
      const latestFormState = await readFormStateAfterLatestRefresh(submitEditorIdentity);
      indexedDbOpenRecoveryState.throwIfFailed();
      if (latestFormState === null) {
        return;
      }
      if (areDeckEditorIdentitiesEqual(renderedEditorIdentityRef.current, submitEditorIdentity) === false) {
        return;
      }
      if (hasDeckRules(latestFormState) === false) {
        setFormErrorMessage(t("deckForm.errors.emptyRules"));
        return;
      }

      const payload: UpdateDeckInput = {
        name: latestFormState.name,
        filterDefinition: buildDeckFilterDefinition(latestFormState.tags),
      };

      if (isCreateMode) {
        const createdDeck = await createDeckItem(payload);
        indexedDbOpenRecoveryState.throwIfFailed();
        navigate(buildSettingsDeckDetailRoute(createdDeck.deckId));
      } else if (deckId !== undefined) {
        const updatedDeck = await updateDeckItem(deckId, payload);
        indexedDbOpenRecoveryState.throwIfFailed();
        navigate(buildSettingsDeckDetailRoute(updatedDeck.deckId));
      }
    } catch (error) {
      if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
        return;
      }
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
      if (indexedDbOpenRecoveryState.hasFailed() === false) {
        isSavingRef.current = false;
        setIsSaving(false);
      }
    }
  }

  if (isLoading || (screenErrorMessage === "" && isEditorInitialized === false)) {
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
        {refreshErrorMessage !== "" ? (
          <>
            <p className="error-banner" role="alert">{refreshErrorMessage}</p>
            <button className="ghost-btn" type="button" onClick={() => void loadScreenData()}>
              {t("common.retry")}
            </button>
          </>
        ) : null}
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
