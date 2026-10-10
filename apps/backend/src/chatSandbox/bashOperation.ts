import { posix } from "node:path";
import type { Bash, BashOptions, InMemoryFs } from "just-bash";
import { cutHeadAtCodePoint } from "../shared/codePointCuts";
import {
  cutToHeadAndTail,
  maximumBashCommandSeconds,
  maximumChatFilePathBytes,
  maximumTransportedStreamChars,
  type ChatSandboxBashRequest,
  type ChatSandboxBashResponse,
} from "./contract";
import { PresignedObjectReader, PresignedReadOnlyFs, type PresignedFile } from "./presignedFs";
import { sha256Hex, uploadToWriteSlots, type SlotFile } from "./slotUploads";

const filesMountPoint = "/files";
const workMountPoint = "/work";
const mebibyte = 1024 * 1024;
/** Bytes `/work` may hold in memory during one call, which also bounds what one command saves. */
const maximumWorkBytes = 512 * mebibyte;
/** Every kept file costs one pre-signed URL in each later request, whose payload Lambda caps at 6 MB. */
const maximumWorkFiles = 500;

/**
 * The hardened profile with work, size and time limits raised until a 20 MB CSV goes through grep, rg,
 * awk, sort, xan, sed and python3 over stdin in about 1.5 GB, with the time limit leaving room for the
 * uploads inside the Lambda's 2-minute timeout. A command over a limit fails with just-bash's own error.
 */
const executionLimits: NonNullable<BashOptions["executionLimits"]> = {
  maxCommandCount: 1_000_000,
  maxLoopIterations: 1_000_000,
  maxAwkIterations: 10_000_000,
  maxSedIterations: 10_000_000,
  maxJqIterations: 10_000_000,
  maxBraceExpansionResults: 1_000_000,
  maxArrayElements: 10_000_000,
  maxCsvRows: 10_000_000,
  maxCsvCells: 100_000_000,
  maxWorkUnits: 1_000_000_000,
  maxStringLength: 256 * mebibyte,
  maxLiveBytes: 1_024 * mebibyte,
  maxInputBytes: 1_024 * mebibyte,
  maxOutputSize: 256 * mebibyte,
  maxHeredocSize: 64 * mebibyte,
  maxDatabaseBytes: 512 * mebibyte,
  maxDatabaseResultBytes: 128 * mebibyte,
  maxWorkerMessageBytes: 128 * mebibyte,
  maxExecutionTimeMs: maximumBashCommandSeconds * 1_000,
  maxPythonTimeoutMs: 60_000,
  maxSqliteTimeoutMs: 60_000,
};

/** Thrown by a `/work` file's loader when the change scan reads it at the path it was seeded at. */
class UnchangedWorkFileSignal extends Error {
  public constructor() {
    super("The work file still holds the content it was seeded with.");
    this.name = "UnchangedWorkFileSignal";
  }
}

/** The path the change scan is reading, or null while the command runs. */
type WorkScanState = { readingPath: string | null };

type CommandOutput = Readonly<{
  stdout: string;
  stderr: string;
  exitCode: number;
}>;

type WorkChanges = Readonly<{
  changedFiles: ReadonlyArray<SlotFile>;
  deletedPaths: ReadonlyArray<string>;
  fileCount: number;
}>;

/** Session files keyed by their path inside the mount, such as `/book.pdf` for `/files/book.pdf`. */
function selectMountedFiles(
  request: ChatSandboxBashRequest,
  mountPoint: string,
): ReadonlyMap<string, PresignedFile> {
  const prefix = `${mountPoint}/`;
  return new Map(request.files.flatMap((file) => file.path.startsWith(prefix)
    ? [[file.path.slice(mountPoint.length), { sizeBytes: file.sizeBytes, getUrl: file.getUrl }] as const]
    : []));
}

async function listFilePaths(fs: InMemoryFs, directory: string): Promise<ReadonlyArray<string>> {
  const entries = await fs.readdirWithFileTypes(directory);
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = posix.join(directory, entry.name);
    if (entry.isDirectory) {
      return listFilePaths(fs, path);
    }

    return entry.isFile ? [path] : [];
  }));
  return nested.flat();
}

/**
 * Null when `path` still holds what it was seeded with. A seeded file nothing replaced is still lazy, so
 * its loader answers with the signal instead of downloading it; a seeded file the command read is
 * compared with what was downloaded.
 */
async function readChangedWorkFile(
  work: InMemoryFs,
  path: string,
  seeded: boolean,
  reader: PresignedObjectReader,
  scan: WorkScanState,
): Promise<Uint8Array | null> {
  let bytes: Uint8Array;
  scan.readingPath = path;
  try {
    bytes = await work.readFileBuffer(path);
  } catch (error) {
    if (error instanceof UnchangedWorkFileSignal) {
      return null;
    }

    throw error;
  } finally {
    scan.readingPath = null;
  }

  if (!seeded) {
    return bytes;
  }

  const seededSha256 = await reader.readDownloadedSha256(`${workMountPoint}${path}`);
  return seededSha256 === sha256Hex(bytes) ? null : bytes;
}

/** Symlinks and empty directories are not kept: a chat file is a path with bytes. */
async function collectWorkChanges(
  work: InMemoryFs,
  seededFiles: ReadonlyMap<string, PresignedFile>,
  reader: PresignedObjectReader,
  scan: WorkScanState,
): Promise<WorkChanges> {
  const paths = await listFilePaths(work, "/");
  const changedFiles: Array<SlotFile> = [];
  for (const path of paths) {
    const bytes = await readChangedWorkFile(work, path, seededFiles.has(path), reader, scan);
    if (bytes !== null) {
      changedFiles.push({ path: `${workMountPoint}${path}`, bytes });
    }
  }

  const presentPaths = new Set(paths);
  return {
    changedFiles,
    deletedPaths: [...seededFiles.keys()]
      .filter((path) => !presentPaths.has(path))
      .map((path) => `${workMountPoint}${path}`),
    fileCount: paths.length,
  };
}

function findWorkSaveRefusal(changes: WorkChanges, slotCount: number): string | null {
  if (changes.changedFiles.length > slotCount) {
    return `the command changed ${changes.changedFiles.length} files, and one command can save at most ${slotCount}`;
  }

  if (changes.fileCount > maximumWorkFiles) {
    return `/work would hold ${changes.fileCount} files, and a chat keeps at most ${maximumWorkFiles}; delete files you no longer need`;
  }

  const longPath = changes.changedFiles.find((file) => Buffer.byteLength(file.path) > maximumChatFilePathBytes);
  return longPath === undefined
    ? null
    : `a path is longer than ${maximumChatFilePathBytes} bytes: ${cutHeadAtCodePoint(longPath.path, 120)}`;
}

/**
 * just-bash 3.6 lets the file system error of a failed output redirect, such as `> /files/x`, escape
 * `exec` instead of failing the command, so it is reported the way bash reports a failed redirect.
 * Changes the command made under /work before that point are kept, as a shell would keep them.
 */
async function execCommand(bash: Bash, command: string): Promise<CommandOutput> {
  try {
    // rawScript keeps the indentation of a heredoc, which a python3 script depends on.
    return await bash.exec(command, { rawScript: true });
  } catch (error) {
    if (error instanceof Error && /^E[A-Z]+: /u.test(error.message)) {
      return { stdout: "", stderr: `bash: ${error.message}\n`, exitCode: 1 };
    }

    throw error;
  }
}

function cutStream(text: string): string {
  const { head, tail } = cutToHeadAndTail(text, maximumTransportedStreamChars);
  return `${head}${tail}`;
}

function appendLine(text: string, line: string): string {
  return text === "" || text.endsWith("\n") ? `${text}${line}\n` : `${text}\n${line}\n`;
}

/**
 * Runs one command over a fresh in-memory file system: `/files` read-only, `/work` writable and seeded
 * with the session's work files, which load only when read. Afterwards the changed `/work` files are
 * uploaded to the write slots, all of them or, when a limit refuses the save, none.
 */
export async function runChatSandboxBash(request: ChatSandboxBashRequest): Promise<ChatSandboxBashResponse> {
  // The package's CommonJS build cannot locate its python3 and sqlite3 workers, so its ES module
  // build is loaded; esbuild keeps this import() as it is in the CommonJS bundle.
  const { Bash, DefenseInDepthBox, InMemoryFs, MountableFs } = await import("just-bash");
  const startedAt = Date.now();
  const mountedAt = new Date(startedAt);
  const reader = new PresignedObjectReader((run) => DefenseInDepthBox.runTrustedAsync(run));
  const scan: WorkScanState = { readingPath: null };

  const seededWorkFiles = selectMountedFiles(request, workMountPoint);
  const work = new InMemoryFs({}, { maxTotalBytes: maximumWorkBytes });
  for (const [path, file] of seededWorkFiles) {
    work.writeFileLazy(path, async () => {
      if (scan.readingPath === path) {
        throw new UnchangedWorkFileSignal();
      }

      return reader.read(`${workMountPoint}${path}`, file);
    }, { mtime: mountedAt });
  }

  const root = new InMemoryFs();
  root.mkdirSync("/tmp");
  const fs = new MountableFs({
    base: root,
    mounts: [
      {
        mountPoint: filesMountPoint,
        filesystem: new PresignedReadOnlyFs(
          filesMountPoint,
          selectMountedFiles(request, filesMountPoint),
          reader,
          mountedAt,
        ),
      },
      { mountPoint: workMountPoint, filesystem: work },
    ],
  });
  const bash = new Bash({
    fs,
    cwd: workMountPoint,
    env: { HOME: workMountPoint },
    python: true,
    executionLimitProfile: "hardened",
    executionLimits,
  });
  const result = await execCommand(bash, request.command);
  reader.throwIfAnyDownloadFailed();

  const changes = await collectWorkChanges(work, seededWorkFiles, reader, scan);
  const refusal = findWorkSaveRefusal(changes, request.writeSlots.length);
  const writtenFiles = refusal === null ? await uploadToWriteSlots(changes.changedFiles, request.writeSlots) : [];
  const stderr = refusal === null
    ? result.stderr
    : appendLine(result.stderr, `bash: nothing under /work was saved: ${refusal}.`);

  return {
    stdout: cutStream(result.stdout),
    stdoutBytes: Buffer.byteLength(result.stdout),
    stderr: cutStream(stderr),
    stderrBytes: Buffer.byteLength(stderr),
    exitCode: refusal !== null && result.exitCode === 0 ? 1 : result.exitCode,
    durationMs: Date.now() - startedAt,
    writtenFiles: [...writtenFiles],
    deletedPaths: refusal === null ? [...changes.deletedPaths] : [],
  };
}
