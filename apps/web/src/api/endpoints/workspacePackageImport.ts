import {
  parseWorkspacePackageImportConfirmResponse,
  parseWorkspacePackageImportPreviewResponse,
} from "../../apiContracts/workspacePackageImport";
import type {
  WorkspacePackageImportConfirmOptions,
  WorkspacePackageImportConfirmResponse,
  WorkspacePackageImportPreviewResponse,
} from "../../types";
import { parseContractResponse } from "../transport/response";
import { allowAuthRecovery, requestJson } from "../transport/transport";

export async function previewWorkspacePackageImport(
  workspaceId: string,
  fileOrBlob: Blob,
): Promise<WorkspacePackageImportPreviewResponse> {
  return parseContractResponse(await requestJson(`/workspaces/${workspaceId}/packages/import/preview`, {
    method: "POST",
    headers: {
      "Content-Type": "application/zip",
    },
    body: fileOrBlob,
  }, allowAuthRecovery), `POST /workspaces/${workspaceId}/packages/import/preview`, parseWorkspacePackageImportPreviewResponse);
}

export async function confirmWorkspacePackageImport(
  workspaceId: string,
  file: File,
  options: WorkspacePackageImportConfirmOptions,
): Promise<WorkspacePackageImportConfirmResponse> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("options", JSON.stringify(options));

  return parseContractResponse(await requestJson(`/workspaces/${workspaceId}/packages/import`, {
    method: "POST",
    body: formData,
  }, allowAuthRecovery), `POST /workspaces/${workspaceId}/packages/import`, parseWorkspacePackageImportConfirmResponse);
}
