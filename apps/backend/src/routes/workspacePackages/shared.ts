import { z } from "zod";
import {
  createBackendObservationScope,
  type BackendObservationScope,
} from "../../observability/sentry";
import type { RequestContext } from "../../server/requestContext";
import type { HttpErrorDetails, ValidationIssueSummary } from "../../shared/errors";

function summarizeValidationPath(path: ReadonlyArray<PropertyKey>): string {
  if (path.length === 0) {
    return "<root>";
  }

  return path.join(".");
}

function summarizeValidationIssue(issue: z.core.$ZodIssue): ValidationIssueSummary {
  return {
    path: summarizeValidationPath(issue.path),
    code: issue.code,
    message: issue.message,
  };
}

export function summarizeValidationDetails(error: z.ZodError): HttpErrorDetails {
  return {
    validationIssues: error.issues.map(summarizeValidationIssue),
  };
}

export function getRequestContextUserId(requestContext: RequestContext | null): string | null {
  return requestContext === null ? null : requestContext.userId;
}

export function createWorkspacePackageScope(
  requestId: string,
  route: string,
  method: string,
  userId: string | null,
  workspaceId: string | null,
  clientAppVersion: string | null,
  clientPlatform: string | null,
): BackendObservationScope {
  return createBackendObservationScope(
    "backend-api",
    requestId,
    route,
    method,
    userId,
    workspaceId,
    null,
    null,
    null,
    clientAppVersion,
    clientPlatform,
  );
}
