import { zstdDecompressSync } from "node:zlib";
import type { Command, ExecResult, ResolvedCommandContext } from "just-bash";

const mebibyte = 1024 * 1024;
/** just-bash's own cap on one command's output (`maxOutputSize`), so a `-c` result always fits it. */
const maximumZstdOutputBytes = 256 * mebibyte;
const usage = "usage: zstd -d [-c | -o OUT] FILE";

type ZstdInvocation = Readonly<{
  inputPath: string;
  output: Readonly<{ kind: "stdout" }> | Readonly<{ kind: "file"; path: string }>;
}>;

class ZstdError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ZstdError";
  }
}

/** `-f` and `-q` change nothing here: an output is always overwritten, and only errors are printed. */
function parseZstdArguments(args: ReadonlyArray<string>): ZstdInvocation {
  const flags = new Set<string>();
  const paths: Array<string> = [];
  let outputPath: string | null = null;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "-o") {
      const next = args[index + 1];
      if (next === undefined) {
        throw new ZstdError(`-o needs an output path; ${usage}`);
      }

      outputPath = next;
      index += 1;
    } else if (arg === "--decompress" || arg === "--stdout") {
      flags.add(arg === "--decompress" ? "d" : "c");
    } else if (/^-[a-z]+$/u.test(arg)) {
      for (const flag of arg.slice(1)) {
        if (!"dcfq".includes(flag)) {
          throw new ZstdError(flag === "o"
            ? `pass -o OUT as its own argument; ${usage}`
            : `-${flag} is not supported: this zstd only decompresses; ${usage}`);
        }

        flags.add(flag);
      }
    } else {
      paths.push(arg);
    }
  }

  if (!flags.has("d")) {
    throw new ZstdError(`this zstd only decompresses, so pass -d; ${usage}`);
  }

  if (paths.length !== 1) {
    throw new ZstdError(`pass exactly one input file, and loop over several; ${usage}`);
  }

  const [inputPath] = paths;
  if (flags.has("c") && outputPath !== null) {
    throw new ZstdError(`pass either -c or -o OUT; ${usage}`);
  }

  if (flags.has("c")) {
    return { inputPath, output: { kind: "stdout" } };
  }

  if (outputPath !== null) {
    return { inputPath, output: { kind: "file", path: outputPath } };
  }

  if (!inputPath.endsWith(".zst") || inputPath === ".zst") {
    throw new ZstdError(`${inputPath} has no .zst suffix to drop: name the output with -o OUT or print it with -c`);
  }

  return { inputPath, output: { kind: "file", path: inputPath.slice(0, -".zst".length) } };
}

/** A file system error such as `ENOENT: ...` or `EROFS: ...`, which the command's code should see. */
function isFileSystemError(error: unknown): error is Error {
  return error instanceof Error && /^E[A-Z]+: /u.test(error.message);
}

/** zlib fails a corrupt frame with a `ZSTD_error_*` code, a cut-off or empty one with `Z_BUF_ERROR`. */
function decompress(bytes: Uint8Array, path: string): Buffer {
  try {
    return zstdDecompressSync(bytes, { maxOutputLength: maximumZstdOutputBytes });
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : null;
    if (code === "ERR_BUFFER_TOO_LARGE") {
      throw new ZstdError(`${path} decompresses to more than ${maximumZstdOutputBytes / mebibyte} MB`);
    }

    if (error instanceof Error && code !== null && (code.startsWith("ZSTD_error_") || code === "Z_BUF_ERROR")) {
      throw new ZstdError(`${path} is not valid zstd data: ${error.message}`);
    }

    throw error;
  }
}

async function runZstd(args: ReadonlyArray<string>, context: ResolvedCommandContext): Promise<ExecResult> {
  const invocation = parseZstdArguments(args);
  let input: Uint8Array;
  try {
    input = await context.fs.readFileBuffer(context.fs.resolvePath(context.cwd, invocation.inputPath));
  } catch (error) {
    if (isFileSystemError(error)) {
      throw new ZstdError(`cannot read ${invocation.inputPath}: ${error.message}`);
    }

    throw error;
  }

  context.executionScope?.throwIfAborted("zstd");
  const output = decompress(input, invocation.inputPath);
  if (invocation.output.kind === "stdout") {
    return { stdout: output.toString("latin1"), stdoutKind: "bytes", stdoutEncoding: "binary", stderr: "", exitCode: 0 };
  }

  try {
    await context.fs.writeFile(context.fs.resolvePath(context.cwd, invocation.output.path), output);
  } catch (error) {
    if (isFileSystemError(error)) {
      throw new ZstdError(`cannot write ${invocation.output.path}: ${error.message}`);
    }

    throw error;
  }

  return { stdout: "", stderr: "", exitCode: 0 };
}

/** Decompresses one zstd file over the sandbox file system with Node's own zstd. */
export function createZstdCommand(): Command {
  return {
    name: "zstd",
    execute: async (args, context): Promise<ExecResult> => {
      try {
        return await runZstd(args, context);
      } catch (error) {
        if (error instanceof ZstdError) {
          return { stdout: "", stderr: `zstd: ${error.message}\n`, exitCode: 1 };
        }

        throw error;
      }
    },
  };
}
