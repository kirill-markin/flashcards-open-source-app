import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAppData } from "../../../appData";
import { useAppErrorDialog } from "../../../appError/AppErrorContext";
import { useAiCardHandoff } from "../../../chat/handoff/useAiCardHandoff";
import { useI18n } from "../../../i18n";
import {
  CardFormFields,
  createCardFormManagedMediaState,
  isCardFormManagedMediaProcessing,
  isCardFormStateDirty,
  toCardFormState,
  type CardFormImageMediaRequest,
  type CardFormMediaUploadRetryRequest,
  type CardFormManagedMediaField,
  type CardFormManagedMediaFieldState,
  type CardFormManagedMediaState,
  type CardFormState,
} from "./CardForm";
import { prepareCardImageMediaAuthoring } from "./cardImageAuthoring";
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

function isWorkspaceUnavailableError(error: unknown): boolean {
  return error instanceof Error && error.message === workspaceUnavailableErrorMessage;
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
  const { showCapturedTechnicalError } = useAppErrorDialog();
  const [currentCard, setCurrentCard] = useState<Card | null>(null);
  const [formState, setFormState] = useState<CardFormState>(toCardFormState(null));
  const [tagSuggestions, setTagSuggestions] = useState<ReadonlyArray<TagSuggestion>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [loadErrorMessage, setLoadErrorMessage] = useState<string>("");
  const [actionErrorMessage, setActionErrorMessage] = useState<string>("");
  const [managedMediaState, setManagedMediaState] = useState<CardFormManagedMediaState>(createCardFormManagedMediaState);
  const observationIdentityRef = useRef<Readonly<{
    userId: string | null;
    installationId: string | null;
  }>>({
    userId: null,
    installationId: null,
  });
  const loadRequestSequenceRef = useRef<number>(0);
  const isCreateMode = cardId === undefined;
  const handoffCardToAi = useAiCardHandoff();
  const isAuthoringMedia = isCardFormManagedMediaProcessing(managedMediaState);
  observationIdentityRef.current = {
    userId: session?.userId ?? null,
    installationId: cloudSettings?.installationId ?? null,
  };

  const loadScreenData = useCallback(async function loadScreenData(): Promise<void> {
    const requestSequence = loadRequestSequenceRef.current + 1;
    loadRequestSequenceRef.current = requestSequence;
    const isCurrentLoadRequest = function isCurrentLoadRequest(): boolean {
      return loadRequestSequenceRef.current === requestSequence;
    };

    setLoadErrorMessage("");
    setActionErrorMessage("");
    setIsLoading(true);

    try {
      if (activeWorkspace === null) {
        throw new Error(workspaceUnavailableErrorMessage);
      }

      const workspaceId = activeWorkspace.workspaceId;
      const [tagsSummary, loadedCard] = await Promise.all([
        loadWorkspaceTagsSummary(workspaceId),
        isCreateMode || cardId === undefined ? Promise.resolve(null) : loadCardById(workspaceId, cardId),
      ]);
      if (isCurrentLoadRequest() === false) {
        return;
      }

      setTagSuggestions(toTagSuggestions(tagsSummary.tags));
      setCurrentCard(loadedCard);
      if (loadedCard !== null) {
        setFormState(toCardFormState(loadedCard));
      }
      if (isCreateMode === false && loadedCard === null) {
        setFormState(toCardFormState(null));
        setLoadErrorMessage(t("cardForm.errors.cardNotFound"));
      }
    } catch (error) {
      if (isCurrentLoadRequest() === false) {
        return;
      }

      if (isWorkspaceUnavailableError(error)) {
        setLoadErrorMessage(workspaceUnavailableErrorMessage);
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
      showCapturedTechnicalError(error);
      setLoadErrorMessage(t("appError.technicalError.message"));
    } finally {
      if (isCurrentLoadRequest()) {
        setIsLoading(false);
      }
    }
  }, [activeWorkspace, cardId, isCreateMode, t]);

  useEffect(() => {
    void loadScreenData();
    return () => {
      loadRequestSequenceRef.current += 1;
    };
  }, [loadScreenData, localReadVersion]);

  function buildUpdatePayload(): UpdateCardInput {
    return {
      frontText: formState.frontText,
      backText: formState.backText,
      tags: formState.tags,
    };
  }

  async function saveCurrentCard(): Promise<Card | null> {
    if (cardId === undefined) {
      setActionErrorMessage(t("cardForm.errors.cardIdRequired"));
      return null;
    }

    setIsSaving(true);
    setActionErrorMessage("");
    setErrorMessage("");

    try {
      const savedCard = await updateCardItem(cardId, buildUpdatePayload());
      setCurrentCard(savedCard);
      setFormState(toCardFormState(savedCard));
      return savedCard;
    } catch (error) {
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
      setIsSaving(false);
    }
  }

  async function handleSubmit(): Promise<void> {
    setIsSaving(true);
    setActionErrorMessage("");
    setErrorMessage("");

    try {
      if (isCreateMode) {
        const payload: CreateCardInput = {
          frontText: formState.frontText,
          backText: formState.backText,
          tags: formState.tags,
        };
        await createCardItem(payload);
      } else if (cardId !== undefined) {
        await updateCardItem(cardId, buildUpdatePayload());
      }

      navigate(cardsRoute);
    } catch (error) {
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
      setIsSaving(false);
    }
  }

  async function handleEditWithAi(): Promise<void> {
    if (isAuthoringMedia) {
      return;
    }

    if (currentCard === null) {
      return;
    }

    if (isCardFormStateDirty(currentCard, formState) === false) {
      await handoffCardToAi(currentCard);
      return;
    }

    const savedCard = await saveCurrentCard();
    if (savedCard === null) {
      return;
    }

    await handoffCardToAi(savedCard);
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
      });
      runMediaUploadTransfers();
      return result.markdown;
    } catch (error) {
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
      setManagedMediaState((currentState) => ({
        ...currentState,
        [request.field]: {
          ...currentState[request.field],
          isProcessing: false,
        },
      }));
    }
  }

  async function handleRetryMediaUploadTransfer(request: CardFormMediaUploadRetryRequest): Promise<void> {
    setActionErrorMessage("");
    setErrorMessage("");

    try {
      await markMediaUploadTransferDueForRetry({
        ...request,
        retryAt: new Date().toISOString(),
      });
      runMediaUploadTransfers();
    } catch (error) {
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
      navigate(cardsRoute);
    } catch (error) {
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
      setIsDeleting(false);
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
          <p className="error-banner">{loadErrorMessage}</p>
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
        {actionErrorMessage !== "" ? <p className="error-banner">{actionErrorMessage}</p> : null}
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
                disabled={isSaving || isDeleting || isAuthoringMedia}
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
              disabled={isSaving || isDeleting || isAuthoringMedia}
              onClick={() => void handleSubmit()}
              data-testid="card-form-save"
            >
              {isSaving ? t("cardForm.actions.saving") : t("cardForm.actions.save")}
            </button>
          </div>
        </div>

        <CardFormFields
          tagSuggestions={tagSuggestions}
          currentCard={currentCard}
          formState={formState}
          formIdPrefix="card-form-screen"
          isSaving={isSaving}
          localReadVersion={localReadVersion}
          managedMediaState={managedMediaState}
          workspaceId={activeWorkspace?.workspaceId ?? null}
          onChange={setFormState}
          onPrepareImageMedia={handlePrepareImageMedia}
          onRetryMediaUploadTransfer={handleRetryMediaUploadTransfer}
        />
      </section>
    </main>
  );
}
