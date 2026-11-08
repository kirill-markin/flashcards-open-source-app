import { createHash } from "node:crypto";
import { chatSandboxUploadErrorType, type ChatSandboxWriteSlot } from "./contract";
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
    this.name = chatSandboxUploadErrorType;
    this.uploadedSlotIds = uploadedSlotIds;
  }
}

/**
 * One socket per upload, so an archive's 2,000 files at once would exhaust the sandbox Lambda's 1,024
 * file descriptors.
 */
const maximumConcurrentUploads = 32;

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Uploads the files to the slots in order, at most `maximumConcurrentUploads` at a time. */
export async function uploadToWriteSlots(
  files: ReadonlyArray<SlotFile>,
  slots: ReadonlyArray<ChatSandboxWriteSlot>,
): Promise<ReadonlyArray<UploadedSlotFile>> {
  const upload = async (file: SlotFile, index: number): Promise<UploadedSlotFile> => {
    const slot = slots[index];
    if (slot === undefined) {
      throw new Error(`No write slot is left for a file. path=${file.path} slotCount=${slots.length}`);
    }

    await uploadPresignedObject(slot.putUrl, file.path, file.bytes);
    return { path: file.path, slotId: slot.slotId, sizeBytes: file.bytes.byteLength, sha256: sha256Hex(file.bytes) };
  };
  const results: Array<PromiseSettledResult<UploadedSlotFile>> = [];
  let nextIndex = 0;
  const uploadRemaining = async (): Promise<void> => {
    for (let index = nextIndex; index < files.length; index = nextIndex) {
      nextIndex += 1;
      [results[index]] = await Promise.allSettled([upload(files[index], index)]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(maximumConcurrentUploads, files.length) }, uploadRemaining));
  const uploadedFiles = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failure !== undefined) {
    throw new ChatSandboxUploadError(uploadedFiles.map((file) => file.slotId), failure.reason);
  }

  return uploadedFiles;
}
