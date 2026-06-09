import {
  createBackendObservationScope,
  type BackendObservationScope,
  type SyncPullDetails,
  type SyncReviewHistoryPullDetails,
} from "../../observability/sentry";
import type { RequestContext } from "../../server/requestContext";
import {
  type SyncPullInput,
  type SyncReviewHistoryPullInput,
} from "../../sync";

export function getRequestContextUserId(requestContext: RequestContext | null): string | null {
  return requestContext === null ? null : requestContext.userId;
}

export function getSyncPullInputDetails(
  input: SyncPullInput | null,
): Pick<SyncPullDetails, "installationId" | "platform" | "appVersion" | "afterHotChangeId"> {
  if (input === null) {
    return {
      installationId: null,
      platform: null,
      appVersion: null,
      afterHotChangeId: null,
    };
  }

  return {
    installationId: input.installationId,
    platform: input.platform,
    appVersion: input.appVersion ?? null,
    afterHotChangeId: input.afterHotChangeId,
  };
}

export function getSyncReviewHistoryPullInputDetails(
  input: SyncReviewHistoryPullInput | null,
): Pick<SyncReviewHistoryPullDetails, "installationId" | "platform" | "appVersion" | "afterReviewSequenceId"> {
  if (input === null) {
    return {
      installationId: null,
      platform: null,
      appVersion: null,
      afterReviewSequenceId: null,
    };
  }

  return {
    installationId: input.installationId,
    platform: input.platform,
    appVersion: input.appVersion ?? null,
    afterReviewSequenceId: input.afterReviewSequenceId,
  };
}

export function createSyncScope(
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
