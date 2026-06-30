import { S3Client } from "@aws-sdk/client-s3";
import {
  createBackendObservationScope,
  type BackendObservationScope,
} from "../../observability/sentry";
import type { MediaAssetsStorageConfig } from "./config";
import {
  buildMediaBlobStorageKey,
  buildMediaMultipartUploadStagingStorageKey,
  buildMediaUploadStagingStorageKey,
} from "../storageKeys";

export type S3Error = Error & {
  $metadata: Readonly<{
    httpStatusCode: number;
  }>;
};

export const testWorkspaceId = "11111111-1111-4111-8111-111111111111";
export const testMediaAssetId = "22222222-2222-4222-8222-222222222222";
export const testSessionId = "33333333-3333-4333-8333-333333333333";
export const testLastOperationId = "operation-1";
export const testLastOperationIdSha256 = "187f0349dd12b6dc73d76d86f421cd454facccc36ef9a2ba6956b37abbb31102";
export const testSha256 = "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8";
export const testObjectBytes = Buffer.from("password");
export const testBlobStorageKey = buildMediaBlobStorageKey(testSha256);
export const testUploadStorageKey = buildMediaUploadStagingStorageKey(
  testWorkspaceId,
  testMediaAssetId,
  testLastOperationId,
);
export const testStagingStorageKey = buildMediaMultipartUploadStagingStorageKey(
  testWorkspaceId,
  testMediaAssetId,
  testSessionId,
);
export const testObservationScope: BackendObservationScope = createBackendObservationScope(
  "backend-api",
  "request-1",
  "/workspaces/:workspaceId/media-assets/upload-sessions/:sessionId/complete",
  "POST",
  "user-1",
  testWorkspaceId,
  null,
  null,
  null,
  null,
  null,
);

export function getTestMediaAssetsStorageConfig(): MediaAssetsStorageConfig {
  return {
    bucketName: "test-media-assets-bucket",
  };
}

export function createS3Error(statusCode: number, name: string, message: string): S3Error {
  const error = new Error(message) as S3Error;
  error.name = name;
  error.$metadata = {
    httpStatusCode: statusCode,
  };
  return error;
}

export function createFailingS3Client(error: S3Error): S3Client {
  const client = new S3Client({
    credentials: {
      accessKeyId: "test-access-key",
      secretAccessKey: "test-secret-key",
    },
    region: "us-east-1",
  });
  client.send = (async () => {
    throw error;
  }) as S3Client["send"];
  return client;
}

export function createTestS3Client(): S3Client {
  return new S3Client({
    credentials: {
      accessKeyId: "test-access-key",
      secretAccessKey: "test-secret-key",
    },
    region: "us-east-1",
  });
}

export function createHeadObjectResponse(fixture: Readonly<{
  sizeBytes: number;
  mimeType: string;
  sha256: string;
  workspaceId?: string;
  mediaAssetId?: string;
  lastOperationIdSha256?: string;
  checksumSha256?: string;
  checksumType?: "COMPOSITE" | "FULL_OBJECT";
}>): Readonly<{
  ContentLength: number;
  ContentType: string;
  ChecksumSHA256: string;
  ChecksumType: "COMPOSITE" | "FULL_OBJECT";
  Metadata: Readonly<Record<string, string>>;
}> {
  return {
    ContentLength: fixture.sizeBytes,
    ContentType: fixture.mimeType,
    ChecksumSHA256: Buffer.from(fixture.checksumSha256 ?? fixture.sha256, "hex").toString("base64"),
    ChecksumType: fixture.checksumType ?? "FULL_OBJECT",
    Metadata: {
      "flashcards-sha256": fixture.sha256,
      "flashcards-workspace-id": fixture.workspaceId ?? testWorkspaceId,
      "flashcards-media-asset-id": fixture.mediaAssetId ?? testMediaAssetId,
      "flashcards-last-operation-id-sha256": fixture.lastOperationIdSha256 ?? testLastOperationIdSha256,
    },
  };
}

export function getUnexpectedS3CommandName(command: unknown): string {
  return typeof command === "object" && command !== null ? command.constructor.name : typeof command;
}
