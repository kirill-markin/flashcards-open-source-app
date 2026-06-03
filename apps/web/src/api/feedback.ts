import {
  parseFeedbackPromptEventResponse,
  parseFeedbackStateEnvelopeResponse,
  parseFeedbackSubmissionResponse,
} from "../apiContracts/feedback";
import type {
  FeedbackPromptEventRequest,
  FeedbackState,
  FeedbackSubmissionRequest,
} from "../types";
import { parseContractResponse } from "./response";
import {
  allowAuthRecovery,
  allowAuthRecoveryWithTransientNetworkRetry,
  requestJson,
} from "./transport";

export async function loadFeedbackState(): Promise<FeedbackState> {
  return parseContractResponse(
    await requestJson("/feedback/state", { method: "GET" }, allowAuthRecoveryWithTransientNetworkRetry),
    "GET /feedback/state",
    parseFeedbackStateEnvelopeResponse,
  ).feedbackState;
}

export async function recordFeedbackPromptEvent(input: FeedbackPromptEventRequest): Promise<FeedbackState> {
  return parseContractResponse(
    await requestJson("/feedback/prompt-events", {
      method: "POST",
      body: JSON.stringify(input),
    }, allowAuthRecovery),
    "POST /feedback/prompt-events",
    parseFeedbackPromptEventResponse,
  ).feedbackState;
}

export async function submitFeedback(input: FeedbackSubmissionRequest): Promise<FeedbackState> {
  return parseContractResponse(
    await requestJson("/feedback/submissions", {
      method: "POST",
      body: JSON.stringify(input),
    }, allowAuthRecovery),
    "POST /feedback/submissions",
    parseFeedbackSubmissionResponse,
  ).feedbackState;
}
