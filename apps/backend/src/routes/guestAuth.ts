import { Hono } from "hono";
import { authenticateRequest } from "../auth";
import { HttpError } from "../errors";
import {
  completeGuestUpgrade,
  createGuestSession,
  prepareGuestUpgrade,
  type GuestUpgradeSelection,
} from "../guestAuth";
import {
  expectNonEmptyString,
  expectRecord,
  parseJsonBody,
} from "../server/requestParsing";
import { logCloudRouteEvent, summarizeValidationIssues } from "../server/logging";
import { extractRequestAuthInputs, toAuthRequest } from "../requestSecurity";
import type { AppEnv } from "../app";

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
}>;

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

export function createGuestAuthRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/guest-auth/session", async (context) => {
    const session = await createGuestSession();
    return context.json({
      guestToken: session.guestToken,
      userId: session.userId,
      workspaceId: session.workspaceId,
    } satisfies GuestSessionEnvelope);
  });

  app.post("/guest-auth/upgrade/prepare", async (context) => {
    const auth = await authenticateRequest(toAuthRequest(extractRequestAuthInputs(context.req.raw)));
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
    const auth = await authenticateRequest(toAuthRequest(extractRequestAuthInputs(context.req.raw)));
    if (auth.transport !== "bearer" && auth.transport !== "session") {
      throw new HttpError(403, "Sign in before upgrading this guest session.", "GUEST_UPGRADE_HUMAN_AUTH_REQUIRED");
    }

    const requestId = context.get("requestId");
    const body = expectRecord(await parseJsonBody(context.req.raw));
    const guestToken = expectNonEmptyString(body.guestToken, "guestToken");
    const selection = parseGuestUpgradeSelection(body.selection);

    try {
      const result = await completeGuestUpgrade(guestToken, auth.subjectUserId, selection);
      logCloudRouteEvent("guest_upgrade_complete", {
        requestId,
        route: context.req.path,
        statusCode: 200,
        selectionType: selection.type,
        targetSubjectUserId: result.targetSubjectUserId,
        guestSessionId: result.guestSessionId,
        targetUserId: result.targetUserId,
        targetWorkspaceId: result.targetWorkspaceId,
        completionKind: result.outcome,
      }, false);

      return context.json({
        workspace: result.workspace,
      } satisfies GuestUpgradeCompleteEnvelope);
    } catch (error) {
      logCloudRouteEvent("guest_upgrade_complete_error", {
        requestId,
        route: context.req.path,
        statusCode: error instanceof HttpError ? error.statusCode : 500,
        selectionType: selection.type,
        targetSubjectUserId: auth.subjectUserId,
        code: error instanceof HttpError ? error.code : "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : String(error),
        validationIssues: summarizeValidationIssues(error),
      }, true);
      throw error;
    }
  });

  return app;
}
