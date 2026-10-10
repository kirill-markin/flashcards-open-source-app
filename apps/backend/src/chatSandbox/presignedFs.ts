import { createHash } from "node:crypto";
import { posix } from "node:path";
import type { FsStat, IFileSystem } from "just-bash";
import { downloadPresignedObject } from "./presignedTransfer";

export type PresignedFile = Readonly<{
  sizeBytes: number;
  getUrl: string;
}>;

type FsErrorCode = "ENOENT" | "EISDIR" | "ENOTDIR" | "EINVAL" | "EROFS";

const fsErrorDescriptions: Readonly<Record<FsErrorCode, string>> = {
  ENOENT: "no such file or directory",
  EISDIR: "illegal operation on a directory",
  ENOTDIR: "not a directory",
  EINVAL: "invalid argument",
  EROFS: "read-only file system",
};
const readOnlyFileMode = 0o444;
const readOnlyDirectoryMode = 0o555;

/** The message shape just-bash's own file systems throw, which its commands turn into shell errors. */
function createFsError(code: FsErrorCode, operation: string, path: string): Error {
  return new Error(`${code}: ${fsErrorDescriptions[code]}, ${operation} '${path}'`);
}

function normalizeMountPath(path: string): string {
  return posix.resolve("/", path);
}

/** just-bash's `DefenseInDepthBox.runTrustedAsync`. */
export type RunTrustedAsync = <Result>(run: () => Promise<Result>) => Promise<Result>;

/**
 * Downloads each session file at most once per call, keyed by its virtual path. A failed download fails
 * the command that read it, and is also kept so that the whole call fails instead of returning output
 * computed without that file.
 */
export class PresignedObjectReader {
  private readonly downloads = new Map<string, Promise<Uint8Array>>();
  private failure: Error | null = null;

  /**
   * A read runs inside a command, where just-bash's defense-in-depth layer blocks the globals `fetch`
   * relies on, so the download runs as trusted host code.
   */
  public constructor(private readonly runTrustedAsync: RunTrustedAsync) {}

  public read(path: string, file: PresignedFile): Promise<Uint8Array> {
    const existing = this.downloads.get(path);
    if (existing !== undefined) {
      return existing;
    }

    const download = this.runTrustedAsync(() => downloadPresignedObject(file.getUrl, path, file.sizeBytes)).catch(
      (error: unknown) => {
        this.failure ??= error instanceof Error ? error : new Error(String(error));
        throw error;
      },
    );
    this.downloads.set(path, download);
    return download;
  }

  /** Lowercase hex SHA-256 of a file this call downloaded, or null when nothing read it. */
  public async readDownloadedSha256(path: string): Promise<string | null> {
    const download = this.downloads.get(path);
    return download === undefined ? null : createHash("sha256").update(await download).digest("hex");
  }

  public throwIfAnyDownloadFailed(): void {
    if (this.failure !== null) {
      throw this.failure;
    }
  }
}

/**
 * Read-only session files, mounted at `mountPoint`. `stat` and `readdir` are answered from the manifest
 * sizes, so listing a directory downloads nothing; the bytes are fetched on the first read.
 */
export class PresignedReadOnlyFs implements IFileSystem {
  private readonly files: ReadonlyMap<string, PresignedFile>;
  private readonly directories: ReadonlyMap<string, ReadonlyArray<string>>;

  /** `files` is keyed by the path inside the mount, such as `/book.pdf`. */
  public constructor(
    private readonly mountPoint: string,
    files: ReadonlyMap<string, PresignedFile>,
    private readonly reader: PresignedObjectReader,
    private readonly mtime: Date,
  ) {
    const children = new Map<string, Set<string>>([["/", new Set()]]);
    for (const path of files.keys()) {
      let child = path;
      while (child !== "/") {
        const parent = posix.dirname(child);
        const siblings = children.get(parent) ?? new Set<string>();
        siblings.add(posix.basename(child));
        children.set(parent, siblings);
        child = parent;
      }
    }
    for (const path of files.keys()) {
      if (children.has(path)) {
        throw new Error(`Session file path is also a directory. path=${mountPoint}${path}`);
      }
    }

    this.files = files;
    this.directories = new Map([...children].map(([path, names]) => [path, [...names].sort()]));
  }

  /** Names the path as the command sees it, under the mount point. */
  private fsError(code: FsErrorCode, operation: string, path: string): Error {
    return createFsError(code, operation, posix.join(this.mountPoint, normalizeMountPath(path)));
  }

  private requireFile(path: string, operation: string): PresignedFile {
    const normalized = normalizeMountPath(path);
    const file = this.files.get(normalized);
    if (file !== undefined) {
      return file;
    }

    throw this.fsError(this.directories.has(normalized) ? "EISDIR" : "ENOENT", operation, path);
  }

  private requireExisting(path: string, operation: string): string {
    const normalized = normalizeMountPath(path);
    if (!this.files.has(normalized) && !this.directories.has(normalized)) {
      throw this.fsError("ENOENT", operation, path);
    }

    return normalized;
  }

  public async readFileBuffer(path: string): Promise<Uint8Array> {
    const file = this.requireFile(path, "open");
    return this.reader.read(`${this.mountPoint}${normalizeMountPath(path)}`, file);
  }

  public async readFile(path: string, options?: Parameters<IFileSystem["readFile"]>[1]): Promise<string> {
    const bytes = await this.readFileBuffer(path);
    const encoding = typeof options === "string" ? options : options?.encoding ?? "utf8";
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString(encoding);
  }

  public async exists(path: string): Promise<boolean> {
    const normalized = normalizeMountPath(path);
    return this.files.has(normalized) || this.directories.has(normalized);
  }

  public async stat(path: string): Promise<FsStat> {
    const normalized = this.requireExisting(path, "stat");
    const file = this.files.get(normalized);
    return {
      isFile: file !== undefined,
      isDirectory: file === undefined,
      isSymbolicLink: false,
      mode: file === undefined ? readOnlyDirectoryMode : readOnlyFileMode,
      size: file?.sizeBytes ?? 0,
      mtime: this.mtime,
      // Commands such as split refuse to work on an input they cannot identify across their own reads.
      identity: `presigned:${posix.join(this.mountPoint, normalized)}`,
    };
  }

  public async lstat(path: string): Promise<FsStat> {
    return this.stat(path);
  }

  public async readdir(path: string): Promise<string[]> {
    const normalized = normalizeMountPath(path);
    const names = this.directories.get(normalized);
    if (names !== undefined) {
      return [...names];
    }

    throw this.fsError(this.files.has(normalized) ? "ENOTDIR" : "ENOENT", "scandir", path);
  }

  public resolvePath(base: string, path: string): string {
    return posix.resolve(base, path);
  }

  public getAllPaths(): string[] {
    return [...this.directories.keys(), ...this.files.keys()];
  }

  public async readlink(path: string): Promise<string> {
    throw this.fsError("EINVAL", "readlink", this.requireExisting(path, "readlink"));
  }

  public async realpath(path: string): Promise<string> {
    return this.requireExisting(path, "realpath");
  }

  /** `mkdir -p` over a directory that already exists succeeds, as it does on a read-only mount. */
  public async mkdir(path: string, options?: Parameters<IFileSystem["mkdir"]>[1]): Promise<void> {
    if (options?.recursive === true && this.directories.has(normalizeMountPath(path))) {
      return;
    }

    throw this.fsError("EROFS", "mkdir", path);
  }

  public async writeFile(path: string): Promise<void> {
    throw this.fsError("EROFS", "write", path);
  }

  public async appendFile(path: string): Promise<void> {
    throw this.fsError("EROFS", "append", path);
  }

  public async createExclusive(path: string): Promise<void> {
    throw this.fsError("EROFS", "open", path);
  }

  public async rm(path: string): Promise<void> {
    throw this.fsError("EROFS", "rm", path);
  }

  public async cp(_source: string, destination: string): Promise<void> {
    throw this.fsError("EROFS", "cp", destination);
  }

  public async mv(source: string): Promise<void> {
    throw this.fsError("EROFS", "rename", source);
  }

  public async chmod(path: string): Promise<void> {
    throw this.fsError("EROFS", "chmod", path);
  }

  public async symlink(_target: string, linkPath: string): Promise<void> {
    throw this.fsError("EROFS", "symlink", linkPath);
  }

  public async link(_existingPath: string, newPath: string): Promise<void> {
    throw this.fsError("EROFS", "link", newPath);
  }

  public async utimes(path: string): Promise<void> {
    throw this.fsError("EROFS", "utime", path);
  }
}
