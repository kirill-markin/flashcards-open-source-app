import { createChatFileUpload, putChatFileUpload } from "../../api";
import {
  isBinaryPendingAttachment,
  type BinaryPendingAttachment,
  type PendingAttachment,
} from "./FileAttachment";

/**
 * Stages the bytes of every file and image of a turn in parallel: `POST /chat/files/uploads` signs a PUT for
 * each one, and the turn then names it in an `upload` part, so no attachment travels in the `POST /chat` body.
 */
export async function uploadPendingAttachments(
  attachments: ReadonlyArray<PendingAttachment>,
): Promise<ReadonlyMap<BinaryPendingAttachment, string>> {
  const uploads = await Promise.all(attachments.filter(isBinaryPendingAttachment).map(async (attachment) => {
    const response = await createChatFileUpload({
      fileName: attachment.fileName,
      mediaType: attachment.mediaType,
      sizeBytes: attachment.blob.size,
    });
    await putChatFileUpload(response.upload, attachment.blob);
    return [attachment, response.uploadId] as const;
  }));

  return new Map(uploads);
}
