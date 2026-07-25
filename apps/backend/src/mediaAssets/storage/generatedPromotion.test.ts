import assert from "node:assert/strict";
import test from "node:test";
import { CopyObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { buildMediaBlobStorageKey, buildMediaUploadStagingStorageKey } from "../storageKeys";
import {
  GeneratedMediaPromotionStorageTerminalError,
  GeneratedMediaPromotionStorageTransientError,
  promoteGeneratedMediaObjectWithDependencies,
  type GeneratedMediaObjectPromotionInput,
} from "./generatedPromotion";
import { createUploadProofMetadata } from "./proof";
import {
  createS3Error, createTestS3Client, getTestMediaAssetsStorageConfig,
  testMediaAssetId, testObservationScope, testSha256, testWorkspaceId,
} from "./testHelpers";
const operationId = "33333333-3333-4333-8333-333333333333";
const mimeType = "image/jpeg";
const sizeBytes = 42;
function input(signal: AbortSignal): GeneratedMediaObjectPromotionInput {
  return {
    workspaceId: testWorkspaceId, mediaAssetId: testMediaAssetId, operationId,
    stagingStorageKey: buildMediaUploadStagingStorageKey(testWorkspaceId, testMediaAssetId, operationId),
    blobStorageKey: buildMediaBlobStorageKey(testSha256),
    mimeType, sizeBytes, sha256: testSha256,
    observationScope: testObservationScope, signal,
  };
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
  const client = createTestS3Client();
  client.send = send;
  await promoteGeneratedMediaObjectWithDependencies(promotionInput, {
    s3Client: client, getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig,
  });
}
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
  let copied = false;
  await promote(reusedInput, (async (command: unknown) => {
    if (command instanceof CopyObjectCommand) copied = true;
    if (command instanceof HeadObjectCommand && command.input.Key === reusedInput.stagingStorageKey) {
      return stagingResponse(reusedInput);
    }
    return permanentResponse(reusedInput);
  }) as S3Client["send"]);
  assert.equal(copied, false);
  await assert.rejects(
    promote(reusedInput, (async (command: unknown) => {
      if (command instanceof HeadObjectCommand && command.input.Key === reusedInput.stagingStorageKey) {
        return stagingResponse(reusedInput);
      }
      return headResponse(reusedInput, {
        "flashcards-sha256": reusedInput.sha256, "tenant-user-id": "private-user",
      }, reusedInput.sha256);
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
