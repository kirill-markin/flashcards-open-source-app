import {
  createBackendObservationScope,
  type BackendObservationScope,
} from "../../observability/sentry";
import type { RequestContext } from "../../server/requestContext";

export function getRequestContextUserId(requestContext: RequestContext | null): string | null {
  return requestContext === null ? null : requestContext.userId;
}

export function createWorkspaceRouteScope(
  requestId: string,
  route: string,
  method: string,
  userId: string | null,
  workspaceId: string | null,
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
  );
}
