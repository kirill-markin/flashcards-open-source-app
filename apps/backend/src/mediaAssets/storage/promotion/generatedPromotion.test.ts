import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { CopyObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type {
  GeneratedMediaBlobStorageCapability,
  GeneratedMediaBlobWriterExactInput,
} from "../../../chat/cardImages/promotion/jobs";
import { MediaBlobWriterFenceError } from "../../blobLifecycle";
import { buildMediaBlobStorageKey, buildMediaUploadStagingStorageKey } from "../../storageKeys";
import { imageJpegCardMediaBlobNormalizationVersion } from "../../types";
import {
  GeneratedMediaPromotionStorageTerminalError,
  GeneratedMediaPromotionStorageTransientError,
  getGeneratedMediaPromotionS3Client,
  loadGeneratedMediaStagingObjectWithDependencies,
  promoteGeneratedMediaObjectWithCapabilityVerifier,
  promoteGeneratedMediaObjectWithDependencies,
  storeGeneratedMediaStagingObjectWithDependencies,
  type GeneratedMediaObjectPromotionInput,
  type StoreGeneratedMediaStagingObjectInput,
} from "./generatedPromotion";
import { createUploadProofMetadata } from "../proof";
import {
  createS3Error, createTestS3Client, getTestMediaAssetsStorageConfig,
  testMediaAssetId, testObservationScope, testSha256, testWorkspaceId,
} from "../testHelpers";
const operationId = "33333333-3333-4333-8333-333333333333";
const mimeType = "image/jpeg";
const sizeBytes = 42;
const reservationToken = "77777777-7777-4777-8777-777777777777";
const storageCapability = Object.freeze({}) as GeneratedMediaBlobStorageCapability;
type CapabilityVerifier = (
  capability: GeneratedMediaBlobStorageCapability,
  writer: GeneratedMediaBlobWriterExactInput,
) => void;
function input(signal: AbortSignal): GeneratedMediaObjectPromotionInput {
  const promotion = {
    workspaceId: testWorkspaceId, mediaAssetId: testMediaAssetId, operationId,
    stagingStorageKey: buildMediaUploadStagingStorageKey(testWorkspaceId, testMediaAssetId, operationId),
    blobStorageKey: buildMediaBlobStorageKey(testSha256),
    mimeType, sizeBytes, sha256: testSha256,
    observationScope: testObservationScope, signal,
  };
  const writer: GeneratedMediaBlobWriterExactInput = Object.freeze({
    jobId: "88888888-8888-4888-8888-888888888888",
    operationId: promotion.operationId,
    userId: "user-1",
    workspaceId: promotion.workspaceId,
    cardId: "99999999-9999-4999-8999-999999999999",
    targetSide: "back",
    altText: "Generated image",
    mediaAssetId: promotion.mediaAssetId,
    replicaId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    stagingStorageKey: promotion.stagingStorageKey,
    blobStorageKey: promotion.blobStorageKey,
    sha256: promotion.sha256,
    mimeType: promotion.mimeType,
    sizeBytes: promotion.sizeBytes,
    state: "leased",
    retryCount: 0,
    nextAttemptAt: "2099-07-30T09:00:00.000Z",
    leaseToken: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    leaseOwner: "test-worker",
    leaseExpiresAt: "2099-07-30T09:05:00.000Z",
    lastError: null,
    createdAt: "2099-07-30T09:00:00.000Z",
    updatedAt: "2099-07-30T09:00:00.000Z",
    reservationToken,
    normalizationVersion: imageJpegCardMediaBlobNormalizationVersion,
    reservationState: "active",
  });
  return { ...promotion, writer, storageCapability };
}
function headResponse(
  promotionInput: GeneratedMediaObjectPromotionInput,
  metadata: Readonly<Record<string, string>>,
  checksumSha256: string,
): Readonly<{
  ContentLength: number; ContentType: string; ChecksumSHA256: string;
  ChecksumType: "FULL_OBJECT"; Metadata: Readonly<Record<string, string>>;
}> {
  return {
    ContentLength: promotionInput.sizeBytes,
    ContentType: promotionInput.mimeType,
    ChecksumSHA256: Buffer.from(checksumSha256, "hex").toString("base64"),
    ChecksumType: "FULL_OBJECT",
    Metadata: metadata,
  };
}
function stagingResponse(promotionInput: GeneratedMediaObjectPromotionInput) {
  return headResponse(promotionInput, createUploadProofMetadata({
    workspaceId: promotionInput.workspaceId, mediaAssetId: promotionInput.mediaAssetId,
    lastOperationId: promotionInput.operationId, sha256: promotionInput.sha256,
  }), promotionInput.sha256);
}
function permanentResponse(promotionInput: GeneratedMediaObjectPromotionInput) {
  return headResponse(
    promotionInput,
    { "flashcards-sha256": promotionInput.sha256 },
    promotionInput.sha256,
  );
}
async function promote(
  promotionInput: GeneratedMediaObjectPromotionInput,
  send: S3Client["send"],
): Promise<void> {
  return promoteWithVerifier(promotionInput, send, verifyTestCapability);
}
async function promoteWithVerifier(
  promotionInput: GeneratedMediaObjectPromotionInput,
  send: S3Client["send"],
  verifyCapability: CapabilityVerifier,
): Promise<void> {
  const client = createTestS3Client();
  client.send = send;
  await promoteGeneratedMediaObjectWithCapabilityVerifier(
    promotionInput,
    {
      s3Client: client, getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig,
    },
    verifyCapability,
  );
}
function verifyTestCapability(
  capability: GeneratedMediaBlobStorageCapability,
  _writer: GeneratedMediaBlobWriterExactInput,
): void {
  assert.equal(capability, storageCapability);
}
function stagingInput(bytes: Buffer): StoreGeneratedMediaStagingObjectInput {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    workspaceId: testWorkspaceId, mediaAssetId: testMediaAssetId, operationId,
    stagingStorageKey: buildMediaUploadStagingStorageKey(testWorkspaceId, testMediaAssetId, operationId),
    mimeType, sizeBytes: bytes.byteLength, sha256, bytes, observationScope: testObservationScope,
    signal: new AbortController().signal,
  };
}
test("generated staging is reusable, conditional, and cannot be poisoned by different bytes", async () => {
  const firstInput = stagingInput(Buffer.from("first normalized generated image"));
  let storedInput: StoreGeneratedMediaStagingObjectInput | null = null;
  const client = createTestS3Client();
  client.send = (async (command: unknown, options?: Readonly<{ abortSignal?: AbortSignal }>) => {
    assert.ok(options?.abortSignal instanceof AbortSignal);
    if (command instanceof PutObjectCommand) {
      assert.equal(command.input.IfNoneMatch, "*");
      if (storedInput !== null) throw createS3Error(412, "PreconditionFailed", "exists");
      storedInput = firstInput; return {};
    }
    assert.ok(command instanceof HeadObjectCommand); const stored = storedInput;
    if (stored === null) throw createS3Error(404, "NotFound", "missing");
    return headResponse(
      { ...input(stored.signal), sizeBytes: stored.sizeBytes, sha256: stored.sha256 },
      createUploadProofMetadata({
        workspaceId: stored.workspaceId, mediaAssetId: stored.mediaAssetId,
        lastOperationId: stored.operationId, sha256: stored.sha256,
      }),
      stored.sha256,
    );
  }) as S3Client["send"];
  const dependencies = { s3Client: client, getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig };
  const stored = await storeGeneratedMediaStagingObjectWithDependencies(firstInput, dependencies);
  assert.deepEqual(await loadGeneratedMediaStagingObjectWithDependencies(firstInput, dependencies), stored);
  await assert.rejects(
    storeGeneratedMediaStagingObjectWithDependencies(
      stagingInput(Buffer.from("different normalized generated image")), dependencies),
    (error: unknown) => error instanceof GeneratedMediaPromotionStorageTerminalError
      && error.code === "STAGING_CONTENT_INVALID",
  );
  storedInput = null; assert.equal(await loadGeneratedMediaStagingObjectWithDependencies(firstInput, dependencies), null);
});
test("generated promotion handles 409/412 and cross-workspace reuses a tenant-neutral blob", async () => {
  for (const copyStatuses of [[], [409, 409], [412]] as const) {
    const promotionInput = input(new AbortController().signal);
    const commands: Array<string> = [];
    let blobHeads = 0;
    let copyAttempts = 0;
    await promote(promotionInput, (async (command: unknown) => {
      if (command instanceof HeadObjectCommand) {
        commands.push(`head:${String(command.input.Key)}`);
        if (command.input.Key === promotionInput.stagingStorageKey) return stagingResponse(promotionInput);
        blobHeads += 1;
        if (blobHeads === 1) throw createS3Error(404, "NotFound", "missing");
        return permanentResponse(promotionInput);
      }
      assert.ok(command instanceof CopyObjectCommand);
      commands.push("copy");
      assert.deepEqual(command.input.Metadata, { "flashcards-sha256": promotionInput.sha256 });
      assert.equal(command.input.IfNoneMatch, "*");
      copyAttempts += 1;
      const status = copyStatuses[copyAttempts - 1];
      if (status !== undefined) throw createS3Error(status, "ConditionalRequestConflict", "winner");
      return {};
    }) as S3Client["send"]);
    assert.equal(commands[0], `head:${promotionInput.stagingStorageKey}`);
    assert.equal(commands.at(-1), `head:${promotionInput.blobStorageKey}`);
    assert.equal(copyAttempts, copyStatuses[0] === 412 ? 1 : copyStatuses.length + 1);
  }
  const reusedIdentity = {
    workspaceId: "44444444-4444-4444-8444-444444444444",
    mediaAssetId: "55555555-5555-4555-8555-555555555555",
    operationId: "66666666-6666-4666-8666-666666666666",
  };
  const reusedInput: GeneratedMediaObjectPromotionInput = {
    ...input(new AbortController().signal), ...reusedIdentity,
    stagingStorageKey: buildMediaUploadStagingStorageKey(
      reusedIdentity.workspaceId, reusedIdentity.mediaAssetId, reusedIdentity.operationId,
    ),
  };
  const exactReusedInput: GeneratedMediaObjectPromotionInput = {
    ...reusedInput,
    writer: Object.freeze({
      ...reusedInput.writer,
      ...reusedIdentity,
      stagingStorageKey: reusedInput.stagingStorageKey,
    }),
  };
  let copied = false;
  await promote(exactReusedInput, (async (command: unknown) => {
    if (command instanceof CopyObjectCommand) copied = true;
    if (command instanceof HeadObjectCommand && command.input.Key === exactReusedInput.stagingStorageKey) {
      return stagingResponse(exactReusedInput);
    }
    return permanentResponse(exactReusedInput);
  }) as S3Client["send"]);
  assert.equal(copied, false);
  await assert.rejects(
    promote(exactReusedInput, (async (command: unknown) => {
      if (command instanceof HeadObjectCommand && command.input.Key === exactReusedInput.stagingStorageKey) {
        return stagingResponse(exactReusedInput);
      }
      return headResponse(exactReusedInput, {
        "flashcards-sha256": exactReusedInput.sha256, "tenant-user-id": "private-user",
      }, exactReusedInput.sha256);
    }) as S3Client["send"]),
    (error: unknown) => error instanceof GeneratedMediaPromotionStorageTerminalError
      && error.code === "PERMANENT_BLOB_CONFLICT",
  );
});
test("generated promotion terminates corrupt objects, bounds retry, and obeys its deadline", async () => {
  const missingInput = input(new AbortController().signal);
  await assert.rejects(
    promote(missingInput, (async () => {
      throw createS3Error(404, "NotFound", "missing");
    }) as S3Client["send"]),
    (error: unknown) => error instanceof GeneratedMediaPromotionStorageTerminalError
      && error.code === "STAGING_NOT_FOUND",
  );
  const unexpectedError = new Error("storage configuration missing");
  let unexpectedCalls = 0;
  await assert.rejects(
    promote(missingInput, (async () => {
      unexpectedCalls += 1;
      throw unexpectedError;
    }) as S3Client["send"]),
    (error: unknown) => error === unexpectedError,
  );
  assert.equal(unexpectedCalls, 1);
  const corruptInput = input(new AbortController().signal);
  await assert.rejects(
    promote(corruptInput, (async () => headResponse(
      corruptInput,
      createUploadProofMetadata({
        workspaceId: corruptInput.workspaceId, mediaAssetId: corruptInput.mediaAssetId,
        lastOperationId: corruptInput.operationId, sha256: corruptInput.sha256,
      }),
      "0".repeat(64),
    )) as S3Client["send"]),
    (error: unknown) => error instanceof GeneratedMediaPromotionStorageTerminalError
      && error.code === "STAGING_CONTENT_INVALID",
  );
  const mismatchedInput = input(new AbortController().signal);
  await assert.rejects(
    promote(mismatchedInput, (async () => headResponse(
      mismatchedInput,
      createUploadProofMetadata({
        workspaceId: "77777777-7777-4777-8777-777777777777",
        mediaAssetId: mismatchedInput.mediaAssetId,
        lastOperationId: mismatchedInput.operationId,
        sha256: mismatchedInput.sha256,
      }),
      mismatchedInput.sha256,
    )) as S3Client["send"]),
    (error: unknown) => error instanceof GeneratedMediaPromotionStorageTerminalError
      && error.code === "STAGING_PROOF_INVALID",
  );
  const retryInput = input(new AbortController().signal);
  let copyAttempts = 0;
  let blobHeads = 0;
  await assert.rejects(
    promote(retryInput, (async (command: unknown) => {
      if (command instanceof HeadObjectCommand) {
        if (command.input.Key === retryInput.stagingStorageKey) return stagingResponse(retryInput);
        blobHeads += 1;
        throw createS3Error(404, "NotFound", "missing");
      }
      copyAttempts += 1;
      throw createS3Error(400, "RequestTimeout", "timeout");
    }) as S3Client["send"]),
    GeneratedMediaPromotionStorageTransientError,
  );
  assert.equal(blobHeads, 1);
  assert.equal(copyAttempts, 3);
  let authorizationChecks = 0;
  let revalidatedCopyAttempts = 0;
  const revalidationInput = input(new AbortController().signal);
  await assert.rejects(
    promoteWithVerifier(
      revalidationInput,
      (async (command: unknown) => {
        if (command instanceof HeadObjectCommand) {
          if (command.input.Key === revalidationInput.stagingStorageKey) {
            return stagingResponse(revalidationInput);
          }
          throw createS3Error(404, "NotFound", "missing");
        }
        revalidatedCopyAttempts += 1;
        throw createS3Error(409, "ConditionalRequestConflict", "retry");
      }) as S3Client["send"],
      () => {
        authorizationChecks += 1;
        if (authorizationChecks === 4) {
          throw new MediaBlobWriterFenceError("test_retry_revalidation");
        }
      },
    ),
    MediaBlobWriterFenceError,
  );
  assert.equal(authorizationChecks, 4);
  assert.equal(revalidatedCopyAttempts, 1);
  const abortController = new AbortController();
  const deadlineInput = input(abortController.signal);
  let deadlineCopyAttempts = 0;
  const deadlineReason = new Error("worker deadline");
  const operation = promote(deadlineInput, (async (
    command: unknown,
    options: Readonly<{ abortSignal?: AbortSignal }>,
  ) => {
    if (command instanceof HeadObjectCommand) {
      if (command.input.Key === deadlineInput.stagingStorageKey) return stagingResponse(deadlineInput);
      throw createS3Error(404, "NotFound", "missing");
    }
    deadlineCopyAttempts += 1;
    return new Promise((_resolve, reject) => {
      options.abortSignal?.addEventListener("abort", () => reject(options.abortSignal?.reason), { once: true });
    });
  }) as S3Client["send"]);
  setTimeout(() => abortController.abort(deadlineReason), 10);
  await assert.rejects(operation, (error: unknown) => error === deadlineReason);
  assert.equal(deadlineCopyAttempts, 1);
});

test("generated promotion rejects forged capabilities and mismatched payloads before S3", async () => {
  for (const promotionInput of [
    input(new AbortController().signal),
    {
      ...input(new AbortController().signal),
      sha256: "0".repeat(64),
      blobStorageKey: buildMediaBlobStorageKey("0".repeat(64)),
    },
  ]) {
    let calls = 0;
    await assert.rejects(
      promoteGeneratedMediaObjectWithDependencies(
        promotionInput,
        {
          s3Client: Object.assign(createTestS3Client(), {
            send: async () => {
              calls += 1;
              return {};
            },
          }),
          getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig,
        },
      ),
      MediaBlobWriterFenceError,
    );
    assert.equal(calls, 0);
  }
});

test("production generated promotion disables SDK-internal retries", async () => {
  assert.equal(
    await getGeneratedMediaPromotionS3Client().config.maxAttempts(),
    1,
  );
});
