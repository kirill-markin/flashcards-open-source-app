import assert from "node:assert/strict";
import test from "node:test";
import type { Card } from "../../cards";
import type { Deck } from "../../decks";
import { toCardRow, toDeckRow } from "../agentSql/shared";
import { getSqlResourceDescriptor } from "./schema";
import type { SqlResourceName, SqlRow } from "./types";

/**
 * Keeps `DESCRIBE` honest about what `SELECT *` returns.
 *
 * A `SELECT *` row from a source without `UNNEST` is whatever `toCardRow` or
 * `toDeckRow` built, verbatim: `loadSelectRows` in
 * `apps/backend/src/aiTools/agentSql/readExecution.ts` maps every page through
 * them and the select executor projects `*` from the object it is handed, while
 * an `UNNEST` source adds its alias key on top - a key `DESCRIBE` never
 * publishes. `DESCRIBE` and `SHOW COLUMNS` render
 * `getSqlResourceDescriptor(resource).columns` from this directory instead. The
 * two files have nothing tying them together, so a column added, renamed, or
 * dropped on one side alone makes `DESCRIBE` misdescribe the rows an agent
 * actually receives - which is worse than no schema at all, because every agent
 * surface reads `DESCRIBE` as the authority. Removing `deleted_at` had to touch
 * both by hand and only happened to get it right.
 *
 * `workspace` and `review_events` are deliberately out: `toReviewEventRow` has
 * the same shape but its columns are immutable, and the workspace row is built
 * inline, so neither carries the drift risk this guards.
 */

/**
 * Every `Card` field populated, including the four the row builder is expected
 * to drop (`clientUpdatedAt`, `lastModifiedByReplicaId`, `lastOperationId`,
 * `deletedAt`). Populating them is the point: it proves the builder drops them
 * on purpose rather than the fixture simply never offering them.
 */
const REPRESENTATIVE_CARD: Card = {
  cardId: "11111111-1111-4111-8111-111111111111",
  frontText: "ubiquitous",
  backText: "Present everywhere at once.",
  cardType: "basic",
  metadata: {
    version: 1,
    source: {
      label: "Describe contract guard",
      author: "guard",
      comment: "Representative row for the DESCRIBE contract guard",
      createdAt: "2026-02-28T09:00:00.000Z",
      importedAt: "2026-02-28T09:00:00.000Z",
      importId: "22222222-2222-4222-8222-222222222222",
    },
  },
  tags: ["english", "vocabulary"],
  dueAt: "2026-03-01T09:00:00.000Z",
  createdAt: "2026-02-28T09:00:00.000Z",
  reps: 4,
  lapses: 1,
  fsrsCardState: "review",
  fsrsStepIndex: 0,
  fsrsStability: 12.5,
  fsrsDifficulty: 5.25,
  fsrsLastReviewedAt: "2026-02-28T10:00:00.000Z",
  fsrsScheduledDays: 3,
  clientUpdatedAt: "2026-02-28T10:00:00.000Z",
  lastModifiedByReplicaId: "33333333-3333-4333-8333-333333333333",
  lastOperationId: "44444444-4444-4444-8444-444444444444",
  updatedAt: "2026-02-28T10:00:00.000Z",
  deletedAt: null,
};

/** The `Deck` counterpart, populated on the same principle. */
const REPRESENTATIVE_DECK: Deck = {
  deckId: "55555555-5555-4555-8555-555555555555",
  workspaceId: "66666666-6666-4666-8666-666666666666",
  name: "English vocabulary",
  filterDefinition: {
    version: 2,
    tags: ["english", "vocabulary"],
  },
  createdAt: "2026-02-28T09:00:00.000Z",
  clientUpdatedAt: "2026-02-28T10:00:00.000Z",
  lastModifiedByReplicaId: "77777777-7777-4777-8777-777777777777",
  lastOperationId: "88888888-8888-4888-8888-888888888888",
  updatedAt: "2026-02-28T10:00:00.000Z",
  deletedAt: null,
};

function formatColumnNames(columnNames: ReadonlyArray<string>): string {
  return columnNames.length === 0 ? "none" : columnNames.join(", ");
}

/**
 * Asserts in both directions, so a column added to either side alone fails: a
 * one-directional check would pass a row that quietly gained a field nothing
 * describes.
 *
 * Both sides are reported in a single assertion rather than two, because when
 * a column is renamed it drifts in both directions at once and one failure
 * naming both halves reads as the rename it is.
 */
function assertRowMatchesDescribedColumns(
  resourceName: SqlResourceName,
  rowBuilderName: string,
  row: SqlRow,
): void {
  const rowColumnNames = Object.keys(row);
  const describedColumnNames = getSqlResourceDescriptor(resourceName)
    .columns
    .map((column) => column.columnName);

  const describedColumnNameSet = new Set(describedColumnNames);
  const rowColumnNameSet = new Set(rowColumnNames);

  const undescribed = rowColumnNames.filter((columnName) => !describedColumnNameSet.has(columnName));
  const unreturned = describedColumnNames.filter((columnName) => !rowColumnNameSet.has(columnName));

  assert.ok(
    undescribed.length === 0 && unreturned.length === 0,
    `SELECT * on ${resourceName} and DESCRIBE ${resourceName} disagree. `
      + `Returned by ${rowBuilderName} but not described by getSqlResourceDescriptor("${resourceName}"): ${formatColumnNames(undescribed)}. `
      + `Described by getSqlResourceDescriptor("${resourceName}") but not returned by ${rowBuilderName}: ${formatColumnNames(unreturned)}.`,
  );
}

test("DESCRIBE cards describes exactly the columns SELECT * returns", () => {
  assertRowMatchesDescribedColumns("cards", "toCardRow", toCardRow(REPRESENTATIVE_CARD));
});

test("DESCRIBE decks describes exactly the columns SELECT * returns", () => {
  assertRowMatchesDescribedColumns("decks", "toDeckRow", toDeckRow(REPRESENTATIVE_DECK));
});
