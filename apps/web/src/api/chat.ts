import {
  parseChatSessionSnapshotResponse,
  parseChatTranscriptionResponse,
  parseNewChatSessionResponse,
  parseStartChatRunResponse,
  parseStopChatRunResponse,
} from "../apiContracts/chat";
import { webAppVersion } from "../clientIdentity";
import type { Locale } from "../i18n/types";
import type {
  ChatSessionSnapshot,
  ChatTranscriptionResponse,
  ChatTranscriptionSource,
  NewChatSessionRequestBody,
  NewChatSessionResponse,
  StartChatRunRequestBody,
  StartChatRunResponse,
  StopChatRunRequestBody,
  StopChatRunResponse,
} from "../types";
import { parseContractResponse } from "./response";
import { allowAuthRecovery, requestJson } from "./transport";

type ChatResumeRequestDiagnostics = Readonly<{
  resumeAttemptId: number;
}>;

function buildChatSnapshotPath(sessionId: string, workspaceId: string): string {
  const searchParams = new URLSearchParams({
    sessionId,
    workspaceId,
  });
  return `/chat?${searchParams.toString()}`;
}

export async function getChatSnapshot(sessionId: string, workspaceId: string): Promise<ChatSessionSnapshot> {
  return parseContractResponse(await requestJson(buildChatSnapshotPath(sessionId, workspaceId), {
    method: "GET",
  }, allowAuthRecovery), "GET /chat", parseChatSessionSnapshotResponse);
}

export async function getChatSnapshotWithResumeDiagnostics(
  sessionId: string,
  workspaceId: string,
  diagnostics: ChatResumeRequestDiagnostics,
): Promise<ChatSessionSnapshot> {
  return parseContractResponse(await requestJson(buildChatSnapshotPath(sessionId, workspaceId), {
    method: "GET",
    headers: {
      "X-Chat-Resume-Attempt-Id": String(diagnostics.resumeAttemptId),
      "X-Client-Platform": "web",
      "X-Client-Version": webAppVersion,
    },
  }, allowAuthRecovery), "GET /chat", parseChatSessionSnapshotResponse);
}

export async function startChatRun(body: StartChatRunRequestBody): Promise<StartChatRunResponse> {
  return parseContractResponse(await requestJson("/chat", {
    method: "POST",
    body: JSON.stringify(body),
  }, allowAuthRecovery), "POST /chat", parseStartChatRunResponse);
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
  }, allowAuthRecovery), "POST /chat/new", parseNewChatSessionResponse);
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
    body: formData,
  }, allowAuthRecovery), "POST /chat/transcriptions", parseChatTranscriptionResponse);
}
