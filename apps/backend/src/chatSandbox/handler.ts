import { ChatSandboxWorkSaveError, runChatSandboxBash } from "./bashOperation";
import { chatSandboxRequestSchema, type ChatSandboxBashResponse } from "./contract";

/**
 * The chat sandbox runs model-written commands over one chat session's files. Its boundary is the
 * Lambda microVM: the execution role can only write this function's logs and the function is in no VPC,
 * so the only stored data it can reach is the objects the chat worker pre-signed for this call, and the
 * shell itself gets no network. Every call builds a fresh in-memory file system and writes nothing to
 * the Lambda's own disk.
 *
 * Accepted residual risk: Lambda reuses a warm instance for later calls, including other users' calls,
 * so an escape from the shell interpreter or the Python WASM runtime could observe a later call on the
 * same instance.
 *
 * Only metadata is logged here: never a command, its output, a file's content, or a pre-signed URL.
 * A failed call logs the write slots it uploaded to as well, because the worker records no row for them.
 */
export async function handleChatSandboxRequest(
  event: unknown,
  lambdaRequestId: string,
): Promise<ChatSandboxBashResponse> {
  const request = chatSandboxRequestSchema.parse(event);
  const startedAt = Date.now();
  try {
    const response = await runChatSandboxBash(request);
    console.log({
      action: "chat_sandbox_operation_completed",
      lambdaRequestId,
      operation: request.operation,
      sessionId: request.sessionId,
      fileCount: request.files.length,
      writeSlotCount: request.writeSlots.length,
      exitCode: response.exitCode,
      durationMs: Date.now() - startedAt,
      stdoutBytes: response.stdoutBytes,
      stderrBytes: response.stderrBytes,
      writtenFileCount: response.writtenFiles.length,
      deletedPathCount: response.deletedPaths.length,
      uploadedSlotIds: response.writtenFiles.map((file) => file.slotId),
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
      uploadedSlotIds: error instanceof ChatSandboxWorkSaveError ? error.uploadedSlotIds : [],
    });
    throw error;
  }
}
