import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import type pg from "pg";
import type { DatabaseExecutor, SqlValue } from "../database";
import {
  QUALIFIED_REVIEWS_METRIC_VERSION,
  classifyQualifiedReviewActivity,
  createCurrentUserPublicProfileResolver,
  recordQualifiedReviewActivityFactInExecutor,
} from "./reviewActivityFacts";

type QueryResultRow = pg.QueryResultRow;

type StoredFact = Readonly<{
  reviewEventId: string;
  metricVersion: string;
  publicProfileId: string;
  reviewedByUserId: string | null;
  rating: number;
  reviewedAtClient: string;
  reviewedAtServer: string;
  isCountable: boolean;
  exclusionReason: string | null;
}>;

type MutableFactStoreState = {
  currentUserId: string;
  currentUserIdQueryCount: number;
  profilesByUserId: Map<string, string>;
  insertedProfileIds: Array<string>;
  facts: Array<StoredFact>;
};

function createQueryResult<Row extends QueryResultRow>(rows: ReadonlyArray<Row>): pg.QueryResult<Row> {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows: [...rows],
  };
}

function createFactStoreState(currentUserId: string): MutableFactStoreState {
  return {
    currentUserId,
    currentUserIdQueryCount: 0,
    profilesByUserId: new Map<string, string>(),
    insertedProfileIds: [],
    facts: [],
  };
}

function readStringParam(params: ReadonlyArray<SqlValue>, index: number, label: string): string {
  const value = params[index];
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }

  return value;
}

function readNumberParam(params: ReadonlyArray<SqlValue>, index: number, label: string): number {
  const value = params[index];
  if (typeof value !== "number") {
    throw new Error(`${label} must be a number.`);
  }

  return value;
}

function readBooleanParam(params: ReadonlyArray<SqlValue>, index: number, label: string): boolean {
  const value = params[index];
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean.`);
  }

  return value;
}

function readNullableStringParam(params: ReadonlyArray<SqlValue>, index: number, label: string): string | null {
  const value = params[index];
  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error(`${label} must be a string or null.`);
  }

  return value;
}

function createFactExecutor(state: MutableFactStoreState): DatabaseExecutor {
  return {
    async query<Row extends QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      if (text === "SELECT security.current_user_id() AS user_id") {
        state.currentUserIdQueryCount += 1;
        return createQueryResult([{ user_id: state.currentUserId }]) as unknown as pg.QueryResult<Row>;
      }

      if (
        text.startsWith("SELECT public_profile_id, leaderboard_participation_enabled")
        && text.includes("FROM community.public_profiles")
        && text.includes("WHERE user_id = $1")
      ) {
        const userId = readStringParam(params, 0, "userId");
        const publicProfileId = state.profilesByUserId.get(userId);
        const rows = publicProfileId === undefined
          ? []
          : [{ public_profile_id: publicProfileId, leaderboard_participation_enabled: true }];
        return createQueryResult(rows) as unknown as pg.QueryResult<Row>;
      }

      if (text.startsWith("WITH inserted_profile AS")) {
        const userId = readStringParam(params, 0, "userId");
        const publicProfileId = readStringParam(params, 1, "publicProfileId");
        const existing = state.profilesByUserId.get(userId);
        if (existing !== undefined) {
          return createQueryResult([
            { public_profile_id: existing, leaderboard_participation_enabled: true },
          ]) as unknown as pg.QueryResult<Row>;
        }

        state.profilesByUserId.set(userId, publicProfileId);
        state.insertedProfileIds.push(publicProfileId);
        return createQueryResult([
          { public_profile_id: publicProfileId, leaderboard_participation_enabled: true },
        ]) as unknown as pg.QueryResult<Row>;
      }

      if (
        text.startsWith("INSERT INTO community.public_review_activity_facts")
        && text.includes("ON CONFLICT (review_event_id, metric_version) DO NOTHING")
      ) {
        const reviewEventId = readStringParam(params, 0, "reviewEventId");
        const metricVersion = readStringParam(params, 1, "metricVersion");
        const alreadyStored = state.facts.some(
          (fact) => fact.reviewEventId === reviewEventId && fact.metricVersion === metricVersion,
        );
        if (alreadyStored) {
          return createQueryResult([]) as unknown as pg.QueryResult<Row>;
        }

        state.facts.push({
          reviewEventId,
          metricVersion,
          publicProfileId: readStringParam(params, 2, "publicProfileId"),
          reviewedByUserId: readNullableStringParam(params, 3, "reviewedByUserId"),
          rating: readNumberParam(params, 4, "rating"),
          reviewedAtClient: readStringParam(params, 5, "reviewedAtClient"),
          reviewedAtServer: readStringParam(params, 6, "reviewedAtServer"),
          isCountable: readBooleanParam(params, 7, "isCountable"),
          exclusionReason: readNullableStringParam(params, 8, "exclusionReason"),
        });
        return createQueryResult([]) as unknown as pg.QueryResult<Row>;
      }

      throw new Error(`Unexpected review activity fact query: ${text}`);
    },
  };
}

const PROFILE_USER_1 = { userId: "user-1", publicProfileId: "profile-1" } as const;

test("classifyQualifiedReviewActivity excludes rating 0 as again", () => {
  assert.deepEqual(classifyQualifiedReviewActivity(0), {
    metricVersion: QUALIFIED_REVIEWS_METRIC_VERSION,
    isCountable: false,
    exclusionReason: "again",
  });
});

test("classifyQualifiedReviewActivity counts ratings 1, 2, and 3", () => {
  for (const rating of [1, 2, 3]) {
    assert.deepEqual(classifyQualifiedReviewActivity(rating), {
      metricVersion: QUALIFIED_REVIEWS_METRIC_VERSION,
      isCountable: true,
      exclusionReason: null,
    });
  }
});

test("recordQualifiedReviewActivityFactInExecutor creates a countable fact for a good rating", async () => {
  const state = createFactStoreState("user-1");
  const executor = createFactExecutor(state);

  await recordQualifiedReviewActivityFactInExecutor(executor, PROFILE_USER_1, {
    reviewEventId: "review-1",
    rating: 2,
    reviewedAtClient: "2026-06-10T10:00:00.000Z",
    reviewedAtServer: "2026-06-10T10:00:01.000Z",
  });

  assert.deepEqual(state.facts, [{
    reviewEventId: "review-1",
    metricVersion: "qualified_reviews_v1",
    publicProfileId: "profile-1",
    reviewedByUserId: "user-1",
    rating: 2,
    reviewedAtClient: "2026-06-10T10:00:00.000Z",
    reviewedAtServer: "2026-06-10T10:00:01.000Z",
    isCountable: true,
    exclusionReason: null,
  }]);
});

test("recordQualifiedReviewActivityFactInExecutor records an again rating as not countable", async () => {
  const state = createFactStoreState("user-1");
  const executor = createFactExecutor(state);

  await recordQualifiedReviewActivityFactInExecutor(executor, PROFILE_USER_1, {
    reviewEventId: "review-again",
    rating: 0,
    reviewedAtClient: "2026-06-10T10:00:00.000Z",
    reviewedAtServer: "2026-06-10T10:00:01.000Z",
  });

  const fact = state.facts[0];
  assert.equal(fact?.isCountable, false);
  assert.equal(fact?.exclusionReason, "again");
  assert.equal(fact?.reviewedByUserId, "user-1");
});

test("recordQualifiedReviewActivityFactInExecutor stays idempotent for a replayed review event", async () => {
  const state = createFactStoreState("user-1");
  const executor = createFactExecutor(state);

  const input = {
    reviewEventId: "review-replay",
    rating: 1,
    reviewedAtClient: "2026-06-10T10:00:00.000Z",
    reviewedAtServer: "2026-06-10T10:00:01.000Z",
  } as const;
  await recordQualifiedReviewActivityFactInExecutor(executor, PROFILE_USER_1, input);
  await recordQualifiedReviewActivityFactInExecutor(executor, PROFILE_USER_1, input);

  assert.equal(state.facts.length, 1);
});

test("createCurrentUserPublicProfileResolver ensures the scoped profile once and memoizes", async () => {
  const state = createFactStoreState("user-without-profile");
  const executor = createFactExecutor(state);
  const resolveReviewedBy = createCurrentUserPublicProfileResolver(executor);

  const first = await resolveReviewedBy();
  const second = await resolveReviewedBy();

  assert.equal(first.userId, "user-without-profile");
  assert.equal(state.insertedProfileIds.length, 1);
  assert.equal(first.publicProfileId, state.insertedProfileIds[0]);
  assert.deepEqual(second, first);
  // The second call is served from the memo, so the scope/profile is resolved once.
  assert.equal(state.currentUserIdQueryCount, 1);
});

test("0058 migration adds immutable authorship and the public review activity fact layer", () => {
  const migrationPath = resolve(
    process.cwd(),
    "../../db/migrations/0058_public_review_activity_facts.sql",
  );
  const migrationSql = readFileSync(migrationPath, "utf8");

  assert.match(
    migrationSql,
    /ALTER TABLE content\.review_events\s+ADD COLUMN IF NOT EXISTS reviewed_by_user_id TEXT\s+REFERENCES org\.user_settings\(user_id\) ON DELETE SET NULL/,
  );
  assert.match(migrationSql, /FROM sync\.workspace_replicas AS workspace_replicas/);
  assert.match(migrationSql, /SET reviewed_by_user_id = workspace_replicas\.user_id/);

  assert.match(migrationSql, /CREATE TABLE IF NOT EXISTS community\.public_review_activity_facts/);
  assert.match(migrationSql, /review_event_id\s+UUID\s+NOT NULL REFERENCES content\.review_events\(review_event_id\) ON DELETE CASCADE/);
  assert.match(migrationSql, /public_profile_id\s+UUID\s+NOT NULL REFERENCES community\.public_profiles\(public_profile_id\) ON DELETE CASCADE/);
  assert.match(migrationSql, /reviewed_by_user_id TEXT\s+REFERENCES org\.user_settings\(user_id\) ON DELETE SET NULL/);
  assert.match(migrationSql, /PRIMARY KEY \(review_event_id, metric_version\)/);

  assert.match(migrationSql, /idx_public_review_activity_facts_metric_countable_client_time\s+ON community\.public_review_activity_facts\(metric_version, is_countable, reviewed_at_client\)/);
  assert.match(migrationSql, /idx_public_review_activity_facts_profile_metric_countable_client_time\s+ON community\.public_review_activity_facts\(public_profile_id, metric_version, is_countable, reviewed_at_client\)/);
  assert.match(migrationSql, /idx_public_review_activity_facts_user_metric_client_time\s+ON community\.public_review_activity_facts\(reviewed_by_user_id, metric_version, reviewed_at_client\)/);

  assert.match(migrationSql, /'qualified_reviews_v1'/);
  assert.match(migrationSql, /\(review_events\.rating <> 0\)/);
  assert.match(migrationSql, /CASE WHEN review_events\.rating = 0 THEN 'again' ELSE NULL END/);

  assert.match(migrationSql, /ALTER TABLE community\.public_review_activity_facts ENABLE ROW LEVEL SECURITY/);
  assert.match(migrationSql, /CREATE POLICY public_review_activity_facts_self_insert_runtime/);
  assert.match(migrationSql, /WITH CHECK \(reviewed_by_user_id = security\.current_user_id\(\)\)/);
  assert.match(migrationSql, /GRANT INSERT \(/);

  // Display names are never stored in the fact layer; they stay derived at read time.
  assert.equal(migrationSql.includes("display_name"), false);
  // Facts are immutable, so there is no inert updated_at column.
  assert.equal(migrationSql.includes("updated_at"), false);
});
