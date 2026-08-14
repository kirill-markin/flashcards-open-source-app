import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useAppData } from "../../../appData";
import {
  markIndexedDbOpenRecoveryFailureAndCheckActive,
  type IndexedDbOpenRecoveryState,
  useAppErrorDialog,
} from "../../../appError/AppErrorContext";
import { useAiCardHandoff } from "../../../chat/handoff/useAiCardHandoff";
import { useI18n } from "../../../i18n";
import {
  cancelCardFormTextareaSelectionRestore,
  captureCardFormTextareaSelection,
  CardFormFields,
  createCardFormManagedMediaState,
  isCardFormManagedMediaProcessing,
  isCardFormStateDirty,
  scheduleCardFormTextareaSelectionRestore,
  toCardFormState,
  type CardFormImageMediaRequest,
  type CardFormFieldsHandle,
  type CardFormMediaUploadRetryRequest,
  type CardFormManagedMediaField,
  type CardFormManagedMediaFieldState,
  type CardFormManagedMediaState,
  type CardFormState,
  type CardFormTextareaSelectionRestore,
  type CardFormTextareaSelectionSnapshot,
} from "./CardForm";
import { prepareCardImageMediaAuthoring } from "./cardImageAuthoring";
import {
  isGeneratedMediaLifecycleConflictPresent,
  mergeGeneratedMediaLifecycleConflicts,
  reconcileGeneratedMediaLifecycleChanges,
  type GeneratedMediaLifecycleConflict,
  type GeneratedMediaLifecycleTextReplacements,
} from "./cardFormMediaLifecycle";
import { getExpectedCardMutationInlineErrorMessage } from "../cardMutationErrors";
import type { Card, CreateCardInput, TagSuggestion, UpdateCardInput } from "../../../types";
import { loadCardById } from "../../../localDb/cards/cards";
import { loadWorkspaceTagsSummary } from "../../../localDb/cards/workspace";
import { markMediaUploadTransferDueForRetry } from "../../../localDb/mediaTransfers";
import { UnsupportedImagePreparationError } from "../../../media/imagePreparation";
import { captureAppOperationError } from "../../../observability/appOperationObservation";
import { cardsRoute } from "../../../routes";

function toTagSuggestions(tags: Awaited<ReturnType<typeof loadWorkspaceTagsSummary>>["tags"]): ReadonlyArray<TagSuggestion> {
  return tags.map((tagSummary) => ({
    tag: tagSummary.tag,
    countState: "ready",
    cardsCount: tagSummary.cardsCount,
  }));
}

const workspaceUnavailableErrorMessage = "Workspace is unavailable";

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

type CardFormIdentity = Readonly<{
  cardId: string | null;
  workspaceId: string;
}>;

type PendingCardFormTextareaSelectionRestore = Readonly<{
  formIdentity: CardFormIdentity;
  loadRequestSequence: number;
  restore: CardFormTextareaSelectionRestore;
  restoreGeneration: number;
}>;

function isWorkspaceUnavailableError(error: unknown): boolean {
  return error instanceof Error && error.message === workspaceUnavailableErrorMessage;
}

function areCardFormIdentitiesEqual(
  left: CardFormIdentity | null,
  right: CardFormIdentity,
): boolean {
  return left !== null
    && left.cardId === right.cardId
    && left.workspaceId === right.workspaceId;
}

export function CardFormScreen(): ReactElement {
  const { cardId } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const {
    activeWorkspace,
    cloudSettings,
    createCardItem,
    updateCardItem,
    deleteCardItem,
    setErrorMessage,
    localReadVersion,
    runMediaUploadTransfers,
    session,
  } = useAppData();
  const { indexedDbOpenRecoveryState, showCapturedTechnicalError } = useAppErrorDialog();
  const cardFormFieldsRef = useRef<CardFormFieldsHandle | null>(null);
  const formIdentityRef = useRef<CardFormIdentity | null>(null);
  const renderedFormIdentityRef = useRef<CardFormIdentity | null>(null);
  const reconciliationBaselineCardRef = useRef<Card | null>(null);
  const pendingTextareaSelectionRestoreRef = useRef<PendingCardFormTextareaSelectionRestore | null>(null);
  const textareaSelectionRestoreGenerationRef = useRef<number>(0);
  const textareaSelectionRef = useRef<CardFormTextareaSelectionSnapshot | null>(null);
  const [currentCard, setCurrentCard] = useState<Card | null>(null);
  const formStateRef = useRef<CardFormState>(toCardFormState(null));
  const [formState, setFormState] = useState<CardFormState>(formStateRef.current);
  const [tagSuggestions, setTagSuggestions] = useState<ReadonlyArray<TagSuggestion>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [loadErrorMessage, setLoadErrorMessage] = useState<string>("");
  const [refreshErrorMessage, setRefreshErrorMessage] = useState<string>("");
  const [actionErrorMessage, setActionErrorMessage] = useState<string>("");
  const mediaLifecycleConflictRef = useRef<GeneratedMediaLifecycleConflict | null>(null);
  const [mediaLifecycleConflict, setMediaLifecycleConflict] = useState<GeneratedMediaLifecycleConflict | null>(null);
  const [managedMediaState, setManagedMediaState] = useState<CardFormManagedMediaState>(createCardFormManagedMediaState);
  const observationIdentityRef = useRef<Readonly<{
    userId: string | null;
    installationId: string | null;
  }>>({
    userId: null,
    installationId: null,
  });
  const loadRequestSequenceRef = useRef<number>(0);
  const successfulMutationGenerationRef = useRef<number>(0);
  const isCreateMode = cardId === undefined;
  const handoffCardToAi = useAiCardHandoff();
  const isAuthoringMedia = isCardFormManagedMediaProcessing(managedMediaState);
  const isSubmissionBlocked = mediaLifecycleConflict !== null
    && isGeneratedMediaLifecycleConflictPresent(mediaLifecycleConflict, formState);
  observationIdentityRef.current = {
    userId: session?.userId ?? null,
    installationId: cloudSettings?.installationId ?? null,
  };
  renderedFormIdentityRef.current = activeWorkspace === null
    ? null
    : {
      cardId: cardId ?? null,
      workspaceId: activeWorkspace.workspaceId,
    };

  const cancelPendingTextareaSelectionRestore = useCallback(
    function cancelPendingTextareaSelectionRestore(): void {
      textareaSelectionRestoreGenerationRef.current += 1;
      const pendingRestore = pendingTextareaSelectionRestoreRef.current;
      pendingTextareaSelectionRestoreRef.current = null;
      if (pendingRestore !== null) {
        cancelCardFormTextareaSelectionRestore(pendingRestore.restore);
      }
    },
    [],
  );

  const resetTextareaSelectionRestore = useCallback(
    function resetTextareaSelectionRestore(): void {
      cancelPendingTextareaSelectionRestore();
      textareaSelectionRef.current = null;
    },
    [cancelPendingTextareaSelectionRestore],
  );

  const captureCurrentTextareaSelection = useCallback(
    function captureCurrentTextareaSelection(): void {
      textareaSelectionRef.current = captureCardFormTextareaSelection("card-form-screen");
    },
    [],
  );

  const scheduleTextareaSelectionRestore = useCallback(
    function scheduleTextareaSelectionRestore(
      selection: CardFormTextareaSelectionSnapshot | null,
      replacements: GeneratedMediaLifecycleTextReplacements,
      nextFormState: CardFormState,
      formIdentity: CardFormIdentity,
      loadRequestSequence: number,
    ): void {
      cancelPendingTextareaSelectionRestore();
      const restoreGeneration = textareaSelectionRestoreGenerationRef.current;
      let didFinishSynchronously = false;
      const restore = scheduleCardFormTextareaSelectionRestore(
        selection,
        replacements,
        nextFormState,
        () => (
          textareaSelectionRestoreGenerationRef.current === restoreGeneration
          && loadRequestSequenceRef.current === loadRequestSequence
          && areCardFormIdentitiesEqual(
            renderedFormIdentityRef.current,
            formIdentity,
          )
        ),
        () => {
          didFinishSynchronously = true;
          if (textareaSelectionRestoreGenerationRef.current !== restoreGeneration) {
            return;
          }

          pendingTextareaSelectionRestoreRef.current = null;
          textareaSelectionRef.current = null;
        },
      );
      if (restore === null) {
        textareaSelectionRef.current = null;
        return;
      }
      if (didFinishSynchronously) {
        return;
      }

      textareaSelectionRef.current = restore.selection;
      pendingTextareaSelectionRestoreRef.current = {
        formIdentity,
        loadRequestSequence,
        restore,
        restoreGeneration,
      };
    },
    [cancelPendingTextareaSelectionRestore],
  );

  const loadScreenData = useCallback(async function loadScreenData(): Promise<void> {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    const carriedTextareaSelection = (
      pendingTextareaSelectionRestoreRef.current?.restore.selection ?? null
    );
    const shouldCarryPendingSelection = carriedTextareaSelection !== null;
    if (shouldCarryPendingSelection === false) {
      captureCurrentTextareaSelection();
    }
    cancelPendingTextareaSelectionRestore();
    const requestSequence = loadRequestSequenceRef.current + 1;
    loadRequestSequenceRef.current = requestSequence;
    const mutationGeneration = successfulMutationGenerationRef.current;
    const isCurrentLoadRequest = function isCurrentLoadRequest(): boolean {
      return loadRequestSequenceRef.current === requestSequence
        && successfulMutationGenerationRef.current === mutationGeneration;
    };

    const renderedFormIdentity = renderedFormIdentityRef.current;
    const isBackgroundRefresh = (
      renderedFormIdentity !== null
      && areCardFormIdentitiesEqual(
        formIdentityRef.current,
        renderedFormIdentity,
      )
      && (
        isCreateMode
        || reconciliationBaselineCardRef.current !== null
      )
    );
    if (isBackgroundRefresh === false) {
      setLoadErrorMessage("");
      setRefreshErrorMessage("");
      setActionErrorMessage("");
      setIsLoading(true);
    }
    const setCurrentLoadErrorMessage = function setCurrentLoadErrorMessage(
      errorMessage: string,
    ): void {
      if (isBackgroundRefresh) {
        setRefreshErrorMessage(errorMessage);
      } else {
        setLoadErrorMessage(errorMessage);
      }
    };
    const restoreCarriedTextareaSelection = function restoreCarriedTextareaSelection(): void {
      if (
        isBackgroundRefresh === false
        || renderedFormIdentity === null
        || carriedTextareaSelection === null
      ) {
        return;
      }

      scheduleTextareaSelectionRestore(
        carriedTextareaSelection,
        {
          frontText: [],
          backText: [],
        },
        formStateRef.current,
        renderedFormIdentity,
        requestSequence,
      );
    };

    try {
      if (activeWorkspace === null) {
        resetTextareaSelectionRestore();
        throw new Error(workspaceUnavailableErrorMessage);
      }

      const workspaceId = activeWorkspace.workspaceId;
      const formIdentity: CardFormIdentity = {
        cardId: cardId ?? null,
        workspaceId,
      };
      const isSameFormIdentity = areCardFormIdentitiesEqual(
        formIdentityRef.current,
        formIdentity,
      );
      const [tagsSummary, loadedCard] = await Promise.all([
        runRecoveryGuardedLocalRead(
          () => loadWorkspaceTagsSummary(workspaceId),
          indexedDbOpenRecoveryState,
        ),
        runRecoveryGuardedLocalRead(
          () => isCreateMode || cardId === undefined
            ? Promise.resolve(null)
            : loadCardById(workspaceId, cardId),
          indexedDbOpenRecoveryState,
        ),
      ]);
      indexedDbOpenRecoveryState.throwIfFailed();
      if (isCurrentLoadRequest() === false) {
        return;
      }
      if (shouldCarryPendingSelection === false) {
        captureCurrentTextareaSelection();
      }

      if (
        loadedCard === null
        && isCreateMode === false
        && isBackgroundRefresh
      ) {
        restoreCarriedTextareaSelection();
        setRefreshErrorMessage(t("cardForm.errors.cardNotFound"));
        return;
      }

      setRefreshErrorMessage("");
      setTagSuggestions(toTagSuggestions(tagsSummary.tags));
      const previousCard = reconciliationBaselineCardRef.current;
      setCurrentCard(loadedCard);
      if (loadedCard !== null) {
        if (
          isSameFormIdentity
          && previousCard !== null
          && previousCard.cardId === loadedCard.cardId
        ) {
          const reconciliation = reconcileGeneratedMediaLifecycleChanges(
            previousCard,
            loadedCard,
            formStateRef.current,
          );
          scheduleTextareaSelectionRestore(
            carriedTextareaSelection ?? textareaSelectionRef.current,
            reconciliation.textReplacements,
            reconciliation.formState,
            formIdentity,
            requestSequence,
          );
          formStateRef.current = reconciliation.formState;
          setFormState(reconciliation.formState);
          const existingConflict = mediaLifecycleConflictRef.current;
          const discoveredConflict = reconciliation.conflict.references.length === 0
            ? null
            : reconciliation.conflict;
          const nextConflict = discoveredConflict === null
            ? existingConflict
            : existingConflict === null
              ? discoveredConflict
              : mergeGeneratedMediaLifecycleConflicts(existingConflict, discoveredConflict);
          reconciliationBaselineCardRef.current = loadedCard;
          if (nextConflict === null) {
            mediaLifecycleConflictRef.current = null;
            setMediaLifecycleConflict(null);
          } else {
            mediaLifecycleConflictRef.current = nextConflict;
            setMediaLifecycleConflict(nextConflict);
          }
        } else {
          const initialFormState = toCardFormState(loadedCard);
          reconciliationBaselineCardRef.current = loadedCard;
          mediaLifecycleConflictRef.current = null;
          resetTextareaSelectionRestore();
          formStateRef.current = initialFormState;
          formIdentityRef.current = formIdentity;
          setMediaLifecycleConflict(null);
          setFormState(initialFormState);
        }
      } else if (isCreateMode) {
        if (isSameFormIdentity === false) {
          const initialFormState = toCardFormState(null);
          reconciliationBaselineCardRef.current = null;
          mediaLifecycleConflictRef.current = null;
          resetTextareaSelectionRestore();
          formStateRef.current = initialFormState;
          formIdentityRef.current = formIdentity;
          setMediaLifecycleConflict(null);
          setFormState(initialFormState);
        } else {
          scheduleTextareaSelectionRestore(
            carriedTextareaSelection ?? textareaSelectionRef.current,
            {
              frontText: [],
              backText: [],
            },
            formStateRef.current,
            formIdentity,
            requestSequence,
          );
        }
      } else {
        const initialFormState = toCardFormState(null);
        reconciliationBaselineCardRef.current = null;
        mediaLifecycleConflictRef.current = null;
        resetTextareaSelectionRestore();
        formStateRef.current = initialFormState;
        formIdentityRef.current = formIdentity;
        setMediaLifecycleConflict(null);
        setFormState(initialFormState);
        setLoadErrorMessage(t("cardForm.errors.cardNotFound"));
      }
    } catch (error) {
      if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
        return;
      }
      if (isCurrentLoadRequest() === false) {
        return;
      }

      restoreCarriedTextareaSelection();
      if (isWorkspaceUnavailableError(error)) {
        setCurrentLoadErrorMessage(workspaceUnavailableErrorMessage);
        return;
      }

      const observationIdentity = observationIdentityRef.current;
      captureAppOperationError(error, {
        feature: "cards",
        operation: "card_form_load",
        userId: observationIdentity.userId,
        workspaceId: activeWorkspace?.workspaceId ?? null,
        installationId: observationIdentity.installationId,
        entityId: cardId ?? null,
      });
      if (isBackgroundRefresh === false) {
        showCapturedTechnicalError(error);
      }
      setCurrentLoadErrorMessage(t("appError.technicalError.message"));
    } finally {
      if (isCurrentLoadRequest() && indexedDbOpenRecoveryState.hasFailed() === false) {
        setIsLoading(false);
      }
    }
  }, [
    activeWorkspace,
    cancelPendingTextareaSelectionRestore,
    captureCurrentTextareaSelection,
    cardId,
    indexedDbOpenRecoveryState,
    isCreateMode,
    resetTextareaSelectionRestore,
    scheduleTextareaSelectionRestore,
    t,
  ]);

  useEffect(() => {
    void loadScreenData();
    return () => {
      loadRequestSequenceRef.current += 1;
    };
  }, [loadScreenData, localReadVersion]);

  useEffect(() => () => {
    resetTextareaSelectionRestore();
  }, [resetTextareaSelectionRestore]);

  function buildUpdatePayload(): UpdateCardInput {
    const currentFormState = formStateRef.current;
    return {
      frontText: currentFormState.frontText,
      backText: currentFormState.backText,
      tags: currentFormState.tags,
    };
  }

  function handleFormStateChange(nextFormState: CardFormState): void {
    formStateRef.current = nextFormState;
    setFormState(nextFormState);
  }

  function isSubmissionAllowed(): boolean {
    const conflict = mediaLifecycleConflictRef.current;
    if (conflict === null) {
      return true;
    }

    return isGeneratedMediaLifecycleConflictPresent(conflict, formStateRef.current) === false;
  }

  async function saveCurrentCard(): Promise<Card | null> {
    if (indexedDbOpenRecoveryState.hasFailed() || isSubmissionAllowed() === false) {
      return null;
    }

    if (cardId === undefined) {
      setActionErrorMessage(t("cardForm.errors.cardIdRequired"));
      return null;
    }

    setIsSaving(true);
    setActionErrorMessage("");
    setErrorMessage("");

    try {
      const savedCard = await updateCardItem(cardId, buildUpdatePayload());
      indexedDbOpenRecoveryState.throwIfFailed();
      successfulMutationGenerationRef.current += 1;
      reconciliationBaselineCardRef.current = savedCard;
      setCurrentCard(savedCard);
      const savedFormState = toCardFormState(savedCard);
      formStateRef.current = savedFormState;
      setFormState(savedFormState);
      return savedCard;
    } catch (error) {
      if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
        return null;
      }
      const expectedErrorMessage = getExpectedCardMutationInlineErrorMessage(error, t("cardForm.errors.cardNotFound"));
      if (expectedErrorMessage !== null) {
        setActionErrorMessage(expectedErrorMessage);
        return null;
      }

      if (isWorkspaceUnavailableError(error)) {
        setActionErrorMessage(workspaceUnavailableErrorMessage);
        return null;
      }

      captureAppOperationError(error, {
        feature: "cards",
        operation: "card_save",
        userId: session?.userId ?? null,
        workspaceId: activeWorkspace?.workspaceId ?? null,
        installationId: cloudSettings?.installationId ?? null,
        entityId: cardId,
      });
      showCapturedTechnicalError(error);
      setActionErrorMessage(t("appError.technicalError.message"));
      return null;
    } finally {
      if (indexedDbOpenRecoveryState.hasFailed() === false) {
        setIsSaving(false);
      }
    }
  }

  async function handleSubmit(): Promise<void> {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    cardFormFieldsRef.current?.commitTagsDraft();
    if (isSubmissionAllowed() === false) {
      return;
    }

    setIsSaving(true);
    setActionErrorMessage("");
    setErrorMessage("");

    try {
      if (isCreateMode) {
        const currentFormState = formStateRef.current;
        const payload: CreateCardInput = {
          frontText: currentFormState.frontText,
          backText: currentFormState.backText,
          tags: currentFormState.tags,
        };
        await createCardItem(payload);
        indexedDbOpenRecoveryState.throwIfFailed();
      } else if (cardId !== undefined) {
        await updateCardItem(cardId, buildUpdatePayload());
        indexedDbOpenRecoveryState.throwIfFailed();
      }

      navigate(cardsRoute);
    } catch (error) {
      if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
        return;
      }
      const expectedErrorMessage = getExpectedCardMutationInlineErrorMessage(error, t("cardForm.errors.cardNotFound"));
      if (expectedErrorMessage !== null) {
        setActionErrorMessage(expectedErrorMessage);
        return;
      }

      if (isWorkspaceUnavailableError(error)) {
        setActionErrorMessage(workspaceUnavailableErrorMessage);
        return;
      }

      captureAppOperationError(error, {
        feature: "cards",
        operation: "card_save",
        userId: session?.userId ?? null,
        workspaceId: activeWorkspace?.workspaceId ?? null,
        installationId: cloudSettings?.installationId ?? null,
        entityId: cardId ?? null,
      });
      showCapturedTechnicalError(error);
      setActionErrorMessage(t("appError.technicalError.message"));
    } finally {
      if (indexedDbOpenRecoveryState.hasFailed() === false) {
        setIsSaving(false);
      }
    }
  }

  async function handleEditWithAi(): Promise<void> {
    if (indexedDbOpenRecoveryState.hasFailed() || isAuthoringMedia) {
      return;
    }

    cardFormFieldsRef.current?.commitTagsDraft();
    if (isSubmissionAllowed() === false) {
      return;
    }

    if (currentCard === null) {
      return;
    }

    if (isCardFormStateDirty(currentCard, formStateRef.current) === false) {
      const didHandoff = await handoffCardToAi(currentCard);
      if (didHandoff === false || indexedDbOpenRecoveryState.hasFailed()) {
        return;
      }
      return;
    }

    const savedCard = await saveCurrentCard();
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }
    if (savedCard === null) {
      return;
    }

    const didHandoff = await handoffCardToAi(savedCard);
    if (didHandoff === false || indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }
  }

  function setManagedMediaFieldState(
    field: CardFormManagedMediaField,
    nextState: CardFormManagedMediaFieldState,
  ): void {
    setManagedMediaState((currentState) => ({
      ...currentState,
      [field]: nextState,
    }));
  }

  function setManagedMediaFieldError(field: CardFormManagedMediaField, errorMessage: string): void {
    setManagedMediaFieldState(field, {
      isProcessing: false,
      errorMessage,
    });
  }

  async function handlePrepareImageMedia(request: CardFormImageMediaRequest): Promise<string | null> {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return null;
    }

    if (activeWorkspace === null) {
      setManagedMediaFieldError(request.field, t("cardForm.media.errors.workspaceUnavailable"));
      return null;
    }

    if (cloudSettings === null) {
      setManagedMediaFieldError(request.field, t("cardForm.media.errors.installationUnavailable"));
      return null;
    }

    setManagedMediaFieldState(request.field, {
      isProcessing: true,
      errorMessage: "",
    });
    setErrorMessage("");

    try {
      const result = await prepareCardImageMediaAuthoring({
        workspaceId: activeWorkspace.workspaceId,
        installationId: cloudSettings.installationId,
        file: request.file,
        altText: request.altText,
      }, indexedDbOpenRecoveryState.throwIfFailed);
      indexedDbOpenRecoveryState.throwIfFailed();
      runMediaUploadTransfers();
      return result.markdown;
    } catch (error) {
      if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
        return null;
      }
      if (error instanceof UnsupportedImagePreparationError) {
        setManagedMediaFieldError(request.field, t("cardForm.media.errors.unsupportedImage"));
        return null;
      }

      captureAppOperationError(error, {
        feature: "cards",
        operation: "card_image_authoring",
        userId: session?.userId ?? null,
        workspaceId: activeWorkspace.workspaceId,
        installationId: cloudSettings.installationId,
        entityId: cardId ?? null,
      });
      showCapturedTechnicalError(error);
      setManagedMediaFieldError(request.field, t("cardForm.media.errors.processingFailed"));
      return null;
    } finally {
      if (indexedDbOpenRecoveryState.hasFailed() === false) {
        setManagedMediaState((currentState) => ({
          ...currentState,
          [request.field]: {
            ...currentState[request.field],
            isProcessing: false,
          },
        }));
      }
    }
  }

  async function handleRetryMediaUploadTransfer(request: CardFormMediaUploadRetryRequest): Promise<void> {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    setActionErrorMessage("");
    setErrorMessage("");

    try {
      await markMediaUploadTransferDueForRetry({
        ...request,
        retryAt: new Date().toISOString(),
      });
      indexedDbOpenRecoveryState.throwIfFailed();
      runMediaUploadTransfers();
    } catch (error) {
      if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
        return;
      }
      captureAppOperationError(error, {
        feature: "cards",
        operation: "card_image_upload_retry",
        userId: session?.userId ?? null,
        workspaceId: request.workspaceId,
        installationId: cloudSettings?.installationId ?? null,
        entityId: request.mediaAssetId,
      });
      showCapturedTechnicalError(error);
      setActionErrorMessage(t("appError.technicalError.message"));
    }
  }

  async function handleDelete(): Promise<void> {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    if (cardId === undefined) {
      setActionErrorMessage(t("cardForm.errors.cardIdRequired"));
      return;
    }

    if (window.confirm(t("cardForm.deleteConfirmation")) === false) {
      return;
    }

    setIsDeleting(true);
    setActionErrorMessage("");
    setErrorMessage("");

    try {
      await deleteCardItem(cardId);
      indexedDbOpenRecoveryState.throwIfFailed();
      navigate(cardsRoute);
    } catch (error) {
      if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
        return;
      }
      const expectedErrorMessage = getExpectedCardMutationInlineErrorMessage(error, t("cardForm.errors.cardNotFound"));
      if (expectedErrorMessage !== null) {
        setActionErrorMessage(expectedErrorMessage);
        return;
      }

      if (isWorkspaceUnavailableError(error)) {
        setActionErrorMessage(workspaceUnavailableErrorMessage);
        return;
      }

      captureAppOperationError(error, {
        feature: "cards",
        operation: "card_delete",
        userId: session?.userId ?? null,
        workspaceId: activeWorkspace?.workspaceId ?? null,
        installationId: cloudSettings?.installationId ?? null,
        entityId: cardId,
      });
      showCapturedTechnicalError(error);
      setActionErrorMessage(t("appError.technicalError.message"));
    } finally {
      if (indexedDbOpenRecoveryState.hasFailed() === false) {
        setIsDeleting(false);
      }
    }
  }

  if (isLoading) {
    return (
      <main className="container">
        <section className="panel">
          <h1 className="title">{isCreateMode ? t("cardForm.title.new") : t("cardForm.title.edit")}</h1>
          <p className="subtitle">{t("cardForm.loading")}</p>
        </section>
      </main>
    );
  }

  if (loadErrorMessage !== "") {
    return (
      <main className="container">
        <section className="panel">
          <h1 className="title">{isCreateMode ? t("cardForm.title.new") : t("cardForm.title.edit")}</h1>
          <p className="error-banner" data-testid="card-form-load-error">{loadErrorMessage}</p>
          <button
            className="primary-btn"
            type="button"
            onClick={() => void loadScreenData()}
            data-testid="card-form-load-retry"
          >
            {t("common.retry")}
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="container">
      <section className="panel">
        {isSubmissionBlocked ? (
          <p className="error-banner" role="alert" data-testid="card-form-lifecycle-conflict">
            {t("cardForm.errors.mediaLifecycleConflict")}
          </p>
        ) : null}
        {refreshErrorMessage !== "" ? (
          <>
            <p className="error-banner" role="alert" data-testid="card-form-refresh-error">
              {refreshErrorMessage}
            </p>
            <button
              className="ghost-btn"
              type="button"
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={() => void loadScreenData()}
              data-testid="card-form-refresh-retry"
            >
              {t("common.retry")}
            </button>
          </>
        ) : null}
        {actionErrorMessage !== "" ? (
          <p className="error-banner" role="alert" data-testid="card-form-action-error">
            {actionErrorMessage}
          </p>
        ) : null}
        <div className="screen-head">
          <div>
            <h1 className="title">{isCreateMode ? t("cardForm.title.new") : t("cardForm.title.edit")}</h1>
            <p className="subtitle">{t("cardForm.subtitle")}</p>
          </div>
          <div className="screen-actions">
            <Link className="ghost-btn" to={cardsRoute}>{t("cardForm.actions.back")}</Link>
            {!isCreateMode && currentCard !== null ? (
              <button
                type="button"
                className="ghost-btn review-editor-ai-btn"
                disabled={isSaving || isDeleting || isAuthoringMedia || isSubmissionBlocked}
                onClick={() => void handleEditWithAi()}
                data-testid="card-form-edit-with-ai"
              >
                {t("cardForm.actions.editWithAi")}
              </button>
            ) : null}
            {!isCreateMode ? (
              <button
                type="button"
                className="ghost-btn settings-danger-btn"
                disabled={isSaving || isDeleting || isAuthoringMedia}
                onClick={() => void handleDelete()}
                data-testid="card-form-delete"
              >
                {isDeleting ? t("cardForm.actions.deleting") : t("cardForm.actions.delete")}
              </button>
            ) : null}
            <button
              type="button"
              className="primary-btn"
              disabled={isSaving || isDeleting || isAuthoringMedia || isSubmissionBlocked}
              onClick={() => void handleSubmit()}
              data-testid="card-form-save"
            >
              {isSaving ? t("cardForm.actions.saving") : t("cardForm.actions.save")}
            </button>
          </div>
        </div>

        <CardFormFields
          ref={cardFormFieldsRef}
          tagSuggestions={tagSuggestions}
          currentCard={currentCard}
          formState={formState}
          formIdPrefix="card-form-screen"
          isSaving={isSaving}
          localReadVersion={localReadVersion}
          managedMediaState={managedMediaState}
          workspaceId={activeWorkspace?.workspaceId ?? null}
          onChange={handleFormStateChange}
          onPrepareImageMedia={handlePrepareImageMedia}
          onRetryMediaUploadTransfer={handleRetryMediaUploadTransfer}
        />
      </section>
    </main>
  );
}
