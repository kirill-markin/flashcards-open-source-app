import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Hono } from "hono";
import pg from "pg";
import { createSyncRoutes } from "../routes/sync";
import type { AppEnv } from "../server/app";
import type { RequestContext } from "../server/requestContext";

const localUserId = "local";
const localWorkspaceId = "35274129-ef97-d366-954c-955b4bb0fbf0";

type LocalWorkspaceRow = Readonly<{
  role: string;
  selected_workspace_id: string;
  user_id: string;
  workspace_id: string;
}>;

type BootstrapReplicaRow = Readonly<{
  installation_id: string;
  platform: string;
  user_id: string;
  workspace_id: string;
}>;

function requireOwnerDatabaseUrl(): string {
  const databaseUrl = process.env.TEST_DATABASE_ADMIN_URL?.trim();
  if (databaseUrl === undefined || databaseUrl === "") {
    throw new Error(
      "TEST_DATABASE_ADMIN_URL is required for the fresh PostgreSQL bootstrap integration test.",
    );
  }

  return databaseUrl;
}

function createLocalRequestContext(): RequestContext {
  return {
    userId: localUserId,
    subjectUserId: localUserId,
    selectedWorkspaceId: localWorkspaceId,
    email: null,
    locale: "en",
    userSettingsCreatedAt: "2026-01-01T00:00:00.000Z",
    preferences: {
      reviewReactionAnimationsEnabled: true,
    },
    transport: "bearer",
    connectionId: null,
    guestSessionId: null,
    guestPlatform: null,
  };
}

function createFreshBootstrapApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", async (context, next) => {
    context.set("requestId", randomUUID());
    context.set("clientAppVersion", null);
    context.set("clientPlatform", null);
    await next();
  });
  app.route("/", createSyncRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {
        authorizationHeader: undefined,
        sessionToken: undefined,
        csrfTokenHeader: undefined,
        originHeader: undefined,
        refererHeader: undefined,
        secFetchSiteHeader: undefined,
      },
      requestContext: createLocalRequestContext(),
    }),
  }));
  return app;
}

test("a fresh PostgreSQL database bootstraps the migration-0018 local workspace", async () => {
  const ownerPool = new pg.Pool({
    connectionString: requireOwnerDatabaseUrl(),
    application_name: "fresh-bootstrap-integration-owner",
  });
  const installationId = randomUUID();

  try {
    const localWorkspace = await ownerPool.query<LocalWorkspaceRow>(
      `SELECT
         user_settings.user_id,
         user_settings.workspace_id::text AS selected_workspace_id,
         workspaces.workspace_id::text AS workspace_id,
         memberships.role
       FROM org.user_settings AS user_settings
       INNER JOIN org.workspaces AS workspaces
         ON workspaces.workspace_id = user_settings.workspace_id
       INNER JOIN org.workspace_memberships AS memberships
         ON memberships.workspace_id = workspaces.workspace_id
        AND memberships.user_id = user_settings.user_id
       WHERE user_settings.user_id = $1`,
      [localUserId],
    );
    assert.deepEqual(localWorkspace.rows, [{
      user_id: localUserId,
      selected_workspace_id: localWorkspaceId,
      workspace_id: localWorkspaceId,
      role: "owner",
    }]);

    const response = await createFreshBootstrapApp().request(
      `http://localhost/workspaces/${localWorkspaceId}/sync/bootstrap`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mode: "pull",
          installationId,
          platform: "web",
          cursor: null,
          limit: 2,
        }),
      },
    );
    const responseBody = await response.text();
    assert.equal(response.status, 200, responseBody);

    const replica = await ownerPool.query<BootstrapReplicaRow>(
      `SELECT
         installation_id::text AS installation_id,
         platform,
         user_id,
         workspace_id::text AS workspace_id
       FROM sync.workspace_replicas
       WHERE workspace_id = $1
         AND installation_id = $2`,
      [localWorkspaceId, installationId],
    );
    assert.deepEqual(replica.rows, [{
      installation_id: installationId,
      platform: "web",
      user_id: localUserId,
      workspace_id: localWorkspaceId,
    }]);
  } finally {
    await ownerPool.end();
  }
});
