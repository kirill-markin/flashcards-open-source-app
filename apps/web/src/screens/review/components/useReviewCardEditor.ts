import { useState } from "react";
import { useAppErrorDialog } from "../../../appError/AppErrorContext";
import type { TranslationKey } from "../../../i18n";
import { captureAppOperationError } from "../../../observability/appOperationObservation";
import { getExpectedCardMutationInlineErrorMessage } from "../../cards/cardMutationErrors";
import { toCardFormState, type CardFormState } from "../../cards/form/CardForm";
import type { Card } from "../../../types";

type UseReviewCardEditorParams = Readonly<{
  deleteCardItem: (cardId: string) => Promise<Card>;
  installationId: string | null;
  queueCards: ReadonlyArray<Card>;
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
  handleEditorDelete: () => Promise<void>;
  handleEditorSaveForAiHandoff: () => Promise<Card | null>;
  handleEditorSave: () => Promise<void>;
  handleOpenEditor: (card: Card) => void;
  isEditorPresented: boolean;
  isEditorSaving: boolean;
  setEditorFormState: (nextFormState: CardFormState) => void;
  setIsEditorPresented: (value: boolean) => void;
}>;

export function useReviewCardEditor(params: UseReviewCardEditorParams): UseReviewCardEditorResult {
  const {
    deleteCardItem,
    installationId,
    queueCards,
    selectedCard,
    setErrorMessage,
    t,
    updateCardItem,
    userId,
    workspaceId,
  } = params;
  const { showCapturedTechnicalError } = useAppErrorDialog();
  const [isEditorPresented, setIsEditorPresented] = useState<boolean>(false);
  const [editingCardId, setEditingCardId] = useState<string>("");
  const [editorFormState, setEditorFormState] = useState<CardFormState>(toCardFormState(null));
  const [editorErrorMessage, setEditorErrorMessage] = useState<string>("");
  const [isEditorSaving, setIsEditorSaving] = useState<boolean>(false);
  const editingCard = queueCards.find((card) => card.cardId === editingCardId) ?? selectedCard ?? null;

  function handleOpenEditor(card: Card): void {
    setEditingCardId(card.cardId);
    setEditorFormState(toCardFormState(card));
    setEditorErrorMessage("");
    setIsEditorPresented(true);
  }

  async function handleEditorSave(): Promise<void> {
    if (editingCardId === "") {
      setEditorErrorMessage(t("reviewEditor.errors.cardNotFound"));
      return;
    }

    setIsEditorSaving(true);
    setEditorErrorMessage("");
    setErrorMessage("");

    try {
      await updateCardItem(editingCardId, {
        frontText: editorFormState.frontText,
        backText: editorFormState.backText,
        tags: editorFormState.tags,
      });
      setIsEditorPresented(false);
    } catch (error) {
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
      setIsEditorSaving(false);
    }
  }

  async function handleEditorSaveForAiHandoff(): Promise<Card | null> {
    if (editingCardId === "") {
      setEditorErrorMessage(t("reviewEditor.errors.cardNotFound"));
      return null;
    }

    setIsEditorSaving(true);
    setEditorErrorMessage("");
    setErrorMessage("");

    try {
      const savedCard = await updateCardItem(editingCardId, {
        frontText: editorFormState.frontText,
        backText: editorFormState.backText,
        tags: editorFormState.tags,
      });
      return savedCard;
    } catch (error) {
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
      setIsEditorSaving(false);
    }
  }

  async function handleEditorDelete(): Promise<void> {
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
      setIsEditorPresented(false);
    } catch (error) {
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
      setIsEditorSaving(false);
    }
  }

  return {
    editorErrorMessage,
    editingCard,
    editorFormState,
    handleEditorDelete,
    handleEditorSaveForAiHandoff,
    handleEditorSave,
    handleOpenEditor,
    isEditorPresented,
    isEditorSaving,
    setEditorFormState,
    setIsEditorPresented,
  };
}
