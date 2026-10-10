import { runChatSandboxBash } from "./bashOperation";
import { chatSandboxRequestSchema, type ChatSandboxRequest, type ChatSandboxResponse } from "./contract";
import { runChatSandboxPdfPage } from "./pdfPageOperation";
import { runChatSandboxPrepare } from "./prepareOperation";
import { ChatSandboxUploadError } from "./slotUploads";

/** Counts, sizes and outcomes only. */
type OperationLogDetails = Readonly<Record<string, number | string | null | ReadonlyArray<string>>>;

type CompletedOperation = Readonly<{
  response: ChatSandboxResponse;
  details: OperationLogDetails;
}>;

async function runOperation(request: ChatSandboxRequest): Promise<CompletedOperation> {
  if (request.operation === "bash") {
    const response = await runChatSandboxBash(request);
    return {
      response,
      details: {
        fileCount: request.files.length,
        writeSlotCount: request.writeSlots.length,
        exitCode: response.exitCode,
        stdoutBytes: response.stdoutBytes,
        stderrBytes: response.stderrBytes,
        writtenFileCount: response.writtenFiles.length,
        deletedPathCount: response.deletedPaths.length,
        uploadedSlotIds: response.writtenFiles.map((file) => file.slotId),
      },
    };
  }

  if (request.operation === "prepare") {
    const response = await runChatSandboxPrepare(request);
    const derivedFiles = response.outcome === "prepared" ? response.derivedFiles : [];
    return {
      response,
      details: {
        mediaType: request.file.mediaType,
        sourceBytes: request.file.sizeBytes,
        writeSlotCount: request.writeSlots.length,
        outcome: response.outcome,
        derivedFileCount: derivedFiles.length,
        derivedBytes: derivedFiles.reduce((total, file) => total + file.sizeBytes, 0),
        uploadedSlotIds: derivedFiles.map((file) => file.slotId),
      },
    };
  }

  const response = await runChatSandboxPdfPage(request);
  return {
    response,
    details: {
      sourceBytes: request.file.sizeBytes,
      page: request.page,
      outcome: response.outcome,
      pageCount: response.outcome === "failed" ? null : response.pageCount,
      pageBase64Chars: response.outcome === "failed" ? null : response.pdfBase64.length,
    },
  };
}

/**
 * The chat sandbox runs model-written commands over one chat session's files, and parses the files
 * people attach, which no other backend code parses. Its boundary is the Lambda microVM: the execution
 * role can only write this function's logs and the function is in no VPC, so the only stored data it
 * can reach is the objects the chat worker pre-signed for this call, and the shell itself gets no
 * network. Every call builds its files in memory and writes nothing to the Lambda's own disk.
 *
 * Accepted residual risk: Lambda reuses a warm instance for later calls, including other users' calls,
 * so an escape from the shell interpreter, the Python WASM runtime or a document parser could observe a
 * later call on the same instance.
 *
 * One record per call, metadata only: never a command, its output, a file's content, or a pre-signed
 * URL. A failed call logs the write slots it uploaded to as well, because the worker records no row for
 * them.
 */
export async function handleChatSandboxRequest(
  event: unknown,
  lambdaRequestId: string,
): Promise<ChatSandboxResponse> {
  const request = chatSandboxRequestSchema.parse(event);
  const startedAt = Date.now();
  try {
    const { response, details } = await runOperation(request);
    console.log({
      action: "chat_sandbox_operation_completed",
      lambdaRequestId,
      operation: request.operation,
      sessionId: request.sessionId,
      durationMs: Date.now() - startedAt,
      ...details,
    });
    return response;
  } catch (error) {
    console.error({
      action: "chat_sandbox_operation_failed",
      lambdaRequestId,
      operation: request.operation,
      sessionId: request.sessionId,
      durationMs: Date.now() - startedAt,
      errorName: error instanceof Error ? error.name : "NonErrorThrown",
      errorMessage: error instanceof Error ? error.message : String(error),
      uploadedSlotIds: error instanceof ChatSandboxUploadError ? error.uploadedSlotIds : [],
    });
    throw error;
  }
}
