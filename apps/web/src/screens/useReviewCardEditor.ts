import { useState } from "react";
import { toCardFormState, type CardFormState } from "./CardForm";
import type { Card, TagSuggestion } from "../types";

type UseReviewCardEditorParams = Readonly<{
  deleteCardItem: (cardId: string) => Promise<Card>;
  queueCards: ReadonlyArray<Card>;
  selectedCard: Card | null;
  setErrorMessage: (message: string) => void;
  updateCardItem: (cardId: string, input: Readonly<{
    frontText: string;
    backText: string;
    tags: ReadonlyArray<string>;
    effortLevel: Card["effortLevel"];
  }>) => Promise<Card>;
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
    queueCards,
    selectedCard,
    setErrorMessage,
    updateCardItem,
  } = params;
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
      setEditorErrorMessage("Card not found");
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
        effortLevel: editorFormState.effortLevel,
      });
      setIsEditorPresented(false);
    } catch (error) {
      setEditorErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsEditorSaving(false);
    }
  }

  async function handleEditorSaveForAiHandoff(): Promise<Card | null> {
    if (editingCardId === "") {
      setEditorErrorMessage("Card not found");
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
        effortLevel: editorFormState.effortLevel,
      });
      return savedCard;
    } catch (error) {
      setEditorErrorMessage(error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      setIsEditorSaving(false);
    }
  }

  async function handleEditorDelete(): Promise<void> {
    if (editingCardId === "") {
      setEditorErrorMessage("Card not found");
      return;
    }

    if (window.confirm("Delete this card?") === false) {
      return;
    }

    setIsEditorSaving(true);
    setEditorErrorMessage("");
    setErrorMessage("");

    try {
      await deleteCardItem(editingCardId);
      setIsEditorPresented(false);
    } catch (error) {
      setEditorErrorMessage(error instanceof Error ? error.message : String(error));
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
