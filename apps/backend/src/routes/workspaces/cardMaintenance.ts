import { Hono } from "hono";
import type { AppEnv } from "../../server/app";
import { loadRequestContextFromRequest, parseWorkspaceIdParam } from "../../server/requestContext";
import { expectRecord, expectUuidString, parseJsonBody } from "../../server/requestParsing";
import { HttpError } from "../../shared/errors";
import {
  executeCardMaintenanceForUser,
  parseCardMaintenancePreviewFingerprint,
  previewCardMaintenanceForUser,
  reconcileCardMaintenanceForUser,
  type CardMaintenanceInput,
} from "../../workspaces/cardMaintenance";
import { requireHumanManagedConnectionAccess } from "./connectionAccess";

function parseCardMaintenanceInput(body: Readonly<Record<string, unknown>>): CardMaintenanceInput {
  switch (body.kind) {
    case "resetCard":
    case "resetDeck":
      return { kind: body.kind, target: expectUuidString(body.target, "target") };
    case "resetTag":
    case "removeTag":
      if (typeof body.target !== "string" || body.target.trim() === "" || body.target.includes("\0")) {
        throw new HttpError(400, "target must be a valid, non-empty tag spelling", "CARD_MAINTENANCE_INPUT_INVALID");
      }
      return { kind: body.kind, target: body.target };
    default:
      throw new HttpError(400, "kind must be resetCard, resetDeck, resetTag, or removeTag", "CARD_MAINTENANCE_INPUT_INVALID");
  }
}

export function createCardMaintenanceRoutes(
  allowedOrigins: ReadonlyArray<string>,
  loadRequestContext: typeof loadRequestContextFromRequest,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/workspaces/:workspaceId/card-maintenance/preview", async (context) => {
    const { requestContext } = await loadRequestContext(context.req.raw, allowedOrigins);
    requireHumanManagedConnectionAccess(requestContext.transport);
    const workspaceId = parseWorkspaceIdParam(context.req.param("workspaceId"));
    const input = parseCardMaintenanceInput(expectRecord(await parseJsonBody(context.req.raw)));
    const preview = await previewCardMaintenanceForUser(requestContext.userId, workspaceId, input);
    return context.json(preview);
  });

  app.post("/workspaces/:workspaceId/card-maintenance/execute", async (context) => {
    const { requestContext } = await loadRequestContext(context.req.raw, allowedOrigins);
    requireHumanManagedConnectionAccess(requestContext.transport);
    const workspaceId = parseWorkspaceIdParam(context.req.param("workspaceId"));
    const body = expectRecord(await parseJsonBody(context.req.raw));
    const input = parseCardMaintenanceInput(body);
    if (typeof body.confirmationText !== "string") {
      throw new HttpError(400, "confirmationText must be a string", "CARD_MAINTENANCE_CONFIRMATION_INVALID");
    }
    const result = await executeCardMaintenanceForUser(requestContext.userId, workspaceId, {
      ...input,
      confirmationText: body.confirmationText,
      previewFingerprint: parseCardMaintenancePreviewFingerprint(body.previewFingerprint),
    });
    return context.json(result);
  });

  app.post("/workspaces/:workspaceId/card-maintenance/reconcile", async (context) => {
    const { requestContext } = await loadRequestContext(context.req.raw, allowedOrigins);
    requireHumanManagedConnectionAccess(requestContext.transport);
    const workspaceId = parseWorkspaceIdParam(context.req.param("workspaceId"));
    const body = expectRecord(await parseJsonBody(context.req.raw));
    const result = await reconcileCardMaintenanceForUser(
      requestContext.userId,
      workspaceId,
      parseCardMaintenancePreviewFingerprint(body.previewFingerprint),
    );
    return context.json(result);
  });

  return app;
}
