import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import { useAppData } from "../appData";
import { formatDeckFilterDefinition } from "../deckFilters";

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

export function DecksScreen(): ReactElement {
  const { decks } = useAppData();

  return (
    <main className="container">
      <section className="panel">
        <div className="screen-head">
          <div>
            <h1 className="title">Decks</h1>
            <p className="subtitle">Saved filter sets over the full cards table.</p>
          </div>
          <div className="screen-actions">
            <span className="badge">{decks.length} total</span>
            <Link className="primary-btn" to="/decks/new">New deck</Link>
          </div>
        </div>

        <div className="txn-scroll">
          <table className="txn-table">
            <thead>
              <tr>
                <th className="txn-th">Name</th>
                <th className="txn-th">Filters</th>
                <th className="txn-th">Updated</th>
              </tr>
            </thead>
            <tbody>
              {decks.map((deck) => (
                <tr key={deck.deckId} className="txn-row">
                  <td className="txn-cell">{deck.name}</td>
                  <td className="txn-cell">
                    <div className="cell-stack">
                      <span className="cell-primary">{formatDeckFilterDefinition(deck.filterDefinition)}</span>
                    </div>
                  </td>
                  <td className="txn-cell txn-cell-mono">{formatTimestamp(deck.updatedAt)}</td>
                </tr>
              ))}
              {decks.length === 0 ? (
                <tr>
                  <td className="txn-cell txn-empty" colSpan={3}>No decks yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
