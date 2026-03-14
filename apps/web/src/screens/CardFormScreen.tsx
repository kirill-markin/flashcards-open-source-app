import { useCallback, useEffect, useState, type ReactElement } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAppData } from "../appData";
import { CardFormFields, toCardFormState, type CardFormState } from "./CardForm";
import type { Card, CreateCardInput, UpdateCardInput } from "../types";
import { cardsRoute } from "../routes";

export function CardFormScreen(): ReactElement {
  const { cardId } = useParams();
  const navigate = useNavigate();
  const { cards, ensureCardsLoaded, getCardById, createCardItem, updateCardItem, deleteCardItem, setErrorMessage } = useAppData();
  const [currentCard, setCurrentCard] = useState<Card | null>(null);
  const [formState, setFormState] = useState<CardFormState>(toCardFormState(null));
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [loadErrorMessage, setLoadErrorMessage] = useState<string>("");
  const [actionErrorMessage, setActionErrorMessage] = useState<string>("");
  const isCreateMode = cardId === undefined;

  const loadScreenData = useCallback(async function loadScreenData(): Promise<void> {
    setLoadErrorMessage("");
    setActionErrorMessage("");

    if (isCreateMode) {
      setCurrentCard(null);
      setFormState(toCardFormState(null));
      setIsLoading(true);
      try {
        await ensureCardsLoaded();
      } catch (error) {
        setLoadErrorMessage(error instanceof Error ? error.message : String(error));
      } finally {
        setIsLoading(false);
      }
      return;
    }

    if (cardId === undefined) {
      throw new Error("Card ID is required");
    }

    setIsLoading(true);
    try {
      await ensureCardsLoaded();
      const card = await getCardById(cardId);
      setCurrentCard(card);
      setFormState(toCardFormState(card));
    } catch (error) {
      setLoadErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }, [cardId, ensureCardsLoaded, getCardById, isCreateMode]);

  useEffect(() => {
    void loadScreenData();
  }, [loadScreenData]);

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
        const payload: UpdateCardInput = {
          frontText: formState.frontText,
          backText: formState.backText,
          tags: formState.tags,
          effortLevel: formState.effortLevel,
        };
        await updateCardItem(cardId, payload);
      }

      navigate(cardsRoute);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
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
          cards={cards}
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
