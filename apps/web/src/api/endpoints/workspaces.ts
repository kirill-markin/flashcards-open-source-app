import {
  parseDeleteWorkspaceResponse,
  parseResetWorkspaceProgressResponse,
  parseWorkspaceDeletePreviewResponse,
  parseWorkspaceEnvelopeResponse,
  parseWorkspaceResetProgressPreviewResponse,
  parseWorkspacesEnvelopeResponse,
} from "../../apiContracts/account";
import type {
  DeleteWorkspaceResponse,
  ResetWorkspaceProgressResponse,
  WorkspaceDeletePreview,
  WorkspaceResetProgressPreview,
  WorkspaceSummary,
} from "../../types";
import { parseContractResponse } from "../transport/response";
import {
  allowAuthRecovery,
  allowAuthRecoveryWithTransientNetworkRetry,
  requestJson,
} from "../transport/transport";

const collectionPageLimit = 100;

export async function listWorkspaces(): Promise<ReadonlyArray<WorkspaceSummary>> {
  const workspaces: Array<WorkspaceSummary> = [];
  let nextCursor: string | null = null;

  do {
    const searchParams = new URLSearchParams({
      limit: String(collectionPageLimit),
    });
    if (nextCursor !== null) {
      searchParams.set("cursor", nextCursor);
    }

    const payload = parseContractResponse(
      await requestJson(
        `/workspaces?${searchParams.toString()}`,
        { method: "GET" },
        allowAuthRecoveryWithTransientNetworkRetry,
      ),
      "GET /workspaces",
      parseWorkspacesEnvelopeResponse,
    );
    workspaces.push(...payload.workspaces);
    nextCursor = payload.nextCursor;
  } while (nextCursor !== null);

  return workspaces;
}

export async function createWorkspace(name: string): Promise<WorkspaceSummary> {
  const payload = parseContractResponse(await requestJson("/workspaces", {
    method: "POST",
    body: JSON.stringify({ name }),
  }, allowAuthRecovery), "POST /workspaces", parseWorkspaceEnvelopeResponse);
  return payload.workspace;
}

export async function selectWorkspace(workspaceId: string): Promise<WorkspaceSummary> {
  const payload = parseContractResponse(await requestJson(`/workspaces/${workspaceId}/select`, {
    method: "POST",
  }, allowAuthRecovery), `POST /workspaces/${workspaceId}/select`, parseWorkspaceEnvelopeResponse);
  return payload.workspace;
}

export async function renameWorkspace(workspaceId: string, name: string): Promise<WorkspaceSummary> {
  const payload = parseContractResponse(await requestJson(`/workspaces/${workspaceId}/rename`, {
    method: "POST",
    body: JSON.stringify({ name }),
  }, allowAuthRecovery), `POST /workspaces/${workspaceId}/rename`, parseWorkspaceEnvelopeResponse);
  return payload.workspace;
}

export async function loadWorkspaceDeletePreview(workspaceId: string): Promise<WorkspaceDeletePreview> {
  return parseContractResponse(await requestJson(`/workspaces/${workspaceId}/delete-preview`, {
    method: "GET",
  }, allowAuthRecovery), `GET /workspaces/${workspaceId}/delete-preview`, parseWorkspaceDeletePreviewResponse);
}

export async function deleteWorkspace(workspaceId: string, confirmationText: string): Promise<DeleteWorkspaceResponse> {
  return parseContractResponse(await requestJson(`/workspaces/${workspaceId}/delete`, {
    method: "POST",
    body: JSON.stringify({ confirmationText }),
  }, allowAuthRecovery), `POST /workspaces/${workspaceId}/delete`, parseDeleteWorkspaceResponse);
}

export async function loadWorkspaceResetProgressPreview(
  workspaceId: string,
): Promise<WorkspaceResetProgressPreview> {
  return parseContractResponse(
    await requestJson(`/workspaces/${workspaceId}/reset-progress-preview`, {
      method: "GET",
    }, allowAuthRecovery),
    `GET /workspaces/${workspaceId}/reset-progress-preview`,
    parseWorkspaceResetProgressPreviewResponse,
  );
}

export async function resetWorkspaceProgress(
  workspaceId: string,
  confirmationText: string,
): Promise<ResetWorkspaceProgressResponse> {
  return parseContractResponse(
    await requestJson(`/workspaces/${workspaceId}/reset-progress`, {
      method: "POST",
      body: JSON.stringify({ confirmationText }),
    }, allowAuthRecovery),
    `POST /workspaces/${workspaceId}/reset-progress`,
    parseResetWorkspaceProgressResponse,
  );
}
