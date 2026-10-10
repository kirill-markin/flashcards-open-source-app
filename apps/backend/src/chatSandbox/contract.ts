import { z } from "zod";
import { cutHeadAtCodePoint, cutTailAtCodePoint } from "../shared/codePointCuts";

/**
 * What the chat worker and the sandbox Lambda exchange. The worker alone decides which objects the
 * sandbox may touch: one pre-signed GET URL per session file, and pre-signed PUT URLs for fresh keys
 * that the sandbox fills with the `/work` files a command changed.
 */

/**
 * Each output stream travels cut to its head and tail, which keeps the response far below Lambda's
 * 6 MB synchronous payload limit even when every character is escaped in JSON.
 */
export const maximumTransportedStreamChars = 64_000;
/** The time limit of one command, inside the sandbox Lambda's 2-minute timeout. */
export const maximumBashCommandSeconds = 90;
/** Keeps a path far below the btree row limit of the unique (session_id, path) index. */
export const maximumWorkPathBytes = 1_024;

const sessionFilePathSchema = z.string().regex(/^\/(?:files|work)\/[^\0]+$/u);
const workPathSchema = z.string()
  .regex(/^\/work\/[^\0]+$/u)
  .refine((path) => Buffer.byteLength(path) <= maximumWorkPathBytes);

const chatSandboxFileSchema = z.object({
  path: sessionFilePathSchema,
  sizeBytes: z.number().int().nonnegative(),
  getUrl: z.string().url(),
}).strict();

const chatSandboxWriteSlotSchema = z.object({
  slotId: z.string().min(1),
  putUrl: z.string().url(),
}).strict();

export const chatSandboxBashRequestSchema = z.object({
  operation: z.literal("bash"),
  sessionId: z.string().uuid(),
  command: z.string().min(1),
  files: z.array(chatSandboxFileSchema),
  writeSlots: z.array(chatSandboxWriteSlotSchema),
}).strict();

export const chatSandboxRequestSchema = z.discriminatedUnion("operation", [chatSandboxBashRequestSchema]);

/** `stdout` and `stderr` are cut by `cutToHeadAndTail`; the byte counts are those of the whole streams. */
export const chatSandboxBashResponseSchema = z.object({
  stdout: z.string().max(maximumTransportedStreamChars),
  stdoutBytes: z.number().int().nonnegative(),
  stderr: z.string().max(maximumTransportedStreamChars),
  stderrBytes: z.number().int().nonnegative(),
  exitCode: z.number().int(),
  durationMs: z.number().int().nonnegative(),
  writtenFiles: z.array(z.object({
    path: workPathSchema,
    slotId: z.string().min(1),
    sizeBytes: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  }).strict()),
  deletedPaths: z.array(workPathSchema),
}).strict();

export type ChatSandboxWriteSlot = z.infer<typeof chatSandboxWriteSlotSchema>;
export type ChatSandboxBashRequest = z.infer<typeof chatSandboxBashRequestSchema>;
export type ChatSandboxBashResponse = z.infer<typeof chatSandboxBashResponseSchema>;

export type HeadAndTail = Readonly<{
  head: string;
  tail: string;
}>;

/**
 * Keeps the first and last halves of `maximumChars`, each a code unit shorter where it would split a
 * surrogate pair; `tail` is empty when the text fits. Cutting a stream that was already cut keeps the
 * head and tail of the original as long as each half is not larger than the half of the first cut.
 */
export function cutToHeadAndTail(text: string, maximumChars: number): HeadAndTail {
  if (text.length <= maximumChars) {
    return { head: text, tail: "" };
  }

  const headChars = Math.ceil(maximumChars / 2);
  return {
    head: cutHeadAtCodePoint(text, headChars),
    tail: cutTailAtCodePoint(text, maximumChars - headChars),
  };
}
