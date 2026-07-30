import assert from "node:assert/strict";
import test from "node:test";
import {
  DeleteObjectCommand,
  HeadObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { buildMediaBlobStorageKey } from "../storageKeys";
import {
  deletePermanentMediaBlobWithDependencies,
  MediaBlobCleanupStorageAmbiguousDeleteError,
  MediaBlobCleanupStorageConditionalConflictError,
  MediaBlobCleanupStorageTerminalError,
  MediaBlobCleanupStorageTransientError,
} from "./blobCleanup";
import { getMediaBlobCleanupS3Client } from "./config";
import {
  createS3Error,
  createTestS3Client,
  getTestMediaAssetsStorageConfig,
  testObservationScope,
  testSha256,
} from "./testHelpers";

const storageKey = buildMediaBlobStorageKey(testSha256);

function input() {
  return {
    sha256: testSha256,
    storageKey,
    cleanupGeneration: 7,
    renewLease: async () => {},
    signal: new AbortController().signal,
    observationScope: testObservationScope,
  };
}

async function removeWithSend(send: S3Client["send"]) {
  const client = createTestS3Client();
  client.send = send;
  return deletePermanentMediaBlobWithDependencies(input(), {
    s3Client: client,
    getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig,
  });
}

test("permanent blob cleanup treats only an exact-key HEAD 404 as idempotent success", async () => {
  let calls = 0;
  assert.equal(await removeWithSend((async (command: unknown) => {
    calls += 1;
    assert.ok(command instanceof HeadObjectCommand);
    assert.equal(command.input.Key, storageKey);
    throw createS3Error(404, "NotFound", "missing");
  }) as S3Client["send"]), "not_found");
  assert.equal(calls, 1);

  await assert.rejects(
    removeWithSend((async () => {
      throw createS3Error(403, "AccessDenied", "denied");
    }) as S3Client["send"]),
    (error: unknown) => (
      error instanceof MediaBlobCleanupStorageTerminalError
      && error.operation === "head_object"
      && error.statusCode === 403
    ),
  );
});

test("permanent blob cleanup deletes only the validated content-addressed key", async () => {
  const commands: Array<string> = [];
  assert.equal(await removeWithSend((async (command: unknown) => {
    if (command instanceof HeadObjectCommand) {
      commands.push(`head:${String(command.input.Key)}`);
      return { ETag: "\"exact-etag\"" };
    }
    assert.ok(command instanceof DeleteObjectCommand);
    assert.equal(command.input.IfMatch, "\"exact-etag\"");
    commands.push(`delete:${String(command.input.Key)}`);
    return {};
  }) as S3Client["send"]), "deleted");
  assert.deepEqual(commands, [`head:${storageKey}`, `delete:${storageKey}`]);

  await assert.rejects(
    deletePermanentMediaBlobWithDependencies(
      { ...input(), storageKey: "media/uploads/staging-object" },
      {
        s3Client: createTestS3Client(),
        getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig,
      },
    ),
    /exact content-addressed storage key/u,
  );
});

test("permanent blob cleanup renews its exact lease before every S3 operation", async () => {
  const commands: Array<string> = [];
  let renewals = 0;
  const client = createTestS3Client();
  client.send = (async (command: unknown) => {
    assert.ok(
      command instanceof HeadObjectCommand
      || command instanceof DeleteObjectCommand,
    );
    commands.push(command.constructor.name);
    return command instanceof HeadObjectCommand
      ? { ETag: "\"exact-etag\"" }
      : {};
  }) as S3Client["send"];
  assert.equal(
    await deletePermanentMediaBlobWithDependencies(
      {
        ...input(),
        renewLease: async () => {
          renewals += 1;
          if (renewals === 2) {
            throw new Error("exact cleanup lease was lost");
          }
        },
      },
      {
        s3Client: client,
        getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig,
      },
    ).then(
      () => "unexpected success",
      (error: unknown) => {
        assert.match(String(error), /exact cleanup lease was lost/u);
        return "lease rejected";
      },
    ),
    "lease rejected",
  );
  assert.equal(renewals, 2);
  assert.deepEqual(commands, ["HeadObjectCommand"]);
});

test("permanent blob cleanup treats DELETE 404 after HEAD success as idempotent success", async () => {
  const commands: Array<string> = [];
  assert.equal(await removeWithSend((async (command: unknown) => {
    if (command instanceof HeadObjectCommand) {
      commands.push("head");
      return { ETag: "\"exact-etag\"" };
    }
    assert.ok(command instanceof DeleteObjectCommand);
    commands.push("delete");
    throw createS3Error(404, "NoSuchKey", "removed concurrently");
  }) as S3Client["send"]), "not_found");
  assert.deepEqual(commands, ["head", "delete"]);
});

test("permanent blob cleanup preserves an ambiguous conditional delete for durable reconciliation", async () => {
  let headCalls = 0;
  let deleteCalls = 0;
  await assert.rejects(
    removeWithSend((async (command: unknown) => {
      if (command instanceof HeadObjectCommand) {
        headCalls += 1;
        return { ETag: "\"exact-etag\"" };
      }
      assert.ok(command instanceof DeleteObjectCommand);
      assert.equal(command.input.IfMatch, "\"exact-etag\"");
      deleteCalls += 1;
      throw createS3Error(503, "SlowDown", "commit outcome unknown");
    }) as S3Client["send"]),
    (error: unknown) => (
      error instanceof MediaBlobCleanupStorageAmbiguousDeleteError
      && error.operation === "delete_object"
      && error.statusCode === 503
    ),
  );
  assert.equal(headCalls, 1);
  assert.equal(deleteCalls, 1);
});

test("permanent blob cleanup bounds only non-mutating HEAD retries", async () => {
  let boundedHeadCalls = 0;
  await assert.rejects(
    removeWithSend((async (command: unknown) => {
      assert.ok(command instanceof HeadObjectCommand);
      boundedHeadCalls += 1;
      throw createS3Error(503, "SlowDown", "retry");
    }) as S3Client["send"]),
    (error: unknown) => (
      error instanceof MediaBlobCleanupStorageTransientError
      && error.operation === "head_object"
      && error.statusCode === 503
    ),
  );
  assert.equal(boundedHeadCalls, 3);
});

test("permanent blob cleanup retains its fence on a conditional delete conflict", async () => {
  await assert.rejects(
    removeWithSend((async (command: unknown) => {
      if (command instanceof HeadObjectCommand) {
        return { ETag: "\"replaced-object\"" };
      }
      assert.ok(command instanceof DeleteObjectCommand);
      throw createS3Error(
        412,
        "PreconditionFailed",
        "object no longer matches the observed ETag",
      );
    }) as S3Client["send"]),
    (error: unknown) => (
      error instanceof MediaBlobCleanupStorageConditionalConflictError
      && error.statusCode === 412
      && error.storageKey === storageKey
    ),
  );
});

test("permanent blob cleanup requires an exact ETag and disables SDK retries", async () => {
  let calls = 0;
  await assert.rejects(
    removeWithSend((async (command: unknown) => {
      calls += 1;
      assert.ok(command instanceof HeadObjectCommand);
      return {};
    }) as S3Client["send"]),
    (error: unknown) => (
      error instanceof MediaBlobCleanupStorageTerminalError
      && error.operation === "head_object"
    ),
  );
  assert.equal(calls, 1);
  assert.equal(await getMediaBlobCleanupS3Client().config.maxAttempts(), 1);
});
