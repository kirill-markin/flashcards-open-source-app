import {
  parseChatSessionArchiveResponse,
  parseChatSessionRenameResponse,
  parseChatSessionSnapshotResponse,
  parseChatSessionsListResponse,
  parseChatTranscriptionResponse,
  parseNewChatSessionResponse,
  parseStartChatRunResponse,
  parseStopChatRunResponse,
} from "../../apiContracts/chat";
import {
  OWN_OPENAI_KEY_HEADER_NAME,
  readActiveOwnOpenAIKey,
} from "../../chat/preferences/ownOpenAIKeyStorage";
import { webAppVersion } from "../../clientIdentity";
import type { Locale } from "../../i18n/types";
import type {
  ChatSessionArchiveResponse,
  ChatSessionHistorySummary,
  ChatSessionSnapshot,
  ChatSessionsListResponse,
  ChatTranscriptionResponse,
  ChatTranscriptionSource,
  NewChatSessionRequestBody,
  NewChatSessionResponse,
  StartChatRunRequestBody,
  StartChatRunResponse,
  StopChatRunRequestBody,
  StopChatRunResponse,
} from "../../types";
import { ApiError } from "../transport/errors";
import { parseContractResponse } from "../transport/response";
import {
  allowAuthRecovery,
  allowAuthRecoveryWithTransientNetworkRetry,
  requestJson,
} from "../transport/transport";

type ChatResumeRequestDiagnostics = Readonly<{
  resumeAttemptId: number;
}>;

const CHAT_SESSIONS_PAGE_LIMIT = 20;
const START_CHAT_RUN_GATEWAY_TIMEOUT_MAXIMUM_ATTEMPT_COUNT = 3;

function buildOwnOpenAIKeyHeaders(): Record<string, string> {
  const ownOpenAIKey = readActiveOwnOpenAIKey();
  return ownOpenAIKey === null ? {} : { [OWN_OPENAI_KEY_HEADER_NAME]: ownOpenAIKey };
}

function buildChatSnapshotPath(sessionId: string, workspaceId: string): string {
  const searchParams = new URLSearchParams({
    sessionId,
    workspaceId,
  });
  return `/chat?${searchParams.toString()}`;
}

export async function getChatSnapshot(
  sessionId: string,
  workspaceId: string,
  signal: AbortSignal,
): Promise<ChatSessionSnapshot> {
  return parseContractResponse(await requestJson(buildChatSnapshotPath(sessionId, workspaceId), {
    method: "GET",
    signal,
  }, allowAuthRecoveryWithTransientNetworkRetry), "GET /chat", parseChatSessionSnapshotResponse);
}

export async function getChatSnapshotWithResumeDiagnostics(
  sessionId: string,
  workspaceId: string,
  diagnostics: ChatResumeRequestDiagnostics,
  signal: AbortSignal,
): Promise<ChatSessionSnapshot> {
  return parseContractResponse(await requestJson(buildChatSnapshotPath(sessionId, workspaceId), {
    method: "GET",
    headers: {
      "X-Chat-Resume-Attempt-Id": String(diagnostics.resumeAttemptId),
      "X-Client-Platform": "web",
      "X-Client-Version": webAppVersion,
    },
    signal,
  }, allowAuthRecoveryWithTransientNetworkRetry), "GET /chat", parseChatSessionSnapshotResponse);
}

export async function listChatSessions(
  workspaceId: string,
  cursor: string | null,
  searchText: string | null,
  signal: AbortSignal,
): Promise<ChatSessionsListResponse> {
  const searchParams = new URLSearchParams({
    workspaceId,
    limit: String(CHAT_SESSIONS_PAGE_LIMIT),
  });
  if (cursor !== null) {
    searchParams.set("cursor", cursor);
  }
  if (searchText !== null) {
    searchParams.set("q", searchText);
  }

  return parseContractResponse(await requestJson(`/chat/sessions?${searchParams.toString()}`, {
    method: "GET",
    signal,
  }, allowAuthRecoveryWithTransientNetworkRetry), "GET /chat/sessions", parseChatSessionsListResponse);
}

function buildChatSessionActionPath(sessionId: string, workspaceId: string, action: "rename" | "archive"): string {
  const searchParams = new URLSearchParams({
    workspaceId,
  });
  return `/chat/sessions/${encodeURIComponent(sessionId)}/${action}?${searchParams.toString()}`;
}

export async function renameChatSession(
  sessionId: string,
  workspaceId: string,
  title: string,
): Promise<ChatSessionHistorySummary> {
  return parseContractResponse(await requestJson(buildChatSessionActionPath(sessionId, workspaceId, "rename"), {
    method: "POST",
    body: JSON.stringify({ title }),
  }, allowAuthRecoveryWithTransientNetworkRetry), "POST /chat/sessions/:sessionId/rename", parseChatSessionRenameResponse);
}

/**
 * Not retried: a repeated archive of the same chat answers 404.
 */
export async function archiveChatSession(
  sessionId: string,
  workspaceId: string,
): Promise<ChatSessionArchiveResponse> {
  return parseContractResponse(await requestJson(buildChatSessionActionPath(sessionId, workspaceId, "archive"), {
    method: "POST",
  }, allowAuthRecovery), "POST /chat/sessions/:sessionId/archive", parseChatSessionArchiveResponse);
}

async function requestStartChatRun(body: StartChatRunRequestBody): Promise<StartChatRunResponse> {
  return parseContractResponse(await requestJson("/chat", {
    method: "POST",
    headers: {
      "X-Client-Platform": "web",
      ...buildOwnOpenAIKeyHeaders(),
    },
    body: JSON.stringify(body),
  }, allowAuthRecoveryWithTransientNetworkRetry), "POST /chat", parseStartChatRunResponse);
}

/**
 * A gateway timeout can arrive after the backend persisted the turn, for example while it stores uploaded
 * files, so it is retried with the same `clientRequestId`, which the backend answers from the persisted turn.
 */
export async function startChatRun(body: StartChatRunRequestBody): Promise<StartChatRunResponse> {
  for (let attemptCount = 1; ; attemptCount += 1) {
    try {
      return await requestStartChatRun(body);
    } catch (error) {
      if (
        error instanceof ApiError === false
        || error.statusCode !== 504
        || attemptCount >= START_CHAT_RUN_GATEWAY_TIMEOUT_MAXIMUM_ATTEMPT_COUNT
      ) {
        throw error;
      }

      console.warn("Chat start-run gateway timeout retry", {
        attemptCount,
        maximumAttemptCount: START_CHAT_RUN_GATEWAY_TIMEOUT_MAXIMUM_ATTEMPT_COUNT,
        requestId: error.requestId,
      });
    }
  }
}

export async function createNewChatSession(
  sessionId: string,
  workspaceId: string,
  uiLocale: Locale,
): Promise<NewChatSessionResponse> {
  const requestBody: NewChatSessionRequestBody = {
    sessionId,
    workspaceId,
    uiLocale,
  };

  return parseContractResponse(await requestJson("/chat/new", {
    method: "POST",
    body: JSON.stringify(requestBody),
  }, allowAuthRecoveryWithTransientNetworkRetry), "POST /chat/new", parseNewChatSessionResponse);
}

export async function stopChatRun(
  sessionId: string,
  workspaceId: string,
  runId: string | null,
): Promise<StopChatRunResponse> {
  const requestBody: StopChatRunRequestBody = runId === null
    ? {
      sessionId,
      workspaceId,
    }
    : {
      sessionId,
      workspaceId,
      runId,
    };

  return parseContractResponse(await requestJson("/chat/stop", {
    method: "POST",
    body: JSON.stringify(requestBody),
  }, allowAuthRecovery), "POST /chat/stop", parseStopChatRunResponse);
}

function extensionForAudioMediaType(mediaType: string): string {
  if (mediaType === "audio/wav" || mediaType === "audio/wave" || mediaType === "audio/x-wav") {
    return "wav";
  }

  if (mediaType === "audio/mp4" || mediaType === "audio/m4a" || mediaType === "audio/x-m4a") {
    return "m4a";
  }

  return "webm";
}

function normalizeAudioMediaType(mediaType: string): string {
  const normalizedMediaType = mediaType.trim().toLowerCase();
  const [baseMediaType] = normalizedMediaType.split(";", 1);

  if (baseMediaType === "audio/wav" || baseMediaType === "audio/wave" || baseMediaType === "audio/x-wav") {
    return "audio/wav";
  }

  if (baseMediaType === "audio/mp4" || baseMediaType === "audio/m4a" || baseMediaType === "audio/x-m4a") {
    return "audio/mp4";
  }

  return "audio/webm";
}

export async function transcribeChatAudio(
  blob: Blob,
  source: ChatTranscriptionSource,
  sessionId: string,
  workspaceId: string,
  signal: AbortSignal,
): Promise<ChatTranscriptionResponse> {
  const mediaType = normalizeAudioMediaType(blob.type === "" ? "audio/webm" : blob.type);
  const file = new File([blob], `chat-dictation.${extensionForAudioMediaType(mediaType)}`, { type: mediaType });
  const formData = new FormData();
  formData.append("file", file);
  formData.append("source", source);
  formData.append("sessionId", sessionId);
  formData.append("workspaceId", workspaceId);

  return parseContractResponse(await requestJson("/chat/transcriptions", {
    method: "POST",
    headers: buildOwnOpenAIKeyHeaders(),
    body: formData,
    signal,
  }, allowAuthRecovery), "POST /chat/transcriptions", parseChatTranscriptionResponse);
}
