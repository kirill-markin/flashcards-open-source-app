import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import type { AdminAppConfig } from "../../config";
import { DataTable } from "../../table/DataTable";
import { clampDataTablePage, emptyDataTableState, type DataTableColumn, type DataTableState } from "../../table/dataTableModel";
import {
  cardTextPreviewLength,
  emptyCardsEnumOptions,
  loadCardFullText,
  loadCardsEnumOptions,
  loadCardsPage,
  type CardFullText,
  type CardRow,
  type CardsEnumOptions,
  type CardsPageResult,
} from "./cardsQuery";

type LoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{
    status: "ready";
    result: CardsPageResult;
    isLoading: boolean;
    /** A reload that failed while the previous page stays on screen; cleared only by a later success. */
    reloadError: string | null;
  }>;

type EnumOptionsState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; options: CardsEnumOptions }>;

// Every state change is a query, so a burst of keystrokes in a filter would be a burst of queries. The
// newest state waits this long before it is sent, and the ones it superseded never reach the network.
const tableReloadDebounceMs = 300;

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

// The column ids name the SQL each one's filter and sort read, `cardColumnSqlById` in `cardsQuery.ts`.
// Front and back render through `withFullTextCells`, which carries the full-text state, so the page
// query reads these columns and never reloads when a card is expanded.
const cardColumns: ReadonlyArray<DataTableColumn<CardRow>> = [
  { id: "front", label: "Front", kind: "text", value: (card) => card.frontPreview, renderCell: null },
  { id: "back", label: "Back", kind: "text", value: (card) => card.backPreview, renderCell: null },
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

// The front cell carries the one toggle for both sides, because one request loads both.
function withFullTextCells(
  fullTexts: Readonly<Record<string, FullTextState>>,
  actions: FullTextActions,
): ReadonlyArray<DataTableColumn<CardRow>> {
  const readFullText = (card: CardRow): CardFullText | null => {
    const state = fullTexts[card.cardId];
    return state?.status === "ready" ? state.fullText : null;
  };
  return cardColumns.map((column): DataTableColumn<CardRow> => {
    if (column.id === "front") {
      return {
        ...column,
        renderCell: (card: CardRow) => (
          <div className="card-text-cell">
            <span className="card-text">{getShownText(card.frontPreview, card.frontLength, readFullText(card)?.frontText ?? null)}</span>
            {renderFullTextToggle(card, fullTexts[card.cardId], actions)}
          </div>
        ),
      };
    }
    if (column.id === "back") {
      return {
        ...column,
        renderCell: (card: CardRow) => (
          <span className="card-text">{getShownText(card.backPreview, card.backLength, readFullText(card)?.backText ?? null)}</span>
        ),
      };
    }
    return column;
  });
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

/**
 * Every card of the person's workspaces, sorted, filtered and paged in SQL; an unsorted table is newest
 * first. The enum option lists are fetched once on entry, apart from the pages, so the rows never wait
 * for them and their failure only empties the enum filters.
 */
export function CardsTab(props: Readonly<{
  config: AdminAppConfig;
  userId: string;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
}>): JSX.Element {
  const { config, userId, onTerminalAdminError } = props;
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [revision, setRevision] = useState<number>(0);
  const [tableState, setTableState] = useState<DataTableState>(emptyDataTableState);
  const [enumOptionsState, setEnumOptionsState] = useState<EnumOptionsState>({ status: "loading" });
  const [enumOptionsRevision, setEnumOptionsRevision] = useState<number>(0);
  const [fullTexts, setFullTexts] = useState<Readonly<Record<string, FullTextState>>>({});
  // Only a table that already shows a page waits for the debounce; the first load has nothing to coalesce.
  const hasLoadedPageRef = useRef<boolean>(false);

  // Blind to the table state, so neither a table change nor the clamp re-request asks for them again.
  useEffect(() => {
    let isSuperseded = false;
    setEnumOptionsState({ status: "loading" });

    async function loadEnumOptions(): Promise<void> {
      try {
        const options = await loadCardsEnumOptions(config, userId);
        if (isSuperseded) return;
        setEnumOptionsState({ status: "ready", options });
      } catch (error: unknown) {
        if (isSuperseded || onTerminalAdminError(error, config)) return;
        setEnumOptionsState({ status: "error", message: getErrorMessage(error) });
      }
    }

    void loadEnumOptions();
    return () => {
      isSuperseded = true;
    };
  }, [config, enumOptionsRevision, onTerminalAdminError, userId]);

  useEffect(() => {
    const requestedState = tableState;
    let isSuperseded = false;
    // The previous page stays on screen, dimmed, until the new one arrives.
    setLoadState((current) => {
      if (current.status === "ready") return { ...current, isLoading: true };
      return current.status === "error" ? { status: "loading" } : current;
    });

    async function loadPage(): Promise<void> {
      try {
        const result = await loadCardsPage(config, userId, requestedState, cardColumns);
        if (isSuperseded) return;
        // A page past the end, from a shrunken total, is asked for again as the last page the table shows.
        const clampedPage = clampDataTablePage(requestedState.page, result.totalCount);
        if (clampedPage !== requestedState.page) {
          setTableState({ ...requestedState, page: clampedPage });
          return;
        }
        hasLoadedPageRef.current = true;
        setLoadState({ status: "ready", result, isLoading: false, reloadError: null });
      } catch (error: unknown) {
        if (isSuperseded || onTerminalAdminError(error, config)) return;
        const message = getErrorMessage(error);
        setLoadState((current) => current.status === "ready"
          ? { ...current, isLoading: false, reloadError: message }
          : { status: "error", message });
      }
    }

    const reloadTimeoutId = window.setTimeout(
      () => { void loadPage(); },
      hasLoadedPageRef.current ? tableReloadDebounceMs : 0,
    );
    return () => {
      isSuperseded = true;
      window.clearTimeout(reloadTimeoutId);
    };
  }, [config, onTerminalAdminError, revision, tableState, userId]);

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

  const columns = useMemo(() => withFullTextCells(fullTexts, { expand, collapse }), [fullTexts, expand, collapse]);

  return (
    <div className="user-tab" data-testid="user-cards">
      <p className="dashboard-section-description">
        Every card in this person's workspaces, newest first, deleted cards included and dimmed. Front and back show their first {cardTextPreviewLength.toLocaleString("en-US")} characters, while filtering and sorting read the whole text; Show full text loads the whole card. Sorting, filters and pages apply to every card.
      </p>
      {loadState.status === "loading" ? <p className="report-state" aria-live="polite">Loading cards…</p> : null}
      {loadState.status === "error" ? <div className="report-state report-state-error">
        <strong>User cards query failed.</strong><span>{loadState.message}</span>
        <button className="filter-button" type="button" onClick={() => setRevision((value) => value + 1)}>Retry</button>
      </div> : null}
      {loadState.status === "ready" && loadState.reloadError !== null ? <div className="report-state report-state-error" role="alert" data-testid="user-cards-reload-error">
        <strong>User cards query failed; the rows below are from the previous query.</strong><span>{loadState.reloadError}</span>
        <button className="filter-button" type="button" onClick={() => setRevision((value) => value + 1)}>Retry</button>
      </div> : null}
      {enumOptionsState.status === "error" ? <div className="report-state report-state-error" role="alert" data-testid="user-cards-enum-options-error">
        <strong>Filter options query failed; the enum column filters list no values until it succeeds.</strong><span>{enumOptionsState.message}</span>
        <button className="filter-button" type="button" onClick={() => setEnumOptionsRevision((value) => value + 1)}>Retry</button>
      </div> : null}
      {loadState.status === "ready" ? <DataTable
        testId="user-cards-table"
        columns={columns}
        rows={loadState.result.rows}
        rowKey={getCardRowKey}
        rowClassName={getCardRowClassName}
        state={tableState}
        onStateChange={setTableState}
        server={{
          totalCount: loadState.result.totalCount,
          enumOptionsByColumnId: enumOptionsState.status === "ready" ? enumOptionsState.options : emptyCardsEnumOptions,
          isLoading: loadState.isLoading,
        }}
      /> : null}
    </div>
  );
}
