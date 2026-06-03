import type {
  FeedbackPromptEventResponse,
  FeedbackState,
  FeedbackStateEnvelope,
  FeedbackSubmissionResponse,
} from "../types";
import {
  parseBoolean,
  parseLiteral,
  parseNullableString,
  parseNumber,
  parseObject,
  parseOptionalField,
  parseRequiredField,
} from "./core";

function parseFeedbackState(value: unknown, endpoint: string, path: string): FeedbackState {
  const objectValue = parseObject(value, endpoint, path);

  return {
    automaticPromptCooldownDays: parseRequiredField(
      objectValue,
      "automaticPromptCooldownDays",
      endpoint,
      path,
      parseNumber,
    ),
    lastAutomaticPromptShownAt: parseRequiredField(
      objectValue,
      "lastAutomaticPromptShownAt",
      endpoint,
      path,
      parseNullableString,
    ),
    lastFeedbackSubmittedAt: parseRequiredField(
      objectValue,
      "lastFeedbackSubmittedAt",
      endpoint,
      path,
      parseNullableString,
    ),
    nextAutomaticPromptAt: parseRequiredField(objectValue, "nextAutomaticPromptAt", endpoint, path, parseNullableString),
  };
}

function parseOptionalOkTrue(value: unknown, endpoint: string, path: string): true {
  return parseLiteral(parseBoolean(value, endpoint, path), endpoint, path, true);
}

export function parseFeedbackStateEnvelopeResponse(value: unknown, endpoint: string): FeedbackStateEnvelope {
  const objectValue = parseObject(value, endpoint, "");

  return {
    feedbackState: parseRequiredField(objectValue, "feedbackState", endpoint, "", parseFeedbackState),
  };
}

export function parseFeedbackPromptEventResponse(
  value: unknown,
  endpoint: string,
): FeedbackPromptEventResponse {
  const objectValue = parseObject(value, endpoint, "");
  const ok = parseOptionalField(objectValue, "ok", endpoint, "", parseOptionalOkTrue);

  return {
    feedbackState: parseRequiredField(objectValue, "feedbackState", endpoint, "", parseFeedbackState),
    ...(ok === undefined ? {} : { ok }),
  };
}

export function parseFeedbackSubmissionResponse(
  value: unknown,
  endpoint: string,
): FeedbackSubmissionResponse {
  const objectValue = parseObject(value, endpoint, "");
  const ok = parseOptionalField(objectValue, "ok", endpoint, "", parseOptionalOkTrue);

  return {
    feedbackState: parseRequiredField(objectValue, "feedbackState", endpoint, "", parseFeedbackState),
    ...(ok === undefined ? {} : { ok }),
  };
}
