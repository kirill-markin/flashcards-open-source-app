import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getMediaAssetsS3Client, getMediaAssetsStorageConfig } from "../mediaAssets/storage/config";

export class ChatFileStorageError extends Error {
  public constructor(operation: "put" | "get", s3Key: string, cause: unknown) {
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
