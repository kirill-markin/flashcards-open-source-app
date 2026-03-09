import { useCallback, useEffect, useState, type ChangeEvent, type ReactElement } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAppData } from "../appData";
import { buildDeckFilterDefinition, EFFORT_LEVELS, formatDeckFilterDefinition } from "../deckFilters";
import { CardFormTagsField } from "./CardFormTagsField";
import { getTagSuggestionsFromCards } from "./CardTagsInput";
import type { EffortLevel } from "../types";

type FormState = Readonly<{
  name: string;
  effortLevels: ReadonlyArray<EffortLevel>;
  tags: ReadonlyArray<string>;
}>;

function createInitialFormState(): FormState {
  return {
    name: "",
    effortLevels: [],
    tags: [],
  };
}

function toggleEffortLevel(
  effortLevels: ReadonlyArray<EffortLevel>,
  effortLevel: EffortLevel,
): ReadonlyArray<EffortLevel> {
  if (effortLevels.includes(effortLevel)) {
    return effortLevels.filter((value) => value !== effortLevel);
  }

  return [...effortLevels, effortLevel];
}

export function DeckFormScreen(): ReactElement {
  const navigate = useNavigate();
  const { cards, ensureCardsLoaded, ensureDecksLoaded, createDeckItem, setErrorMessage } = useAppData();
  const [formState, setFormState] = useState<FormState>(createInitialFormState());
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [screenErrorMessage, setScreenErrorMessage] = useState<string>("");
  const tagSuggestions = getTagSuggestionsFromCards(cards);
  const filterDefinition = buildDeckFilterDefinition(formState.effortLevels, formState.tags);
  const nameFieldId = "deck-name";
  const tagsFieldId = "deck-tags-input";

  const loadScreenData = useCallback(async function loadScreenData(): Promise<void> {
    setIsLoading(true);
    setScreenErrorMessage("");

    try {
      await Promise.all([ensureDecksLoaded(), ensureCardsLoaded()]);
    } catch (error) {
      setScreenErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }, [ensureCardsLoaded, ensureDecksLoaded]);

  useEffect(() => {
    void loadScreenData();
  }, [loadScreenData]);

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
      await createDeckItem({
        name: formState.name,
        filterDefinition,
      });
      navigate("/decks");
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
          <h1 className="title">New deck</h1>
          <p className="subtitle">Loading deck data…</p>
        </section>
      </main>
    );
  }

  if (screenErrorMessage !== "") {
    return (
      <main className="container">
        <section className="panel">
          <h1 className="title">New deck</h1>
          <p className="error-banner">{screenErrorMessage}</p>
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
        <div className="screen-head">
          <div>
            <h1 className="title">New deck</h1>
            <p className="subtitle">Save a reusable card filter set.</p>
          </div>
          <div className="screen-actions">
            <Link className="ghost-btn" to="/decks">Back</Link>
            <button
              type="button"
              className="primary-btn"
              disabled={isSaving}
              onClick={() => void handleSubmit()}
            >
              {isSaving ? "Saving…" : "Save deck"}
            </button>
          </div>
        </div>

        <div className="card-form-layout">
          <section className="card-form-panel">
            <label className="form-label" htmlFor={nameFieldId}>
              <span>Name</span>
              <input
                id={nameFieldId}
                name="name"
                className="settings-input"
                value={formState.name}
                onChange={(event: ChangeEvent<HTMLInputElement>) => updateField("name", event.target.value)}
              />
            </label>

            <fieldset className="deck-form-fieldset">
              <legend className="deck-form-legend">Effort</legend>
              <div className="deck-checkbox-list">
                {EFFORT_LEVELS.map((effortLevel) => (
                  <label key={effortLevel} className="deck-checkbox-option">
                    <input
                      id={`deck-effort-${effortLevel}`}
                      name="effortLevels"
                      type="checkbox"
                      checked={formState.effortLevels.includes(effortLevel)}
                      onChange={() => updateField("effortLevels", toggleEffortLevel(formState.effortLevels, effortLevel))}
                    />
                    <span>{effortLevel}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="form-label">
              <label htmlFor={tagsFieldId}>
                <span>Tags</span>
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
            <h2 className="panel-subtitle">Filter preview</h2>
            <dl className="meta-list">
              <div className="meta-row">
                <dt>Name</dt>
                <dd>{formState.name.trim() === "" ? "new deck" : formState.name.trim()}</dd>
              </div>
              <div className="meta-row">
                <dt>Summary</dt>
                <dd>{formatDeckFilterDefinition(filterDefinition)}</dd>
              </div>
              <div className="meta-row">
                <dt>Conditions</dt>
                <dd>{Number(filterDefinition.effortLevels.length > 0) + Number(filterDefinition.tags.length > 0)}</dd>
              </div>
            </dl>
          </aside>
        </div>
      </section>
    </main>
  );
}
