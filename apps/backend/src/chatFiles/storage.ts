import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getMediaAssetsS3Client, getMediaAssetsStorageConfig } from "../mediaAssets/storage/config";

/** The chat sandbox uses a URL within the one call it is signed for. */
const sandboxObjectUrlExpiresSeconds = 5 * 60;

let presignS3Client: S3Client | null = null;

export class ChatFileStorageError extends Error {
  public constructor(
    operation: "put" | "get" | "head" | "presign_get" | "presign_put",
    s3Key: string,
    cause: unknown,
  ) {
    const causeName = cause instanceof Error ? cause.name : "UnknownError";
    const causeMessage = cause instanceof Error ? cause.message : String(cause);
    super(`Chat file object ${operation} failed. s3Key=${s3Key} errorName=${causeName} errorMessage=${causeMessage}`);
    this.name = "ChatFileStorageError";
  }
}

/** The IAM grant in `infra/aws/lib/gateways/api-gateway.ts` covers exactly this prefix. */
export function buildChatFileS3Key(sessionId: string, fileId: string): string {
  return `chat-files/sessions/${sessionId}/${fileId}`;
}

/**
 * The bucket expires it a day later (`infra/aws/lib/media-assets.ts`); a turn that names it stores a copy
 * under a session key.
 */
export function buildChatFileUploadS3Key(userId: string, uploadId: string): string {
  return `chat-files/uploads/${userId}/${uploadId}`;
}

/** The client's default retry policy retries transient S3 failures before this throws. */
export async function putChatFileObject(s3Key: string, bytes: Buffer, mediaType: string): Promise<void> {
  try {
    await getMediaAssetsS3Client().send(new PutObjectCommand({
      Bucket: getMediaAssetsStorageConfig().bucketName,
      Key: s3Key,
      Body: bytes,
      ContentType: mediaType,
    }));
  } catch (error) {
    throw new ChatFileStorageError("put", s3Key, error);
  }
}

export async function getChatFileObjectBytes(s3Key: string): Promise<Buffer> {
  try {
    const response = await getMediaAssetsS3Client().send(new GetObjectCommand({
      Bucket: getMediaAssetsStorageConfig().bucketName,
      Key: s3Key,
    }));
    if (response.Body === undefined) {
      throw new Error("S3 returned no body");
    }

    return Buffer.from(await response.Body.transformToByteArray());
  } catch (error) {
    throw new ChatFileStorageError("get", s3Key, error);
  }
}

/**
 * Null when there is no object. The chat roles have no `s3:ListBucket`, so S3 answers a HEAD of a missing
 * key with 403 rather than 404.
 */
export async function headChatFileObjectSize(s3Key: string): Promise<number | null> {
  try {
    const response = await getMediaAssetsS3Client().send(new HeadObjectCommand({
      Bucket: getMediaAssetsStorageConfig().bucketName,
      Key: s3Key,
    }));
    if (response.ContentLength === undefined) {
      throw new Error("S3 returned no content length");
    }

    return response.ContentLength;
  } catch (error) {
    if (
      error instanceof S3ServiceException
      && (error.$metadata.httpStatusCode === 403 || error.$metadata.httpStatusCode === 404)
    ) {
      return null;
    }

    throw new ChatFileStorageError("head", s3Key, error);
  }
}

/**
 * By default the SDK signs a PUT URL with the CRC32 of an empty body, which S3 then enforces on the
 * upload, so checksums are added only where an operation requires one.
 */
function getPresignS3Client(): S3Client {
  presignS3Client ??= new S3Client({
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  return presignS3Client;
}

export async function createChatFileDownloadUrl(s3Key: string): Promise<string> {
  try {
    return await getSignedUrl(getPresignS3Client(), new GetObjectCommand({
      Bucket: getMediaAssetsStorageConfig().bucketName,
      Key: s3Key,
    }), { expiresIn: sandboxObjectUrlExpiresSeconds });
  } catch (error) {
    throw new ChatFileStorageError("presign_get", s3Key, error);
  }
}

export async function createChatFileUploadUrl(s3Key: string): Promise<string> {
  try {
    return await getSignedUrl(getPresignS3Client(), new PutObjectCommand({
      Bucket: getMediaAssetsStorageConfig().bucketName,
      Key: s3Key,
    }), { expiresIn: sandboxObjectUrlExpiresSeconds });
  } catch (error) {
    throw new ChatFileStorageError("presign_put", s3Key, error);
  }
}

/** The signature binds the length and the type, so S3 refuses a PUT of any other size or type. */
export async function createChatFileUploadPutUrl(
  s3Key: string,
  mediaType: string,
  sizeBytes: number,
  signedAt: Date,
  expiresSeconds: number,
): Promise<string> {
  try {
    return await getSignedUrl(getPresignS3Client(), new PutObjectCommand({
      Bucket: getMediaAssetsStorageConfig().bucketName,
      Key: s3Key,
      ContentType: mediaType,
      ContentLength: sizeBytes,
    }), {
      expiresIn: expiresSeconds,
      signingDate: signedAt,
      signableHeaders: new Set(["content-length", "content-type"]),
    });
  } catch (error) {
    throw new ChatFileStorageError("presign_put", s3Key, error);
  }
}
