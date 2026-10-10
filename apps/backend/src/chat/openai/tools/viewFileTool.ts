import { posix } from "node:path";
import type OpenAI from "openai";
import type { z } from "zod";
import { createChatFileDownloadUrl, getChatFileObjectBytes, listChatSessionFiles } from "../../../chatFiles";
import { invokeChatSandbox } from "../../../chatSandbox/client";
import { chatSandboxPdfPageResponseSchema, type ChatSandboxPdfPageRequest } from "../../../chatSandbox/contract";
import { writeCloudWatchRecord } from "../../../observability/cloudWatch";
import { cutHeadAtCodePoint } from "../../../shared/codePointCuts";
import { toJsonbSafeText } from "../../../shared/jsonbSafeText";
import {
  isChatAttachmentUnsupportedTypeError,
  validateChatImageAttachmentContent,
  type ValidatedChatAttachmentContent,
} from "../../attachmentPolicy";
import type { ExecutedChatToolCall, OpenAIToolContext } from "./tools";
import { VIEW_FILE_TOOL_ARGUMENT_VALIDATOR } from "./viewFileToolContract";

const mebibyte = 1024 * 1024;
/** An image travels base64-encoded in every later model call of the run. */
const maximumViewedImageBytes = 10 * mebibyte;
const maximumSandboxErrorChars = 2_000;
const viewableImageMediaTypes: ReadonlySet<string> = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);
const pdfMediaType = "application/pdf";

type ViewFileArguments = z.infer<typeof VIEW_FILE_TOOL_ARGUMENT_VALIDATOR>;

type ViewedFile = Readonly<{
  path: string;
  mediaType: string;
  sizeBytes: number;
  s3Key: string;
}>;

/** A result and what its log record needs beyond the arguments. */
type ViewFileOutcome = Readonly<{
  result: ExecutedChatToolCall;
  mediaType: string | null;
  sandboxRequestId: string | null;
}>;

type ViewFileLog = Readonly<{
  path: string | null;
  page: number | null;
  mediaType: string | null;
  durationMs: number;
  sandboxRequestId: string | null;
  errorClass: string | null;
}>;

function createViewFileFailure(toolErrorClass: string, message: string): ExecutedChatToolCall {
  return {
    output: toJsonbSafeText(`Error: ${message}`),
    isMutating: false,
    succeeded: false,
    shouldInvalidateMainContent: false,
    stopReason: null,
    generatedImageTelemetry: null,
    sqlTelemetry: null,
    toolErrorClass,
    modelContent: null,
  };
}

/** The note is all that is stored; the model sees the part after it during this run only. */
function createViewFileSuccess(
  note: string,
  viewedPart: OpenAI.Responses.ResponseInputImageContent | OpenAI.Responses.ResponseInputFileContent,
): ExecutedChatToolCall {
  const output = toJsonbSafeText(note);
  return {
    output,
    isMutating: false,
    succeeded: true,
    shouldInvalidateMainContent: false,
    stopReason: null,
    generatedImageTelemetry: null,
    sqlTelemetry: null,
    toolErrorClass: null,
    modelContent: [{ type: "input_text", text: output }, viewedPart],
  };
}

/** The structure check the chat applies to attached images, so an image the provider would refuse never reaches it. */
async function viewImage(file: ViewedFile, page: number | null): Promise<ExecutedChatToolCall> {
  if (page !== null) {
    return createViewFileFailure("ViewFileInvalidArguments", `${file.path} is an image; pass page null.`);
  }

  if (file.sizeBytes > maximumViewedImageBytes) {
    return createViewFileFailure(
      "ViewFileTooLarge",
      `${file.path} is ${(file.sizeBytes / mebibyte).toFixed(1)} MB, and view_file shows images of at most ${maximumViewedImageBytes / mebibyte} MB.`,
    );
  }

  const bytes = await getChatFileObjectBytes(file.s3Key);
  let image: ValidatedChatAttachmentContent;
  try {
    image = validateChatImageAttachmentContent(file.mediaType, bytes.toString("base64"));
  } catch (error) {
    if (!isChatAttachmentUnsupportedTypeError(error)) {
      throw error;
    }

    return createViewFileFailure("ViewFileInvalidImage", `${file.path} is not a readable ${file.mediaType} image.`);
  }

  return createViewFileSuccess(`[view_file showed ${file.path}]`, {
    type: "input_image",
    detail: "auto",
    image_url: `data:${image.mediaType};base64,${image.base64Data}`,
  });
}

/** The sandbox cuts the page out, because only the sandbox parses files people attach. */
async function viewPdfPage(
  file: ViewedFile,
  page: number,
  context: OpenAIToolContext,
): Promise<Readonly<{ result: ExecutedChatToolCall; sandboxRequestId: string | null }>> {
  const invocation = await invokeChatSandbox({
    prepare: async (): Promise<ChatSandboxPdfPageRequest> => ({
      operation: "pdf_page",
      sessionId: context.sessionId,
      file: { path: file.path, sizeBytes: file.sizeBytes, getUrl: await createChatFileDownloadUrl(file.s3Key) },
      page,
    }),
    // Cutting a page uploads nothing, so a lost answer leaves nothing behind.
    abandon: () => undefined,
  }, chatSandboxPdfPageResponseSchema, context.signal, context.generatedImageObservationContext.scope);
  if (invocation.status === "failed") {
    return {
      result: createViewFileFailure(
        invocation.error.errorType,
        `the sandbox did not finish (${invocation.error.errorType}): `
          + cutHeadAtCodePoint(invocation.error.sandboxErrorMessage, maximumSandboxErrorChars),
      ),
      sandboxRequestId: invocation.sandboxRequestId,
    };
  }

  const { response } = invocation;
  if (response.outcome === "failed") {
    return {
      result: createViewFileFailure("ViewFilePageUnavailable", `${file.path}: ${response.error}`),
      sandboxRequestId: invocation.sandboxRequestId,
    };
  }

  const baseName = posix.basename(file.path, ".pdf");
  return {
    result: response.outcome === "extracted"
      ? createViewFileSuccess(`[view_file showed ${file.path}, page ${page} of ${response.pageCount}]`, {
        type: "input_file",
        filename: `${baseName}-page-${page}.pdf`,
        file_data: `data:${pdfMediaType};base64,${response.pdfBase64}`,
      })
      : createViewFileSuccess(
        `[view_file showed all ${response.pageCount} pages of the encrypted ${file.path}, `
          + `because no single page could be cut out of it; page ${page} is the one asked for]`,
        {
          type: "input_file",
          filename: `${baseName}.pdf`,
          file_data: `data:${pdfMediaType};base64,${response.pdfBase64}`,
        },
      ),
    sandboxRequestId: invocation.sandboxRequestId,
  };
}

async function viewFile(args: ViewFileArguments, context: OpenAIToolContext): Promise<ViewFileOutcome> {
  const sessionFiles = await listChatSessionFiles(
    { userId: context.userId, workspaceId: context.workspaceId },
    context.sessionId,
  );
  const file = sessionFiles.find((candidate) => candidate.path === args.path);
  if (file === undefined) {
    return {
      result: createViewFileFailure(
        "ViewFileNotFound",
        `no file at ${args.path}. List the chat's files with bash: find /files /work -type f`,
      ),
      mediaType: null,
      sandboxRequestId: null,
    };
  }

  if (viewableImageMediaTypes.has(file.mediaType)) {
    return { result: await viewImage(file, args.page), mediaType: file.mediaType, sandboxRequestId: null };
  }

  if (file.mediaType === pdfMediaType) {
    return args.page === null
      ? {
        result: createViewFileFailure("ViewFileInvalidArguments", `${file.path} is a PDF; pass the 1-based page to look at.`),
        mediaType: file.mediaType,
        sandboxRequestId: null,
      }
      : { ...await viewPdfPage(file, args.page, context), mediaType: file.mediaType };
  }

  return {
    result: createViewFileFailure(
      "ViewFileUnsupportedType",
      `view_file shows PNG, JPEG, GIF and WebP images and PDF pages, and ${file.path} is ${file.mediaType}; read it with bash instead.`,
    ),
    mediaType: file.mediaType,
    sandboxRequestId: null,
  };
}

function logViewFile(context: OpenAIToolContext, log: ViewFileLog): void {
  writeCloudWatchRecord({
    action: "chat_view_file",
    scope: context.generatedImageObservationContext.scope,
    details: {
      toolCallId: context.toolCallId,
      ...log,
    },
  }, "breadcrumb");
}

/**
 * Puts one image or one PDF page into the model's context, the way Codex's view_image does. The image or
 * page reaches only this run's later model calls; the stored replay item keeps the text note alone.
 */
export async function executeViewFileToolCall(
  rawArguments: string,
  context: OpenAIToolContext,
): Promise<ExecutedChatToolCall> {
  context.signal?.throwIfAborted();
  const startedAt = Date.now();
  let args: ViewFileArguments;
  try {
    args = VIEW_FILE_TOOL_ARGUMENT_VALIDATOR.parse(JSON.parse(rawArguments));
  } catch (error) {
    const errorClass = error instanceof Error ? error.name : "UnknownError";
    logViewFile(context, {
      path: null,
      page: null,
      mediaType: null,
      durationMs: Date.now() - startedAt,
      sandboxRequestId: null,
      errorClass,
    });
    return createViewFileFailure(
      errorClass,
      'invalid arguments. Pass {"path": "/files/photo.png", "page": null} for an image, or a 1-based page number for a PDF.',
    );
  }

  let outcome: ViewFileOutcome;
  try {
    outcome = await viewFile(args, context);
  } catch (error) {
    logViewFile(context, {
      path: args.path,
      page: args.page,
      mediaType: null,
      durationMs: Date.now() - startedAt,
      sandboxRequestId: null,
      errorClass: error instanceof Error ? error.name : "UnknownError",
    });
    throw error;
  }

  logViewFile(context, {
    path: args.path,
    page: args.page,
    mediaType: outcome.mediaType,
    durationMs: Date.now() - startedAt,
    sandboxRequestId: outcome.sandboxRequestId,
    errorClass: outcome.result.toolErrorClass,
  });
  return outcome.result;
}
