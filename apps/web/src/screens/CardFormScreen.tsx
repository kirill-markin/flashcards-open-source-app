import { useEffect, useState, type ChangeEvent, type ReactElement } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAppData } from "../appData";
import { CardTagsInput, getTagSuggestionsFromCards } from "./CardTagsInput";
import type { Card, CreateCardInput, EffortLevel, UpdateCardInput } from "../types";

type FormState = Readonly<{
  frontText: string;
  backText: string;
  tags: ReadonlyArray<string>;
  effortLevel: EffortLevel;
}>;

function formatTimestamp(value: string | null): string {
  if (value === null) {
    return "new";
  }

  return new Date(value).toLocaleString();
}

function toFormState(card: Card | null): FormState {
  if (card === null) {
    return {
      frontText: "",
      backText: "",
      tags: [],
      effortLevel: "fast",
    };
  }

  return {
    frontText: card.frontText,
    backText: card.backText,
    tags: card.tags,
    effortLevel: card.effortLevel,
  };
}

export function CardFormScreen(): ReactElement {
  const { cardId } = useParams();
  const navigate = useNavigate();
  const { cards, getCardById, createCardItem, updateCardItem, setErrorMessage } = useAppData();
  const [currentCard, setCurrentCard] = useState<Card | null>(null);
  const [formState, setFormState] = useState<FormState>(toFormState(null));
  const [isLoading, setIsLoading] = useState<boolean>(cardId !== undefined);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const isCreateMode = cardId === undefined;
  const tagSuggestions = getTagSuggestionsFromCards(cards);

  useEffect(() => {
    if (isCreateMode) {
      setCurrentCard(null);
      setFormState(toFormState(null));
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    void (async () => {
      try {
        const card = await getCardById(cardId);
        setCurrentCard(card);
        setFormState(toFormState(card));
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error));
      } finally {
        setIsLoading(false);
      }
    })();
  }, [cardId, getCardById, isCreateMode, setErrorMessage]);

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

      navigate("/cards");
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
          <h1 className="title">Card form</h1>
          <p className="subtitle">Loading card…</p>
        </section>
      </main>
    );
  }

  return (
    <main className="container">
      <section className="panel">
        <div className="screen-head">
          <div>
            <h1 className="title">{isCreateMode ? "New card" : "Card form"}</h1>
            <p className="subtitle">Large editor in the same mono system as the tables.</p>
          </div>
          <div className="screen-actions">
            <Link className="ghost-btn" to="/cards">Back</Link>
            <button
              type="button"
              className="primary-btn"
              disabled={isSaving}
              onClick={() => void handleSubmit()}
            >
              {isSaving ? "Saving…" : "Save card"}
            </button>
          </div>
        </div>

        <div className="card-form-layout">
          <section className="card-form-panel">
            <label className="form-label">
              <span>Front</span>
              <textarea
                className="settings-input form-textarea"
                rows={7}
                value={formState.frontText}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>) => updateField("frontText", event.target.value)}
              />
            </label>

            <label className="form-label">
              <span>Back</span>
              <textarea
                className="settings-input form-textarea"
                rows={9}
                value={formState.backText}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>) => updateField("backText", event.target.value)}
              />
            </label>

            <label className="form-label">
              <span>Tags</span>
              <CardTagsInput
                value={formState.tags}
                suggestions={tagSuggestions}
                placeholder="Type tag and press Enter"
                onChange={(nextValue) => updateField("tags", nextValue)}
              />
            </label>

            <label className="form-label">
              <span>Effort</span>
              <select
                className="settings-select"
                value={formState.effortLevel}
                onChange={(event) => updateField("effortLevel", event.target.value as EffortLevel)}
              >
                <option value="fast">fast</option>
                <option value="medium">medium</option>
                <option value="long">long</option>
              </select>
            </label>
          </section>

          <aside className="card-meta-panel">
            <h2 className="panel-subtitle">Read-only metadata</h2>
            <dl className="meta-list">
              <div className="meta-row">
                <dt>Card ID</dt>
                <dd>{currentCard?.cardId ?? "new"}</dd>
              </div>
              <div className="meta-row">
                <dt>Due</dt>
                <dd>{formatTimestamp(currentCard?.dueAt ?? null)}</dd>
              </div>
              <div className="meta-row">
                <dt>Reps</dt>
                <dd>{currentCard?.reps ?? 0}</dd>
              </div>
              <div className="meta-row">
                <dt>Lapses</dt>
                <dd>{currentCard?.lapses ?? 0}</dd>
              </div>
              <div className="meta-row">
                <dt>Updated</dt>
                <dd>{formatTimestamp(currentCard?.updatedAt ?? null)}</dd>
              </div>
            </dl>
          </aside>
        </div>
      </section>
    </main>
  );
}
