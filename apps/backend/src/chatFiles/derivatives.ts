import { posix } from "node:path";
import { invokeChatSandbox, type ChatSandboxInvocation } from "../chatSandbox/client";
import {
  chatSandboxPrepareResponseSchema,
  countDerivativeWriteSlots,
  findChatFileDerivativeKind,
  maximumDerivativeErrorChars,
  type ChatFileDerivativeKind,
  type ChatSandboxPrepareRequest,
  type ChatSandboxPrepareResponse,
} from "../chatSandbox/contract";
import { transactionWithWorkspaceScope, type WorkspaceDatabaseScope } from "../database";
import { writeCloudWatchRecord } from "../observability/cloudWatch";
import type { BackendObservationScope } from "../observability/sentry";
import { cutHeadAtCodePoint } from "../shared/codePointCuts";
import { toJsonbSafeText } from "../shared/jsonbSafeText";
import { logOrphanedChatFileUploads } from "./attachments";
import { findChatFilePathConflict } from "./paths";
import {
  finishChatAttachmentDerivativesWithExecutor,
  insertChatDerivedFileWithExecutor,
  listChatFilePathsWithExecutor,
  lockChatSessionWithExecutor,
  selectChatAttachmentDerivativesPreparedWithExecutor,
  type ChatSessionFile,
} from "./repository";
import { createChatFileDownloadUrl } from "./storage";
import { listChatSessionFiles, resolveChatFileMediaTypeFromPath } from "./workFiles";
import { createChatFileWriteSlots, signChatFileWriteSlots, type ChatFileWriteSlot } from "./writeSlots";

/** What preparing one attachment left: the paths derived from it, or why there are none. */
export type ChatFileDerivatives = Readonly<{
  derivedPaths: ReadonlyArray<string>;
  error: string | null;
}>;

/** Keyed by attachment file id; an attachment whose preparation has not finished has no entry. */
export type ChatFileDerivativeIndex = ReadonlyMap<string, ChatFileDerivatives>;

type DerivedChatFile = ChatFileWriteSlot & Readonly<{
  path: string;
  sizeBytes: number;
  sha256: string;
}>;

/** A failed preparation carries the slots the sandbox may have filled without saying so. */
type Preparation =
  | Readonly<{ outcome: "prepared"; derivedFiles: ReadonlyArray<DerivedChatFile> }>
  | Readonly<{ outcome: "failed"; error: string; unconfirmedSlots: ReadonlyArray<ChatFileWriteSlot> }>;

/** `superseded`: the attachment was gone or already prepared once the result was recorded. */
type RecordedPreparation =
  | Readonly<{ outcome: "prepared" }>
  | Readonly<{ outcome: "failed"; error: string }>
  | Readonly<{ outcome: "superseded" }>;

type PendingAttachment = Readonly<{
  file: ChatSessionFile;
  kind: ChatFileDerivativeKind;
}>;

function toStoredDerivativeError(error: string): string {
  return toJsonbSafeText(cutHeadAtCodePoint(error, maximumDerivativeErrorChars));
}

/**
 * The sandbox parses untrusted files, so every derived file must sit in a slot this call issued and at a
 * normalized path under its attachment: `<path>.txt` or `<path>.d/`.
 */
function readDerivedFiles(
  sourcePath: string,
  response: Extract<ChatSandboxPrepareResponse, { outcome: "prepared" }>,
  slots: ReadonlyMap<string, ChatFileWriteSlot>,
): ReadonlyArray<DerivedChatFile> | null {
  const usedSlotIds = new Set<string>();
  const derivedFiles: Array<DerivedChatFile> = [];
  for (const file of response.derivedFiles) {
    const slot = slots.get(file.slotId);
    const isUnderSource = file.path === `${sourcePath}.txt` || file.path.startsWith(`${sourcePath}.d/`);
    const isNormalized = posix.normalize(file.path) === file.path && !file.path.endsWith("/");
    if (slot === undefined || usedSlotIds.has(file.slotId) || !isUnderSource || !isNormalized) {
      return null;
    }

    usedSlotIds.add(file.slotId);
    derivedFiles.push({ ...slot, path: file.path, sizeBytes: file.sizeBytes, sha256: file.sha256 });
  }

  return derivedFiles;
}

function readPreparation(
  file: ChatSessionFile,
  invocation: ChatSandboxInvocation<ChatSandboxPrepareResponse>,
  slots: ReadonlyMap<string, ChatFileWriteSlot>,
): Preparation {
  if (invocation.status === "failed") {
    return {
      outcome: "failed",
      error: `the sandbox did not finish (${invocation.error.errorType}): ${invocation.error.sandboxErrorMessage}`,
      unconfirmedSlots: [...slots.values()],
    };
  }

  const { response } = invocation;
  if (response.outcome === "failed") {
    return { outcome: "failed", error: response.error, unconfirmedSlots: [] };
  }

  const derivedFiles = readDerivedFiles(file.path, response, slots);
  return derivedFiles === null
    ? {
      outcome: "failed",
      error: "the sandbox answered with a file outside this attachment or its write slots",
      unconfirmedSlots: [...slots.values()],
    }
    : { outcome: "prepared", derivedFiles };
}

/**
 * Records the result under the session row lock, which every writer of `/files` paths takes, so the
 * paths checked here stay free until the rows are inserted.
 */
async function recordPreparation(
  scope: WorkspaceDatabaseScope,
  sessionId: string,
  file: ChatSessionFile,
  preparation: Preparation,
): Promise<RecordedPreparation> {
  return transactionWithWorkspaceScope(scope, async (executor): Promise<RecordedPreparation> => {
    await lockChatSessionWithExecutor(executor, scope, sessionId);
    const prepared = await selectChatAttachmentDerivativesPreparedWithExecutor(executor, scope, file.fileId);
    if (prepared !== false) {
      return { outcome: "superseded" };
    }

    if (preparation.outcome === "failed") {
      const error = toStoredDerivativeError(preparation.error);
      await finishChatAttachmentDerivativesWithExecutor(executor, scope, file.fileId, error);
      return { outcome: "failed", error };
    }

    const conflict = findChatFilePathConflict([
      ...await listChatFilePathsWithExecutor(executor, scope, sessionId),
      ...preparation.derivedFiles.map((derivedFile) => derivedFile.path),
    ]);
    if (conflict !== null) {
      const error = toStoredDerivativeError(`the derived path ${conflict} is already taken`);
      await finishChatAttachmentDerivativesWithExecutor(executor, scope, file.fileId, error);
      return { outcome: "failed", error };
    }

    for (const derivedFile of preparation.derivedFiles) {
      await insertChatDerivedFileWithExecutor(executor, scope, {
        fileId: derivedFile.fileId,
        sessionId,
        sourceFileId: file.fileId,
        path: derivedFile.path,
        mediaType: resolveChatFileMediaTypeFromPath(derivedFile.path),
        sizeBytes: derivedFile.sizeBytes,
        sha256: derivedFile.sha256,
        s3Key: derivedFile.s3Key,
      });
    }
    await finishChatAttachmentDerivativesWithExecutor(executor, scope, file.fileId, null);
    return { outcome: "prepared" };
  });
}

/** Uploads no row names: the sandbox's unconfirmed slots, or derived files the record step refused. */
function logUnrecordedUploads(
  observationScope: BackendObservationScope,
  preparation: Preparation,
  recorded: RecordedPreparation,
): void {
  if (preparation.outcome === "failed") {
    logOrphanedChatFileUploads(observationScope, preparation.unconfirmedSlots, "sandbox_unconfirmed", null);
    return;
  }

  if (recorded.outcome !== "prepared") {
    logOrphanedChatFileUploads(
      observationScope,
      preparation.derivedFiles,
      recorded.outcome === "superseded" ? "already_converted" : "path_taken",
      null,
    );
  }
}

/** One sandbox call: derives the files, records them or the error, and logs one record, also when it throws. */
async function prepareAttachmentDerivatives(
  scope: WorkspaceDatabaseScope,
  sessionId: string,
  pending: PendingAttachment,
  signal: AbortSignal | null,
  observationScope: BackendObservationScope,
): Promise<void> {
  const { file, kind } = pending;
  const startedAt = Date.now();
  let slots: ReadonlyMap<string, ChatFileWriteSlot> = new Map();
  let invocation: ChatSandboxInvocation<ChatSandboxPrepareResponse> | null = null;
  let preparation: Preparation | null = null;
  let recorded: RecordedPreparation;
  try {
    invocation = await invokeChatSandbox({
      prepare: async (): Promise<ChatSandboxPrepareRequest> => {
        const attemptSlots = createChatFileWriteSlots(sessionId, countDerivativeWriteSlots(kind));
        const request: ChatSandboxPrepareRequest = {
          operation: "prepare",
          sessionId,
          file: {
            path: file.path,
            mediaType: file.mediaType,
            sizeBytes: file.sizeBytes,
            getUrl: await createChatFileDownloadUrl(file.s3Key),
          },
          writeSlots: await signChatFileWriteSlots(attemptSlots),
        };
        slots = attemptSlots;
        return request;
      },
      abandon: (error) => {
        logOrphanedChatFileUploads(observationScope, [...slots.values()], "sandbox_unconfirmed", error);
      },
    }, chatSandboxPrepareResponseSchema, signal, observationScope);
    preparation = readPreparation(file, invocation, slots);
    recorded = await recordPreparation(scope, sessionId, file, preparation);
  } catch (error) {
    // Abandoned sandbox attempts logged their slots already; an answer whose record step threw is logged here.
    if (preparation !== null) {
      logOrphanedChatFileUploads(
        observationScope,
        preparation.outcome === "prepared" ? preparation.derivedFiles : preparation.unconfirmedSlots,
        "write_failed",
        error,
      );
    }
    writeCloudWatchRecord({
      action: "chat_file_derivatives_prepared",
      scope: observationScope,
      details: {
        fileId: file.fileId,
        mediaType: file.mediaType,
        sizeBytes: file.sizeBytes,
        outcome: "thrown",
        derivedFileCount: 0,
        derivedBytes: 0,
        durationMs: Date.now() - startedAt,
        sandboxRequestId: invocation?.sandboxRequestId ?? null,
        sandboxErrorType: invocation?.status === "failed" ? invocation.error.errorType : null,
        derivativesError: null,
        errorClass: error instanceof Error ? error.name : "UnknownError",
      },
    }, "breadcrumb");
    throw error;
  }

  logUnrecordedUploads(observationScope, preparation, recorded);
  const derivedFiles = preparation.outcome === "prepared" && recorded.outcome === "prepared"
    ? preparation.derivedFiles
    : [];
  const event = {
    action: "chat_file_derivatives_prepared",
    scope: observationScope,
    details: {
      fileId: file.fileId,
      mediaType: file.mediaType,
      sizeBytes: file.sizeBytes,
      outcome: recorded.outcome,
      derivedFileCount: derivedFiles.length,
      derivedBytes: derivedFiles.reduce((total, derivedFile) => total + derivedFile.sizeBytes, 0),
      durationMs: Date.now() - startedAt,
      sandboxRequestId: invocation.sandboxRequestId,
      sandboxErrorType: invocation.status === "failed" ? invocation.error.errorType : null,
      derivativesError: recorded.outcome === "failed" ? recorded.error : null,
      errorClass: null,
    },
  } as const;
  if (recorded.outcome === "failed") {
    writeCloudWatchRecord({ ...event, message: "No files could be derived from a chat attachment." }, "warning");
    return;
  }

  writeCloudWatchRecord(event, "breadcrumb");
}

function buildChatFileDerivativeIndex(files: ReadonlyArray<ChatSessionFile>): ChatFileDerivativeIndex {
  const derivedPathsBySource = new Map<string, Array<string>>();
  for (const file of files) {
    if (file.sourceFileId !== null) {
      const derivedPaths = derivedPathsBySource.get(file.sourceFileId) ?? [];
      derivedPaths.push(file.path);
      derivedPathsBySource.set(file.sourceFileId, derivedPaths);
    }
  }

  return new Map(files.flatMap((file) => file.origin === "attachment" && file.derivativesPrepared
    ? [[file.fileId, { derivedPaths: derivedPathsBySource.get(file.fileId) ?? [], error: file.derivativesError }] as const]
    : []));
}

/**
 * Runs before a chat run builds its history: every attachment of the session that text, CSV or sqlite
 * files can be derived from and that was not prepared yet gets one sandbox call. A call that failed, a
 * file the sandbox could not read and a sandbox that did not finish alike, is recorded as the
 * attachment's derivatives_error and never tried again; only a sandbox the worker could not reach throws.
 * Returns what every prepared attachment of the session yielded.
 */
export async function prepareChatFileDerivatives(
  scope: WorkspaceDatabaseScope,
  sessionId: string,
  signal: AbortSignal | null,
  observationScope: BackendObservationScope,
): Promise<ChatFileDerivativeIndex> {
  const files = await listChatSessionFiles(scope, sessionId);
  const pendingAttachments = files.flatMap((file): ReadonlyArray<PendingAttachment> => {
    const kind = findChatFileDerivativeKind(file.mediaType);
    return file.origin === "attachment" && !file.derivativesPrepared && kind !== null ? [{ file, kind }] : [];
  });
  for (const pending of pendingAttachments) {
    await prepareAttachmentDerivatives(scope, sessionId, pending, signal, observationScope);
  }

  return buildChatFileDerivativeIndex(
    pendingAttachments.length === 0 ? files : await listChatSessionFiles(scope, sessionId),
  );
}
