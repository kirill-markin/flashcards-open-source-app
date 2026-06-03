import { z } from "zod";
import { HttpError, type HttpErrorDetails, type ValidationIssueSummary } from "../shared/errors";
import {
  feedbackMessageMaxCharacters,
  type FeedbackPromptEventInput,
  type FeedbackSubmissionInput,
} from "./types";

const uuidStringSchema = z.string().uuid().transform((value) => value.toLowerCase());
const nullableUuidStringSchema = uuidStringSchema.nullable();
const platformSchema = z.enum(["ios", "android", "web"]);
const promptEventTypeSchema = z.enum(["automatic_prompt_shown", "automatic_prompt_dismissed"]);
const submissionTriggerSchema = z.enum(["automatic", "settings"]);
const requiredNullableTextSchema = z.string().trim().min(1).nullable();
const isoTimestampSchema = z.string().datetime().transform((value) => new Date(value).toISOString());
const messageSchema = z.string()
  .transform((value) => value.trim())
  .pipe(z.string().min(1).max(feedbackMessageMaxCharacters));

const feedbackPromptEventInputSchema = z.strictObject({
  feedbackPromptEventId: uuidStringSchema,
  workspaceId: nullableUuidStringSchema,
  installationId: nullableUuidStringSchema,
  platform: platformSchema,
  appVersion: requiredNullableTextSchema,
  locale: requiredNullableTextSchema,
  timezone: requiredNullableTextSchema,
  eventType: promptEventTypeSchema,
  createdAtClient: isoTimestampSchema,
});

const feedbackSubmissionInputSchema = z.strictObject({
  feedbackSubmissionId: uuidStringSchema,
  workspaceId: nullableUuidStringSchema,
  installationId: nullableUuidStringSchema,
  platform: platformSchema,
  appVersion: requiredNullableTextSchema,
  locale: requiredNullableTextSchema,
  timezone: requiredNullableTextSchema,
  trigger: submissionTriggerSchema,
  message: messageSchema,
  createdAtClient: isoTimestampSchema,
});

function summarizeValidationIssue(issue: z.core.$ZodIssue): ValidationIssueSummary {
  const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
  return {
    path,
    code: issue.code,
    message: issue.message,
  };
}

function summarizeValidationDetails(error: z.ZodError): HttpErrorDetails {
  return {
    validationIssues: error.issues.map(summarizeValidationIssue),
  };
}

function parseFeedbackInput<ParsedType>(schema: z.ZodSchema<ParsedType>, value: unknown): ParsedType {
  const parsedInput = schema.safeParse(value);
  if (parsedInput.success) {
    return parsedInput.data;
  }

  throw new HttpError(
    400,
    "Feedback request is invalid.",
    "FEEDBACK_INVALID_INPUT",
    summarizeValidationDetails(parsedInput.error),
  );
}

export function parseFeedbackPromptEventInput(value: unknown): FeedbackPromptEventInput {
  return parseFeedbackInput(feedbackPromptEventInputSchema, value);
}

export function parseFeedbackSubmissionInput(value: unknown): FeedbackSubmissionInput {
  return parseFeedbackInput(feedbackSubmissionInputSchema, value);
}
