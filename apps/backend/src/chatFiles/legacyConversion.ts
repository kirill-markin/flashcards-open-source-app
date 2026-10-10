import {
  transactionWithWorkspaceScope,
  type DatabaseExecutor,
  type WorkspaceDatabaseScope,
} from "../database";
import { addBackendBreadcrumb, type BackendObservationScope } from "../observability/sentry";
import {
  isChatAttachmentUnsupportedTypeError,
  normalizeChatFileAttachmentMediaType,
  normalizeChatImageAttachmentMediaType,
} from "../chat/attachmentPolicy";
import type { InlineAttachmentContentPart } from "../chat/types";
import {
  collectInlineAttachments,
  decodeInlineChatAttachment,
  isInlineAttachmentContentPart,
  logOrphanedChatFileUploads,
  recordUploadedChatAttachmentsWithExecutor,
  replaceInlineAttachments,
  uploadInlineChatAttachments,
  type DecodedChatAttachment,
  type UploadedChatAttachment,
} from "./attachments";
import {
  listInlineAttachmentUserItemsWithExecutor,
  lockChatSessionWithExecutor,
  selectActiveRunInlineTurnInputWithExecutor,
  updateChatItemContentWithExecutor,
  updateChatRunTurnInputWithExecutor,
  type InlineAttachmentChatItemRow,
  type StoredContent,
} from "./repository";

type InlineAttachmentContent = Readonly<{
  items: ReadonlyArray<InlineAttachmentChatItemRow>;
  turnInput: StoredContent | null;
}>;

type ConvertedContent = Readonly<{
  source: "chat_item" | "run_turn_input";
  itemId: string | null;
  convertedPartCount: number;
}>;

type LegacyConversion = Readonly<{
  converted: ReadonlyArray<ConvertedContent>;
  unusedUploads: ReadonlyArray<UploadedChatAttachment>;
}>;

function listContents(content: InlineAttachmentContent): ReadonlyArray<StoredContent> {
  return [
    ...content.items.map((item) => item.payload.content),
    ...(content.turnInput === null ? [] : [content.turnInput]),
  ];
}

function countInlineAttachments(content: StoredContent): number {
  return content.filter(isInlineAttachmentContentPart).length;
}

const unknownMediaType = "application/octet-stream";
// An image arrives without a name, and kept as a file it needs one.
const keptImageFileName = "image";

function canonicalizeLegacyMediaType(part: InlineAttachmentContentPart): string {
  try {
    return part.type === "image"
      ? normalizeChatImageAttachmentMediaType(part.mediaType)
      : normalizeChatFileAttachmentMediaType(part.fileName, part.mediaType);
  } catch (error) {
    if (!isChatAttachmentUnsupportedTypeError(error)) {
      throw error;
    }

    return part.mediaType.split(";")[0].trim().toLowerCase() || unknownMediaType;
  }
}

function keepLegacyAttachmentAsFile(
  part: InlineAttachmentContentPart,
  observationScope: BackendObservationScope,
): DecodedChatAttachment {
  const attachment: DecodedChatAttachment = {
    type: "file",
    fileName: part.type === "file" ? part.fileName : keptImageFileName,
    mediaType: canonicalizeLegacyMediaType(part),
    bytes: Buffer.from(part.base64Data, "base64"),
  };
  addBackendBreadcrumb({
    action: "chat_file_legacy_attachment_kept_as_file",
    scope: observationScope,
    details: { partType: part.type, mediaType: attachment.mediaType, sizeBytes: attachment.bytes.length },
  });
  return attachment;
}

/**
 * Stored bytes were accepted when they were stored, so today's attachment policy only canonicalizes them
 * here. What it rejects is kept as a file, which the model sees as a manifest line only, so an image the
 * provider would refuse never reaches it.
 */
function decodeLegacyInlineChatAttachment(
  part: InlineAttachmentContentPart,
  observationScope: BackendObservationScope,
): DecodedChatAttachment {
  try {
    return decodeInlineChatAttachment(part);
  } catch (error) {
    if (!isChatAttachmentUnsupportedTypeError(error)) {
      throw error;
    }

    return keepLegacyAttachmentAsFile(part, observationScope);
  }
}

/** Rereads under the session lock, so only what is still inline is converted. */
async function convertInlineAttachmentContentWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
  runId: string,
  uploads: ReadonlyMap<string, UploadedChatAttachment>,
): Promise<LegacyConversion> {
  const run = await selectActiveRunInlineTurnInputWithExecutor(executor, scope, runId);
  const current: InlineAttachmentContent = {
    items: await listInlineAttachmentUserItemsWithExecutor(executor, scope, sessionId),
    turnInput: run === null ? null : run.inline_turn_input,
  };
  const currentAttachments = collectInlineAttachments(listContents(current));
  const unusedUploads = [...uploads].flatMap(([key, upload]) => currentAttachments.has(key) ? [] : [upload]);
  if (currentAttachments.size === 0) {
    return { converted: [], unusedUploads };
  }

  const references = await recordUploadedChatAttachmentsWithExecutor(
    executor,
    scope,
    sessionId,
    new Map([...uploads].filter(([key]) => currentAttachments.has(key))),
  );
  const converted: Array<ConvertedContent> = [];
  for (const item of current.items) {
    await updateChatItemContentWithExecutor(
      executor,
      scope,
      item.item_id,
      replaceInlineAttachments(item.payload.content, references),
    );
    converted.push({
      source: "chat_item",
      itemId: item.item_id,
      convertedPartCount: countInlineAttachments(item.payload.content),
    });
  }

  if (current.turnInput !== null) {
    await updateChatRunTurnInputWithExecutor(
      executor,
      scope,
      runId,
      replaceInlineAttachments(current.turnInput, references),
    );
    converted.push({
      source: "run_turn_input",
      itemId: null,
      convertedPartCount: countInlineAttachments(current.turnInput),
    });
  }

  return { converted, unusedUploads };
}

/**
 * Turns the inline attachments a session stored before session files existed into session files, so the
 * run about to be claimed replays references instead of bytes: every user message of the session and the
 * run's own turn input. Identical bytes in both become one file, which keeps the stored turn input equal
 * to the user message it repeats. Nothing is converted for a run that is no longer queued or running.
 *
 * The bytes are uploaded outside any transaction. The rows and rewrites land in one transaction under the
 * session row lock, which `prepareChatRun` also takes to insert a user message, so a second worker
 * converting the same session finds nothing left and only its own uploads are orphaned.
 */
export async function convertLegacyChatSessionAttachments(
  userId: string,
  workspaceId: string,
  runId: string,
  observationScope: BackendObservationScope,
): Promise<void> {
  const scope = { userId, workspaceId };
  const pending = await transactionWithWorkspaceScope(scope, async (executor) => {
    const run = await selectActiveRunInlineTurnInputWithExecutor(executor, scope, runId);
    if (run === null) {
      return null;
    }

    const content: InlineAttachmentContent = {
      items: await listInlineAttachmentUserItemsWithExecutor(executor, scope, run.session_id),
      turnInput: run.inline_turn_input,
    };
    return { sessionId: run.session_id, attachments: collectInlineAttachments(listContents(content)) };
  });
  if (pending === null || pending.attachments.size === 0) {
    return;
  }

  const uploads = await uploadInlineChatAttachments(
    pending.sessionId,
    new Map([...pending.attachments].map(([key, part]) => [
      key,
      decodeLegacyInlineChatAttachment(part, observationScope),
    ])),
    observationScope,
  );
  let conversion: LegacyConversion;
  try {
    conversion = await transactionWithWorkspaceScope(scope, async (executor) => {
      await lockChatSessionWithExecutor(executor, scope, pending.sessionId);
      return convertInlineAttachmentContentWithExecutor(executor, scope, pending.sessionId, runId, uploads);
    });
  } catch (error) {
    logOrphanedChatFileUploads(observationScope, [...uploads.values()], "write_failed", error);
    throw error;
  }

  logOrphanedChatFileUploads(observationScope, conversion.unusedUploads, "already_converted", null);
  for (const details of conversion.converted) {
    addBackendBreadcrumb({
      action: "chat_file_legacy_attachments_converted",
      scope: observationScope,
      details,
    });
  }
}
