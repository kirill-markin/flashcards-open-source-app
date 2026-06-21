import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { loadOpenApiDocument } from "../shared/openapi";
import {
  loadProgressLeaderboard,
  loadProgressLeaderboardInExecutor,
} from "./index";

function loadApiGatewaySource(): string {
  const apiGatewayPath = path.resolve(process.cwd(), "../../infra/aws/lib/gateways/api-gateway.ts");
  return fs.readFileSync(apiGatewayPath, "utf8");
}

function loadProgressIndexSource(): string {
  const progressIndexPath = path.resolve(process.cwd(), "src/progress/index.ts");
  return fs.readFileSync(progressIndexPath, "utf8").replace(/\s+/g, " ");
}

test("published contract excludes progress endpoints while the API Gateway resource tree still predeclares the paths", () => {
  const openApiDocument = loadOpenApiDocument() as Readonly<{
    info?: Readonly<{ title?: string; description?: string }>;
    paths?: Readonly<Record<string, object>>;
  }>;
  assert.equal(openApiDocument.info?.title, "Flashcards Open Source App External AI-Agent API");
  assert.match(openApiDocument.info?.description ?? "", /external ai agents/i);
  assert.equal(openApiDocument.paths?.["/me/progress"], undefined);
  assert.equal(openApiDocument.paths?.["/me/progress/summary"], undefined);
  assert.equal(openApiDocument.paths?.["/me/progress/review-schedule"], undefined);
  assert.equal(openApiDocument.paths?.["/me/progress/series"], undefined);
  assert.equal(openApiDocument.paths?.["/me/progress/leaderboard"], undefined);
  assert.equal(openApiDocument.paths?.["/me/progress/leaderboards/streak"], undefined);

  const apiGatewaySource = loadApiGatewaySource();
  assert.match(apiGatewaySource, /const meProgress = me\.addResource\("progress"\);/);
  assert.doesNotMatch(apiGatewaySource, /meProgress\.addMethod\("GET", integration\);/);
  assert.match(apiGatewaySource, /meProgress\.addResource\("summary"\)\.addMethod\("GET", integration\);/);
  assert.match(apiGatewaySource, /meProgress\.addResource\("review-schedule"\)\.addMethod\("GET", integration\);/);
  assert.match(apiGatewaySource, /meProgress\.addResource\("series"\)\.addMethod\("GET", integration\);/);
});

test("progress barrel re-exports the community leaderboard loaders", async () => {
  assert.equal(typeof loadProgressLeaderboardInExecutor, "function");

  // The re-export resolves to the real loader: a guest returns the linked-account
  // state without opening a transaction, so this runs offline.
  const guestLeaderboard = await loadProgressLeaderboard({
    userId: "user-guest",
    transport: "guest",
    localeHint: "en",
  });

  assert.equal(guestLeaderboard.status, "linked_account_required");
  assert.deepEqual(guestLeaderboard.windows, []);
});

test("public progress streak loaders retry transient repeatable-read materialization failures", () => {
  const source = loadProgressIndexSource();

  assert.match(source, /import \{ withTransientDatabaseRetry \} from "\.\.\/database\/transient";/);
  assert.match(source, /import \{ createBackendRuntimeObservationScope \} from "\.\.\/observability\/sentry";/);
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

test("published contract omits progress leaderboards while the API Gateway predeclares them", () => {
  const openApiDocument = loadOpenApiDocument() as Readonly<{
    paths?: Readonly<Record<string, object>>;
  }>;
  assert.equal(openApiDocument.paths?.["/me/progress/leaderboard"], undefined);
  assert.equal(openApiDocument.paths?.["/me/progress/leaderboards/streak"], undefined);

  const apiGatewaySource = loadApiGatewaySource();
  assert.match(
    apiGatewaySource,
    /meProgress\.addResource\("leaderboard"\)\.addMethod\("GET", integration\);/,
  );
  assert.match(
    apiGatewaySource,
    /meProgressLeaderboards\.addResource\("streak"\)\.addMethod\("GET", integration\);/,
  );
});
