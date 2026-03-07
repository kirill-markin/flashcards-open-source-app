import { useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { useAppData } from "../appData";
import { EditableCardEffortCell, EditableCardTagsCell, EditableCardTextCell } from "./CardsTableEditors";
import { getTagSuggestionsFromCards } from "./CardTagsInput";
import type { Card, UpdateCardInput } from "../types";

type SortKey = "frontText" | "backText" | "tags" | "effortLevel" | "dueAt" | "reps" | "lapses" | "updatedAt";
type SortDirection = "asc" | "desc";

function formatTimestamp(value: string | null): string {
  if (value === null) {
    return "new";
  }

  return new Date(value).toLocaleString();
}

function compareCards(left: Card, right: Card, sortKey: SortKey, sortDirection: SortDirection): number {
  const multiplier = sortDirection === "asc" ? 1 : -1;
  const leftValue = sortKey === "tags" ? left.tags.join(", ") : left[sortKey];
  const rightValue = sortKey === "tags" ? right.tags.join(", ") : right[sortKey];

  if (typeof leftValue === "number" && typeof rightValue === "number") {
    return (leftValue - rightValue) * multiplier;
  }

  const leftString = leftValue ?? "";
  const rightString = rightValue ?? "";
  return String(leftString).localeCompare(String(rightString)) * multiplier;
}

export function CardsScreen(): ReactElement {
  const { cards, updateCardItem, setErrorMessage } = useAppData();
  const [sortKey, setSortKey] = useState<SortKey>("updatedAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [savingCardId, setSavingCardId] = useState<string>("");

  async function handleInlineSave(card: Card, patch: UpdateCardInput): Promise<void> {
    setSavingCardId(card.cardId);
    setErrorMessage("");

    try {
      await updateCardItem(card.cardId, patch);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingCardId("");
    }
  }

  function toggleSort(nextSortKey: SortKey): void {
    if (nextSortKey === sortKey) {
      setSortDirection((currentDirection) => (currentDirection === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(nextSortKey);
    setSortDirection(nextSortKey === "updatedAt" ? "desc" : "asc");
  }

  const sortedCards = [...cards].sort((left, right) => compareCards(left, right, sortKey, sortDirection));
  const tagSuggestions = getTagSuggestionsFromCards(cards);

  return (
    <main className="container">
      <section className="panel">
        <div className="screen-head">
          <div>
            <h1 className="title">Cards</h1>
            <p className="subtitle">Manage the whole deck in one table.</p>
          </div>
          <div className="screen-actions">
            <span className="badge">{cards.length} total</span>
            <Link className="primary-btn" to="/cards/new">New card</Link>
          </div>
        </div>

        <div className="txn-scroll">
          <table className="txn-table cards-table">
            <thead>
              <tr>
                <th className="txn-th txn-th-sortable" onClick={() => toggleSort("frontText")}>Front</th>
                <th className="txn-th txn-th-sortable" onClick={() => toggleSort("backText")}>Back</th>
                <th className="txn-th txn-th-sortable" onClick={() => toggleSort("tags")}>Tags</th>
                <th className="txn-th txn-th-sortable" onClick={() => toggleSort("effortLevel")}>Effort</th>
                <th className="txn-th txn-th-sortable" onClick={() => toggleSort("dueAt")}>Due</th>
                <th className="txn-th txn-th-sortable" onClick={() => toggleSort("reps")}>Reps</th>
                <th className="txn-th txn-th-sortable" onClick={() => toggleSort("lapses")}>Lapses</th>
                <th className="txn-th txn-th-sortable" onClick={() => toggleSort("updatedAt")}>Updated</th>
                <th className="txn-th cards-open-th" />
              </tr>
            </thead>
            <tbody>
              {sortedCards.map((card) => {
                const isSaving = savingCardId === card.cardId;
                return (
                  <tr key={card.cardId} className="txn-row cards-row">
                    <EditableCardTextCell
                      value={card.frontText}
                      displayValue={card.frontText}
                      cellClassName=""
                      multiline={true}
                      saving={isSaving}
                      onCommit={(nextValue) => handleInlineSave(card, { frontText: nextValue })}
                    />
                    <EditableCardTextCell
                      value={card.backText}
                      displayValue={card.backText}
                      cellClassName=""
                      multiline={true}
                      saving={isSaving}
                      onCommit={(nextValue) => handleInlineSave(card, { backText: nextValue })}
                    />
                    <EditableCardTagsCell
                      value={card.tags}
                      suggestions={tagSuggestions}
                      cellClassName="cards-tag-cell"
                      saving={isSaving}
                      onCommit={(nextValue) => handleInlineSave(card, { tags: nextValue })}
                    />
                    <EditableCardEffortCell
                      value={card.effortLevel}
                      cellClassName=""
                      saving={isSaving}
                      onCommit={(nextValue) => handleInlineSave(card, { effortLevel: nextValue })}
                    />
                    <td className="txn-cell txn-cell-mono">{formatTimestamp(card.dueAt)}</td>
                    <td className="txn-cell txn-cell-mono">{card.reps}</td>
                    <td className="txn-cell txn-cell-mono">{card.lapses}</td>
                    <td className="txn-cell txn-cell-mono">{formatTimestamp(card.updatedAt)}</td>
                    <td className="txn-cell cards-open-cell">
                      <Link className="row-open-link" to={`/cards/${card.cardId}`}>Open</Link>
                    </td>
                  </tr>
                );
              })}
              {sortedCards.length === 0 ? (
                <tr>
                  <td className="txn-cell txn-empty" colSpan={9}>No cards yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
