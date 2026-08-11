import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  loadLeaderboardProfile,
  loadLeaderboardProfileInExecutor,
  loadProgressLeaderboard,
  loadProgressLeaderboardInExecutor,
} from "./index";

function loadApiGatewaySource(): string {
  const apiGatewayPath = path.resolve(process.cwd(), "../../infra/aws/lib/gateways/api-gateway.ts");
  return fs.readFileSync(apiGatewayPath, "utf8");
}

function loadProgressReportsIndexSource(): string {
  const progressReportsIndexPath = path.resolve(process.cwd(), "src/progress/reports/index.ts");
  return fs.readFileSync(progressReportsIndexPath, "utf8").replace(/\s+/g, " ");
}

function assertApiGatewayUsesBackendProxy(apiGatewaySource: string): void {
  assert.match(
    apiGatewaySource,
    /restApi\.root\.addResource\("\{proxy\+}"\)\.addMethod\("ANY", integration\);/,
  );
}

test("API Gateway proxies backend-owned progress routes", () => {
  const apiGatewaySource = loadApiGatewaySource();
  assertApiGatewayUsesBackendProxy(apiGatewaySource);
});

test("progress barrel re-exports the community leaderboard loaders", async () => {
  assert.equal(typeof loadProgressLeaderboardInExecutor, "function");
  assert.equal(typeof loadLeaderboardProfileInExecutor, "function");

  // The re-export resolves to the real loader: a guest returns the linked-account
  // state without opening a transaction, so this runs offline.
  const guestLeaderboard = await loadProgressLeaderboard({
    userId: "user-guest",
    transport: "guest",
    localeHint: "en",
  });

  assert.equal(guestLeaderboard.status, "linked_account_required");
  assert.deepEqual(guestLeaderboard.windows, []);

  const guestProfile = await loadLeaderboardProfile({
    userId: "user-guest",
    transport: "guest",
    localeHint: "en",
    publicProfileId: "00000000-0000-4000-8000-000000000001",
  });

  assert.deepEqual(guestProfile, { status: "linked_account_required" });
});

test("public progress streak loaders retry transient repeatable-read failures", () => {
  const source = loadProgressReportsIndexSource();

  assert.match(source, /import \{ withTransientDatabaseRetry \} from "\.\.\/\.\.\/database\/transient";/);
  assert.match(source, /import \{ createBackendRuntimeObservationScope \} from "\.\.\/\.\.\/observability\/sentry";/);
  assert.match(
    source,
    /export async function loadUserProgressSummary\(request: ProgressSummaryRequest\): Promise<ProgressSummaryResponse> \{ return withTransientDatabaseRetry\( \(\) => unsafeRepeatableReadTransaction\( async \(executor\) => loadUserProgressSummaryInExecutor\(executor, request\), \), createBackendRuntimeObservationScope, \); \}/,
  );
  assert.match(
    source,
    /export async function loadUserProgressSeries\(request: ProgressSeriesRequest\): Promise<ProgressSeries> \{ return withTransientDatabaseRetry\( \(\) => unsafeRepeatableReadTransaction\( async \(executor\) => loadUserProgressSeriesInExecutor\(executor, request\), \), createBackendRuntimeObservationScope, \); \}/,
  );
  assert.doesNotMatch(
    source,
    /export async function loadUserProgressReviewSchedule\( request: ProgressReviewScheduleRequest, \): Promise<ProgressReviewSchedule> \{ return withTransientDatabaseRetry/,
  );
});
