import { ApiContractError } from "../../apiContracts/core";
import {
  parseWorkspaceAnkiExportDownload,
  parseWorkspacePackageExportDownloadMetadata,
  parseWorkspacePackageExportPreviewResponse,
} from "../../apiContracts/workspacePackageExport";
import {
  workspaceAnkiExportContentType,
  workspaceAnkiExportFilename,
  type WorkspacePackageExportDownloadResult,
  type WorkspacePackageExportPreviewResponse,
  type WorkspacePackageExportRequest,
} from "../../types";
import { parseContractResponse, readJsonResponse } from "../transport/response";
import { allowAuthRecovery, requestBlob, requestJson } from "../transport/transport";
import { waitForTransportDelay } from "../transport/transportSignals";

const signedAnkiDownloadMaximumAttemptCount = 2;

class SignedAnkiDownloadError extends Error {
  constructor(message: string, readonly statusCode: number | null) {
    super(message);
    this.name = "SignedAnkiDownloadError";
  }
}

export async function previewWorkspacePackageExport(
  workspaceId: string,
  request: WorkspacePackageExportRequest,
  signal: AbortSignal,
): Promise<WorkspacePackageExportPreviewResponse> {
  return parseContractResponse(await requestJson(`/workspaces/${workspaceId}/packages/export/preview`, {
    method: "POST",
    body: JSON.stringify(request),
    signal,
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

function readMimeType(headers: Headers): string | undefined {
  return headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase();
}

async function fetchSignedAnkiExportOnce(downloadUrl: string, signal: AbortSignal): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(downloadUrl, {
      method: "GET",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      redirect: "error",
      signal,
    });
  } catch {
    signal.throwIfAborted();
    throw new SignedAnkiDownloadError("Could not reach the Anki export download server.", null);
  }

  if (response.status !== 200) {
    throw new SignedAnkiDownloadError(
      `The Anki export download server returned HTTP ${response.status}`,
      response.status,
    );
  }

  if (readMimeType(response.headers) !== workspaceAnkiExportContentType) {
    throw new ApiContractError("Anki export download", "Content-Type", workspaceAnkiExportContentType);
  }

  try {
    return await response.blob();
  } catch {
    signal.throwIfAborted();
    throw new SignedAnkiDownloadError("Could not read the Anki export file.", null);
  }
}

function isRetryableSignedAnkiDownloadError(error: unknown): error is SignedAnkiDownloadError {
  if (!(error instanceof SignedAnkiDownloadError)) {
    return false;
  }

  const { statusCode } = error;
  return statusCode === null || statusCode === 408 || statusCode === 429 || statusCode >= 500;
}

async function fetchSignedAnkiExport(downloadUrl: string, signal: AbortSignal): Promise<Blob> {
  for (let attemptCount = 1; ; attemptCount += 1) {
    try {
      return await fetchSignedAnkiExportOnce(downloadUrl, signal);
    } catch (error) {
      if (!isRetryableSignedAnkiDownloadError(error) || attemptCount >= signedAnkiDownloadMaximumAttemptCount) {
        throw error;
      }

      console.warn("Anki export download retry", { attemptCount, statusCode: error.statusCode });
      await waitForTransportDelay(500, signal);
    }
  }
}

export async function downloadWorkspaceAnkiExport(
  workspaceId: string,
  request: WorkspacePackageExportRequest,
  signal: AbortSignal,
): Promise<WorkspacePackageExportDownloadResult> {
  const path = `/workspaces/${workspaceId}/packages/export/anki`;
  const endpoint = `POST ${path}`;
  const response = await requestBlob(path, {
    method: "POST",
    headers: {
      Accept: `${workspaceAnkiExportContentType}, application/json`,
    },
    body: JSON.stringify(request),
    signal,
  }, allowAuthRecovery);
  if (response.statusCode !== 200) {
    throw new ApiContractError(endpoint, "HTTP status", "200");
  }

  const contentType = readMimeType(response.headers);
  if (contentType === workspaceAnkiExportContentType) {
    return { blob: response.blob, filename: workspaceAnkiExportFilename, contentType };
  }

  if (contentType !== "application/json") {
    throw new ApiContractError(endpoint, "Content-Type", `${workspaceAnkiExportContentType} or application/json`);
  }

  const payload = await readJsonResponse(new Response(response.blob, {
    headers: response.headers,
    status: response.statusCode,
  }));
  const { downloadUrl, filename, contentType: downloadContentType } = parseContractResponse(
    payload,
    endpoint,
    parseWorkspaceAnkiExportDownload,
  );
  const blob = await fetchSignedAnkiExport(downloadUrl, signal);
  return { blob, filename, contentType: downloadContentType };
}
