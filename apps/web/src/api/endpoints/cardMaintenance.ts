import { combineAbortSignals } from "../../abortSignals";
import {
  parseCardMaintenancePreview,
  parseCardMaintenanceReconciliation,
  parseCardMaintenanceResult,
  type CardMaintenanceExecution,
  type CardMaintenancePreview,
  type CardMaintenanceResult,
  type CardMaintenanceTarget,
} from "../../apiContracts/cardMaintenance";
import { parseContractResponse } from "../transport/response";
import { allowAuthRecovery, allowAuthRecoveryWithTransientNetworkRetry, requestJson } from "../transport/transport";

const cardMaintenanceRequestTimeoutMs = 35 * 1000;

export async function loadCardMaintenancePreview(
  workspaceId: string,
  userId: string,
  target: CardMaintenanceTarget,
): Promise<CardMaintenancePreview> {
  const path = `/workspaces/${workspaceId}/card-maintenance/preview`;
  return parseContractResponse(
    await requestJson(path, {
      method: "POST",
      body: JSON.stringify(target),
    }, { ...allowAuthRecoveryWithTransientNetworkRetry, expectedUserId: userId }),
    `POST ${path}`,
    parseCardMaintenancePreview,
  );
}

export async function executeCardMaintenance(
  workspaceId: string,
  userId: string,
  execution: CardMaintenanceExecution,
): Promise<CardMaintenanceResult> {
  const path = `/workspaces/${workspaceId}/card-maintenance/execute`;
  return parseContractResponse(
    await requestJson(path, {
      method: "POST",
      body: JSON.stringify(execution),
      signal: AbortSignal.timeout(cardMaintenanceRequestTimeoutMs),
    }, { ...allowAuthRecovery, authRecoveryMode: "skip", expectedUserId: userId }),
    `POST ${path}`,
    parseCardMaintenanceResult,
  );
}

export async function reconcileCardMaintenance(
  workspaceId: string,
  userId: string,
  previewFingerprint: string,
  signal: AbortSignal,
): Promise<boolean> {
  const path = `/workspaces/${workspaceId}/card-maintenance/reconcile`;
  const request = combineAbortSignals([signal, AbortSignal.timeout(cardMaintenanceRequestTimeoutMs)]);
  try {
    return parseContractResponse(
      await requestJson(path, {
        method: "POST",
        body: JSON.stringify({ previewFingerprint }),
        signal: request.signal,
      }, { ...allowAuthRecoveryWithTransientNetworkRetry, expectedUserId: userId }),
      `POST ${path}`,
      parseCardMaintenanceReconciliation,
    );
  } finally {
    request.dispose();
  }
}
