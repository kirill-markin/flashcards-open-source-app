import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import pg from "pg";
import type { DatabaseExecutor } from "../database";
import { authenticateAgentApiKey } from "../agent/apiKeys";
import { authenticateMcpAccessToken } from "./mcpTokens";
import { createAgentAccountEnvelope } from "../agent/setup";
import { ensureCognitoUserProfile } from "./ensureUser";
import { getClientAccountIdentity, type RequestContext } from "../server/requestContext";

type OidcClaims = Readonly<{
  iss: string; sub: string; aud: string; iat: number; exp: number;
  nonce?: string; email?: string; email_verified?: boolean;
}>;
type OidcStore = Readonly<{
  consumeAuthorizationCodeGrantInExecutor: (
    executor: DatabaseExecutor, code: string, issuer: string, nowMs: number,
  ) => Promise<Readonly<{ idTokenClaims: OidcClaims | null }> | null>;
  getOidcUserInfoInExecutor: (
    executor: DatabaseExecutor, token: string, nowMs: number,
  ) => Promise<Readonly<{ sub: string; email?: string; email_verified?: boolean }> | "insufficient_scope" | null>;
}>;

const legacyUserId = "stable-client-backfill";
const legacySubject = "stable-client-backfill-subject";
const keyConnectionId = "19500000-0000-4000-8000-000000000001";
const oauthConnectionId = "19500000-0000-4000-8000-000000000002";
const clientId = "stable-client-backfill-client";
const key = "fca_12345678_" + "A".repeat(26);
const tokenSecret = "B".repeat(40);
const token = "fco_" + tokenSecret;
const hash = (value: string): string => createHash("sha256").update(value).digest("hex");

function executorFor(client: pg.Client): DatabaseExecutor {
  return { query: (text, params) => client.query(text, [...params]) };
}

test("credential-original projection survives canonical owner reassignment and original profile retirement", async () => {
  const ownerUrl = process.env.TEST_DATABASE_ADMIN_URL;
  if (ownerUrl === undefined) throw new Error("TEST_DATABASE_ADMIN_URL is required");
  const owner = new pg.Client({ connectionString: ownerUrl });
  const auth = new pg.Client({ connectionString: ownerUrl });
  const backend = new pg.Client({ connectionString: ownerUrl });
  const targetSubject = randomUUID();
  const unrelatedSubject = randomUUID();
  const freshSubject = randomUUID();
  const userIds = [legacyUserId];
  const workspaces: Array<string> = [];
  const nowMs = Date.now();
  const email = "stable-client-" + randomUUID() + "@mail.test";
  const codes = [randomUUID(), randomUUID()];
  const freshConnectionIds = [randomUUID(), randomUUID()];
  try {
    await Promise.all([owner.connect(), auth.connect(), backend.connect()]);
    await auth.query("SET ROLE auth_app");
    await backend.query("SET ROLE backend_app");
    const oauth = await import(pathToFileURL(resolve(__dirname, "../../../auth/src/server/oauth/oauthStore.ts")).href) as OidcStore;
    for (const table of ["user_identities", "agent_api_keys", "oauth_connections"]) {
      const rows = await owner.query<Readonly<{ original_client_user_id: string }>>(
        "SELECT original_client_user_id FROM auth." + table + " WHERE user_id = $1", [legacyUserId],
      );
      assert.deepEqual(rows.rows.map((row) => row.original_client_user_id), [legacyUserId]);
      await assert.rejects(owner.query(
        "UPDATE auth." + table + " SET original_client_user_id = $2 WHERE user_id = $1",
        [legacyUserId, randomUUID()],
      ), { code: "23514" });
    }

    const original = await ensureCognitoUserProfile(legacySubject, email);
    if (original.selectedWorkspaceId !== null) workspaces.push(original.selectedWorkspaceId);
    assert.deepEqual(original.clientAccountIdentity, {
      originalClientUserId: legacyUserId, canonicalAccountId: legacyUserId, linkedAccountIds: [legacyUserId],
    });
    const target = await ensureCognitoUserProfile(targetSubject, email);
    const unrelated = await ensureCognitoUserProfile(unrelatedSubject, email);
    userIds.push(target.userId, unrelated.userId);
    for (const profile of [target, unrelated]) {
      if (profile.selectedWorkspaceId !== null) workspaces.push(profile.selectedWorkspaceId);
    }
    assert.notEqual(target.userId, unrelated.userId);

    // Old INSERT shapes remain valid after the migration, under actual runtime roles.
    await auth.query("BEGIN");
    await auth.query("SELECT set_config('app.user_id',$1,true)", [target.userId]);
    await auth.query("SELECT auth.bind_cognito_account($1,$2)", [freshSubject, target.userId]);
    await auth.query(
      "INSERT INTO auth.agent_api_keys(connection_id,user_id,label,key_id,key_hash) VALUES ($1,$2,'old lambda',$3,$4)",
      [freshConnectionIds[0], target.userId, randomUUID(), hash("old-secret")],
    );
    await auth.query(
      "INSERT INTO auth.oauth_connections(connection_id,user_id,client_id,label) VALUES ($1,$2,$3,'old lambda')",
      [freshConnectionIds[1], target.userId, clientId],
    );
    await auth.query("COMMIT");
    for (const table of ["user_identities", "agent_api_keys", "oauth_connections"]) {
      const rows = await owner.query<Readonly<{ original_client_user_id: string }>>(
        "SELECT original_client_user_id FROM auth." + table + " WHERE user_id = $1", [target.userId],
      );
      assert.ok(rows.rows.length > 0);
      assert.ok(rows.rows.every((row) => row.original_client_user_id === target.userId));
    }
    await assert.rejects(backend.query(
      "UPDATE auth.user_identities SET user_id = $2 WHERE provider_subject = $1", [legacySubject, target.userId],
    ), { code: "42501" });
    await assert.rejects(auth.query(
      "UPDATE auth.user_identities SET user_id = $2 WHERE provider_subject = $1", [legacySubject, target.userId],
    ), { code: "42501" });

    await auth.query(
      "INSERT INTO auth.oauth_access_tokens(token_hash,connection_id,scope,resource,expires_at,identity_email,identity_email_verified) "
        + "VALUES ($1,$2,'openid email flashcards','https://mcp.nibomo.com',now()+INTERVAL '1 hour',$3,true)",
      [hash(tokenSecret), oauthConnectionId, email],
    );
    const redeem = async (code: string): Promise<OidcClaims> => {
      await auth.query(
        "INSERT INTO auth.oauth_authorization_codes(code_hash,client_id,connection_id,redirect_uri,code_challenge,scope,resource,expires_at,nonce,identity_email,identity_email_verified) "
          + "VALUES ($1,$2,$3,'https://client.test/callback','challenge','openid email flashcards','https://mcp.nibomo.com',now()+INTERVAL '10 minutes','nonce',$4,true)",
        [hash(code), clientId, oauthConnectionId, email],
      );
      await auth.query("BEGIN");
      try {
        const result = await oauth.consumeAuthorizationCodeGrantInExecutor(executorFor(auth), code, "https://auth.nibomo.com", nowMs);
        assert.ok(result?.idTokenClaims);
        await auth.query("COMMIT");
        return result.idTokenClaims;
      } catch (error) {
        await auth.query("ROLLBACK");
        throw error;
      }
    };
    const issuedClaims = await redeem(codes[0]);
    assert.equal(issuedClaims.sub, legacyUserId);
    assert.deepEqual(await oauth.getOidcUserInfoInExecutor(executorFor(auth), token, nowMs), {
      sub: issuedClaims.sub, email, email_verified: true,
    });
    const originalAgent = await authenticateAgentApiKey(key);
    const originalOAuth = await authenticateMcpAccessToken(token, "https://mcp.nibomo.com");
    assert.equal(originalAgent.clientAccountIdentity?.originalClientUserId, legacyUserId);

    // Test-owner fixture only: this slice exposes no runtime reparenting capability.
    await owner.query("BEGIN");
    await owner.query(
      "INSERT INTO org.workspace_memberships(workspace_id,user_id,role) VALUES ($1,$2,'owner')",
      [original.selectedWorkspaceId, target.userId],
    );
    for (const table of ["user_identities", "agent_api_keys", "oauth_connections"]) {
      await owner.query("UPDATE auth." + table + " SET user_id = $2 WHERE user_id = $1", [legacyUserId, target.userId]);
    }
    await owner.query("COMMIT");
    const moved = await ensureCognitoUserProfile(legacySubject, email);
    const linkedIds = [legacyUserId, target.userId].sort();
    assert.equal(moved.userId, target.userId);
    assert.deepEqual(moved.clientAccountIdentity, {
      originalClientUserId: legacyUserId, canonicalAccountId: target.userId, linkedAccountIds: linkedIds,
    });
    assert.equal((await ensureCognitoUserProfile(targetSubject, email)).clientAccountIdentity?.originalClientUserId, target.userId);
    assert.ok(!moved.clientAccountIdentity?.linkedAccountIds.includes(unrelated.userId));

    const oauthCredential = await authenticateMcpAccessToken(token, "https://mcp.nibomo.com");
    assert.equal(oauthCredential.userId, target.userId);
    assert.equal(oauthCredential.connectionId, oauthConnectionId);
    assert.equal(oauthCredential.selectedWorkspaceId, originalOAuth.selectedWorkspaceId);
    const agent = await authenticateAgentApiKey(key);
    assert.equal(agent.userId, target.userId);
    assert.equal(agent.connectionId, keyConnectionId);
    assert.equal(agent.selectedWorkspaceId, originalAgent.selectedWorkspaceId);
    assert.deepEqual(agent.clientAccountIdentity, moved.clientAccountIdentity);
    const context: RequestContext = {
      userId: agent.userId, clientAccountIdentity: agent.clientAccountIdentity,
      subjectUserId: agent.userId, selectedWorkspaceId: agent.selectedWorkspaceId,
      email: moved.email, locale: moved.locale, userSettingsCreatedAt: moved.createdAt,
      preferences: moved.preferences, transport: "api_key", connectionId: agent.connectionId,
      guestSessionId: null, guestPlatform: null,
    };
    const envelope = createAgentAccountEnvelope("https://api.nibomo.com/v1/agent/me", context, null);
    assert.equal(envelope.data.userId, legacyUserId);
    assert.equal(envelope.data.canonicalAccountId, target.userId);
    assert.deepEqual(envelope.data.linkedAccountIds, linkedIds);
    assert.throws(() => getClientAccountIdentity({ ...context, clientAccountIdentity: undefined }));
    const humanContext: RequestContext = {
      ...context, userId: moved.userId, clientAccountIdentity: moved.clientAccountIdentity,
      subjectUserId: legacySubject, transport: "bearer", connectionId: null,
    };
    assert.equal(humanContext.userId, target.userId);
    assert.equal(getClientAccountIdentity(humanContext).originalClientUserId, legacyUserId);
    const refreshedClaims = await redeem(codes[1]);
    assert.deepEqual(refreshedClaims, issuedClaims);
    assert.deepEqual(await oauth.getOidcUserInfoInExecutor(executorFor(auth), token, nowMs), {
      sub: issuedClaims.sub, email, email_verified: true,
    });

    await owner.query("DELETE FROM org.user_settings WHERE user_id = $1", [legacyUserId]);
    assert.equal((await ensureCognitoUserProfile(legacySubject, email)).clientAccountIdentity?.originalClientUserId, legacyUserId);
    assert.equal((await authenticateAgentApiKey(key)).clientAccountIdentity?.originalClientUserId, legacyUserId);
    assert.deepEqual(await oauth.getOidcUserInfoInExecutor(executorFor(auth), token, nowMs), {
      sub: legacyUserId, email, email_verified: true,
    });
  } finally {
    try {
      await Promise.all([owner.query("ROLLBACK"), auth.query("ROLLBACK"), backend.query("ROLLBACK")]);
      await owner.query("DELETE FROM org.workspaces WHERE workspace_id = ANY($1::uuid[])", [workspaces]);
      await owner.query("DELETE FROM org.user_settings WHERE user_id = ANY($1::text[])", [userIds]);
      await owner.query("DELETE FROM auth.oauth_clients WHERE client_id = $1", [clientId]);
    } finally {
      await Promise.all([owner.end(), auth.end(), backend.end()]);
    }
  }
});
