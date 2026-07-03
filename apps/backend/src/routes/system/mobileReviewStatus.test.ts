import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import type pg from "pg";
import type { DatabaseExecutor, SqlValue } from "../../database";
import type { RequestContext } from "../../server/requestContext";
import {
  createSystemTestApp,
} from "./systemTestSupport";
import {
  loadReviewPlatformSummaryInExecutor,
} from "./mobileReviewStatus";
import type { ReviewPlatformSummary } from "./types";

type QueryResultRow = pg.QueryResultRow;
type Platform = "ios" | "android" | "web" | "system";
type ActorKind = "client_installation" | "workspace_seed" | "workspace_reset" | "agent_connection" | "ai_chat";

type ReviewEventFixture = Readonly<{
  workspaceId: string;
  replicaId: string;
  reviewedByUserId: string | null;
}>;

type WorkspaceReplicaFixture = Readonly<{
  workspaceId: string;
  replicaId: string;
  actorKind: ActorKind;
  platform: Platform;
}>;

type ReviewPlatformFixture = Readonly<{
  currentUserId: string;
  reviewEvents: ReadonlyArray<ReviewEventFixture>;
  workspaceReplicas: ReadonlyArray<WorkspaceReplicaFixture>;
}>;

type RecordedQuery = Readonly<{
  text: string;
  params: ReadonlyArray<SqlValue>;
}>;

const CURRENT_USER_ID = "user-1";
const OTHER_USER_ID = "user-2";
const WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
const IOS_REPLICA_ID = "00000000-0000-4000-8000-000000000101";
const ANDROID_REPLICA_ID = "00000000-0000-4000-8000-000000000102";
const WEB_REPLICA_ID = "00000000-0000-4000-8000-000000000103";

function createQueryResult<Row extends QueryResultRow>(rows: ReadonlyArray<Row>): pg.QueryResult<Row> {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows: [...rows],
  };
}

function isMobileClientReplica(replica: WorkspaceReplicaFixture | undefined): boolean {
  return replica !== undefined
    && replica.actorKind === "client_installation"
    && (replica.platform === "ios" || replica.platform === "android");
}

function findReplicaForReview(
  reviewEvent: ReviewEventFixture,
  workspaceReplicas: ReadonlyArray<WorkspaceReplicaFixture>,
): WorkspaceReplicaFixture | undefined {
  return workspaceReplicas.find((replica) =>
    replica.workspaceId === reviewEvent.workspaceId
    && replica.replicaId === reviewEvent.replicaId
  );
}

function hasCurrentUserMobileReviewEvent(fixture: ReviewPlatformFixture): boolean {
  return fixture.reviewEvents.some((reviewEvent) =>
    reviewEvent.reviewedByUserId === fixture.currentUserId
    && isMobileClientReplica(findReplicaForReview(reviewEvent, fixture.workspaceReplicas))
  );
}

function createReviewPlatformExecutor(
  fixture: ReviewPlatformFixture,
): Readonly<{
  executor: DatabaseExecutor;
  recordedQueries: ReadonlyArray<RecordedQuery>;
}> {
  const recordedQueries: Array<RecordedQuery> = [];

  const executor: DatabaseExecutor = {
    async query<Row extends QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      recordedQueries.push({ text, params });

      if (text === "SELECT content.current_user_has_mobile_review_event() AS has_mobile_review_event") {
        if (params.length !== 0) {
          throw new Error("Review platform summary query must not accept request parameters.");
        }

        return createQueryResult([{
          has_mobile_review_event: hasCurrentUserMobileReviewEvent(fixture),
        }]) as unknown as pg.QueryResult<Row>;
      }

      throw new Error(`Unexpected review platform summary query: ${text}`);
    },
  };

  return {
    executor,
    recordedQueries,
  };
}

function createClientReplica(replicaId: string, platform: Exclude<Platform, "system">): WorkspaceReplicaFixture {
  return {
    workspaceId: WORKSPACE_ID,
    replicaId,
    actorKind: "client_installation",
    platform,
  };
}

function createReviewEvent(replicaId: string, reviewedByUserId: string | null): ReviewEventFixture {
  return {
    workspaceId: WORKSPACE_ID,
    replicaId,
    reviewedByUserId,
  };
}

async function loadSummaryFromFixture(fixture: ReviewPlatformFixture): Promise<Readonly<{
  summary: ReviewPlatformSummary;
  recordedQueries: ReadonlyArray<RecordedQuery>;
}>> {
  const { executor, recordedQueries } = createReviewPlatformExecutor(fixture);
  const summary = await loadReviewPlatformSummaryInExecutor(executor);

  return {
    summary,
    recordedQueries,
  };
}

test("review platform summary returns false when the user has no reviews", async () => {
  const { summary, recordedQueries } = await loadSummaryFromFixture({
    currentUserId: CURRENT_USER_ID,
    reviewEvents: [],
    workspaceReplicas: [createClientReplica(IOS_REPLICA_ID, "ios")],
  });

  assert.deepEqual(summary, { hasMobileReviewEvent: false });
  assert.equal(recordedQueries.length, 1);
});

test("review platform summary returns false for web-only reviews", async () => {
  const { summary } = await loadSummaryFromFixture({
    currentUserId: CURRENT_USER_ID,
    reviewEvents: [createReviewEvent(WEB_REPLICA_ID, CURRENT_USER_ID)],
    workspaceReplicas: [createClientReplica(WEB_REPLICA_ID, "web")],
  });

  assert.deepEqual(summary, { hasMobileReviewEvent: false });
});

test("review platform summary returns true for iOS reviews", async () => {
  const { summary } = await loadSummaryFromFixture({
    currentUserId: CURRENT_USER_ID,
    reviewEvents: [createReviewEvent(IOS_REPLICA_ID, CURRENT_USER_ID)],
    workspaceReplicas: [createClientReplica(IOS_REPLICA_ID, "ios")],
  });

  assert.deepEqual(summary, { hasMobileReviewEvent: true });
});

test("review platform summary returns true for Android reviews", async () => {
  const { summary } = await loadSummaryFromFixture({
    currentUserId: CURRENT_USER_ID,
    reviewEvents: [createReviewEvent(ANDROID_REPLICA_ID, CURRENT_USER_ID)],
    workspaceReplicas: [createClientReplica(ANDROID_REPLICA_ID, "android")],
  });

  assert.deepEqual(summary, { hasMobileReviewEvent: true });
});

test("review platform summary ignores another user's mobile reviews", async () => {
  const { summary } = await loadSummaryFromFixture({
    currentUserId: CURRENT_USER_ID,
    reviewEvents: [createReviewEvent(IOS_REPLICA_ID, OTHER_USER_ID)],
    workspaceReplicas: [createClientReplica(IOS_REPLICA_ID, "ios")],
  });

  assert.deepEqual(summary, { hasMobileReviewEvent: false });
});

test("GET /me/review-platform-summary returns exactly one boolean for human transports", async () => {
  const transports: ReadonlyArray<RequestContext["transport"]> = ["session", "bearer", "guest"];

  for (const transport of transports) {
    const app = createSystemTestApp({
      transport,
      loadReviewPlatformSummaryFn: async (userId) => {
        assert.equal(userId, CURRENT_USER_ID);
        return { hasMobileReviewEvent: true };
      },
    });

    const response = await app.request("http://localhost/me/review-platform-summary");
    const payload = await response.json() as ReviewPlatformSummary;

    assert.equal(response.status, 200);
    assert.deepEqual(payload, { hasMobileReviewEvent: true });
    assert.deepEqual(Object.keys(payload), ["hasMobileReviewEvent"]);
  }
});

test("GET /me/review-platform-summary rejects ApiKey authentication", async () => {
  let called = false;
  const app = createSystemTestApp({
    transport: "api_key",
    loadReviewPlatformSummaryFn: async () => {
      called = true;
      return { hasMobileReviewEvent: true };
    },
  });

  const response = await app.request("http://localhost/me/review-platform-summary");

  assert.equal(called, false);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: "This endpoint requires Guest, Bearer, or Session authentication",
    requestId: "request-1",
    code: "REVIEW_PLATFORM_SUMMARY_HUMAN_AUTH_REQUIRED",
  });
});

test("migration defines current user mobile review function with explicit schema filters", () => {
  const migrationSql = readFileSync(
    resolve(process.cwd(), "../../db/migrations/0086_current_user_mobile_review_status.sql"),
    "utf8",
  );

  assert.match(migrationSql, /CREATE OR REPLACE FUNCTION content\.current_user_has_mobile_review_event\(\)/);
  assert.match(migrationSql, /RETURNS BOOLEAN/);
  assert.match(migrationSql, /SECURITY DEFINER/);
  assert.match(migrationSql, /SET search_path = pg_catalog/);
  assert.match(migrationSql, /FROM content\.review_events AS review_events/);
  assert.match(
    migrationSql,
    /INNER JOIN sync\.workspace_replicas AS workspace_replicas\s+ON workspace_replicas\.workspace_id = review_events\.workspace_id\s+AND workspace_replicas\.replica_id = review_events\.replica_id/,
  );
  assert.match(migrationSql, /review_events\.reviewed_by_user_id = security\.current_user_id\(\)/);
  assert.match(migrationSql, /workspace_replicas\.actor_kind = 'client_installation'/);
  assert.match(migrationSql, /workspace_replicas\.platform IN \('ios', 'android'\)/);
  assert.match(
    migrationSql,
    /GRANT EXECUTE ON FUNCTION content\.current_user_has_mobile_review_event\(\) TO backend_app/,
  );

  const functionBody = migrationSql.slice(
    migrationSql.indexOf("AS $$"),
    migrationSql.indexOf("$$;", migrationSql.indexOf("AS $$")),
  );
  assert.equal(functionBody.includes("security.current_workspace_id()"), false);
});
