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

test("published contract excludes progress endpoints while the API Gateway resource tree still predeclares the paths", () => {
  const openApiDocument = loadOpenApiDocument() as Readonly<{
    info?: Readonly<{ title?: string; description?: string }>;
    paths?: Readonly<Record<string, unknown>>;
  }>;
  assert.equal(openApiDocument.info?.title, "Flashcards Open Source App External AI-Agent API");
  assert.match(openApiDocument.info?.description ?? "", /external ai agents/i);
  assert.equal(openApiDocument.paths?.["/me/progress"], undefined);
  assert.equal(openApiDocument.paths?.["/me/progress/summary"], undefined);
  assert.equal(openApiDocument.paths?.["/me/progress/review-schedule"], undefined);
  assert.equal(openApiDocument.paths?.["/me/progress/series"], undefined);

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

test("published contract documents the progress leaderboard and the API Gateway predeclares it", () => {
  const openApiDocument = loadOpenApiDocument() as Readonly<{
    paths?: Readonly<Record<string, unknown>>;
  }>;
  assert.notEqual(openApiDocument.paths?.["/me/progress/leaderboard"], undefined);

  const apiGatewaySource = loadApiGatewaySource();
  assert.match(
    apiGatewaySource,
    /meProgress\.addResource\("leaderboard"\)\.addMethod\("GET", integration\);/,
  );
});
