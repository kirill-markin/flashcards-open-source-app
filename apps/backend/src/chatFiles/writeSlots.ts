import { randomUUID } from "node:crypto";
import type { ChatSandboxWriteSlot } from "../chatSandbox/contract";
import { buildChatFileS3Key, createChatFileUploadUrl } from "./storage";

/** A fresh key the chat sandbox may fill; its id becomes the file id of the row that records it. */
export type ChatFileWriteSlot = Readonly<{
  fileId: string;
  s3Key: string;
}>;

/** Keyed by file id, which is also the slot id the sandbox answers with. */
export function createChatFileWriteSlots(sessionId: string, count: number): ReadonlyMap<string, ChatFileWriteSlot> {
  return new Map(Array.from({ length: count }, () => {
    const fileId = randomUUID();
    return [fileId, { fileId, s3Key: buildChatFileS3Key(sessionId, fileId) }] as const;
  }));
}

export async function signChatFileWriteSlots(
  slots: ReadonlyMap<string, ChatFileWriteSlot>,
): Promise<Array<ChatSandboxWriteSlot>> {
  return Promise.all([...slots.values()].map(async (slot) => ({
    slotId: slot.fileId,
    putUrl: await createChatFileUploadUrl(slot.s3Key),
  })));
}
