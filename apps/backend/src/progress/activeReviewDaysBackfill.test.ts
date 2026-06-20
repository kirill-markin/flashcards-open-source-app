import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import type { DatabaseExecutor, SqlValue } from "../database";
import { createBackendObservationScope } from "../observability/sentry";
import {
  backfillActiveReviewDaysWithDependencies,
  loadActiveReviewDaysBackfillCandidatePageInExecutor,
  loadActiveReviewDaysBackfillCursorInExecutor,
  saveActiveReviewDaysBackfillCursorInExecutor,
  type ActiveReviewDaysBackfillCandidatePage,
  type ActiveReviewDaysBackfillCursor,
} from "./activeReviewDaysBackfill";

type RecordedQuery = Readonly<{
  text: string;
  params: ReadonlyArray<SqlValue>;
}>;

type CandidatePageRow = pg.QueryResultRow & Readonly<{
  user_id: string;
  workspace_id: string;
  progress_time_zone: string;
  missing_review_local_date_count: string | number;
  missing_active_review_day_count: string | number;
}>;

type CandidateKeyRow = pg.QueryResultRow & Readonly<{
  user_id: string;
  workspace_id: string;
  progress_time_zone: string;
}>;

type CursorRow = pg.QueryResultRow & Readonly<{
  cursor_user_id: string | null;
  cursor_workspace_id: string | null;
}>;

function createQueryResult<Row extends pg.QueryResultRow>(rows: ReadonlyArray<Row>): pg.QueryResult<Row> {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    rows: [...rows],
    fields: [],
  };
}

function createRowsExecutor(
  rows: ReadonlyArray<pg.QueryResultRow>,
): Readonly<{
  executor: DatabaseExecutor;
  recordedQueries: ReadonlyArray<RecordedQuery>;
}> {
  const recordedQueries: Array<RecordedQuery> = [];
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      recordedQueries.push({ text, params });
      return createQueryResult(rows) as unknown as pg.QueryResult<Row>;
    },
  };

  return {
    executor,
    recordedQueries,
  };
}

function createCandidatePageExecutor(
  candidateKeyRows: ReadonlyArray<CandidateKeyRow>,
  candidateRows: ReadonlyArray<CandidatePageRow>,
): Readonly<{
  executor: DatabaseExecutor;
  recordedQueries: ReadonlyArray<RecordedQuery>;
}> {
  const recordedQueries: Array<RecordedQuery> = [];
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      recordedQueries.push({ text, params });
      if (text.includes("WITH candidate_keys")) {
        return createQueryResult(candidateRows) as unknown as pg.QueryResult<Row>;
      }

      return createQueryResult(candidateKeyRows) as unknown as pg.QueryResult<Row>;
    },
  };

  return {
    executor,
    recordedQueries,
  };
}

function createCandidatePage(
  candidateKeyCount: number,
  nextCursor: ActiveReviewDaysBackfillCursor,
  scannedUserIds: ReadonlyArray<string>,
): ActiveReviewDaysBackfillCandidatePage {
  return {
    candidates: [],
    nextCursor,
    candidateKeyCount,
    scannedUserIds,
  };
}

function createTestObservationScope() {
  return createBackendObservationScope(
    "progress-active-days-backfill",
    "request-1",
    null,
    null,
    null,
    null,
    null,
    null,
    null,
  );
}

test("loadActiveReviewDaysBackfillCursorInExecutor returns the stored cursor", async () => {
  const { executor, recordedQueries } = createRowsExecutor([
    {
      cursor_user_id: "user-2",
      cursor_workspace_id: "00000000-0000-4000-8000-000000000003",
    } satisfies CursorRow,
  ]);

  const cursor = await loadActiveReviewDaysBackfillCursorInExecutor(executor);

  assert.deepEqual(cursor, {
    userId: "user-2",
    workspaceId: "00000000-0000-4000-8000-000000000003",
  });
  assert.equal(recordedQueries.length, 1);
  assert.match(recordedQueries[0]?.text ?? "", /FROM progress\.active_review_days_backfill_state/);
  assert.deepEqual(recordedQueries[0]?.params, ["progress_active_days_backfill"]);
});

test("loadActiveReviewDaysBackfillCursorInExecutor returns null for missing or reset state", async () => {
  const missingState = createRowsExecutor([]);
  const missingCursor = await loadActiveReviewDaysBackfillCursorInExecutor(missingState.executor);
  assert.equal(missingCursor, null);

  const resetState = createRowsExecutor([
    {
      cursor_user_id: null,
      cursor_workspace_id: null,
    } satisfies CursorRow,
  ]);
  const resetCursor = await loadActiveReviewDaysBackfillCursorInExecutor(resetState.executor);
  assert.equal(resetCursor, null);
});

test("saveActiveReviewDaysBackfillCursorInExecutor upserts and resets durable cursor state", async () => {
  const { executor, recordedQueries } = createRowsExecutor([]);

  await saveActiveReviewDaysBackfillCursorInExecutor(executor, {
    userId: "user-4",
    workspaceId: "00000000-0000-4000-8000-000000000004",
  });
  await saveActiveReviewDaysBackfillCursorInExecutor(executor, null);

  assert.equal(recordedQueries.length, 2);
  assert.match(recordedQueries[0]?.text ?? "", /INSERT INTO progress\.active_review_days_backfill_state AS state/);
  assert.match(recordedQueries[0]?.text ?? "", /ON CONFLICT \(job_name\)/);
  assert.deepEqual(recordedQueries[0]?.params, [
    "progress_active_days_backfill",
    "user-4",
    "00000000-0000-4000-8000-000000000004",
  ]);
  assert.deepEqual(recordedQueries[1]?.params, [
    "progress_active_days_backfill",
    null,
    null,
  ]);
});

test("loadActiveReviewDaysBackfillCandidatePageInExecutor selects known-timezone users with active-day gaps", async () => {
  const { executor, recordedQueries } = createCandidatePageExecutor(
    [
      {
        user_id: "user-1",
        workspace_id: "00000000-0000-4000-8000-000000000001",
        progress_time_zone: "Europe/Madrid",
      },
      {
        user_id: "user-2",
        workspace_id: "00000000-0000-4000-8000-000000000003",
        progress_time_zone: "America/Los_Angeles",
      },
    ],
    [
      {
        user_id: "user-1",
        workspace_id: "00000000-0000-4000-8000-000000000001",
        progress_time_zone: "Europe/Madrid",
        missing_review_local_date_count: "2",
        missing_active_review_day_count: 1,
      },
      {
        user_id: "user-2",
        workspace_id: "00000000-0000-4000-8000-000000000003",
        progress_time_zone: "America/Los_Angeles",
        missing_review_local_date_count: 0,
        missing_active_review_day_count: "3",
      },
    ],
  );

  const page = await loadActiveReviewDaysBackfillCandidatePageInExecutor(executor, {
    cursor: null,
    batchSize: 25,
  });

  assert.deepEqual(page, {
    candidates: [
      {
        userId: "user-1",
        workspaceId: "00000000-0000-4000-8000-000000000001",
        progressTimeZone: "Europe/Madrid",
        missingReviewLocalDateCount: 2,
        missingActiveReviewDayCount: 1,
      },
      {
        userId: "user-2",
        workspaceId: "00000000-0000-4000-8000-000000000003",
        progressTimeZone: "America/Los_Angeles",
        missingReviewLocalDateCount: 0,
        missingActiveReviewDayCount: 3,
      },
    ],
    nextCursor: {
      userId: "user-2",
      workspaceId: "00000000-0000-4000-8000-000000000003",
    },
    candidateKeyCount: 2,
    scannedUserIds: ["user-1", "user-2"],
  });

  assert.equal(recordedQueries.length, 2);
  const keyPageQuery = recordedQueries[0];
  const gapQuery = recordedQueries[1];
  if (keyPageQuery === undefined || gapQuery === undefined) {
    assert.fail("Expected candidate key and gap queries to be recorded");
  }
  assert.match(keyPageQuery.text, /user_settings\.progress_time_zone IS NOT NULL/);
  assert.doesNotMatch(keyPageQuery.text, /LEFT JOIN progress\.user_active_review_days AS active_days/);
  assert.match(keyPageQuery.text, /\$1::text IS NULL/);
  assert.match(
    keyPageQuery.text,
    /\(review_events\.reviewed_by_user_id, review_events\.workspace_id\) > \(\$1::text, \$2::uuid\)/,
  );
  assert.match(
    keyPageQuery.text,
    /GROUP BY review_events\.reviewed_by_user_id, review_events\.workspace_id, user_settings\.progress_time_zone/,
  );
  assert.match(keyPageQuery.text, /ORDER BY review_events\.reviewed_by_user_id ASC, review_events\.workspace_id ASC/);
  assert.match(keyPageQuery.text, /LIMIT \$3/);
  assert.deepEqual(keyPageQuery.params, [null, null, 25]);

  assert.match(gapQuery.text, /WITH candidate_keys\(user_id, workspace_id, progress_time_zone\) AS \(VALUES/);
  assert.match(gapQuery.text, /INNER JOIN content\.review_events AS review_events/);
  assert.match(gapQuery.text, /review_events\.reviewed_by_user_id = candidate_keys\.user_id/);
  assert.match(gapQuery.text, /review_events\.workspace_id = candidate_keys\.workspace_id/);
  assert.match(gapQuery.text, /LEFT JOIN progress\.user_active_review_days AS active_days/);
  assert.match(gapQuery.text, /reviewed_local_date IS NULL OR active_day_local_date IS NULL/);
  assert.doesNotMatch(gapQuery.text, /LIMIT \$3/);
  assert.deepEqual(gapQuery.params, [
    "user-1",
    "00000000-0000-4000-8000-000000000001",
    "Europe/Madrid",
    "user-2",
    "00000000-0000-4000-8000-000000000003",
    "America/Los_Angeles",
  ]);
});

test("loadActiveReviewDaysBackfillCandidatePageInExecutor applies the keyset cursor", async () => {
  const { executor, recordedQueries } = createCandidatePageExecutor([], []);

  const page = await loadActiveReviewDaysBackfillCandidatePageInExecutor(executor, {
    cursor: {
      userId: "user-2",
      workspaceId: "00000000-0000-4000-8000-000000000003",
    },
    batchSize: 10,
  });

  assert.deepEqual(page, {
    candidates: [],
    nextCursor: null,
    candidateKeyCount: 0,
    scannedUserIds: [],
  });
  assert.equal(recordedQueries.length, 1);
  assert.deepEqual(recordedQueries[0]?.params, ["user-2", "00000000-0000-4000-8000-000000000003", 10]);
});

test("loadActiveReviewDaysBackfillCandidatePageInExecutor advances past key pages with no gaps", async () => {
  const { executor, recordedQueries } = createCandidatePageExecutor(
    [
      {
        user_id: "user-3",
        workspace_id: "00000000-0000-4000-8000-000000000004",
        progress_time_zone: "Europe/London",
      },
    ],
    [],
  );

  const page = await loadActiveReviewDaysBackfillCandidatePageInExecutor(executor, {
    cursor: null,
    batchSize: 25,
  });

  assert.deepEqual(page, {
    candidates: [],
    nextCursor: {
      userId: "user-3",
      workspaceId: "00000000-0000-4000-8000-000000000004",
    },
    candidateKeyCount: 1,
    scannedUserIds: ["user-3"],
  });
  assert.equal(recordedQueries.length, 2);
});

test("backfillActiveReviewDaysWithDependencies resumes from stored cursor and advances after a full page", async () => {
  const observationScope = createTestObservationScope();
  const savedCursors: Array<ActiveReviewDaysBackfillCursor> = [];
  const loadedPageCursors: Array<ActiveReviewDaysBackfillCursor> = [];
  const page = createCandidatePage(
    1,
    {
      userId: "user-3",
      workspaceId: "00000000-0000-4000-8000-000000000003",
    },
    ["user-3"],
  );

  const result = await backfillActiveReviewDaysWithDependencies(
    {
      batchSize: 1,
      maxPages: 1,
    },
    observationScope,
    {
      async loadCursor(): Promise<ActiveReviewDaysBackfillCursor> {
        return {
          userId: "user-2",
          workspaceId: "00000000-0000-4000-8000-000000000002",
        };
      },
      async saveCursor(cursor: ActiveReviewDaysBackfillCursor): Promise<void> {
        savedCursors.push(cursor);
      },
      async loadCandidatePage(cursor: ActiveReviewDaysBackfillCursor): Promise<ActiveReviewDaysBackfillCandidatePage> {
        loadedPageCursors.push(cursor);
        return page;
      },
      async materializeCandidate(): Promise<Readonly<{ reviewEventsMaterialized: number; activeReviewDaysUpserted: number }>> {
        return {
          reviewEventsMaterialized: 0,
          activeReviewDaysUpserted: 0,
        };
      },
    },
  );

  assert.equal(result.finished, false);
  assert.equal(result.pagesScanned, 1);
  assert.deepEqual(loadedPageCursors, [
    {
      userId: "user-2",
      workspaceId: "00000000-0000-4000-8000-000000000002",
    },
  ]);
  assert.deepEqual(savedCursors, [
    {
      userId: "user-3",
      workspaceId: "00000000-0000-4000-8000-000000000003",
    },
  ]);
});

test("backfillActiveReviewDaysWithDependencies resets stored cursor when a pass reaches the end", async () => {
  const observationScope = createTestObservationScope();
  const savedCursors: Array<ActiveReviewDaysBackfillCursor> = [];

  const result = await backfillActiveReviewDaysWithDependencies(
    {
      batchSize: 25,
      maxPages: 5,
    },
    observationScope,
    {
      async loadCursor(): Promise<ActiveReviewDaysBackfillCursor> {
        return {
          userId: "user-9",
          workspaceId: "00000000-0000-4000-8000-000000000009",
        };
      },
      async saveCursor(cursor: ActiveReviewDaysBackfillCursor): Promise<void> {
        savedCursors.push(cursor);
      },
      async loadCandidatePage(): Promise<ActiveReviewDaysBackfillCandidatePage> {
        return createCandidatePage(0, null, []);
      },
      async materializeCandidate(): Promise<Readonly<{ reviewEventsMaterialized: number; activeReviewDaysUpserted: number }>> {
        assert.fail("No candidates should be materialized after an empty key page");
      },
    },
  );

  assert.equal(result.finished, true);
  assert.equal(result.pagesScanned, 1);
  assert.deepEqual(savedCursors, [null]);
});
