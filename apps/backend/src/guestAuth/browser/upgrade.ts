import { Hono } from "hono";
import { authenticateRequest, type AuthResult } from "../../auth";
import {
  enforceAllowedBrowserOrigin,
  enforceSessionCsrfProtection,
  extractRequestAuthInputs,
} from "../../auth/requestSecurity";
import {
  completeBrowserGuestUpgrade,
  prepareBrowserGuestUpgrade,
  type GuestUpgradeSelection,
} from "../index";
import type { AppEnv } from "../../server/app";
import {
  expectBoolean,
  expectNonEmptyString,
  expectRecord,
  parseJsonBody,
} from "../../server/requestParsing";
import { HttpError } from "../../shared/errors";

async function authenticateBrowserUpgrade(
  request: Request,
  allowedOrigins: ReadonlyArray<string>,
): Promise<Readonly<{ auth: AuthResult; guestToken: string }>> {
  const inputs = extractRequestAuthInputs(request);
  enforceAllowedBrowserOrigin(inputs, allowedOrigins, "Origin is not allowed for browser guest conversion");
  if (inputs.authorizationHeader !== undefined) {
    throw new HttpError(400, "Browser guest conversion requires cookies.", "BROWSER_AUTH_COOKIE_REQUIRED");
  }
  if (inputs.sessionToken === undefined) {
    throw new HttpError(401, "Sign in before converting the browser guest.", "BROWSER_SESSION_REQUIRED");
  }
  await enforceSessionCsrfProtection(request.method, inputs, allowedOrigins);
  const auth = await authenticateRequest({
    authorizationHeader: undefined,
    sessionToken: inputs.sessionToken,
  });
  if (auth.transport !== "session") {
    throw new HttpError(401, "Sign in before converting the browser guest.", "BROWSER_SESSION_REQUIRED");
  }
  if (inputs.guestSessionToken === undefined) {
    throw new HttpError(409, "The browser guest cookie is missing. Preserve local data and recover its credential before conversion.", "GUEST_BROWSER_RECOVERY_REQUIRED");
  }
  return { auth, guestToken: inputs.guestSessionToken };
}

function parseBrowserUpgradeSelection(value: unknown): GuestUpgradeSelection {
  const body = expectRecord(value);
  const type = expectNonEmptyString(body.type, "selection.type");
  if (type === "create_new") {
    return {
      type,
      ...(body.name === undefined ? {} : { name: expectNonEmptyString(body.name, "selection.name") }),
    };
  }
  if (type === "existing") {
    return {
      type,
      workspaceId: expectNonEmptyString(body.workspaceId, "selection.workspaceId"),
      ...(body.discardDemoOnly === undefined ? {}
        : { discardDemoOnly: expectBoolean(body.discardDemoOnly, "selection.discardDemoOnly") }),
    };
  }
  throw new HttpError(400, "selection.type must be existing or create_new.", "GUEST_UPGRADE_SELECTION_INVALID");
}

function assertCookieOnlyBody(body: Readonly<Record<string, unknown>>): void {
  if (body.guestToken !== undefined) {
    throw new HttpError(400, "Send the guest credential only in its browser cookie.", "BROWSER_AUTH_COOKIE_REQUIRED");
  }
}

export function createBrowserGuestUpgradeRoutes(allowedOrigins: ReadonlyArray<string>): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.post("/guest-auth/browser/upgrade/prepare", async (context) => {
    const { auth, guestToken } = await authenticateBrowserUpgrade(context.req.raw, allowedOrigins);
    const body = expectRecord(await parseJsonBody(context.req.raw));
    assertCookieOnlyBody(body);
    const drained = expectBoolean(body.guestWorkspaceSyncedAndOutboxDrained, "guestWorkspaceSyncedAndOutboxDrained");
    if (!drained) {
      throw new HttpError(409, "Guest writes must be synced and the guest outbox empty before sign-in. Preserve local data and resume guest ownership before retrying.", "GUEST_UPGRADE_GUEST_SYNC_NOT_DRAINED");
    }
    const result = await prepareBrowserGuestUpgrade(guestToken, auth.subjectUserId, auth.email);
    return context.json(result);
  });

  app.post("/guest-auth/browser/upgrade/complete", async (context) => {
    const { auth, guestToken } = await authenticateBrowserUpgrade(context.req.raw, allowedOrigins);
    const body = expectRecord(await parseJsonBody(context.req.raw));
    assertCookieOnlyBody(body);
    const selection = parseBrowserUpgradeSelection(body.selection);
    const result = await completeBrowserGuestUpgrade(guestToken, auth.subjectUserId, selection, {
      guestWorkspaceSyncedAndOutboxDrained: expectBoolean(
        body.guestWorkspaceSyncedAndOutboxDrained, "guestWorkspaceSyncedAndOutboxDrained",
      ),
      requiresGuestWorkspaceSyncedAndOutboxDrained: true,
      supportsDroppedEntities: expectBoolean(body.supportsDroppedEntities, "supportsDroppedEntities"),
    });
    return context.json({
      workspace: result.workspace,
      ...(result.droppedEntities === undefined ? {} : { droppedEntities: result.droppedEntities }),
    });
  });
  return app;
}
