import assert from "node:assert/strict";
import {
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { EventEmitter, getEventListeners } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import sharp from "sharp";
import { HttpError } from "../../shared/errors";
import {
  imageJpegCardMaxSidePixels,
  imageJpegCardTransparentPixelLightCardGray,
  normalizeImageBytesForCard,
  normalizeImageBytesForCardUntilDeadline,
  runImageNormalizationWorker,
  type ImageNormalizationProcessDependencies,
} from "./imageNormalization";
import { imageJpegCardMediaBlobMimeType } from "../types";

type RgbPixel = Readonly<{
  red: number;
  green: number;
  blue: number;
}>;

async function createTransparentPng(): Promise<Buffer> {
  return sharp({
    create: {
      width: 12,
      height: 12,
      channels: 4,
      background: {
        r: 0,
        g: 0,
        b: 0,
        alpha: 0,
      },
    },
  }).png().toBuffer();
}

async function createLargeJpeg(): Promise<Buffer> {
  return sharp({
    create: {
      width: 1_600,
      height: 800,
      channels: 3,
      background: {
        r: 20,
        g: 30,
        b: 40,
      },
    },
  }).jpeg().toBuffer();
}

async function readFirstPixel(bytes: Buffer): Promise<RgbPixel> {
  const rawImage = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
  const red = rawImage.data[0];
  const green = rawImage.data[1];
  const blue = rawImage.data[2];
  if (red === undefined || green === undefined || blue === undefined) {
    throw new Error("Normalized image did not contain a readable RGB pixel.");
  }

  return { red, green, blue };
}

function assertApproximatelyEqual(actual: number, expected: number): void {
  assert.ok(
    Math.abs(actual - expected) <= 4,
    `Expected ${actual} to be within 4 of ${expected}`,
  );
}

test("normalizeImageBytesForCard converts transparent PNG to deterministic metadata-free JPEG", async () => {
  const inputBytes = await createTransparentPng();

  const firstResult = await normalizeImageBytesForCard(inputBytes);
  const secondResult = await normalizeImageBytesForCard(inputBytes);
  const metadata = await sharp(firstResult.bytes).metadata();
  const firstPixel = await readFirstPixel(firstResult.bytes);

  assert.equal(firstResult.mimeType, imageJpegCardMediaBlobMimeType);
  assert.equal(firstResult.sizeBytes, firstResult.bytes.byteLength);
  assert.deepEqual(firstResult.bytes, secondResult.bytes);
  assert.equal(metadata.format, "jpeg");
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.xmp, undefined);
  assertApproximatelyEqual(firstPixel.red, imageJpegCardTransparentPixelLightCardGray.r);
  assertApproximatelyEqual(firstPixel.green, imageJpegCardTransparentPixelLightCardGray.g);
  assertApproximatelyEqual(firstPixel.blue, imageJpegCardTransparentPixelLightCardGray.b);
});

test("normalizeImageBytesForCard constrains the longest side", async () => {
  const inputBytes = await createLargeJpeg();

  const result = await normalizeImageBytesForCard(inputBytes);
  const metadata = await sharp(result.bytes).metadata();

  assert.equal(metadata.width, imageJpegCardMaxSidePixels);
  assert.equal(metadata.height, 600);
});

test("normalizeImageBytesForCard rejects GIF input", async () => {
  const singlePixelGif = Buffer.from(
    "R0lGODlhAQABAPAAAP///wAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==",
    "base64",
  );

  await assert.rejects(
    async () => normalizeImageBytesForCard(singlePixelGif),
    (error: unknown): boolean => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 415);
      assert.equal(error.code, "MEDIA_ASSET_IMAGE_FORMAT_UNSUPPORTED");
      return true;
    },
  );
});

test("deadline-aware normalization rejects before starting native work when budget is exhausted", async () => {
  const inputBytes = await createTransparentPng();
  const controller = new AbortController();

  await assert.rejects(
    normalizeImageBytesForCardUntilDeadline(
      inputBytes,
      Date.now() + 500,
      controller.signal,
    ),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 503);
      assert.equal(error.code, "MEDIA_ASSET_INGESTION_DEADLINE_EXCEEDED");
      return true;
    },
  );
});

const indefinitelyStalledWorkerScripts = {
  metadata: String.raw`
process.stdin.resume();
process.stdin.once("end", () => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
});
`,
  nativeQueue: String.raw`
const { pbkdf2 } = require("node:crypto");
process.stdin.resume();
process.stdin.once("end", () => {
  pbkdf2("input", "salt", 2147483647, 64, "sha512", () => {});
});
`,
  processing: String.raw`
const sharp = require(process.argv[1]);
const chunks = [];
process.stdin.on("data", (chunk) => chunks.push(chunk));
process.stdin.once("end", () => {
  sharp(Buffer.concat(chunks)).blur(1000).toBuffer().catch(() => {});
  setInterval(() => {}, 1000);
});
`,
} as const;

function assertProcessWasReaped(processId: number): void {
  assert.throws(
    () => process.kill(processId, 0),
    (error: unknown) => {
      assert.equal(
        typeof error === "object" && error !== null && "code" in error
          ? error.code
          : null,
        "ESRCH",
      );
      return true;
    },
  );
}

function requireChildProcessId(processId: number | null): number {
  if (processId === null) {
    throw new Error("Normalization worker did not expose a child process id.");
  }
  return processId;
}

for (const [phase, script] of Object.entries(indefinitelyStalledWorkerScripts)) {
  test(`normalization deadline kills and reaps a child stalled in ${phase}`, async () => {
    const controller = new AbortController();
    const listenerCountBefore = getEventListeners(controller.signal, "abort").length;
    let childProcessId: number | null = null;
    const dependencies: ImageNormalizationProcessDependencies = {
      abortProcessFn: () => {
        throw new Error("Normalization supervisor unexpectedly aborted its parent.");
      },
      killProcessFn: (processId, signal) => {
        process.kill(processId, signal);
      },
      nowFn: Date.now,
      spawnFn: (command, arguments_, options) => {
        const child = spawn(command, arguments_, options);
        childProcessId = child.pid ?? null;
        return child;
      },
    };
    const workerArguments = phase === "processing"
      ? [require.resolve("sharp")]
      : [];

    await assert.rejects(
      runImageNormalizationWorker(
        Buffer.from("worker-input"),
        Date.now() + 1_050,
        controller.signal,
        { script, arguments: workerArguments },
        dependencies,
      ),
      (error: unknown) => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.statusCode, 503);
        assert.equal(error.code, "MEDIA_ASSET_INGESTION_DEADLINE_EXCEEDED");
        return true;
      },
    );

    assertProcessWasReaped(requireChildProcessId(childProcessId));
    assert.equal(
      getEventListeners(controller.signal, "abort").length,
      listenerCountBefore,
    );
  });
}

test("normalization abort kills and reaps its child before rejecting", async () => {
  const controller = new AbortController();
  const listenerCountBefore = getEventListeners(controller.signal, "abort").length;
  let childProcessId: number | null = null;
  const dependencies: ImageNormalizationProcessDependencies = {
    abortProcessFn: () => {
      throw new Error("Normalization supervisor unexpectedly aborted its parent.");
    },
    killProcessFn: (processId, signal) => {
      process.kill(processId, signal);
    },
    nowFn: Date.now,
    spawnFn: (command, arguments_, options) => {
      const child = spawn(command, arguments_, options);
      childProcessId = child.pid ?? null;
      return child;
    },
  };
  const result = runImageNormalizationWorker(
    Buffer.from("worker-input"),
    Date.now() + 10_000,
    controller.signal,
    { script: indefinitelyStalledWorkerScripts.metadata, arguments: [] },
    dependencies,
  );
  controller.abort();

  await assert.rejects(
    result,
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.code, "MEDIA_ASSET_INGESTION_DEADLINE_EXCEEDED");
      assert.equal(error.details?.retryAfterSeconds, 1);
      return true;
    },
  );
  assertProcessWasReaped(requireChildProcessId(childProcessId));
  assert.equal(
    getEventListeners(controller.signal, "abort").length,
    listenerCountBefore,
  );
});

type FakeNormalizationChild = Readonly<{
  child: ChildProcessWithoutNullStreams;
  close: (exitCode: number | null, signal: NodeJS.Signals | null) => void;
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
}>;

function createFakeNormalizationChild(
  processId: number | undefined,
  killFn: () => boolean,
): FakeNormalizationChild {
  const childEvents = new EventEmitter();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let exitCode: number | null = null;
  let signalCode: NodeJS.Signals | null = null;
  const child = childEvents as ChildProcessWithoutNullStreams;

  Object.defineProperties(child, {
    pid: { get: () => processId },
    exitCode: { get: () => exitCode },
    signalCode: { get: () => signalCode },
    stdin: { value: stdin },
    stdout: { value: stdout },
    stderr: { value: stderr },
    kill: { value: killFn },
  });

  return {
    child,
    close: (nextExitCode, nextSignalCode) => {
      exitCode = nextExitCode;
      signalCode = nextSignalCode;
      child.emit("close", nextExitCode, nextSignalCode);
    },
    stdin,
    stdout,
    stderr,
  };
}

function createFakeProcessDependencies(
  child: ChildProcessWithoutNullStreams,
  killProcessFn: ImageNormalizationProcessDependencies["killProcessFn"],
): ImageNormalizationProcessDependencies {
  return {
    abortProcessFn: () => {
      throw new Error("Normalization supervisor unexpectedly aborted its parent.");
    },
    killProcessFn,
    nowFn: Date.now,
    spawnFn: () => child,
  };
}

test("normalization maps a spawn error without leaving listeners", async () => {
  const controller = new AbortController();
  const listenerCountBefore = getEventListeners(controller.signal, "abort").length;
  const fake = createFakeNormalizationChild(undefined, () => false);
  const dependencies = createFakeProcessDependencies(
    fake.child,
    () => {
      throw new Error("A process without a pid must not be killed.");
    },
  );
  queueMicrotask(() => fake.child.emit("error", new Error("spawn failed")));

  await assert.rejects(
    runImageNormalizationWorker(
      Buffer.from("worker-input"),
      Date.now() + 5_000,
      controller.signal,
      { script: "", arguments: [] },
      dependencies,
    ),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.code, "MEDIA_ASSET_IMAGE_PROCESSING_UNAVAILABLE");
      return true;
    },
  );

  assert.equal(
    getEventListeners(controller.signal, "abort").length,
    listenerCountBefore,
  );
});

for (const streamName of ["stdin", "stdout", "stderr"] as const) {
  test(`normalization supervises ${streamName} pipe errors until close`, async () => {
    const controller = new AbortController();
    let fake: FakeNormalizationChild;
    let killCalls = 0;
    fake = createFakeNormalizationChild(4321, () => {
      killCalls += 1;
      queueMicrotask(() => fake.close(null, "SIGKILL"));
      return true;
    });
    const dependencies = createFakeProcessDependencies(
      fake.child,
      () => {
        throw new Error("Fallback process kill must not run after delivered SIGKILL.");
      },
    );
    const result = runImageNormalizationWorker(
      Buffer.from("worker-input"),
      Date.now() + 5_000,
      controller.signal,
      { script: "", arguments: [] },
      dependencies,
    );

    fake[streamName].emit("error", new Error(`${streamName} failed`));

    await assert.rejects(
      result,
      (error: unknown) => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.code, "MEDIA_ASSET_IMAGE_PROCESSING_UNAVAILABLE");
        return true;
      },
    );
    assert.equal(killCalls, 1);
  });
}

test("kill false waits for an already-exited child close without signaling a reused pid", async () => {
  const controller = new AbortController();
  let fake: FakeNormalizationChild;
  let fallbackKillCalls = 0;
  fake = createFakeNormalizationChild(4322, () => {
    queueMicrotask(() => fake.close(0, null));
    return false;
  });
  const dependencies = createFakeProcessDependencies(
    fake.child,
    () => {
      fallbackKillCalls += 1;
    },
  );
  const result = runImageNormalizationWorker(
    Buffer.from("worker-input"),
    Date.now() + 5_000,
    controller.signal,
    { script: "", arguments: [] },
    dependencies,
  );

  controller.abort();

  await assert.rejects(result, (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.code, "MEDIA_ASSET_INGESTION_DEADLINE_EXCEEDED");
    return true;
  });
  assert.equal(fallbackKillCalls, 0);
});

test("kill false escalates a live child and still waits for confirmed close", async () => {
  const controller = new AbortController();
  let fake: FakeNormalizationChild;
  let fallbackKillCalls = 0;
  fake = createFakeNormalizationChild(4323, () => false);
  const dependencies = createFakeProcessDependencies(
    fake.child,
    (processId, signal) => {
      assert.equal(processId, 4323);
      assert.equal(signal, "SIGKILL");
      fallbackKillCalls += 1;
      queueMicrotask(() => fake.close(null, "SIGKILL"));
    },
  );
  const result = runImageNormalizationWorker(
    Buffer.from("worker-input"),
    Date.now() + 5_000,
    controller.signal,
    { script: "", arguments: [] },
    dependencies,
  );

  controller.abort();

  await assert.rejects(result, (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.code, "MEDIA_ASSET_INGESTION_DEADLINE_EXCEEDED");
    return true;
  });
  assert.equal(fallbackKillCalls, 1);
});

test("thrown child signal failure escalates and still waits for confirmed close", async () => {
  const controller = new AbortController();
  let fake: FakeNormalizationChild;
  let fallbackKillCalls = 0;
  fake = createFakeNormalizationChild(4325, () => {
    throw new Error("child signal failed");
  });
  const dependencies = createFakeProcessDependencies(
    fake.child,
    () => {
      fallbackKillCalls += 1;
      queueMicrotask(() => fake.close(null, "SIGKILL"));
    },
  );
  const result = runImageNormalizationWorker(
    Buffer.from("worker-input"),
    Date.now() + 5_000,
    controller.signal,
    { script: "", arguments: [] },
    dependencies,
  );

  controller.abort();

  await assert.rejects(result, (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.code, "MEDIA_ASSET_INGESTION_DEADLINE_EXCEEDED");
    return true;
  });
  assert.equal(fallbackKillCalls, 1);
});

test("concurrent abort notifications terminate the child once", async () => {
  const controller = new AbortController();
  let fake: FakeNormalizationChild;
  let killCalls = 0;
  fake = createFakeNormalizationChild(4324, () => {
    killCalls += 1;
    queueMicrotask(() => fake.close(null, "SIGKILL"));
    return true;
  });
  const result = runImageNormalizationWorker(
    Buffer.from("worker-input"),
    Date.now() + 5_000,
    controller.signal,
    { script: "", arguments: [] },
    createFakeProcessDependencies(fake.child, () => {}),
  );

  controller.abort();
  controller.abort();

  await assert.rejects(result);
  assert.equal(killCalls, 1);
});
