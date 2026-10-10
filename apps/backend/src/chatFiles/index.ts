/**
 * Files of one chat session: bytes in the media assets bucket under `chat-files/sessions/<sessionId>/`,
 * one `ai.chat_files` row each, and a reference part in chat history in place of the bytes. The model
 * reaches them by virtual path: `/files/` for attachments and their derived text, `/work/` for its own.
 */
export {
  logOrphanedChatFileUploads,
  recordTurnChatAttachmentsWithExecutor,
  uploadTurnInlineChatAttachments,
  type UploadedChatAttachment,
} from "./attachments";
export {
  ChatFileCleanupBatchError,
  runChatFileCleanupBatch,
  type ChatFileCleanupBatchResult,
} from "./cleanup";
export { convertLegacyChatSessionAttachments } from "./legacyConversion";
export {
  buildChatFileS3Key,
  createChatFileDownloadUrl,
  createChatFileUploadUrl,
  getChatFileObjectBytes,
} from "./storage";
export {
  listChatSessionFiles,
  recordChatWorkFileChanges,
  type SavedChatWorkFile,
} from "./workFiles";
