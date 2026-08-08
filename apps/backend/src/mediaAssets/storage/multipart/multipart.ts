import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
} from "@aws-sdk/client-s3";
import type { CreatedMultipartMediaAssetUpload } from "../../types";
import { MediaBlobWriterFenceError } from "../../blobLifecycle";
import { HttpError } from "../../../shared/errors";
import {
  createExpiresAt,
  multipartUploadExpiresSeconds,
} from "../config";
import type {
  AbortMultipartMediaAssetUploadInput,
  AbortMultipartMediaAssetUploadUntilDeadlineInput,
  AssertMediaAssetObjectInput,
  CompleteMultipartMediaAssetUploadInput,
  CreateMultipartMediaAssetUploadInput,
  MediaAssetStorageContext,
  MediaAssetStorageDependencies,
} from "../contracts";
import {
  createMediaAssetStorageError,
  isNoSuchMultipartUploadError,
  rethrowMediaAssetStorageAbortReason,
  runMediaAssetStorageOperationWithRetries,
  runMediaAssetStorageOperationWithRetriesAndAbortSignal,
} from "../errors";
import { loadMediaAssetObjectMetadataWithAbortSignalAndDependencies } from "../objects";
import {
  assertMediaAssetObjectMetadataMatches,
  assertMediaAssetObjectShapeAndProofMatches,
  createUploadProofMetadata,
  toBase64Sha256Digest,
} from "../proof";
import {
  createMediaAssetCopySource,
  promoteVerifiedMediaAssetUploadToBlobWithCapabilityVerifier,
} from "../promotion/promotion";
import {
  assertMultipartMediaBlobStorageCapabilityForMutation,
  createMediaAssetUploadSessionCompletedPartsFingerprint,
  type MultipartMediaBlobStorageCapability,
  type MultipartMediaBlobWriterAttemptExactInput,
} from "../../uploadSessions";

type MultipartMediaBlobStorageCapabilityVerifier = (
  capability: MultipartMediaBlobStorageCapability,
  writer: MultipartMediaBlobWriterAttemptExactInput,
) => void;

function assertMultipartCompletionInputMatchesWriter(
  input: CompleteMultipartMediaAssetUploadInput,
): void {
  if (
    input.workspaceId !== input.writer.workspaceId
    || input.mediaAssetId !== input.writer.mediaAssetId
    || input.stagingStorageKey !== input.writer.stagingStorageKey
    || input.blobStorageKey !== input.writer.blobStorageKey
    || input.s3UploadId !== input.writer.s3UploadId
    || input.mimeType !== input.writer.mimeType
    || input.sizeBytes !== input.writer.sizeBytes
    || input.sha256 !== input.writer.sha256
    || input.lastOperationId !== input.writer.lastOperationId
    || createMediaAssetUploadSessionCompletedPartsFingerprint(input.parts)
      !== input.writer.completedPartsFingerprint
  ) {
    throw new MediaBlobWriterFenceError(
      "verify_multipart_storage_input",
    );
  }
}

async function assertMultipartCompletionMutationAuthorized(
  input: CompleteMultipartMediaAssetUploadInput,
  verifyCapability: MultipartMediaBlobStorageCapabilityVerifier,
): Promise<void> {
  input.signal.throwIfAborted();
  assertMultipartCompletionInputMatchesWriter(input);
  const storageCapability = await input.getStorageCapability();
  input.signal.throwIfAborted();
  verifyCapability(storageCapability, input.writer);
}

async function normalizeMultipartStagingObjectWithDependencies(
  input: CompleteMultipartMediaAssetUploadInput,
  stagingObjectInput: AssertMediaAssetObjectInput,
  dependencies: MediaAssetStorageDependencies,
  verifyCapability: MultipartMediaBlobStorageCapabilityVerifier,
): Promise<void> {
  const config = dependencies.getMediaAssetsStorageConfigFn();
  const context: MediaAssetStorageContext = {
    workspaceId: input.workspaceId,
    mediaAssetId: input.mediaAssetId,
    storageKey: input.stagingStorageKey,
    observationScope: input.observationScope,
  };

  try {
    await runMediaAssetStorageOperationWithRetriesAndAbortSignal(
      context,
      "copy_object",
      input.signal,
      async () => {
        const sourceMetadata =
          await loadMediaAssetObjectMetadataWithAbortSignalAndDependencies(
            stagingObjectInput,
            input.signal,
            dependencies,
          );
        assertMediaAssetObjectShapeAndProofMatches(
          stagingObjectInput,
          sourceMetadata,
        );
        if (sourceMetadata.checksumType === "FULL_OBJECT") {
          assertMediaAssetObjectMetadataMatches(
            stagingObjectInput,
            sourceMetadata,
          );
          return;
        }
        if (sourceMetadata.eTag === null) {
          throw new Error(
            `S3 head_object did not return ETag for multipart staging object workspaceId=${input.workspaceId} mediaAssetId=${input.mediaAssetId}.`,
          );
        }

        await assertMultipartCompletionMutationAuthorized(
          input,
          verifyCapability,
        );
        input.assertStorageMutationAuthorized();
        await dependencies.s3Client.send(new CopyObjectCommand({
          Bucket: config.bucketName,
          Key: input.stagingStorageKey,
          CopySource: createMediaAssetCopySource(
            config.bucketName,
            input.stagingStorageKey,
          ),
          CopySourceIfMatch: sourceMetadata.eTag,
          ContentType: input.mimeType,
          ChecksumAlgorithm: "SHA256",
          MetadataDirective: "REPLACE",
          Metadata: createUploadProofMetadata(input),
        }), { abortSignal: input.signal });
      },
    );

    const normalizedMetadata =
      await loadMediaAssetObjectMetadataWithAbortSignalAndDependencies(
        stagingObjectInput,
        input.signal,
        dependencies,
      );
    assertMediaAssetObjectMetadataMatches(
      stagingObjectInput,
      normalizedMetadata,
    );
  } catch (error) {
    rethrowMediaAssetStorageAbortReason(input.signal);
    if (
      error instanceof HttpError
      || error instanceof MediaBlobWriterFenceError
    ) {
      throw error;
    }
    throw createMediaAssetStorageError(context, "copy_object", error);
  }
}

export async function createMultipartMediaAssetUploadWithDependencies(
  input: CreateMultipartMediaAssetUploadInput,
  dependencies: MediaAssetStorageDependencies,
): Promise<CreatedMultipartMediaAssetUpload> {
  const config = dependencies.getMediaAssetsStorageConfigFn();
  const context: MediaAssetStorageContext = {
    workspaceId: input.workspaceId,
    mediaAssetId: input.mediaAssetId,
    storageKey: input.stagingStorageKey,
    observationScope: input.observationScope,
  };
  const uploadProofMetadata = createUploadProofMetadata(input);

  try {
    const response = await runMediaAssetStorageOperationWithRetriesAndAbortSignal(
      context,
      "create_multipart_upload",
      input.signal,
      async () => dependencies.s3Client.send(
        new CreateMultipartUploadCommand({
          Bucket: config.bucketName,
          Key: input.stagingStorageKey,
          ContentType: input.mimeType,
          ChecksumAlgorithm: "SHA256",
          Metadata: uploadProofMetadata,
        }),
        { abortSignal: input.signal },
      ),
    );
    if (response.UploadId === undefined || response.UploadId.trim() === "") {
      throw new Error(
        `S3 create_multipart_upload did not return UploadId for workspaceId=${input.workspaceId} mediaAssetId=${input.mediaAssetId}.`,
      );
    }

    return {
      storageKey: input.stagingStorageKey,
      s3UploadId: response.UploadId,
      expiresAt: createExpiresAt(multipartUploadExpiresSeconds),
    };
  } catch (error) {
    rethrowMediaAssetStorageAbortReason(input.signal);
    throw createMediaAssetStorageError(context, "create_multipart_upload", error);
  }
}

export async function completeMultipartMediaAssetUploadWithDependencies(
  input: CompleteMultipartMediaAssetUploadInput,
  dependencies: MediaAssetStorageDependencies,
): Promise<void> {
  return completeMultipartMediaAssetUploadWithCapabilityVerifier(
    input,
    dependencies,
    assertMultipartMediaBlobStorageCapabilityForMutation,
  );
}

export async function completeMultipartMediaAssetUploadWithCapabilityVerifier(
  input: CompleteMultipartMediaAssetUploadInput,
  dependencies: MediaAssetStorageDependencies,
  verifyCapability: MultipartMediaBlobStorageCapabilityVerifier,
): Promise<void> {
  await assertMultipartCompletionMutationAuthorized(input, verifyCapability);
  const config = dependencies.getMediaAssetsStorageConfigFn();
  const context: MediaAssetStorageContext = {
    workspaceId: input.workspaceId,
    mediaAssetId: input.mediaAssetId,
    storageKey: input.stagingStorageKey,
    observationScope: input.observationScope,
  };
  const completedParts = [...input.parts]
    .sort((left, right) => left.partNumber - right.partNumber)
    .map((part) => ({
      PartNumber: part.partNumber,
      ETag: part.eTag,
      ChecksumSHA256: toBase64Sha256Digest(part.sha256),
    }));

  try {
    await runMediaAssetStorageOperationWithRetriesAndAbortSignal(
      context,
      "complete_multipart_upload",
      input.signal,
      async () => {
        await assertMultipartCompletionMutationAuthorized(
          input,
          verifyCapability,
        );
        input.assertStorageMutationAuthorized();
        return dependencies.s3Client.send(new CompleteMultipartUploadCommand({
          Bucket: config.bucketName,
          Key: input.stagingStorageKey,
          UploadId: input.s3UploadId,
          MultipartUpload: {
            Parts: completedParts,
          },
        }), { abortSignal: input.signal });
      },
    );
  } catch (error) {
    rethrowMediaAssetStorageAbortReason(input.signal);
    if (error instanceof MediaBlobWriterFenceError) {
      throw error;
    }
    if (isNoSuchMultipartUploadError(error) === false) {
      throw createMediaAssetStorageError(context, "complete_multipart_upload", error);
    }
  }

  const stagingObjectInput: AssertMediaAssetObjectInput = {
    workspaceId: input.workspaceId,
    mediaAssetId: input.mediaAssetId,
    storageKey: input.stagingStorageKey,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    sha256: input.sha256,
    lastOperationId: input.lastOperationId,
    observationScope: input.observationScope,
  };
  await normalizeMultipartStagingObjectWithDependencies(
    input,
    stagingObjectInput,
    dependencies,
    verifyCapability,
  );

  await promoteVerifiedMediaAssetUploadToBlobWithCapabilityVerifier(
    {
      writer: input.writer,
      getStorageCapability: input.getStorageCapability,
      assertStorageMutationAuthorized:
        input.assertStorageMutationAuthorized,
      signal: input.signal,
      workspaceId: input.workspaceId,
      mediaAssetId: input.mediaAssetId,
      uploadStorageKey: input.stagingStorageKey,
      blobStorageKey: input.blobStorageKey,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      sha256: input.sha256,
      lastOperationId: input.lastOperationId,
      observationScope: input.observationScope,
    },
    dependencies,
    verifyCapability,
  );
}

export async function abortMultipartMediaAssetUploadWithDependencies(
  input: AbortMultipartMediaAssetUploadInput,
  dependencies: MediaAssetStorageDependencies,
): Promise<void> {
  const config = dependencies.getMediaAssetsStorageConfigFn();
  const context: MediaAssetStorageContext = {
    workspaceId: input.workspaceId,
    mediaAssetId: input.mediaAssetId,
    storageKey: input.stagingStorageKey,
    observationScope: input.observationScope,
  };

  try {
    await runMediaAssetStorageOperationWithRetriesAndAbortSignal(
      context,
      "abort_multipart_upload",
      input.signal,
      async () => dependencies.s3Client.send(new AbortMultipartUploadCommand({
        Bucket: config.bucketName,
        Key: input.stagingStorageKey,
        UploadId: input.s3UploadId,
      }), { abortSignal: input.signal }),
    );
  } catch (error) {
    rethrowMediaAssetStorageAbortReason(input.signal);
    if (isNoSuchMultipartUploadError(error)) {
      return;
    }

    throw createMediaAssetStorageError(context, "abort_multipart_upload", error);
  }
}

export async function abortMultipartMediaAssetUploadUntilDeadlineWithDependencies(
  input: AbortMultipartMediaAssetUploadUntilDeadlineInput,
  dependencies: MediaAssetStorageDependencies,
): Promise<void> {
  return abortMultipartMediaAssetUploadWithDependencies(input, dependencies);
}
