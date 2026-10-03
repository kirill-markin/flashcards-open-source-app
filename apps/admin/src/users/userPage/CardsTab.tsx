import { useCallback, useEffect, useMemo, useState, type JSX } from "react";
import type { AdminAppConfig } from "../../config";
import { DataTable } from "../../table/DataTable";
import { emptyDataTableState, type DataTableColumn, type DataTableState } from "../../table/dataTableModel";
import { cardTextPreviewLength, loadCardFullText, loadCards, type CardFullText, type CardRow } from "./cardsQuery";

type LoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; cards: ReadonlyArray<CardRow> }>;

/** A card without an entry shows its preview; a failed load keeps the preview and says why. */
type FullTextState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; fullText: CardFullText }>;

type FullTextActions = Readonly<{
  expand: (cardId: string) => void;
  collapse: (cardId: string) => void;
}>;

function isCardTruncated(card: CardRow): boolean {
  return card.frontLength > cardTextPreviewLength || card.backLength > cardTextPreviewLength;
}

function getShownText(preview: string, length: number, fullText: string | null): string {
  if (fullText !== null) return fullText;
  return length > cardTextPreviewLength ? `${preview}…` : preview;
}

function renderFullTextToggle(card: CardRow, state: FullTextState | undefined, actions: FullTextActions): JSX.Element | null {
  if (!isCardTruncated(card)) return null;
  if (state?.status === "ready") {
    return <button className="card-text-toggle" type="button" onClick={() => actions.collapse(card.cardId)}>Show less</button>;
  }
  return (
    <>
      <button
        className="card-text-toggle"
        type="button"
        disabled={state?.status === "loading"}
        onClick={() => actions.expand(card.cardId)}
      >{state?.status === "loading" ? "Loading full text…" : "Show full text"}</button>
      {state?.status === "error" ? <span className="card-text-error" role="alert">Loading full text failed: {state.message}</span> : null}
    </>
  );
}

// The front cell carries the one toggle for both sides, because one request loads both.
function buildCardColumns(
  fullTexts: Readonly<Record<string, FullTextState>>,
  actions: FullTextActions,
): ReadonlyArray<DataTableColumn<CardRow>> {
  const readFullText = (card: CardRow): CardFullText | null => {
    const state = fullTexts[card.cardId];
    return state?.status === "ready" ? state.fullText : null;
  };
  return [
    {
      id: "front",
      label: "Front",
      kind: "text",
      value: (card) => card.frontPreview,
      renderCell: (card) => (
        <div className="card-text-cell">
          <span className="card-text">{getShownText(card.frontPreview, card.frontLength, readFullText(card)?.frontText ?? null)}</span>
          {renderFullTextToggle(card, fullTexts[card.cardId], actions)}
        </div>
      ),
    },
    {
      id: "back",
      label: "Back",
      kind: "text",
      value: (card) => card.backPreview,
      renderCell: (card) => (
        <span className="card-text">{getShownText(card.backPreview, card.backLength, readFullText(card)?.backText ?? null)}</span>
      ),
    },
    { id: "tags", label: "Tags", kind: "text", value: (card) => card.tags, renderCell: null },
    { id: "card-type", label: "Card type", kind: "enum", value: (card) => card.cardType, renderCell: null },
    { id: "effort", label: "Effort", kind: "enum", value: (card) => card.effortLevel, renderCell: null },
    { id: "created", label: "Created (UTC)", kind: "date", value: (card) => card.createdAt, renderCell: null },
    { id: "updated", label: "Updated (UTC)", kind: "date", value: (card) => card.updatedAt, renderCell: null },
    { id: "due", label: "Due (UTC)", kind: "date", value: (card) => card.dueAt, renderCell: null },
    { id: "reps", label: "Reps", kind: "number", value: (card) => card.reps, renderCell: null },
    { id: "lapses", label: "Lapses", kind: "number", value: (card) => card.lapses, renderCell: null },
    { id: "fsrs-state", label: "FSRS state", kind: "enum", value: (card) => card.fsrsState, renderCell: null },
    { id: "stability", label: "Stability (days)", kind: "number", value: (card) => card.stability, renderCell: null },
    { id: "difficulty", label: "Difficulty", kind: "number", value: (card) => card.difficulty, renderCell: null },
    { id: "last-reviewed", label: "Last reviewed (UTC)", kind: "date", value: (card) => card.lastReviewedAt, renderCell: null },
    { id: "workspace", label: "Workspace", kind: "enum", value: (card) => card.workspaceName, renderCell: null },
    { id: "deleted", label: "Deleted", kind: "boolean", value: (card) => card.deletedAt !== null, renderCell: null },
    { id: "deleted-at", label: "Deleted at (UTC)", kind: "date", value: (card) => card.deletedAt, renderCell: null },
  ];
}

function getCardRowKey(card: CardRow): string {
  return card.cardId;
}

function getCardRowClassName(card: CardRow): string {
  return card.deletedAt === null ? "" : "data-table-row-muted";
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected user cards query error.";
}

export function CardsTab(props: Readonly<{
  config: AdminAppConfig;
  userId: string;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
}>): JSX.Element {
  const { config, userId, onTerminalAdminError } = props;
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [revision, setRevision] = useState<number>(0);
  const [tableState, setTableState] = useState<DataTableState>(emptyDataTableState);
  const [fullTexts, setFullTexts] = useState<Readonly<Record<string, FullTextState>>>({});

  useEffect(() => {
    let cancelled = false;
    setLoadState({ status: "loading" });
    void loadCards(config, userId).then((cards) => {
      if (!cancelled) setLoadState({ status: "ready", cards });
    }).catch((error: unknown) => {
      if (cancelled || onTerminalAdminError(error, config)) return;
      setLoadState({ status: "error", message: getErrorMessage(error) });
    });
    return () => { cancelled = true; };
  }, [config, userId, onTerminalAdminError, revision]);

  const expand = useCallback((cardId: string): void => {
    setFullTexts((current) => ({ ...current, [cardId]: { status: "loading" } }));
    void loadCardFullText(config, userId, cardId).then((fullText) => {
      setFullTexts((current) => ({ ...current, [cardId]: { status: "ready", fullText } }));
    }).catch((error: unknown) => {
      if (onTerminalAdminError(error, config)) return;
      setFullTexts((current) => ({ ...current, [cardId]: { status: "error", message: getErrorMessage(error) } }));
    });
  }, [config, userId, onTerminalAdminError]);

  const collapse = useCallback((cardId: string): void => {
    setFullTexts((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== cardId)));
  }, []);

  const columns = useMemo(() => buildCardColumns(fullTexts, { expand, collapse }), [fullTexts, expand, collapse]);

  if (loadState.status === "loading") {
    return <p className="report-state" aria-live="polite">Loading cards…</p>;
  }

  if (loadState.status === "error") {
    return (
      <div className="report-state report-state-error">
        <strong>User cards query failed.</strong><span>{loadState.message}</span>
        <button className="filter-button" type="button" onClick={() => setRevision((value) => value + 1)}>Retry</button>
      </div>
    );
  }

  return (
    <div className="user-tab" data-testid="user-cards">
      <p className="dashboard-section-description">
        Every card in this person's workspaces, newest first, deleted cards included and dimmed. Front and back show their first {cardTextPreviewLength.toLocaleString("en-US")} characters, and filtering and sorting read only those; Show full text loads the whole card.
      </p>
      <DataTable
        testId="user-cards-table"
        columns={columns}
        rows={loadState.cards}
        rowKey={getCardRowKey}
        rowClassName={getCardRowClassName}
        state={tableState}
        onStateChange={setTableState}
      />
    </div>
  );
}
