import { Hono } from "hono";
import { authenticateRequest } from "../auth";
import { HttpError } from "../shared/errors";
import {
  completeGuestUpgrade,
  createGuestSession,
  deleteGuestSession,
  linkGuestAnalyticsIdentity,
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
    // Absent when replaying a guest upgrade recorded before media assets merged.
    mediaAssetIds?: ReadonlyArray<string>;
  }>;
}>;

type GuestAuthRoutesOptions = Readonly<{
  authenticateRequestFn?: typeof authenticateRequest;
  createGuestSessionFn?: typeof createGuestSession;
  completeGuestUpgradeFn?: typeof completeGuestUpgrade;
  deleteGuestSessionFn?: typeof deleteGuestSession;
  linkGuestAnalyticsIdentityFn?: typeof linkGuestAnalyticsIdentity;
}>;

type GuestSessionCreateRequest = Readonly<{
  platform: GuestSessionPlatform | null;
  idempotencyKey: string | null;
}>;

// Rotation makes this key an effective bearer credential for one guest identity: whoever presents it
// is handed a fresh valid token for that guest's user and workspace. That only holds while the key
// is unguessable and per attempt, so the accepted shape is the shape of a random token: lowercase
// hex, at least 128 bits of it. The check is a floor, not a guarantee. It rejects the obviously
// non-random values — a fixed label, a device or install id in canonical UUID form — but it cannot
// tell a random token from the same install id with its hyphens stripped, or from any other 32-char
// lowercase-hex constant. Per-attempt randomness and dropping the key once the attempt succeeds stay
// client obligations, stated for the client work in `docs/auth-service.md`. The upper bound keeps
// the column from being used as storage. Beyond this shape the backend only ever compares the value.
const guestSessionIdempotencyKeyMinimumLength = 32;
const guestSessionIdempotencyKeyMaximumLength = 200;
const guestSessionIdempotencyKeyPattern = /^[0-9a-f]+$/;

function parseGuestSessionPlatformValue(value: unknown): GuestSessionPlatform | null {
  if (value === undefined) {
    // Pre-1.7.0 iOS/Android clients create guest sessions without platform.
    // Keep this unbound legacy path until those mobile versions are no longer supported.
    return null;
  }

  if (typeof value !== "string") {
    throw new HttpError(400, "platform must be ios, android, or web", "GUEST_SESSION_PLATFORM_INVALID");
  }

  // A web guest session is an analytics credential and nothing more: guest sync stays refused for it
  // in routes/sync/guestPlatform.ts, so issuing one never opens cloud sync to a signed-out browser.
  const platform = value.trim();
  if (platform === "ios" || platform === "android" || platform === "web") {
    return platform;
  }

  throw new HttpError(400, "platform must be ios, android, or web", "GUEST_SESSION_PLATFORM_INVALID");
}

/**
 * Reads the optional idempotency key of one guest session creation attempt.
 *
 * The key is opaque: beyond the token shape asserted here it is never trimmed, parsed, echoed back
 * or logged, because the only other thing the backend does with it is compare it. Clients must
 * generate it from a cryptographic random source once per creation attempt and drop it once that
 * attempt succeeds; `docs/auth-service.md` states that obligation for the client work that calls
 * this route. The shape check narrows the room for getting that wrong — a key derived from an
 * install id or a fixed label would be a stable, guessable credential for the guest identity it
 * names — but it cannot enforce the obligation, because a stable value can still be hex. An absent
 * key keeps the behaviour every shipped client relies on, which is a fresh guest identity per call.
 */
function parseGuestSessionIdempotencyKeyValue(value: unknown): string | null {
  // An explicit JSON null means absent, not invalid. Serializers that encode unset optional fields
  // rather than omitting them — kotlinx.serialization does by default — send it on every no-key
  // call, and that path must stay the shipped-client behaviour instead of a 400.
  if (value === undefined || value === null) {
    return null;
  }

  if (
    typeof value !== "string"
    || value.length < guestSessionIdempotencyKeyMinimumLength
    || value.length > guestSessionIdempotencyKeyMaximumLength
    || !guestSessionIdempotencyKeyPattern.test(value)
  ) {
    throw new HttpError(
      400,
      `idempotencyKey must be ${guestSessionIdempotencyKeyMinimumLength} to ${guestSessionIdempotencyKeyMaximumLength} lowercase hexadecimal characters generated randomly for one creation attempt`,
      "GUEST_SESSION_IDEMPOTENCY_KEY_INVALID",
    );
  }

  return value;
}

async function parseGuestSessionCreateRequest(request: Request): Promise<GuestSessionCreateRequest> {
  const rawBody = await request.text();
  if (rawBody.trim() === "") {
    // Pre-1.7.0 iOS/Android clients create guest sessions with an empty body.
    // Keep this unbound legacy path until those mobile versions are no longer supported.
    return { platform: null, idempotencyKey: null };
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody) as unknown;
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }

  const body = expectRecord(parsedBody);
  return {
    platform: parseGuestSessionPlatformValue(body.platform),
    idempotencyKey: parseGuestSessionIdempotencyKeyValue(body.idempotencyKey),
  };
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
  clientAppVersion: string | null,
  clientPlatform: string | null,
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
    clientAppVersion,
    clientPlatform,
  );
}

export function createGuestAuthRoutes(options: GuestAuthRoutesOptions = {}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const authenticateRequestFn = options.authenticateRequestFn ?? authenticateRequest;
  const createGuestSessionFn = options.createGuestSessionFn ?? createGuestSession;
  const completeGuestUpgradeFn = options.completeGuestUpgradeFn ?? completeGuestUpgrade;
  const deleteGuestSessionFn = options.deleteGuestSessionFn ?? deleteGuestSession;
  const linkGuestAnalyticsIdentityFn = options.linkGuestAnalyticsIdentityFn ?? linkGuestAnalyticsIdentity;

  app.post("/guest-auth/session", async (context) => {
    const createRequest = await parseGuestSessionCreateRequest(context.req.raw);
    const session = await createGuestSessionFn(createRequest.platform, createRequest.idempotencyKey);
    return context.json({
      guestToken: session.guestToken,
      userId: session.userId,
      workspaceId: session.workspaceId,
    } satisfies GuestSessionEnvelope);
  });

  // Claims a guest identity's analytics history for the account that just signed in on this browser
  // or install. The guest token travels in the body, like the upgrade routes, because the request is
  // authenticated as the account rather than as the guest.
  //
  // A `web` guest platform is accepted on purpose. The default-deny gate in
  // server/requestContext.ts reads the credential on the request, which here is the account's, and a
  // web guest is exactly what this route exists to claim.
  //
  // Like the upgrade routes, this one never loads a request context, so the 410 ACCOUNT_DELETED gate
  // that requestContext.ts applies elsewhere is not reached here. The Cognito subject is therefore
  // passed to the writer, which takes the identity lifecycle lock and asserts the subject is not
  // deleted inside its own transaction.
  app.post("/guest-auth/identity/link", async (context) => {
    const auth = await authenticateRequestFn(toAuthRequest(extractRequestAuthInputs(context.req.raw)));
    if (auth.transport !== "bearer" && auth.transport !== "session") {
      throw new HttpError(
        403,
        "Sign in before linking this guest identity.",
        "GUEST_IDENTITY_LINK_HUMAN_AUTH_REQUIRED",
      );
    }

    const body = expectRecord(await parseJsonBody(context.req.raw));
    const guestToken = expectNonEmptyString(body.guestToken, "guestToken");
    // Only the Cognito subject is passed on. The account user id behind it is resolved inside the
    // writer's transaction under the identity lifecycle lock, exactly as the upgrade routes resolve
    // their target, because auth.userId falls back to the raw subject when no mapping exists yet.
    await linkGuestAnalyticsIdentityFn(guestToken, auth.subjectUserId);
    return context.json({ ok: true } as const);
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
        scope: createGuestUpgradeScope(requestId, context.req.path, context.req.method, result.targetUserId, context.get("clientAppVersion"), context.get("clientPlatform")),
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
      const scope = createGuestUpgradeScope(requestId, context.req.path, context.req.method, auth.userId, context.get("clientAppVersion"), context.get("clientPlatform"));
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
