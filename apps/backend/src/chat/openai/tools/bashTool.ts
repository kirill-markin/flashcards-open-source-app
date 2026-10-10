import { randomUUID } from "node:crypto";
import {
  buildChatFileS3Key,
  createChatFileDownloadUrl,
  createChatFileUploadUrl,
  listChatSessionFiles,
  logOrphanedChatFileUploads,
  recordChatWorkFileChanges,
  type SavedChatWorkFile,
} from "../../../chatFiles";
import { invokeChatSandboxBash, type ChatSandboxInvocation } from "../../../chatSandbox/client";
import {
  cutToHeadAndTail,
  type ChatSandboxBashRequest,
  type ChatSandboxBashResponse,
} from "../../../chatSandbox/contract";
import { writeCloudWatchRecord } from "../../../observability/cloudWatch";
import { cutHeadAtCodePoint } from "../../../shared/codePointCuts";
import { BASH_TOOL_ARGUMENT_VALIDATOR, maximumBashCommandChars } from "./bashToolContract";
import { MAX_TOOL_OUTPUT_CHARS } from "./toolResults";
import type { ExecutedChatToolCall, OpenAIToolContext } from "./tools";

/** Fresh keys one command may fill; each is one pre-signed URL in the request. */
const writeSlotCount = 100;
const maximumPathListChars = 2_000;
const maximumSandboxErrorChars = 2_000;
/** Room kept out of the stream budget for the headers, the path lists and two truncation markers. */
const reservedOutputChars = 5_000;
const truncationHint =
  "read slices instead: wc -c FILE, head -n 50 FILE, sed -n '100,200p' FILE, rg -n PATTERN FILE, or redirect the output to a file under /work";
/** Matched by code unit, so the pattern has no `u` flag. */
const unpairedSurrogatePattern = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

type WriteSlot = Readonly<{
  fileId: string;
  s3Key: string;
}>;

/** The sandbox's answer and the write slots of the attempt that gave it. */
type SandboxAnswer = Readonly<{
  invocation: ChatSandboxInvocation;
  slots: ReadonlyMap<string, WriteSlot>;
  workPaths: ReadonlySet<string>;
}>;

type SandboxCommandLog = Readonly<{
  command: string | null;
  durationMs: number;
  invocation: ChatSandboxInvocation | null;
  filesWritten: number;
  filesDeleted: number;
  outputTruncated: boolean;
  errorClass: string | null;
}>;

type RenderedStream = Readonly<{
  text: string;
  truncated: boolean;
}>;

/**
 * Postgres jsonb, which stores the tool result, rejects U+0000, which binary output carries, and
 * unpaired surrogates, which a command can print. Each becomes one code unit, ␀ (U+2400) or U+FFFD, so
 * the output keeps the length its budget was measured in.
 */
function toJsonbSafeText(text: string): string {
  return text.replaceAll("\u0000", "␀").replace(unpairedSurrogatePattern, "�");
}

function createBashToolResult(
  output: string,
  succeeded: boolean,
  isMutating: boolean,
  toolErrorClass: string | null,
): ExecutedChatToolCall {
  return {
    output: toJsonbSafeText(output),
    isMutating,
    succeeded,
    shouldInvalidateMainContent: false,
    stopReason: null,
    generatedImageTelemetry: null,
    sqlTelemetry: null,
    toolErrorClass,
  };
}

function createWriteSlots(sessionId: string): ReadonlyMap<string, WriteSlot> {
  return new Map(Array.from({ length: writeSlotCount }, () => {
    const fileId = randomUUID();
    return [fileId, { fileId, s3Key: buildChatFileS3Key(sessionId, fileId) }] as const;
  }));
}

/**
 * Maps every written file to a slot this call issued and every deleted path to a work file the session
 * has, because the sandbox runs model-written code and its answer is not trusted further than that.
 */
function readSavedWorkFiles(
  response: ChatSandboxBashResponse,
  slots: ReadonlyMap<string, WriteSlot>,
  workPaths: ReadonlySet<string>,
): ReadonlyArray<SavedChatWorkFile> {
  const writtenPaths = new Set<string>();
  const usedSlotIds = new Set<string>();
  const savedFiles = response.writtenFiles.map((file) => {
    const slot = slots.get(file.slotId);
    if (slot === undefined || usedSlotIds.has(file.slotId) || writtenPaths.has(file.path)) {
      throw new Error(`Chat sandbox reported a work file under an unknown or reused slot. slotId=${file.slotId} path=${file.path}`);
    }

    usedSlotIds.add(file.slotId);
    writtenPaths.add(file.path);
    return { fileId: slot.fileId, path: file.path, sizeBytes: file.sizeBytes, sha256: file.sha256, s3Key: slot.s3Key };
  });
  const unknownDeletedPath = response.deletedPaths.find((path) => !workPaths.has(path) || writtenPaths.has(path));
  if (unknownDeletedPath !== undefined) {
    throw new Error(`Chat sandbox reported deleting a work file the session does not have. path=${unknownDeletedPath}`);
  }

  return savedFiles;
}

/**
 * Lists the session's files and runs the command in the sandbox. Every attempt is signed anew: one GET
 * URL per session file and fresh PUT slots. The slots of an attempt whose answer is lost are logged as
 * possibly orphaned, because the sandbox may still fill them. The model never sees a URL.
 */
async function invokeSandbox(command: string, context: OpenAIToolContext): Promise<SandboxAnswer> {
  // Built for every tool call of the run, not only for image generation.
  const observationScope = context.generatedImageObservationContext.scope;
  const sessionFiles = await listChatSessionFiles(
    { userId: context.userId, workspaceId: context.workspaceId },
    context.sessionId,
  );
  let slots: ReadonlyMap<string, WriteSlot> = new Map();
  const prepareRequest = async (): Promise<ChatSandboxBashRequest> => {
    const attemptSlots = createWriteSlots(context.sessionId);
    const request: ChatSandboxBashRequest = {
      operation: "bash",
      sessionId: context.sessionId,
      command,
      files: await Promise.all(sessionFiles.map(async (file) => ({
        path: file.path,
        sizeBytes: file.sizeBytes,
        getUrl: await createChatFileDownloadUrl(file.s3Key),
      }))),
      writeSlots: await Promise.all([...attemptSlots.values()].map(async (slot) => ({
        slotId: slot.fileId,
        putUrl: await createChatFileUploadUrl(slot.s3Key),
      }))),
    };
    slots = attemptSlots;
    return request;
  };
  const invocation = await invokeChatSandboxBash({
    prepare: prepareRequest,
    abandon: (error) => {
      logOrphanedChatFileUploads(observationScope, [...slots.values()], "sandbox_unconfirmed", error);
    },
  }, context.signal, observationScope);
  return {
    invocation,
    slots,
    workPaths: new Set(sessionFiles.flatMap((file) => file.path.startsWith("/work/") ? [file.path] : [])),
  };
}

/**
 * Records the `/work` files a completed command saved and deleted. A failed call, or an answer this
 * rejects, records nothing, so every slot of its attempt is logged as possibly orphaned.
 */
async function recordSandboxAnswer(
  answer: SandboxAnswer,
  context: OpenAIToolContext,
): Promise<ReadonlyArray<SavedChatWorkFile>> {
  const observationScope = context.generatedImageObservationContext.scope;
  const { invocation } = answer;
  if (invocation.status === "failed") {
    logOrphanedChatFileUploads(observationScope, [...answer.slots.values()], "sandbox_unconfirmed", invocation.error);
    return [];
  }

  let savedFiles: ReadonlyArray<SavedChatWorkFile>;
  try {
    savedFiles = readSavedWorkFiles(invocation.response, answer.slots, answer.workPaths);
  } catch (error) {
    logOrphanedChatFileUploads(observationScope, [...answer.slots.values()], "sandbox_unconfirmed", error);
    throw error;
  }

  await recordChatWorkFileChanges(
    { userId: context.userId, workspaceId: context.workspaceId },
    context.sessionId,
    savedFiles,
    invocation.response.deletedPaths,
    observationScope,
  );
  return savedFiles;
}

/**
 * Keeps the head and tail within `maximumChars` and names how many bytes of the whole stream were left
 * out between them.
 */
function renderStream(text: string, totalBytes: number, maximumChars: number): RenderedStream {
  const { head, tail } = cutToHeadAndTail(text, maximumChars);
  const omittedBytes = totalBytes - Buffer.byteLength(head) - Buffer.byteLength(tail);
  if (omittedBytes <= 0) {
    return { text: `${head}${tail}`, truncated: false };
  }

  return {
    text: `${head}\n[... ${omittedBytes} bytes omitted; ${truncationHint} ...]\n${tail}`,
    truncated: true,
  };
}

/** Stderr keeps at least a quarter of the budget when both streams are long, and less only when shorter. */
function splitStreamBudget(stdoutChars: number, stderrChars: number, budget: number): Readonly<{
  stdout: number;
  stderr: number;
}> {
  if (stdoutChars + stderrChars <= budget) {
    return { stdout: stdoutChars, stderr: stderrChars };
  }

  const stderr = Math.min(stderrChars, Math.max(Math.floor(budget / 4), budget - stdoutChars));
  return { stdout: budget - stderr, stderr };
}

function renderPathList(label: string, paths: ReadonlyArray<string>): ReadonlyArray<string> {
  if (paths.length === 0) {
    return [];
  }

  const shownPaths: Array<string> = [];
  let shownChars = 0;
  for (const path of paths) {
    if (shownPaths.length > 0 && shownChars + path.length > maximumPathListChars) {
      break;
    }

    shownPaths.push(path);
    shownChars += path.length + 2;
  }

  const hiddenCount = paths.length - shownPaths.length;
  return [`${label}: ${shownPaths.join(", ")}${hiddenCount === 0 ? "" : `, and ${hiddenCount} more`}`];
}

function renderCompletedCommand(
  response: ChatSandboxBashResponse,
  savedFiles: ReadonlyArray<SavedChatWorkFile>,
): Readonly<{ output: string; truncated: boolean }> {
  const budget = splitStreamBudget(
    response.stdout.length,
    response.stderr.length,
    MAX_TOOL_OUTPUT_CHARS - reservedOutputChars,
  );
  const stdout = renderStream(response.stdout, response.stdoutBytes, budget.stdout);
  const stderr = renderStream(response.stderr, response.stderrBytes, budget.stderr);
  return {
    output: [
      `Exit code: ${response.exitCode}`,
      "Stdout:",
      stdout.text === "" ? "(empty)" : stdout.text,
      ...(stderr.text === "" ? [] : ["Stderr:", stderr.text]),
      ...renderPathList("Saved", savedFiles.map((file) => file.path)),
      ...renderPathList("Deleted", response.deletedPaths),
    ].join("\n"),
    truncated: stdout.truncated || stderr.truncated,
  };
}

/** `filesWritten` and `filesDeleted` count the `/work` changes recorded as rows, not the ones reported. */
function logSandboxCommand(context: OpenAIToolContext, log: SandboxCommandLog): void {
  const response = log.invocation?.status === "completed" ? log.invocation.response : null;
  writeCloudWatchRecord({
    action: "chat_sandbox_command",
    scope: context.generatedImageObservationContext.scope,
    details: {
      toolCallId: context.toolCallId,
      command: log.command,
      exitCode: response?.exitCode ?? null,
      durationMs: log.durationMs,
      stdoutBytes: response?.stdoutBytes ?? null,
      stderrBytes: response?.stderrBytes ?? null,
      outputTruncated: log.outputTruncated,
      filesWritten: log.filesWritten,
      filesDeleted: log.filesDeleted,
      sandboxRequestId: log.invocation?.sandboxRequestId ?? null,
      errorClass: log.errorClass,
    },
  }, "breadcrumb");
}

/**
 * The output is plain text, like a terminal's. A command that fails is still a completed call; only a
 * sandbox that did not answer, such as one that ran out of time or memory, is a failed one.
 */
export async function executeBashToolCall(
  rawArguments: string,
  context: OpenAIToolContext,
): Promise<ExecutedChatToolCall> {
  context.signal?.throwIfAborted();
  const startedAt = Date.now();
  let command: string;
  try {
    command = BASH_TOOL_ARGUMENT_VALIDATOR.parse(JSON.parse(rawArguments)).command;
  } catch (error) {
    const errorClass = error instanceof Error ? error.name : "UnknownError";
    logSandboxCommand(context, {
      command: null,
      durationMs: Date.now() - startedAt,
      invocation: null,
      filesWritten: 0,
      filesDeleted: 0,
      outputTruncated: false,
      errorClass,
    });
    return createBashToolResult(
      `Error: invalid arguments. Pass {"command": "..."} with a non-empty command of at most ${maximumBashCommandChars} characters.`,
      false,
      false,
      errorClass,
    );
  }

  let answer: SandboxAnswer;
  let answeredInvocation: ChatSandboxInvocation | null = null;
  let savedFiles: ReadonlyArray<SavedChatWorkFile>;
  try {
    answer = await invokeSandbox(command, context);
    answeredInvocation = answer.invocation;
    savedFiles = await recordSandboxAnswer(answer, context);
  } catch (error) {
    logSandboxCommand(context, {
      command,
      durationMs: Date.now() - startedAt,
      invocation: answeredInvocation,
      filesWritten: 0,
      filesDeleted: 0,
      outputTruncated: false,
      errorClass: error instanceof Error ? error.name : "UnknownError",
    });
    throw error;
  }

  const { invocation } = answer;
  if (invocation.status === "failed") {
    logSandboxCommand(context, {
      command,
      durationMs: Date.now() - startedAt,
      invocation,
      filesWritten: 0,
      filesDeleted: 0,
      outputTruncated: false,
      errorClass: invocation.error.errorType,
    });
    return createBashToolResult(
      `Error: the sandbox did not finish the command (${invocation.error.errorType}): `
        + `${cutHeadAtCodePoint(invocation.error.sandboxErrorMessage, maximumSandboxErrorChars)}\n`
        + "No change it made under /work was saved.",
      false,
      false,
      invocation.error.errorType,
    );
  }

  const rendered = renderCompletedCommand(invocation.response, savedFiles);
  logSandboxCommand(context, {
    command,
    durationMs: Date.now() - startedAt,
    invocation,
    filesWritten: savedFiles.length,
    filesDeleted: invocation.response.deletedPaths.length,
    outputTruncated: rendered.truncated,
    errorClass: null,
  });
  return createBashToolResult(
    rendered.output,
    true,
    savedFiles.length > 0 || invocation.response.deletedPaths.length > 0,
    null,
  );
}
