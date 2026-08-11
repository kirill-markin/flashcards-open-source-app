import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
} from "node:child_process";
import { HttpError } from "../../shared/errors";
import { imageJpegCardMediaBlobMimeType } from "../types";

export const imageJpegCardMaxSidePixels = 1_200;
export const imageJpegCardJpegQuality = 82;
export const imageJpegCatalogCoverMaxSidePixels = 2_400;
export const imageJpegCatalogCoverJpegQuality = 90;
export const imageJpegCardMaximumDecodedPixels = 24_000_000;
export const imageJpegCardTransparentPixelLightCardGray = {
  r: 241,
  g: 243,
  b: 244,
} as const;

export type NormalizedImageBytes = Readonly<{
  bytes: Buffer;
  mimeType: typeof imageJpegCardMediaBlobMimeType;
  sizeBytes: number;
}>;

export type ImageNormalizationWorker = Readonly<{
  script: string;
  arguments: ReadonlyArray<string>;
}>;

export type ImageNormalizationProcessDependencies = Readonly<{
  abortProcessFn: () => never;
  killProcessFn: (processId: number, signal: NodeJS.Signals) => void;
  nowFn: () => number;
  spawnFn: (
    command: string,
    arguments_: ReadonlyArray<string>,
    options: SpawnOptionsWithoutStdio & Readonly<{ stdio: "pipe" }>,
  ) => ChildProcessWithoutNullStreams;
}>;

const supportedInputFormats = ["jpeg", "png", "webp"] as const;
const heifCompatibleBrands = ["heic", "heix", "hevc", "hevx", "heif", "mif1", "msf1"] as const;
const minimumImageNormalizationProcessBudgetMs = 1_000;
const standaloneImageNormalizationBudgetMs = 60_000;
const maximumImageNormalizationOutputBytes = 32_000_000;
const maximumImageNormalizationErrorBytes = 32_768;

type ImageNormalizationWorkerErrorKind =
  | "animated"
  | "decode"
  | "dimensions_invalid"
  | "dimensions_too_large"
  | "unsupported";

type ImageNormalizationWorkerError = Readonly<{
  kind: ImageNormalizationWorkerErrorKind;
  detail: string;
}>;

function createImageNormalizationWorkerScript(
  maximumSidePixels: number,
  jpegQuality: number,
): string {
  return String.raw`
"use strict";
const sharp = require(process.argv[1]);
const maximumDecodedPixels = ${imageJpegCardMaximumDecodedPixels};
const supportedFormats = ${JSON.stringify(supportedInputFormats)};
const background = ${JSON.stringify(imageJpegCardTransparentPixelLightCardGray)};
function fail(kind, detail) {
  const error = new Error(detail);
  error.normalizationKind = kind;
  throw error;
}
function validateMetadata(metadata) {
  if (!supportedFormats.includes(metadata.format)) {
    fail("unsupported", metadata.format ?? "unknown");
  }
  const pageCount = metadata.pages ?? 1;
  const frameDelays = metadata.delay ?? [];
  if (pageCount > 1 || frameDelays.length > 1) {
    fail("animated", "animated_or_multipage");
  }
  const width = metadata.width;
  const height = metadata.pageHeight ?? metadata.height;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    fail("dimensions_invalid", "unreadable_dimensions");
  }
  if (width * height > maximumDecodedPixels) {
    fail("dimensions_too_large", String(width * height));
  }
}
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function writeFailure(error) {
  const rawKind = error !== null && typeof error === "object"
    ? error.normalizationKind
    : undefined;
  const message = error instanceof Error ? error.message : String(error);
  const pixelLimit = /pixel limit/i.test(message);
  const kind = typeof rawKind === "string"
    ? rawKind
    : pixelLimit ? "dimensions_too_large" : "decode";
  process.stderr.end(JSON.stringify({ kind, detail: message }), () => {
    process.exitCode = 1;
  });
}
async function main() {
  const inputBytes = await readStdin();
  const metadata = await sharp(inputBytes, {
    animated: true,
    failOn: "warning",
    limitInputPixels: maximumDecodedPixels,
  }).metadata();
  validateMetadata(metadata);
  const outputBytes = await sharp(inputBytes, {
    animated: false,
    failOn: "warning",
    limitInputPixels: maximumDecodedPixels,
  })
    .rotate()
    .resize({
      width: ${maximumSidePixels},
      height: ${maximumSidePixels},
      fit: "inside",
      withoutEnlargement: true,
    })
    .flatten({ background })
    .toColorspace("srgb")
    .jpeg({
      quality: ${jpegQuality},
      progressive: false,
      mozjpeg: false,
    })
    .toBuffer();
  process.stdout.end(outputBytes);
}
main().catch(writeFailure);
`;
}

const productionCardImageNormalizationWorker = Object.freeze({
  script: createImageNormalizationWorkerScript(
    imageJpegCardMaxSidePixels,
    imageJpegCardJpegQuality,
  ),
  arguments: [require.resolve("sharp")],
});

const productionCatalogCoverImageNormalizationWorker = Object.freeze({
  script: createImageNormalizationWorkerScript(
    imageJpegCatalogCoverMaxSidePixels,
    imageJpegCatalogCoverJpegQuality,
  ),
  arguments: [require.resolve("sharp")],
});

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createImageNormalizationDeadlineError(): HttpError {
  return new HttpError(
    503,
    "Media image ingestion cannot safely finish within its request deadline. phase=image_normalization",
    "MEDIA_ASSET_INGESTION_DEADLINE_EXCEEDED",
    { retryAfterSeconds: 1 },
  );
}

function createImageNormalizationUnavailableError(error: unknown): HttpError {
  return new HttpError(
    503,
    `Image normalization worker failed. workerMessage=${toErrorMessage(error)}`,
    "MEDIA_ASSET_IMAGE_PROCESSING_UNAVAILABLE",
  );
}

function createUnsupportedImageFormatError(detectedFormat: string): HttpError {
  return new HttpError(
    415,
    [
      "Image format is unsupported.",
      `supportedFormats=${supportedInputFormats.join(",")}`,
      `detectedFormat=${detectedFormat}`,
    ].join(" "),
    "MEDIA_ASSET_IMAGE_FORMAT_UNSUPPORTED",
  );
}

function createImageDecodeError(message: string): HttpError {
  return new HttpError(
    400,
    `Image bytes could not be decoded as JPEG, PNG, or WebP. decoderMessage=${message}`,
    "MEDIA_ASSET_IMAGE_DECODE_FAILED",
  );
}

function mapWorkerError(error: ImageNormalizationWorkerError): HttpError {
  switch (error.kind) {
    case "animated":
      return new HttpError(
        415,
        "Animated or multipage images are not supported for media asset image ingestion.",
        "MEDIA_ASSET_IMAGE_ANIMATED_UNSUPPORTED",
      );
    case "decode":
      return createImageDecodeError(error.detail);
    case "dimensions_invalid":
      return new HttpError(
        400,
        "Image dimensions could not be read from the decoded metadata.",
        "MEDIA_ASSET_IMAGE_DIMENSIONS_INVALID",
      );
    case "dimensions_too_large":
      return new HttpError(
        413,
        `Decoded image dimensions must be at most ${imageJpegCardMaximumDecodedPixels} pixels`,
        "MEDIA_ASSET_IMAGE_DIMENSIONS_TOO_LARGE",
      );
    case "unsupported":
      return createUnsupportedImageFormatError(error.detail);
  }
}

function detectUnsupportedContainerFormat(inputBytes: Buffer): string | null {
  const header = inputBytes.subarray(0, 12).toString("ascii");
  if (header.startsWith("GIF87a") || header.startsWith("GIF89a")) {
    return "gif";
  }

  if (inputBytes.byteLength < 12 || inputBytes.subarray(4, 8).toString("ascii") !== "ftyp") {
    return null;
  }

  const brandBytes = inputBytes.subarray(8, Math.min(inputBytes.byteLength, 64)).toString("ascii");
  return heifCompatibleBrands.some((brand) => brandBytes.includes(brand))
    ? "heif"
    : null;
}

function parseWorkerError(errorBytes: Buffer): ImageNormalizationWorkerError {
  let parsed: unknown;
  try {
    parsed = JSON.parse(errorBytes.toString("utf8"));
  } catch (error) {
    throw createImageNormalizationUnavailableError(error);
  }
  if (
    typeof parsed !== "object"
    || parsed === null
    || !("kind" in parsed)
    || !("detail" in parsed)
    || typeof parsed.kind !== "string"
    || typeof parsed.detail !== "string"
    || (
      parsed.kind !== "animated"
      && parsed.kind !== "decode"
      && parsed.kind !== "dimensions_invalid"
      && parsed.kind !== "dimensions_too_large"
      && parsed.kind !== "unsupported"
    )
  ) {
    throw createImageNormalizationUnavailableError(
      new TypeError("Worker returned an invalid error payload."),
    );
  }
  return { kind: parsed.kind, detail: parsed.detail };
}

function assertNormalizedJpeg(bytes: Buffer): void {
  if (
    bytes.byteLength < 4
    || bytes[0] !== 0xff
    || bytes[1] !== 0xd8
    || bytes[bytes.byteLength - 2] !== 0xff
    || bytes[bytes.byteLength - 1] !== 0xd9
  ) {
    throw createImageNormalizationUnavailableError(
      new TypeError("Worker returned bytes that are not a complete JPEG."),
    );
  }
}

function appendBoundedChunk(
  chunks: Array<Buffer>,
  chunk: Buffer,
  currentSize: number,
  maximumSize: number,
  fieldName: string,
): number {
  const nextSize = currentSize + chunk.byteLength;
  if (nextSize > maximumSize) {
    throw new RangeError(`${fieldName} exceeded ${maximumSize} bytes.`);
  }
  chunks.push(chunk);
  return nextSize;
}

export function runImageNormalizationWorker(
  inputBytes: Buffer,
  deadlineAtMs: number,
  abortSignal: AbortSignal,
  worker: ImageNormalizationWorker,
  dependencies: ImageNormalizationProcessDependencies,
): Promise<Buffer> {
  if (
    !Number.isSafeInteger(deadlineAtMs)
    || deadlineAtMs - dependencies.nowFn() < minimumImageNormalizationProcessBudgetMs
    || abortSignal.aborted
  ) {
    return Promise.reject(createImageNormalizationDeadlineError());
  }

  let child: ChildProcessWithoutNullStreams;
  try {
    child = dependencies.spawnFn(
      process.execPath,
      ["--input-type=commonjs", "--eval", worker.script, ...worker.arguments],
      { stdio: "pipe" },
    );
  } catch (error) {
    return Promise.reject(createImageNormalizationUnavailableError(error));
  }

  return new Promise<Buffer>((resolve, reject) => {
    const outputChunks: Array<Buffer> = [];
    const errorChunks: Array<Buffer> = [];
    let outputSize = 0;
    let errorSize = 0;
    let terminalError: Error | null = null;
    let spawnError: Error | null = null;
    let closed = false;
    let reapTimer: NodeJS.Timeout | null = null;

    const watchdog = setTimeout(
      () => terminate(createImageNormalizationDeadlineError()),
      Math.max(0, deadlineAtMs - dependencies.nowFn()),
    );
    watchdog.unref();

    const cleanup = (): void => {
      clearTimeout(watchdog);
      if (reapTimer !== null) {
        clearTimeout(reapTimer);
      }
      abortSignal.removeEventListener("abort", onAbort);
      child.stdout.removeListener("data", onStdoutData);
      child.stdout.removeListener("error", onStdoutError);
      child.stderr.removeListener("data", onStderrData);
      child.stderr.removeListener("error", onStderrError);
      child.stdin.removeListener("error", onStdinError);
      child.removeListener("error", onChildError);
      child.removeListener("close", onClose);
    };

    const abortUnreapableProcess = (): never => {
      cleanup();
      return dependencies.abortProcessFn();
    };

    const forceReapAfterUndeliveredSignal = (): void => {
      if (
        closed
        || child.exitCode !== null
        || child.signalCode !== null
        || child.pid === undefined
      ) {
        return;
      }
      try {
        dependencies.killProcessFn(child.pid, "SIGKILL");
      } catch (error) {
        if (
          typeof error === "object"
          && error !== null
          && "code" in error
          && error.code === "ESRCH"
        ) {
          return;
        }
        abortUnreapableProcess();
      }
    };

    const terminate = (error: Error): void => {
      if (terminalError !== null || closed) return;
      terminalError = error;
      let delivered = false;
      try {
        delivered = child.kill("SIGKILL");
      } catch {
        delivered = false;
      }
      if (delivered) return;

      reapTimer = setTimeout(forceReapAfterUndeliveredSignal, 0);
      reapTimer.unref();
    };

    const onAbort = (): void => {
      terminate(createImageNormalizationDeadlineError());
    };

    const onStdoutData = (chunk: Buffer): void => {
      try {
        outputSize = appendBoundedChunk(
          outputChunks,
          chunk,
          outputSize,
          maximumImageNormalizationOutputBytes,
          "Image normalization worker output",
        );
      } catch (error) {
        terminate(error instanceof Error ? error : new Error(String(error)));
      }
    };
    const onStdoutError = (error: Error): void => {
      terminate(error);
    };
    const onStderrData = (chunk: Buffer): void => {
      try {
        errorSize = appendBoundedChunk(
          errorChunks,
          chunk,
          errorSize,
          maximumImageNormalizationErrorBytes,
          "Image normalization worker error output",
        );
      } catch (error) {
        terminate(error instanceof Error ? error : new Error(String(error)));
      }
    };
    const onStderrError = (error: Error): void => {
      terminate(error);
    };
    const onStdinError = (error: NodeJS.ErrnoException): void => {
      if (error.code !== "EPIPE") {
        terminate(error);
      }
    };
    const onChildError = (error: Error): void => {
      spawnError = error;
      if (child.pid !== undefined) {
        terminate(error);
        return;
      }
      closed = true;
      cleanup();
      reject(createImageNormalizationUnavailableError(error));
    };
    const onClose = (
      exitCode: number | null,
      exitSignal: NodeJS.Signals | null,
    ): void => {
      if (closed) return;
      closed = true;
      cleanup();
      if (terminalError !== null) {
        reject(
          terminalError instanceof HttpError
            ? terminalError
            : createImageNormalizationUnavailableError(terminalError),
        );
        return;
      }
      if (spawnError !== null) {
        reject(createImageNormalizationUnavailableError(spawnError));
        return;
      }
      const outputBytes = Buffer.concat(outputChunks, outputSize);
      if (exitCode === 0 && exitSignal === null) {
        try {
          assertNormalizedJpeg(outputBytes);
          resolve(outputBytes);
        } catch (error) {
          reject(error);
        }
        return;
      }
      const errorBytes = Buffer.concat(errorChunks, errorSize);
      try {
        if (exitSignal !== null) {
          throw createImageNormalizationUnavailableError(
            new Error(`Worker exited from signal ${exitSignal}.`),
          );
        }
        reject(mapWorkerError(parseWorkerError(errorBytes)));
      } catch (error) {
        reject(error);
      }
    };

    child.stdout.on("data", onStdoutData);
    child.stdout.once("error", onStdoutError);
    child.stderr.on("data", onStderrData);
    child.stderr.once("error", onStderrError);
    child.stdin.once("error", onStdinError);
    child.once("error", onChildError);
    child.once("close", onClose);
    abortSignal.addEventListener("abort", onAbort, { once: true });
    if (abortSignal.aborted) {
      onAbort();
    }

    try {
      child.stdin.end(inputBytes);
    } catch (error) {
      terminate(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

const productionImageNormalizationProcessDependencies: ImageNormalizationProcessDependencies = {
  abortProcessFn: process.abort,
  killProcessFn: (processId, signal) => {
    process.kill(processId, signal);
  },
  nowFn: Date.now,
  spawnFn: spawn,
};

async function normalizeImageBytes(
  inputBytes: Buffer,
  deadlineAtMs: number,
  abortSignal: AbortSignal,
  worker: ImageNormalizationWorker,
): Promise<NormalizedImageBytes> {
  const unsupportedContainerFormat = detectUnsupportedContainerFormat(inputBytes);
  if (unsupportedContainerFormat !== null) {
    throw createUnsupportedImageFormatError(unsupportedContainerFormat);
  }
  const bytes = await runImageNormalizationWorker(
    inputBytes,
    deadlineAtMs,
    abortSignal,
    worker,
    productionImageNormalizationProcessDependencies,
  );
  return {
    bytes,
    mimeType: imageJpegCardMediaBlobMimeType,
    sizeBytes: bytes.byteLength,
  };
}

export async function normalizeImageBytesForCard(inputBytes: Buffer): Promise<NormalizedImageBytes> {
  const controller = new AbortController();
  return normalizeImageBytes(
    inputBytes,
    Date.now() + standaloneImageNormalizationBudgetMs,
    controller.signal,
    productionCardImageNormalizationWorker,
  );
}

export async function normalizeImageBytesForCardUntilDeadline(
  inputBytes: Buffer,
  deadlineAtMs: number,
  abortSignal: AbortSignal,
): Promise<NormalizedImageBytes> {
  return normalizeImageBytes(
    inputBytes,
    deadlineAtMs,
    abortSignal,
    productionCardImageNormalizationWorker,
  );
}

export async function normalizeImageBytesForCatalogCover(
  inputBytes: Buffer,
): Promise<NormalizedImageBytes> {
  const controller = new AbortController();
  return normalizeImageBytes(
    inputBytes,
    Date.now() + standaloneImageNormalizationBudgetMs,
    controller.signal,
    productionCatalogCoverImageNormalizationWorker,
  );
}

export async function normalizeImageBytesForCatalogCoverUntilDeadline(
  inputBytes: Buffer,
  deadlineAtMs: number,
  abortSignal: AbortSignal,
): Promise<NormalizedImageBytes> {
  return normalizeImageBytes(
    inputBytes,
    deadlineAtMs,
    abortSignal,
    productionCatalogCoverImageNormalizationWorker,
  );
}
