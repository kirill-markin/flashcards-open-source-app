import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  markIndexedDbOpenRecoveryFailureAndCheckActive,
  useAppErrorDialog,
} from "../../../../appError/AppErrorContext";
import type { TranslationKey } from "../../../../i18n";
import { UnsupportedImagePreparationError } from "../../../../media/imagePreparation";
import { captureAppOperationError } from "../../../../observability/appOperationObservation";
import { getExpectedCardMutationInlineErrorMessage } from "../../../cards/cardMutationErrors";
import {
  cancelCardFormTextareaSelectionRestore,
  captureCardFormTextareaSelection,
  createCardFormManagedMediaState,
  isCardFormManagedMediaProcessing,
  scheduleCardFormTextareaSelectionRestore,
  toCardFormState,
  type CardFormImageMediaRequest,
  type CardFormMediaUploadRetryRequest,
  type CardFormManagedMediaField,
  type CardFormManagedMediaFieldState,
  type CardFormManagedMediaState,
  type CardFormState,
  type CardFormTextareaSelectionRestore,
  type CardFormTextareaSelectionSnapshot,
} from "../../../cards/form/CardForm";
import { prepareCardImageMediaAuthoring } from "../../../cards/form/cardImageAuthoring";
import {
  isGeneratedMediaLifecycleConflictPresent,
  mergeGeneratedMediaLifecycleConflicts,
  reconcileGeneratedMediaLifecycleChanges,
  type GeneratedMediaLifecycleConflict,
  type GeneratedMediaLifecycleTextReplacements,
} from "../../../cards/form/cardFormMediaLifecycle";
import { markMediaUploadTransferDueForRetry } from "../../../../localDb/mediaTransfers";
import type { Card } from "../../../../types";

export type ReviewEditorPresentationToken = Readonly<{
  presentationGeneration: number;
}>;

type ReviewEditorIdentity = ReviewEditorPresentationToken & Readonly<{
  cardId: string;
  workspaceId: string | null;
}>;

type ReviewCardObservationMarker = Readonly<Pick<
  Card,
  | "cardId"
  | "clientUpdatedAt"
  | "lastModifiedByReplicaId"
  | "lastOperationId"
  | "updatedAt"
>>;

type PendingReviewEditorTextareaSelectionRestore = Readonly<{
  removeBlurListener: () => void;
  restore: CardFormTextareaSelectionRestore;
}>;

type UseReviewCardEditorParams = Readonly<{
  deleteCardItem: (cardId: string) => Promise<Card>;
  installationId: string | null;
  localReadVersion: number;
  queueCards: ReadonlyArray<Card>;
  runMediaUploadTransfers: () => void;
  selectedCard: Card | null;
  setErrorMessage: (message: string) => void;
  t: (key: TranslationKey) => string;
  updateCardItem: (cardId: string, input: Readonly<{
    frontText: string;
    backText: string;
    tags: ReadonlyArray<string>;
  }>) => Promise<Card>;
  userId: string | null;
  workspaceId: string | null;
}>;

export type UseReviewCardEditorResult = Readonly<{
  editorErrorMessage: string;
  editingCard: Card | null;
  editorFormState: CardFormState;
  captureEditorPresentationToken: () => ReviewEditorPresentationToken | null;
  handleEditorDelete: () => Promise<void>;
  handlePrepareImageMedia: (request: CardFormImageMediaRequest) => Promise<string | null>;
  handleEditorSaveForAiHandoff: () => Promise<Card | null>;
  handleRetryMediaUploadTransfer: (request: CardFormMediaUploadRetryRequest) => Promise<void>;
  handleEditorSave: () => Promise<void>;
  handleOpenEditor: (card: Card) => void;
  handleCloseEditor: () => void;
  handleCloseEditorIfCurrent: (token: ReviewEditorPresentationToken) => void;
  isEditorPresented: boolean;
  isEditorSaving: boolean;
  isEditorSubmissionAllowed: () => boolean;
  isEditorSubmissionBlocked: boolean;
  managedMediaState: CardFormManagedMediaState;
  setEditorFormState: (nextFormState: CardFormState) => void;
}>;

function areReviewEditorIdentitiesEqual(
  left: ReviewEditorIdentity | null,
  right: ReviewEditorIdentity,
): boolean {
  return left !== null
    && left.cardId === right.cardId
    && left.presentationGeneration === right.presentationGeneration
    && left.workspaceId === right.workspaceId;
}

function toReviewCardObservationMarker(card: Card): ReviewCardObservationMarker {
  return {
    cardId: card.cardId,
    clientUpdatedAt: card.clientUpdatedAt,
    lastModifiedByReplicaId: card.lastModifiedByReplicaId,
    lastOperationId: card.lastOperationId,
    updatedAt: card.updatedAt,
  };
}

function areReviewCardObservationMarkersEqual(
  left: ReviewCardObservationMarker | null,
  right: ReviewCardObservationMarker,
): boolean {
  return left !== null
    && left.cardId === right.cardId
    && left.clientUpdatedAt === right.clientUpdatedAt
    && left.lastModifiedByReplicaId === right.lastModifiedByReplicaId
    && left.lastOperationId === right.lastOperationId
    && left.updatedAt === right.updatedAt;
}

export function useReviewCardEditor(params: UseReviewCardEditorParams): UseReviewCardEditorResult {
  const {
    deleteCardItem,
    installationId,
    localReadVersion,
    queueCards,
    runMediaUploadTransfers,
    selectedCard,
    setErrorMessage,
    t,
    updateCardItem,
    userId,
    workspaceId,
  } = params;
  const { indexedDbOpenRecoveryState, showCapturedTechnicalError } = useAppErrorDialog();
  const editorIdentityRef = useRef<ReviewEditorIdentity | null>(null);
  const reconciliationBaselineCardRef = useRef<Card | null>(null);
  const lastProcessedObservedCardMarkerRef = useRef<ReviewCardObservationMarker | null>(null);
  const editorFormStateRef = useRef<CardFormState>(toCardFormState(null));
  const editorFormRevisionRef = useRef<number>(0);
  const mediaLifecycleConflictRef = useRef<GeneratedMediaLifecycleConflict | null>(null);
  const pendingTextareaSelectionRestoreRef = useRef<PendingReviewEditorTextareaSelectionRestore | null>(null);
  const textareaSelectionRestoreGenerationRef = useRef<number>(0);
  const syncGenerationRef = useRef<number>(0);
  const presentationGenerationRef = useRef<number>(0);
  const isEditorPresentedRef = useRef<boolean>(false);
  const [isEditorPresented, setIsEditorPresented] = useState<boolean>(false);
  const [editingCardId, setEditingCardId] = useState<string>("");
  const [editorFormState, setEditorFormState] = useState<CardFormState>(editorFormStateRef.current);
  const [editorErrorMessage, setEditorErrorMessage] = useState<string>("");
  const [mediaLifecycleConflict, setMediaLifecycleConflict] = useState<GeneratedMediaLifecycleConflict | null>(null);
  const [isEditorSaving, setIsEditorSaving] = useState<boolean>(false);
  const [managedMediaState, setManagedMediaState] = useState<CardFormManagedMediaState>(createCardFormManagedMediaState);
  const observedEditingCard = queueCards.find((card) => card.cardId === editingCardId)
    ?? (selectedCard?.cardId === editingCardId ? selectedCard : null);
  const editingCard = isEditorPresented
    ? reconciliationBaselineCardRef.current
    : observedEditingCard;
  const isAuthoringMedia = isCardFormManagedMediaProcessing(managedMediaState);
  const isEditorSubmissionBlocked = mediaLifecycleConflict !== null
    && isGeneratedMediaLifecycleConflictPresent(mediaLifecycleConflict, editorFormState);

  const cancelPendingTextareaSelectionRestore = useCallback(
    function cancelPendingTextareaSelectionRestore(): void {
      textareaSelectionRestoreGenerationRef.current += 1;
      const pendingRestore = pendingTextareaSelectionRestoreRef.current;
      pendingTextareaSelectionRestoreRef.current = null;
      if (pendingRestore !== null) {
        pendingRestore.removeBlurListener();
        cancelCardFormTextareaSelectionRestore(pendingRestore.restore);
      }
    },
    [],
  );

  const resetTextareaSelectionRestore = useCallback(
    function resetTextareaSelectionRestore(): void {
      cancelPendingTextareaSelectionRestore();
      syncGenerationRef.current += 1;
    },
    [cancelPendingTextareaSelectionRestore],
  );

  const scheduleTextareaSelectionRestore = useCallback(
    function scheduleTextareaSelectionRestore(
      selection: CardFormTextareaSelectionSnapshot | null,
      replacements: GeneratedMediaLifecycleTextReplacements,
      nextFormState: CardFormState,
      identity: ReviewEditorIdentity,
      syncGeneration: number,
    ): void {
      cancelPendingTextareaSelectionRestore();
      const restoreGeneration = textareaSelectionRestoreGenerationRef.current;
      let didFinishSynchronously = false;
      let removeBlurListener = (): void => undefined;
      const restore = scheduleCardFormTextareaSelectionRestore(
        selection,
        replacements,
        nextFormState,
        () => (
          textareaSelectionRestoreGenerationRef.current === restoreGeneration
          && syncGenerationRef.current === syncGeneration
          && isEditorPresentedRef.current
          && areReviewEditorIdentitiesEqual(editorIdentityRef.current, identity)
        ),
        () => {
          didFinishSynchronously = true;
          removeBlurListener();
          if (textareaSelectionRestoreGenerationRef.current !== restoreGeneration) {
            return;
          }

          pendingTextareaSelectionRestoreRef.current = null;
        },
      );
      if (restore === null || didFinishSynchronously) {
        return;
      }

      const textarea = document.getElementById(restore.selection.textareaId);
      const handleTextareaBlur = function handleTextareaBlur(): void {
        cancelPendingTextareaSelectionRestore();
      };
      if (textarea instanceof HTMLTextAreaElement) {
        textarea.addEventListener("blur", handleTextareaBlur, { once: true });
        removeBlurListener = () => {
          textarea.removeEventListener("blur", handleTextareaBlur);
        };
      }
      pendingTextareaSelectionRestoreRef.current = {
        removeBlurListener,
        restore,
      };
    },
    [cancelPendingTextareaSelectionRestore],
  );

  const handleCloseEditor = useCallback(function handleCloseEditor(): void {
    isEditorPresentedRef.current = false;
    editorIdentityRef.current = null;
    editorFormRevisionRef.current += 1;
    reconciliationBaselineCardRef.current = null;
    lastProcessedObservedCardMarkerRef.current = null;
    mediaLifecycleConflictRef.current = null;
    resetTextareaSelectionRestore();
    setMediaLifecycleConflict(null);
    setIsEditorSaving(false);
    setIsEditorPresented(false);
  }, [resetTextareaSelectionRestore]);

  const handleCloseEditorIfCurrent = useCallback(function handleCloseEditorIfCurrent(
    token: ReviewEditorPresentationToken,
  ): void {
    if (editorIdentityRef.current !== token) {
      return;
    }

    handleCloseEditor();
  }, [handleCloseEditor]);

  function captureEditorPresentationToken(): ReviewEditorPresentationToken | null {
    return editorIdentityRef.current;
  }

  function isEditorPresentationCurrent(token: ReviewEditorPresentationToken): boolean {
    return isEditorPresentedRef.current && editorIdentityRef.current === token;
  }

  useLayoutEffect(() => {
    if (isEditorPresented === false) {
      return;
    }

    const identity = editorIdentityRef.current;
    if (identity === null || identity.workspaceId !== workspaceId) {
      handleCloseEditor();
      return;
    }
    if (observedEditingCard === null || observedEditingCard.cardId !== identity.cardId) {
      return;
    }

    const observedCardMarker = toReviewCardObservationMarker(observedEditingCard);
    if (
      areReviewCardObservationMarkersEqual(
        lastProcessedObservedCardMarkerRef.current,
        observedCardMarker,
      )
    ) {
      return;
    }

    const previousEditingCard = reconciliationBaselineCardRef.current;
    if (previousEditingCard === null || previousEditingCard.cardId !== observedEditingCard.cardId) {
      reconciliationBaselineCardRef.current = observedEditingCard;
      lastProcessedObservedCardMarkerRef.current = observedCardMarker;
      return;
    }

    const carriedSelection = pendingTextareaSelectionRestoreRef.current?.restore.selection ?? null;
    const selection = carriedSelection ?? captureCardFormTextareaSelection("review-card-editor");
    cancelPendingTextareaSelectionRestore();
    const reconciliation = reconcileGeneratedMediaLifecycleChanges(
      previousEditingCard,
      observedEditingCard,
      editorFormStateRef.current,
    );
    const syncGeneration = syncGenerationRef.current + 1;
    syncGenerationRef.current = syncGeneration;
    reconciliationBaselineCardRef.current = observedEditingCard;
    lastProcessedObservedCardMarkerRef.current = observedCardMarker;
    editorFormRevisionRef.current += 1;
    editorFormStateRef.current = reconciliation.formState;
    setEditorFormState(reconciliation.formState);

    const existingConflict = mediaLifecycleConflictRef.current;
    const discoveredConflict = reconciliation.conflict.references.length === 0
      ? null
      : reconciliation.conflict;
    const nextConflict = discoveredConflict === null
      ? existingConflict
      : existingConflict === null
        ? discoveredConflict
        : mergeGeneratedMediaLifecycleConflicts(existingConflict, discoveredConflict);
    mediaLifecycleConflictRef.current = nextConflict;
    setMediaLifecycleConflict(nextConflict);
    scheduleTextareaSelectionRestore(
      selection,
      reconciliation.textReplacements,
      reconciliation.formState,
      identity,
      syncGeneration,
    );
  }, [
    cancelPendingTextareaSelectionRestore,
    handleCloseEditor,
    isEditorPresented,
    localReadVersion,
    observedEditingCard,
    scheduleTextareaSelectionRestore,
    workspaceId,
  ]);

  useEffect(() => () => {
    resetTextareaSelectionRestore();
  }, [resetTextareaSelectionRestore]);

  function handleOpenEditor(card: Card): void {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    resetTextareaSelectionRestore();
    const initialFormState = toCardFormState(card);
    const presentationGeneration = presentationGenerationRef.current + 1;
    presentationGenerationRef.current = presentationGeneration;
    editorIdentityRef.current = {
      cardId: card.cardId,
      presentationGeneration,
      workspaceId,
    };
    reconciliationBaselineCardRef.current = card;
    lastProcessedObservedCardMarkerRef.current = toReviewCardObservationMarker(card);
    mediaLifecycleConflictRef.current = null;
    editorFormRevisionRef.current += 1;
    editorFormStateRef.current = initialFormState;
    isEditorPresentedRef.current = true;
    setEditingCardId(card.cardId);
    setEditorFormState(initialFormState);
    setEditorErrorMessage("");
    setMediaLifecycleConflict(null);
    setManagedMediaState(createCardFormManagedMediaState());
    setIsEditorSaving(false);
    setIsEditorPresented(true);
  }

  function handleEditorFormStateChange(nextFormState: CardFormState): void {
    editorFormRevisionRef.current += 1;
    editorFormStateRef.current = nextFormState;
    setEditorFormState(nextFormState);
  }

  function isEditorSubmissionAllowed(): boolean {
    const conflict = mediaLifecycleConflictRef.current;
    return conflict === null
      || isGeneratedMediaLifecycleConflictPresent(conflict, editorFormStateRef.current) === false;
  }

  async function handleEditorSave(): Promise<void> {
    if (indexedDbOpenRecoveryState.hasFailed() || isAuthoringMedia || isEditorSubmissionAllowed() === false) {
      return;
    }

    if (editingCardId === "") {
      setEditorErrorMessage(t("reviewEditor.errors.cardNotFound"));
      return;
    }

    const presentationToken = captureEditorPresentationToken();
    if (presentationToken === null) {
      return;
    }
    const submittedFormRevision = editorFormRevisionRef.current;
    const submittedFormState = editorFormStateRef.current;
    setIsEditorSaving(true);
    setEditorErrorMessage("");
    setErrorMessage("");

    try {
      const savedCard = await updateCardItem(editingCardId, {
        frontText: submittedFormState.frontText,
        backText: submittedFormState.backText,
        tags: submittedFormState.tags,
      });
      indexedDbOpenRecoveryState.throwIfFailed();
      if (isEditorPresentationCurrent(presentationToken) === false) {
        return;
      }

      reconciliationBaselineCardRef.current = savedCard;
      if (editorFormRevisionRef.current !== submittedFormRevision) {
        return;
      }

      handleCloseEditorIfCurrent(presentationToken);
    } catch (error) {
      if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
        return;
      }
      if (isEditorPresentationCurrent(presentationToken) === false) {
        return;
      }

      const expectedErrorMessage = getExpectedCardMutationInlineErrorMessage(error, t("reviewEditor.errors.cardNotFound"));
      if (expectedErrorMessage !== null) {
        setEditorErrorMessage(expectedErrorMessage);
        return;
      }

      captureAppOperationError(error, {
        feature: "review",
        operation: "review_card_save",
        userId,
        workspaceId,
        installationId,
        entityId: editingCardId,
      });
      showCapturedTechnicalError(error);
      setEditorErrorMessage(t("appError.technicalError.message"));
    } finally {
      if (indexedDbOpenRecoveryState.hasFailed() === false && isEditorPresentationCurrent(presentationToken)) {
        setIsEditorSaving(false);
      }
    }
  }

  async function handleEditorSaveForAiHandoff(): Promise<Card | null> {
    if (indexedDbOpenRecoveryState.hasFailed() || isAuthoringMedia || isEditorSubmissionAllowed() === false) {
      return null;
    }

    if (editingCardId === "") {
      setEditorErrorMessage(t("reviewEditor.errors.cardNotFound"));
      return null;
    }

    const presentationToken = captureEditorPresentationToken();
    if (presentationToken === null) {
      return null;
    }
    const submittedFormRevision = editorFormRevisionRef.current;
    const submittedFormState = editorFormStateRef.current;
    setIsEditorSaving(true);
    setEditorErrorMessage("");
    setErrorMessage("");

    try {
      const savedCard = await updateCardItem(editingCardId, {
        frontText: submittedFormState.frontText,
        backText: submittedFormState.backText,
        tags: submittedFormState.tags,
      });
      indexedDbOpenRecoveryState.throwIfFailed();
      if (isEditorPresentationCurrent(presentationToken) === false) {
        return null;
      }

      const savedFormState = toCardFormState(savedCard);
      reconciliationBaselineCardRef.current = savedCard;
      if (editorFormRevisionRef.current !== submittedFormRevision) {
        return null;
      }

      editorFormRevisionRef.current += 1;
      editorFormStateRef.current = savedFormState;
      setEditorFormState(savedFormState);
      return savedCard;
    } catch (error) {
      if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
        return null;
      }
      if (isEditorPresentationCurrent(presentationToken) === false) {
        return null;
      }

      const expectedErrorMessage = getExpectedCardMutationInlineErrorMessage(error, t("reviewEditor.errors.cardNotFound"));
      if (expectedErrorMessage !== null) {
        setEditorErrorMessage(expectedErrorMessage);
        return null;
      }

      captureAppOperationError(error, {
        feature: "review",
        operation: "review_card_save",
        userId,
        workspaceId,
        installationId,
        entityId: editingCardId,
      });
      showCapturedTechnicalError(error);
      setEditorErrorMessage(t("appError.technicalError.message"));
      return null;
    } finally {
      if (indexedDbOpenRecoveryState.hasFailed() === false && isEditorPresentationCurrent(presentationToken)) {
        setIsEditorSaving(false);
      }
    }
  }

  async function handleEditorDelete(): Promise<void> {
    if (indexedDbOpenRecoveryState.hasFailed() || isAuthoringMedia) {
      return;
    }

    if (editingCardId === "") {
      setEditorErrorMessage(t("reviewEditor.errors.cardNotFound"));
      return;
    }

    if (window.confirm(t("reviewEditor.deleteConfirmation")) === false) {
      return;
    }

    setIsEditorSaving(true);
    setEditorErrorMessage("");
    setErrorMessage("");

    try {
      await deleteCardItem(editingCardId);
      indexedDbOpenRecoveryState.throwIfFailed();
      handleCloseEditor();
    } catch (error) {
      if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
        return;
      }
      const expectedErrorMessage = getExpectedCardMutationInlineErrorMessage(error, t("reviewEditor.errors.cardNotFound"));
      if (expectedErrorMessage !== null) {
        setEditorErrorMessage(expectedErrorMessage);
        return;
      }

      captureAppOperationError(error, {
        feature: "review",
        operation: "review_card_delete",
        userId,
        workspaceId,
        installationId,
        entityId: editingCardId,
      });
      showCapturedTechnicalError(error);
      setEditorErrorMessage(t("appError.technicalError.message"));
    } finally {
      if (indexedDbOpenRecoveryState.hasFailed() === false) {
        setIsEditorSaving(false);
      }
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

    if (workspaceId === null) {
      setManagedMediaFieldError(request.field, t("cardForm.media.errors.workspaceUnavailable"));
      return null;
    }

    if (installationId === null) {
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
        workspaceId,
        installationId,
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
        feature: "review",
        operation: "review_card_image_authoring",
        userId,
        workspaceId,
        installationId,
        entityId: editingCardId === "" ? null : editingCardId,
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

    setEditorErrorMessage("");
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
        feature: "review",
        operation: "review_card_image_upload_retry",
        userId,
        workspaceId: request.workspaceId,
        installationId,
        entityId: request.mediaAssetId,
      });
      showCapturedTechnicalError(error);
      setEditorErrorMessage(t("appError.technicalError.message"));
    }
  }

  return {
    captureEditorPresentationToken,
    editorErrorMessage,
    editingCard,
    editorFormState,
    handleEditorDelete,
    handlePrepareImageMedia,
    handleEditorSaveForAiHandoff,
    handleRetryMediaUploadTransfer,
    handleEditorSave,
    handleOpenEditor,
    handleCloseEditor,
    handleCloseEditorIfCurrent,
    isEditorPresented,
    isEditorSaving,
    isEditorSubmissionAllowed,
    isEditorSubmissionBlocked,
    managedMediaState,
    setEditorFormState: handleEditorFormStateChange,
  };
}
