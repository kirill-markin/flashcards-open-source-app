/**
 * Files of one chat session: bytes in the media assets bucket under `chat-files/sessions/<sessionId>/`,
 * one `ai.chat_files` row each, and a reference part in chat history in place of the bytes. The model
 * reaches them by virtual path: `/files/` for attachments and their derived text, `/work/` for its own.
 * Instead of inline base64, a client may stage an attachment under `chat-files/uploads/<userId>/`; see `uploads.ts`.
 */
export {
  logOrphanedChatFileUploads,
  recordTurnChatAttachmentsWithExecutor,
  uploadTurnChatAttachments,
  type UploadedChatAttachment,
} from "./attachments";
export {
  ChatFileCleanupBatchError,
  runChatFileCleanupBatch,
  type ChatFileCleanupBatchResult,
} from "./cleanup";
export {
  prepareChatFileDerivatives,
  type ChatFileDerivativeIndex,
  type ChatFileDerivatives,
} from "./derivatives";
export { convertLegacyChatSessionAttachments } from "./legacyConversion";
export {
  buildChatFileS3Key,
  createChatFileDownloadUrl,
  getChatFileObjectBytes,
} from "./storage";
export {
  assertChatUploadCountPerTurn,
  createChatFileUpload,
  type ChatFileUpload,
} from "./uploads";
export {
  listChatSessionFiles,
  recordChatWorkFileChanges,
  type SavedChatWorkFile,
} from "./workFiles";
export {
  createChatFileWriteSlots,
  signChatFileWriteSlots,
  type ChatFileWriteSlot,
} from "./writeSlots";
