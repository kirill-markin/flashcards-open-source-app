import { Hono } from "hono";
import { authenticateRequest } from "../auth";
import { HttpError } from "../shared/errors";
import {
  completeGuestUpgrade,
  createGuestSession,
  deleteGuestSession,
  prepareGuestUpgrade,
  type GuestSessionPlatform,
  type GuestUpgradeCompleteCapabilities,
  type GuestUpgradeSelection,
} from "../guestAuth";
import {
  expectBoolean,
  expectNonEmptyString,
  expectRecord,
  parseJsonBody,
} from "../server/requestParsing";
import { createBackendFailureDetails } from "../server/logging";
import {
  addBackendBreadcrumb,
  createBackendObservationScope,
  normalizeCaughtError,
  type BackendObservationScope,
} from "../observability/sentry";
import { reportBackendExceptionOrBreadcrumb } from "../observability/reporting";
import { extractRequestAuthInputs, toAuthRequest } from "../auth/requestSecurity";
import type { AppEnv } from "../server/app";

type GuestSessionEnvelope = Readonly<{
  guestToken: string;
  userId: string;
  workspaceId: string;
}>;

type GuestUpgradePrepareEnvelope = Readonly<{
  mode: "bound" | "merge_required";
}>;

type GuestUpgradeCompleteEnvelope = Readonly<{
  workspace: Readonly<{
    workspaceId: string;
    name: string;
    createdAt: string;
    isSelected: true;
  }>;
  droppedEntities?: Readonly<{
    cardIds: ReadonlyArray<string>;
    deckIds: ReadonlyArray<string>;
    reviewEventIds: ReadonlyArray<string>;
  }>;
}>;

type GuestAuthRoutesOptions = Readonly<{
  authenticateRequestFn?: typeof authenticateRequest;
  createGuestSessionFn?: typeof createGuestSession;
  completeGuestUpgradeFn?: typeof completeGuestUpgrade;
  deleteGuestSessionFn?: typeof deleteGuestSession;
}>;

function parseGuestSessionPlatformValue(value: unknown): GuestSessionPlatform | null {
  if (value === undefined) {
    // Pre-1.7.0 iOS/Android clients create guest sessions without platform.
    // Keep this unbound legacy path until those mobile versions are no longer supported.
    return null;
  }

  if (typeof value !== "string") {
    throw new HttpError(400, "platform must be ios or android", "GUEST_SESSION_PLATFORM_INVALID");
  }

  const platform = value.trim();
  if (platform === "ios" || platform === "android") {
    return platform;
  }

  if (platform === "web") {
    throw new HttpError(
      403,
      "Guest web sessions are not supported. Sign in before using cloud sync on the web app.",
      "GUEST_WEB_SESSION_UNSUPPORTED",
    );
  }

  throw new HttpError(400, "platform must be ios or android", "GUEST_SESSION_PLATFORM_INVALID");
}

async function parseGuestSessionCreatePlatform(request: Request): Promise<GuestSessionPlatform | null> {
  const rawBody = await request.text();
  if (rawBody.trim() === "") {
    // Pre-1.7.0 iOS/Android clients create guest sessions with an empty body.
    // Keep this unbound legacy path until those mobile versions are no longer supported.
    return null;
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody) as unknown;
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }

  const body = expectRecord(parsedBody);
  return parseGuestSessionPlatformValue(body.platform);
}

function parseGuestUpgradeSelection(value: unknown): GuestUpgradeSelection {
  const body = expectRecord(value);
  const type = expectNonEmptyString(body.type, "selection.type");
  if (type === "create_new") {
    return { type: "create_new" };
  }

  if (type === "existing") {
    return {
      type: "existing",
      workspaceId: expectNonEmptyString(body.workspaceId, "selection.workspaceId"),
    };
  }

  throw new HttpError(400, "selection.type is invalid", "GUEST_UPGRADE_SELECTION_INVALID");
}

function parseGuestUpgradeCompleteCapabilities(
  body: Readonly<Record<string, unknown>>,
): GuestUpgradeCompleteCapabilities {
  const hasGuestDrainCapability = body.guestWorkspaceSyncedAndOutboxDrained !== undefined;
  const hasDroppedEntitiesCapability = body.supportsDroppedEntities !== undefined;
  const guestWorkspaceSyncedAndOutboxDrained = !hasGuestDrainCapability
    ? false
    : expectBoolean(
      body.guestWorkspaceSyncedAndOutboxDrained,
      "guestWorkspaceSyncedAndOutboxDrained",
    );

  if (!hasDroppedEntitiesCapability) {
    return {
      guestWorkspaceSyncedAndOutboxDrained,
      requiresGuestWorkspaceSyncedAndOutboxDrained: hasGuestDrainCapability,
      supportsDroppedEntities: false,
    };
  }

  return {
    guestWorkspaceSyncedAndOutboxDrained,
    requiresGuestWorkspaceSyncedAndOutboxDrained: true,
    supportsDroppedEntities: expectBoolean(body.supportsDroppedEntities, "supportsDroppedEntities"),
  };
}

function expectGuestAuthorizationToken(authorizationHeader: string | undefined): string {
  if (authorizationHeader === undefined || !authorizationHeader.startsWith("Guest ")) {
    throw new HttpError(401, "Guest session is invalid.", "GUEST_AUTH_INVALID");
  }

  const guestToken = authorizationHeader.slice(6).trim();
  if (guestToken === "") {
    throw new HttpError(401, "Guest session is invalid.", "GUEST_AUTH_INVALID");
  }

  return guestToken;
}

function createGuestUpgradeScope(
  requestId: string,
  route: string,
  method: string,
  userId: string,
): BackendObservationScope {
  return createBackendObservationScope(
    "backend-api",
    requestId,
    route,
    method,
    userId,
    null,
    null,
    null,
    null,
  );
}

export function createGuestAuthRoutes(options: GuestAuthRoutesOptions = {}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const authenticateRequestFn = options.authenticateRequestFn ?? authenticateRequest;
  const createGuestSessionFn = options.createGuestSessionFn ?? createGuestSession;
  const completeGuestUpgradeFn = options.completeGuestUpgradeFn ?? completeGuestUpgrade;
  const deleteGuestSessionFn = options.deleteGuestSessionFn ?? deleteGuestSession;

  app.post("/guest-auth/session", async (context) => {
    const platform = await parseGuestSessionCreatePlatform(context.req.raw);
    const session = await createGuestSessionFn(platform);
    return context.json({
      guestToken: session.guestToken,
      userId: session.userId,
      workspaceId: session.workspaceId,
    } satisfies GuestSessionEnvelope);
  });

  app.post("/guest-auth/session/delete", async (context) => {
    const requestAuthInputs = extractRequestAuthInputs(context.req.raw);
    const auth = await authenticateRequestFn(toAuthRequest(requestAuthInputs));
    if (auth.transport !== "guest") {
      throw new HttpError(
        403,
        "Delete guest session requires Guest authentication.",
        "GUEST_SESSION_DELETE_GUEST_AUTH_REQUIRED",
      );
    }

    const guestToken = expectGuestAuthorizationToken(requestAuthInputs.authorizationHeader);
    await deleteGuestSessionFn(guestToken);
    return context.json({ ok: true } as const);
  });

  app.post("/guest-auth/upgrade/prepare", async (context) => {
    const auth = await authenticateRequestFn(toAuthRequest(extractRequestAuthInputs(context.req.raw)));
    if (auth.transport !== "bearer" && auth.transport !== "session") {
      throw new HttpError(403, "Sign in before upgrading this guest session.", "GUEST_UPGRADE_HUMAN_AUTH_REQUIRED");
    }

    const body = expectRecord(await parseJsonBody(context.req.raw));
    const guestToken = expectNonEmptyString(body.guestToken, "guestToken");
    const result = await prepareGuestUpgrade(guestToken, auth.subjectUserId, auth.email);
    return context.json({
      mode: result.mode,
    } satisfies GuestUpgradePrepareEnvelope);
  });

  app.post("/guest-auth/upgrade/complete", async (context) => {
    const auth = await authenticateRequestFn(toAuthRequest(extractRequestAuthInputs(context.req.raw)));
    if (auth.transport !== "bearer" && auth.transport !== "session") {
      throw new HttpError(403, "Sign in before upgrading this guest session.", "GUEST_UPGRADE_HUMAN_AUTH_REQUIRED");
    }

    const requestId = context.get("requestId");
    const body = expectRecord(await parseJsonBody(context.req.raw));
    const guestToken = expectNonEmptyString(body.guestToken, "guestToken");
    const selection = parseGuestUpgradeSelection(body.selection);
    // Merge completion consumes already-synced guest cloud rows only. Clients
    // must drain their local guest outbox before calling this route.
    const capabilities = parseGuestUpgradeCompleteCapabilities(body);

    try {
      const result = await completeGuestUpgradeFn(guestToken, auth.subjectUserId, selection, capabilities);
      addBackendBreadcrumb({
        action: "guest_upgrade_complete",
        scope: createGuestUpgradeScope(requestId, context.req.path, context.req.method, result.targetUserId),
        details: {
          statusCode: 200,
          selectionType: selection.type,
          guestWorkspaceSyncedAndOutboxDrained: capabilities.guestWorkspaceSyncedAndOutboxDrained,
          requiresGuestWorkspaceSyncedAndOutboxDrained: capabilities.requiresGuestWorkspaceSyncedAndOutboxDrained,
          supportsDroppedEntities: capabilities.supportsDroppedEntities,
          targetSubjectUserId: result.targetSubjectUserId,
          guestSessionId: result.guestSessionId,
          targetUserId: result.targetUserId,
          targetWorkspaceId: result.targetWorkspaceId,
          completionKind: result.outcome,
        },
      });

      const response: GuestUpgradeCompleteEnvelope = result.droppedEntities === undefined
        ? {
          workspace: result.workspace,
        }
        : {
          workspace: result.workspace,
          droppedEntities: result.droppedEntities,
        };
      return context.json(response);
    } catch (error) {
      const scope = createGuestUpgradeScope(requestId, context.req.path, context.req.method, auth.userId);
      const details = {
        selectionType: selection.type,
        guestWorkspaceSyncedAndOutboxDrained: capabilities.guestWorkspaceSyncedAndOutboxDrained,
        requiresGuestWorkspaceSyncedAndOutboxDrained: capabilities.requiresGuestWorkspaceSyncedAndOutboxDrained,
        supportsDroppedEntities: capabilities.supportsDroppedEntities,
        targetSubjectUserId: auth.subjectUserId,
        guestSessionId: null,
        targetUserId: auth.userId,
        targetWorkspaceId: null,
        completionKind: null,
        ...createBackendFailureDetails(error),
      };
      reportBackendExceptionOrBreadcrumb(
        error,
        { action: "guest_upgrade_complete_error", error: normalizeCaughtError(error), scope, details },
        { action: "guest_upgrade_complete_error", scope, details },
      );
      throw error;
    }
  });

  return app;
}
