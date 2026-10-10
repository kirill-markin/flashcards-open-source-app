import { createHash } from "node:crypto";
import type { ChatSandboxWriteSlot } from "./contract";
import { uploadPresignedObject } from "./presignedTransfer";

export type SlotFile = Readonly<{
  path: string;
  bytes: Uint8Array;
}>;

export type UploadedSlotFile = Readonly<{
  path: string;
  slotId: string;
  sizeBytes: number;
  sha256: string;
}>;

/**
 * Thrown once every upload settled and one of them failed. The slots the others filled hold objects no
 * row will name, so the handler logs them; the message, the failed upload's own, reaches the model.
 */
export class ChatSandboxUploadError extends Error {
  public readonly uploadedSlotIds: ReadonlyArray<string>;

  public constructor(uploadedSlotIds: ReadonlyArray<string>, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "ChatSandboxUploadError";
    this.uploadedSlotIds = uploadedSlotIds;
  }
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Uploads the files to the slots in order, all of them at once. */
export async function uploadToWriteSlots(
  files: ReadonlyArray<SlotFile>,
  slots: ReadonlyArray<ChatSandboxWriteSlot>,
): Promise<ReadonlyArray<UploadedSlotFile>> {
  const results = await Promise.allSettled(files.map(async (file, index) => {
    const slot = slots[index];
    if (slot === undefined) {
      throw new Error(`No write slot is left for a file. path=${file.path} slotCount=${slots.length}`);
    }

    await uploadPresignedObject(slot.putUrl, file.path, file.bytes);
    return { path: file.path, slotId: slot.slotId, sizeBytes: file.bytes.byteLength, sha256: sha256Hex(file.bytes) };
  }));
  const uploadedFiles = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failure !== undefined) {
    throw new ChatSandboxUploadError(uploadedFiles.map((file) => file.slotId), failure.reason);
  }

  return uploadedFiles;
}
