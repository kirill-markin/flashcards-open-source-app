import { posix } from "node:path";
import {
  transactionWithWorkspaceScope,
  transactionWithWorkspaceScopeReadOnly,
  type WorkspaceDatabaseScope,
} from "../database";
import type { BackendObservationScope } from "../observability/sentry";
import {
  isChatAttachmentUnsupportedTypeError,
  normalizeChatFileAttachmentMediaType,
} from "../chat/attachmentPolicy";
import { logOrphanedChatFileUploads } from "./attachments";
import {
  deleteChatWorkFilesWithExecutor,
  insertChatWorkFileWithExecutor,
  listChatSessionFilesWithExecutor,
  type ChatSessionFile,
} from "./repository";

/** A `/work` file the sandbox stored under a fresh key, whose row is not yet inserted. */
export type SavedChatWorkFile = Readonly<{
  fileId: string;
  path: string;
  sizeBytes: number;
  sha256: string;
  s3Key: string;
}>;

const unknownMediaType = "application/octet-stream";
const imageMediaTypeByExtension: Readonly<Record<string, string>> = {
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** By extension: the image types and attachment file types the chat accepts, octet-stream for the rest. */
export function resolveChatFileMediaTypeFromPath(path: string): string {
  const imageMediaType = imageMediaTypeByExtension[posix.extname(path).slice(1).toLowerCase()];
  if (imageMediaType !== undefined) {
    return imageMediaType;
  }

  try {
    return normalizeChatFileAttachmentMediaType(path, unknownMediaType);
  } catch (error) {
    if (!isChatAttachmentUnsupportedTypeError(error)) {
      throw error;
    }

    return unknownMediaType;
  }
}

export async function listChatSessionFiles(
  scope: WorkspaceDatabaseScope,
  sessionId: string,
): Promise<ReadonlyArray<ChatSessionFile>> {
  return transactionWithWorkspaceScopeReadOnly(
    scope,
    async (executor) => listChatSessionFilesWithExecutor(executor, scope, sessionId),
  );
}

/**
 * Applies one sandbox command's `/work` changes in one transaction. A rewritten path gets a new row under
 * its new key instead of an updated one, so the old row's deletion releases the old object exactly as
 * deleting the file does.
 */
export async function recordChatWorkFileChanges(
  scope: WorkspaceDatabaseScope,
  sessionId: string,
  savedFiles: ReadonlyArray<SavedChatWorkFile>,
  deletedPaths: ReadonlyArray<string>,
  observationScope: BackendObservationScope,
): Promise<void> {
  if (savedFiles.length === 0 && deletedPaths.length === 0) {
    return;
  }

  try {
    await transactionWithWorkspaceScope(scope, async (executor) => {
      await deleteChatWorkFilesWithExecutor(executor, scope, sessionId, [
        ...deletedPaths,
        ...savedFiles.map((file) => file.path),
      ]);
      for (const file of savedFiles) {
        await insertChatWorkFileWithExecutor(executor, scope, {
          fileId: file.fileId,
          sessionId,
          path: file.path,
          mediaType: resolveChatFileMediaTypeFromPath(file.path),
          sizeBytes: file.sizeBytes,
          sha256: file.sha256,
          s3Key: file.s3Key,
        });
      }
    });
  } catch (error) {
    logOrphanedChatFileUploads(observationScope, savedFiles, "write_failed", error);
    throw error;
  }
}
