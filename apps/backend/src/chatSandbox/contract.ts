import { z } from "zod";
import { cutHeadAtCodePoint, cutTailAtCodePoint } from "../shared/codePointCuts";

/**
 * What the chat worker and the sandbox Lambda exchange. The worker alone decides which objects the
 * sandbox may touch: pre-signed GET URLs for the session files an operation reads, and pre-signed PUT
 * URLs for fresh keys that the sandbox fills with the files it writes.
 */

/**
 * Each output stream travels cut to its head and tail, which keeps the response far below Lambda's
 * 6 MB synchronous payload limit even when every character is escaped in JSON.
 */
export const maximumTransportedStreamChars = 64_000;
/** The time limit of one command, inside the sandbox Lambda's 2-minute timeout. */
export const maximumBashCommandSeconds = 90;
/** Keeps a path far below the btree row limit of the unique (session_id, path) index. */
export const maximumChatFilePathBytes = 1_024;
/** The files one ZIP extracts or the sheets one XLSX exports. */
export const maximumDerivedFileCount = 200;
/** A one-page PDF, or an encrypted PDF shown whole, travels base64-encoded, which keeps it below Lambda's 6 MB response limit. */
export const maximumPdfPageBytes = 4 * 1024 * 1024;
/** Every page OpenAI reads costs 1–2k input tokens on each later model call of the run, so only a short encrypted PDF travels whole. */
export const maximumWholeEncryptedPdfPages = 10;
/** Short enough to be one clause of the attachment line the model reads on every turn. */
export const maximumDerivativeErrorChars = 300;
/** The SQL calls one `bash` command's code may make through the SQL bridge, counted by the sandbox host. */
export const maximumSqlCallsPerCommand = 500;

/** The media types `apps/backend/src/chat/attachmentPolicy.ts` must give `.zip` and `.apkg` attachments. */
export const chatFileZipMediaType = "application/zip";
export const chatFileApkgMediaType = "application/apkg";

export type ChatFileDerivativeKind = "pdf" | "docx" | "xlsx" | "zip" | "apkg";

const derivativeKindByMediaType: Readonly<Record<string, ChatFileDerivativeKind>> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  [chatFileZipMediaType]: "zip",
  [chatFileApkgMediaType]: "apkg",
};

/** Null for a type nothing is derived from, which is every type outside the map. */
export function findChatFileDerivativeKind(mediaType: string): ChatFileDerivativeKind | null {
  return derivativeKindByMediaType[mediaType] ?? null;
}

/** One `.txt`, a collection with its media list, or one file per extracted entry or sheet. */
export function countDerivativeWriteSlots(kind: ChatFileDerivativeKind): number {
  if (kind === "pdf" || kind === "docx") {
    return 1;
  }

  return kind === "apkg" ? 2 : maximumDerivedFileCount;
}

const sessionFilePathSchema = z.string().regex(/^\/(?:files|work)\/[^\0]+$/u);
const workPathSchema = z.string()
  .regex(/^\/work\/[^\0]+$/u)
  .refine((path) => Buffer.byteLength(path) <= maximumChatFilePathBytes);
const derivedPathSchema = z.string()
  .regex(/^\/files\/[^\0]+$/u)
  .refine((path) => Buffer.byteLength(path) <= maximumChatFilePathBytes);
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const derivativeErrorSchema = z.string().min(1).max(maximumDerivativeErrorChars);

const chatSandboxFileSchema = z.object({
  path: sessionFilePathSchema,
  sizeBytes: z.number().int().nonnegative(),
  getUrl: z.string().url(),
}).strict();

const chatSandboxAttachmentSchema = z.object({
  path: z.string().regex(/^\/files\/[^\0]+$/u),
  mediaType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  getUrl: z.string().url(),
}).strict();

const chatSandboxWriteSlotSchema = z.object({
  slotId: z.string().min(1),
  putUrl: z.string().url(),
}).strict();

/**
 * Where a command's code sends agent SQL: the bridge route on the backend API and the capability the
 * worker minted for this attempt. Both stay in the host process, out of the shell's environment, its
 * files and the command's output. A worker that predates the bridge sends none, and its command gets no
 * SQL functions.
 */
const chatSandboxSqlBridgeSchema = z.object({
  url: z.string().url(),
  authorization: z.string().min(1),
}).strict();

export const chatSandboxBashRequestSchema = z.object({
  operation: z.literal("bash"),
  sessionId: z.string().uuid(),
  command: z.string().min(1),
  files: z.array(chatSandboxFileSchema),
  writeSlots: z.array(chatSandboxWriteSlotSchema),
  sqlBridge: chatSandboxSqlBridgeSchema.optional(),
}).strict();

/** Derives text, CSV or sqlite files from one attachment; the write slots fit its kind. */
export const chatSandboxPrepareRequestSchema = z.object({
  operation: z.literal("prepare"),
  sessionId: z.string().uuid(),
  file: chatSandboxAttachmentSchema,
  writeSlots: z.array(chatSandboxWriteSlotSchema),
}).strict();

/** Cuts one 1-based page out of a PDF. */
export const chatSandboxPdfPageRequestSchema = z.object({
  operation: z.literal("pdf_page"),
  sessionId: z.string().uuid(),
  file: chatSandboxFileSchema,
  page: z.number().int().positive(),
}).strict();

export const chatSandboxRequestSchema = z.discriminatedUnion("operation", [
  chatSandboxBashRequestSchema,
  chatSandboxPrepareRequestSchema,
  chatSandboxPdfPageRequestSchema,
]);

/**
 * `stdout` and `stderr` are cut by `cutToHeadAndTail`; the byte counts are those of the whole streams.
 * `sqlCallCount` counts the SQL calls the command's code sent, `sqlExecuteCallCount` the writes among them;
 * both are present only when the request carried `sqlBridge`, because a worker that predates the bridge
 * rejects them.
 */
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
    sha256: sha256Schema,
  }).strict()),
  deletedPaths: z.array(workPathSchema),
  sqlCallCount: z.number().int().nonnegative().max(maximumSqlCallsPerCommand).optional(),
  sqlExecuteCallCount: z.number().int().nonnegative().max(maximumSqlCallsPerCommand).optional(),
}).strict();

/**
 * `failed` names why the attachment yields nothing, such as a corrupt file or an archive over a limit,
 * and then nothing was uploaded. Derived paths are `<path>.txt` or sit under `<path>.d/`.
 */
export const chatSandboxPrepareResponseSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("prepared"),
    derivedFiles: z.array(z.object({
      path: derivedPathSchema,
      slotId: z.string().min(1),
      sizeBytes: z.number().int().nonnegative(),
      sha256: sha256Schema,
    }).strict()).max(maximumDerivedFileCount),
  }).strict(),
  z.object({ outcome: z.literal("failed"), error: derivativeErrorSchema }).strict(),
]);

const pdfPageCountSchema = z.number().int().positive();
const pdfBase64Schema = z.string().min(1).max(Math.ceil(maximumPdfPageBytes / 3) * 4);

/** `whole_pdf` carries the whole of an encrypted PDF, out of which no single page could be cut. */
export const chatSandboxPdfPageResponseSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("extracted"), pageCount: pdfPageCountSchema, pdfBase64: pdfBase64Schema }).strict(),
  z.object({ outcome: z.literal("whole_pdf"), pageCount: pdfPageCountSchema, pdfBase64: pdfBase64Schema }).strict(),
  z.object({ outcome: z.literal("failed"), error: derivativeErrorSchema }).strict(),
]);

export type ChatSandboxWriteSlot = z.infer<typeof chatSandboxWriteSlotSchema>;
export type ChatSandboxSqlBridge = z.infer<typeof chatSandboxSqlBridgeSchema>;
export type ChatSandboxRequest = z.infer<typeof chatSandboxRequestSchema>;
export type ChatSandboxBashRequest = z.infer<typeof chatSandboxBashRequestSchema>;
export type ChatSandboxBashResponse = z.infer<typeof chatSandboxBashResponseSchema>;
export type ChatSandboxPrepareRequest = z.infer<typeof chatSandboxPrepareRequestSchema>;
export type ChatSandboxPrepareResponse = z.infer<typeof chatSandboxPrepareResponseSchema>;
export type ChatSandboxPdfPageRequest = z.infer<typeof chatSandboxPdfPageRequestSchema>;
export type ChatSandboxPdfPageResponse = z.infer<typeof chatSandboxPdfPageResponseSchema>;
export type ChatSandboxResponse = ChatSandboxBashResponse | ChatSandboxPrepareResponse | ChatSandboxPdfPageResponse;

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
