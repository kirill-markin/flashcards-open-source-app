import {
  parseWorkspacePackageExportDownloadMetadata,
  parseWorkspacePackageExportPreviewResponse,
} from "../../apiContracts/workspacePackageExport";
import type {
  WorkspacePackageExportDownloadResult,
  WorkspacePackageExportPreviewResponse,
  WorkspacePackageExportRequest,
} from "../../types";
import { parseContractResponse } from "../transport/response";
import { allowAuthRecovery, requestBlob, requestJson } from "../transport/transport";

export async function previewWorkspacePackageExport(
  workspaceId: string,
  request: WorkspacePackageExportRequest,
): Promise<WorkspacePackageExportPreviewResponse> {
  return parseContractResponse(await requestJson(`/workspaces/${workspaceId}/packages/export/preview`, {
    method: "POST",
    body: JSON.stringify(request),
  }, allowAuthRecovery), `POST /workspaces/${workspaceId}/packages/export/preview`, parseWorkspacePackageExportPreviewResponse);
}

export async function downloadWorkspacePackageExport(
  workspaceId: string,
  request: WorkspacePackageExportRequest,
): Promise<WorkspacePackageExportDownloadResult> {
  const response = await requestBlob(`/workspaces/${workspaceId}/packages/export`, {
    method: "POST",
    headers: {
      Accept: "application/zip",
    },
    body: JSON.stringify(request),
  }, allowAuthRecovery);
  return {
    blob: response.blob,
    ...parseWorkspacePackageExportDownloadMetadata(response.headers),
  };
}
