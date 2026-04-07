import { useCallback, useEffect, useState, type ReactElement } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAppData } from "../appData";
import { useAiCardHandoff } from "../chat/useAiCardHandoff";
import { CardFormFields, isCardFormStateDirty, toCardFormState, type CardFormState } from "./CardForm";
import type { Card, CreateCardInput, TagSuggestion, UpdateCardInput } from "../types";
import { loadWorkspaceTagsSummary } from "../localDb/workspace";
import { cardsRoute } from "../routes";

function toTagSuggestions(tags: Awaited<ReturnType<typeof loadWorkspaceTagsSummary>>["tags"]): ReadonlyArray<TagSuggestion> {
  return tags.map((tagSummary) => ({
    tag: tagSummary.tag,
    countState: "ready",
    cardsCount: tagSummary.cardsCount,
  }));
}

export function CardFormScreen(): ReactElement {
  const { cardId } = useParams();
  const navigate = useNavigate();
  const { activeWorkspace, getCardById, createCardItem, updateCardItem, deleteCardItem, setErrorMessage, localReadVersion } = useAppData();
  const [currentCard, setCurrentCard] = useState<Card | null>(null);
  const [formState, setFormState] = useState<CardFormState>(toCardFormState(null));
  const [tagSuggestions, setTagSuggestions] = useState<ReadonlyArray<TagSuggestion>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [loadErrorMessage, setLoadErrorMessage] = useState<string>("");
  const [actionErrorMessage, setActionErrorMessage] = useState<string>("");
  const isCreateMode = cardId === undefined;
  const handoffCardToAi = useAiCardHandoff();

  const loadScreenData = useCallback(async function loadScreenData(): Promise<void> {
    setLoadErrorMessage("");
    setActionErrorMessage("");
    setIsLoading(true);

    try {
      if (activeWorkspace === null) {
        throw new Error("Workspace is unavailable");
      }

      const [tagsSummary, loadedCard] = await Promise.all([
        loadWorkspaceTagsSummary(activeWorkspace.workspaceId),
        isCreateMode || cardId === undefined ? Promise.resolve(null) : getCardById(cardId),
      ]);
      setTagSuggestions(toTagSuggestions(tagsSummary.tags));
      setCurrentCard(loadedCard);
      if (loadedCard !== null) {
        setFormState(toCardFormState(loadedCard));
      }
    } catch (error) {
      setLoadErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }, [activeWorkspace, cardId, getCardById, isCreateMode]);

  useEffect(() => {
    void loadScreenData();
  }, [loadScreenData, localReadVersion]);

  function buildUpdatePayload(): UpdateCardInput {
    return {
      frontText: formState.frontText,
      backText: formState.backText,
      tags: formState.tags,
      effortLevel: formState.effortLevel,
    };
  }

  async function saveCurrentCard(): Promise<Card | null> {
    if (cardId === undefined) {
      setActionErrorMessage("Card ID is required");
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
      setActionErrorMessage(error instanceof Error ? error.message : String(error));
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
          effortLevel: formState.effortLevel,
        };
        await createCardItem(payload);
      } else if (cardId !== undefined) {
        await updateCardItem(cardId, buildUpdatePayload());
      }

      navigate(cardsRoute);
    } catch (error) {
      setActionErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleEditWithAi(): Promise<void> {
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

  async function handleDelete(): Promise<void> {
    if (cardId === undefined) {
      setActionErrorMessage("Card ID is required");
      return;
    }

    if (window.confirm("Delete this card?") === false) {
      return;
    }

    setIsDeleting(true);
    setActionErrorMessage("");
    setErrorMessage("");

    try {
      await deleteCardItem(cardId);
      navigate(cardsRoute);
    } catch (error) {
      setActionErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsDeleting(false);
    }
  }

  if (isLoading) {
    return (
      <main className="container">
        <section className="panel">
          <h1 className="title">Card form</h1>
          <p className="subtitle">Loading card…</p>
        </section>
      </main>
    );
  }

  if (loadErrorMessage !== "") {
    return (
      <main className="container">
        <section className="panel">
          <h1 className="title">Card form</h1>
          <p className="error-banner">{loadErrorMessage}</p>
          <button className="primary-btn" type="button" onClick={() => void loadScreenData()}>
            Retry
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
            <h1 className="title">{isCreateMode ? "New card" : "Card form"}</h1>
            <p className="subtitle">Large editor in the same mono system as the tables.</p>
          </div>
          <div className="screen-actions">
            <Link className="ghost-btn" to={cardsRoute}>Back</Link>
            {!isCreateMode && currentCard !== null ? (
              <button
                type="button"
                className="ghost-btn review-editor-ai-btn"
                disabled={isSaving || isDeleting}
                onClick={() => void handleEditWithAi()}
              >
                Edit with AI
              </button>
            ) : null}
            {!isCreateMode ? (
              <button
                type="button"
                className="ghost-btn settings-danger-btn"
                disabled={isSaving || isDeleting}
                onClick={() => void handleDelete()}
              >
                {isDeleting ? "Deleting…" : "Delete card"}
              </button>
            ) : null}
            <button
              type="button"
              className="primary-btn"
              disabled={isSaving || isDeleting}
              onClick={() => void handleSubmit()}
            >
              {isSaving ? "Saving…" : "Save card"}
            </button>
          </div>
        </div>

        <CardFormFields
          tagSuggestions={tagSuggestions}
          currentCard={currentCard}
          formState={formState}
          formIdPrefix="card-form-screen"
          isSaving={isSaving}
          onChange={setFormState}
        />
      </section>
    </main>
  );
}
