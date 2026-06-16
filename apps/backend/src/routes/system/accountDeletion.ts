import type { Hono } from "hono";
import { authenticateRequest } from "../../auth";
import { deleteAccountForAuthenticatedUser } from "../../auth/accountDeletion";
import {
  enforceSessionCsrfProtection,
  extractRequestAuthInputs,
  toAuthRequest,
} from "../../auth/requestSecurity";
import { createBackendFailureDetails } from "../../server/logging";
import { expectRecord, parseJsonBody } from "../../server/requestParsing";
import {
  addBackendBreadcrumb,
  normalizeCaughtError,
} from "../../observability/sentry";
import { reportBackendExceptionOrBreadcrumb } from "../../observability/reporting";
import type { AppEnv } from "../../server/app";
import { HttpError } from "../../shared/errors";
import { createSystemScope } from "./support";

type AccountDeletionRoutesOptions = Readonly<{
  allowedOrigins: ReadonlyArray<string>;
}>;

export function registerAccountDeletionRoute(
  app: Hono<AppEnv>,
  options: AccountDeletionRoutesOptions,
): void {
  app.post("/me/delete", async (context) => {
    const requestId = context.get("requestId");
    const requestAuthInputs = extractRequestAuthInputs(context.req.raw);
    const auth = await authenticateRequest(toAuthRequest(requestAuthInputs));

    if (auth.transport === "session") {
      await enforceSessionCsrfProtection(context.req.method, requestAuthInputs, options.allowedOrigins);
    }

    if (auth.transport !== "session" && auth.transport !== "bearer") {
      throw new HttpError(
        403,
        "Delete account requires a signed-in human session.",
        "ACCOUNT_DELETE_HUMAN_AUTH_REQUIRED",
      );
    }

    const body = expectRecord(await parseJsonBody(context.req.raw));
    if (typeof body.confirmationText !== "string") {
      throw new HttpError(
        400,
        "confirmationText must be a string",
        "ACCOUNT_DELETE_CONFIRMATION_INVALID",
      );
    }

    try {
      await deleteAccountForAuthenticatedUser({
        appUserId: auth.userId,
        authSubjectUserId: auth.subjectUserId,
        email: auth.email,
        cognitoUsername: auth.cognitoUsername,
        confirmationText: body.confirmationText,
      });
      addBackendBreadcrumb({
        action: "account_delete",
        scope: createSystemScope(requestId, context.req.path, context.req.method, auth.userId),
        details: {
          statusCode: 200,
          transport: auth.transport,
        },
      });
      return context.json({ ok: true } as const);
    } catch (error) {
      const scope = createSystemScope(requestId, context.req.path, context.req.method, auth.userId);
      const details = {
        transport: auth.transport,
        ...createBackendFailureDetails(error),
      };
      reportBackendExceptionOrBreadcrumb(
        error,
        { action: "account_delete_error", error: normalizeCaughtError(error), scope, details },
        { action: "account_delete_error", scope, details },
      );
      throw error;
    }
  });
}
