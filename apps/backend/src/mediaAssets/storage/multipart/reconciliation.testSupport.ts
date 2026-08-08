import {
  CopyObjectCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import assert from "node:assert/strict";
import type { ReconcileMultipartMediaAssetUploadInput } from "../contracts";
import {
  createHeadObjectResponse,
  createS3Error,
  getUnexpectedS3CommandName,
  testBlobStorageKey,
  testLastOperationId,
  testMediaAssetId,
  testObservationScope,
  testSha256,
  testStagingStorageKey,
  testWorkspaceId,
} from "../testHelpers";

export const listedParts = [
  {
    partNumber: 1,
    eTag: "\"part-one\"",
    sha256: "1".repeat(64),
  },
  {
    partNumber: 2,
    eTag: "\"part-two\"",
    sha256: "2".repeat(64),
  },
] as const;

export function createListPartsResponse(): Readonly<{
  Parts: ReadonlyArray<Readonly<{
    PartNumber: number;
    ETag: string;
    ChecksumSHA256: string;
  }>>;
  IsTruncated: false;
}> {
  return {
    Parts: listedParts.map((part) => ({
      PartNumber: part.partNumber,
      ETag: part.eTag,
      ChecksumSHA256: Buffer.from(part.sha256, "hex").toString("base64"),
    })),
    IsTruncated: false,
  };
}

export function createInput(
  completedPartsFingerprint: string,
  renewLease: () => Promise<void>,
): ReconcileMultipartMediaAssetUploadInput {
  return {
    workspaceId: testWorkspaceId,
    mediaAssetId: testMediaAssetId,
    stagingStorageKey: testStagingStorageKey,
    blobStorageKey: testBlobStorageKey,
    s3UploadId: "s3-upload-id",
    mimeType: "application/octet-stream",
    sizeBytes: 10,
    sha256: testSha256,
    lastOperationId: testLastOperationId,
    partCount: listedParts.length,
    completedPartsFingerprint,
    renewLease,
    signal: new AbortController().signal,
    observationScope: testObservationScope,
  };
}

export function createMultipartHeadResponse(
  checksumType: "COMPOSITE" | "FULL_OBJECT",
  eTag: string,
): ReturnType<typeof createHeadObjectResponse> {
  return createHeadObjectResponse({
    sizeBytes: 10,
    mimeType: "application/octet-stream",
    sha256: testSha256,
    checksumSha256: checksumType === "FULL_OBJECT"
      ? testSha256
      : "a".repeat(64),
    checksumType,
    eTag,
  });
}

export function createPermanentBlobHeadResponse(
  checksumSha256: string,
): ReturnType<typeof createHeadObjectResponse> {
  return {
    ...createHeadObjectResponse({
      sizeBytes: 10,
      mimeType: "application/octet-stream",
      sha256: testSha256,
      checksumSha256,
      checksumType: "FULL_OBJECT",
      eTag: "\"blob-etag\"",
    }),
    Metadata: {
      "flashcards-sha256": testSha256,
    },
  };
}

export function createS3ClientWithSend(
  send: (command: unknown) => Promise<unknown>,
): S3Client {
  const s3Client = new S3Client({
    credentials: {
      accessKeyId: "test-access-key",
      secretAccessKey: "test-secret-key",
    },
    region: "us-east-1",
  });
  s3Client.send = send as S3Client["send"];
  return s3Client;
}

export function createNormalizationBoundaryS3Client(
  onCopy: () => Promise<unknown>,
): S3Client {
  return createS3ClientWithSend(async (command) => {
    if (command instanceof HeadObjectCommand) {
      if (command.input.Key === testBlobStorageKey) {
        throw createS3Error(404, "NotFound", "missing blob");
      }
      return createMultipartHeadResponse(
        "COMPOSITE",
        "\"multipart-etag\"",
      );
    }
    if (command instanceof CopyObjectCommand) {
      assert.equal(command.input.Key, testStagingStorageKey);
      return onCopy();
    }
    throw new Error(
      `Unexpected S3 command: ${getUnexpectedS3CommandName(command)}`,
    );
  });
}

export function createPromotionBoundaryS3Client(
  onCopy: () => Promise<unknown>,
): S3Client {
  return createS3ClientWithSend(async (command) => {
    if (command instanceof HeadObjectCommand) {
      if (command.input.Key === testBlobStorageKey) {
        throw createS3Error(404, "NotFound", "missing blob");
      }
      return createMultipartHeadResponse(
        "FULL_OBJECT",
        "\"normalized-etag\"",
      );
    }
    if (command instanceof CopyObjectCommand) {
      assert.equal(command.input.Key, testBlobStorageKey);
      return onCopy();
    }
    throw new Error(
      `Unexpected S3 command: ${getUnexpectedS3CommandName(command)}`,
    );
  });
}

