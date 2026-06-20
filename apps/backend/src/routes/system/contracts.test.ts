import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { loadOpenApiDocument } from "../../shared/openapi";

test("API Gateway predeclares PATCH /me/preferences", () => {
  const apiGatewayPath = resolve(process.cwd(), "../../infra/aws/lib/gateways/api-gateway.ts");
  const apiGatewaySource = readFileSync(apiGatewayPath, "utf8");

  assert.match(apiGatewaySource, /me\.addResource\("preferences"\)\.addMethod\("PATCH", integration\);/);
});

test("API Gateway predeclares /me/community/profile", () => {
  const apiGatewayPath = resolve(process.cwd(), "../../infra/aws/lib/gateways/api-gateway.ts");
  const apiGatewaySource = readFileSync(apiGatewayPath, "utf8");

  assert.match(
    apiGatewaySource,
    /const meCommunityProfile = meCommunity\.addResource\("profile"\);/,
  );
  assert.match(apiGatewaySource, /meCommunityProfile\.addMethod\("GET", integration\);/);
  assert.match(apiGatewaySource, /meCommunityProfile\.addMethod\("PATCH", integration\);/);
});

test("published OpenAPI includes community profile endpoint without internal ids", () => {
  const openApiDocument = loadOpenApiDocument() as Readonly<{
    paths?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
    components?: Readonly<{
      schemas?: Readonly<Record<string, unknown>>;
    }>;
  }>;
  const communityProfilePath = openApiDocument.paths?.["/me/community/profile"];
  const profileSchema = openApiDocument.components?.schemas?.CommunityPublicProfileResponse;
  const serializedSchema = JSON.stringify(profileSchema ?? null);

  assert.notEqual(communityProfilePath?.get, undefined);
  assert.notEqual(communityProfilePath?.patch, undefined);
  assert.equal(serializedSchema.includes("publicProfileId"), true);
  assert.equal(serializedSchema.includes("anonymousDisplayName"), true);
  assert.equal(serializedSchema.includes("leaderboardParticipationEnabled"), true);
  assert.equal(serializedSchema.includes("linkedAccountRequiredForLeaderboard"), true);
  assert.equal(serializedSchema.includes("userId"), false);
  assert.equal(serializedSchema.includes("workspaceId"), false);
  assert.equal(serializedSchema.includes("replicaId"), false);
  assert.equal(serializedSchema.includes("email"), false);
});

test("API Gateway predeclares friend invitation routes", () => {
  const apiGatewayPath = resolve(process.cwd(), "../../infra/aws/lib/gateways/api-gateway.ts");
  const apiGatewaySource = readFileSync(apiGatewayPath, "utf8");

  assert.match(
    apiGatewaySource,
    /const meCommunityFriendInvitations = meCommunity\.addResource\("friend-invitations"\);/,
  );
  assert.match(apiGatewaySource, /meCommunityFriendInvitations\.addMethod\("POST", integration\);/);
  assert.match(
    apiGatewaySource,
    /meCommunityFriendInvitations\s*\.addResource\("\{inviteToken\}"\)\s*\.addResource\("accept"\)\s*\.addMethod\("POST", integration\);/,
  );
  assert.match(
    apiGatewaySource,
    /const communityFriendInvitations = community\.addResource\("friend-invitations"\);/,
  );
  assert.match(
    apiGatewaySource,
    /communityFriendInvitations\.addResource\("\{inviteToken\}"\)\.addMethod\("GET", integration\);/,
  );
});

test("published OpenAPI documents friend invitations without internal ids", () => {
  const openApiDocument = loadOpenApiDocument() as Readonly<{
    paths?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
    components?: Readonly<{ schemas?: Readonly<Record<string, unknown>> }>;
  }>;
  const createPath = openApiDocument.paths?.["/me/community/friend-invitations"];
  const previewPath = openApiDocument.paths?.["/community/friend-invitations/{inviteToken}"];
  const acceptPath = openApiDocument.paths?.["/me/community/friend-invitations/{inviteToken}/accept"];
  const schemas = openApiDocument.components?.schemas ?? {};
  const invitationSchemas = Object.fromEntries(
    Object.entries(schemas).filter(([name]) => name.startsWith("FriendInvitation")),
  );
  const serializedContract = JSON.stringify({
    createPath,
    previewPath,
    acceptPath,
    invitationSchemas,
  });
  const serializedInvitationSchemas = JSON.stringify(invitationSchemas);

  assert.notEqual(createPath?.post, undefined);
  assert.notEqual(previewPath?.get, undefined);
  assert.notEqual(acceptPath?.post, undefined);
  assert.equal(serializedContract.includes("inviteUrl"), true);
  assert.equal(serializedContract.includes("expiresAt"), true);
  assert.equal(serializedContract.includes("existingFriendDisplayName"), true);
  assert.equal(serializedInvitationSchemas.includes("publicProfileId"), false);
  assert.equal(serializedInvitationSchemas.includes("userId"), false);
  assert.equal(serializedInvitationSchemas.includes("email"), false);
  assert.equal(serializedInvitationSchemas.includes("inviteeDisplayNameForInviter"), false);
});

test("API Gateway predeclares /me/progress/leaderboard", () => {
  const apiGatewayPath = resolve(process.cwd(), "../../infra/aws/lib/gateways/api-gateway.ts");
  const apiGatewaySource = readFileSync(apiGatewayPath, "utf8");

  assert.match(
    apiGatewaySource,
    /meProgress\.addResource\("leaderboard"\)\.addMethod\("GET", integration\);/,
  );
});

test("API Gateway predeclares /me/progress/leaderboards/streak", () => {
  const apiGatewayPath = resolve(process.cwd(), "../../infra/aws/lib/gateways/api-gateway.ts");
  const apiGatewaySource = readFileSync(apiGatewayPath, "utf8");

  assert.match(
    apiGatewaySource,
    /const meProgressLeaderboards = meProgress\.addResource\("leaderboards"\);/,
  );
  assert.match(
    apiGatewaySource,
    /meProgressLeaderboards\.addResource\("streak"\)\.addMethod\("GET", integration\);/,
  );
});

test("published OpenAPI documents the progress leaderboard without internal ids", () => {
  const openApiDocument = loadOpenApiDocument() as Readonly<{
    paths?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
    components?: Readonly<{ schemas?: Readonly<Record<string, unknown>> }>;
  }>;
  const leaderboardPath = openApiDocument.paths?.["/me/progress/leaderboard"];
  const schemas = openApiDocument.components?.schemas ?? {};
  const leaderboardSchemas = Object.fromEntries(
    Object.entries(schemas).filter(([name]) => name.startsWith("ProgressLeaderboard") || name === "LeaderboardWindowKey"),
  );
  const serializedSchemas = JSON.stringify(leaderboardSchemas);

  assert.notEqual(leaderboardPath?.get, undefined);
  assert.notEqual(schemas.ProgressLeaderboardResponse, undefined);
  for (const expectedField of [
    "status",
    "defaultWindowKey",
    "metricVersion",
    "anonymousDisplayName",
    "friendDisplayName",
    "publicProfileId",
    "qualifiedReviewCount",
    "rank",
    "nextRefreshAfter",
    "participantCount",
    "rankingRows",
  ]) {
    assert.equal(serializedSchemas.includes(expectedField), true, `OpenAPI must document ${expectedField}`);
  }
  for (const internalField of [
    "userId",
    "friend_user_id",
    "friendUserId",
    "friend_public_profile_id",
    "friendPublicProfileId",
    "created_from_invitation_id",
    "friendInvitationId",
    "inviter_user_id",
    "inviterUserId",
    "createdFromInvitationId",
    "baseSort",
    "reviewed_by",
    "reviewedBy",
    "email",
  ]) {
    assert.equal(serializedSchemas.includes(internalField), false, `OpenAPI must not expose ${internalField}`);
  }
});

test("published OpenAPI documents the streak leaderboard without internal ids or rating fields", () => {
  const openApiDocument = loadOpenApiDocument() as Readonly<{
    paths?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
    components?: Readonly<{ schemas?: Readonly<Record<string, unknown>> }>;
  }>;
  const leaderboardPath = openApiDocument.paths?.["/me/progress/leaderboards/streak"];
  const schemas = openApiDocument.components?.schemas ?? {};
  const leaderboardSchemas = Object.fromEntries(
    Object.entries(schemas).filter(([name]) => name.startsWith("StreakLeaderboard")),
  );
  const serializedSchemas = JSON.stringify(leaderboardSchemas);

  assert.notEqual(leaderboardPath?.get, undefined);
  assert.notEqual(schemas.StreakLeaderboardResponse, undefined);
  for (const expectedField of [
    "status",
    "metricVersion",
    "streakDays",
    "anonymousDisplayName",
    "friendDisplayName",
    "publicProfileId",
    "rank",
    "snapshotId",
    "snapshotGeneratedAt",
    "asOfUtcDate",
    "nextRefreshAfter",
    "participantCount",
    "rankingRows",
  ]) {
    assert.equal(serializedSchemas.includes(expectedField), true, `OpenAPI must document ${expectedField}`);
  }
  for (const internalField of [
    "defaultWindowKey",
    "windowKey",
    "windows",
    "qualifiedReviewCount",
    "userId",
    "friend_user_id",
    "friendUserId",
    "friend_public_profile_id",
    "friendPublicProfileId",
    "created_from_invitation_id",
    "friendInvitationId",
    "inviter_user_id",
    "inviterUserId",
    "createdFromInvitationId",
    "baseSort",
    "reviewed_by",
    "reviewedBy",
    "email",
  ]) {
    assert.equal(serializedSchemas.includes(internalField), false, `OpenAPI must not expose ${internalField}`);
  }
});
