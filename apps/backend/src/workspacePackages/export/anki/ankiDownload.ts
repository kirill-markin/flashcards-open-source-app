import { randomUUID } from "node:crypto";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  getMediaAssetsPresignS3Client,
  getMediaAssetsS3Client,
  getMediaAssetsStorageConfig,
} from "../../../mediaAssets/storage/config";
import type { AnkiWorkspacePackage } from "./contract";

const ankiDownloadExpirySeconds = 15 * 60;

export async function createAnkiWorkspacePackageDownload(
  workspaceId: string,
  archive: AnkiWorkspacePackage,
): Promise<string> {
  const { bucketName } = getMediaAssetsStorageConfig();
  const object = {
    Bucket: bucketName,
    Key: "workspace-exports/" + workspaceId + "/" + randomUUID() + "/" + archive.fileName,
  };
  const url = await getSignedUrl(getMediaAssetsPresignS3Client(), new GetObjectCommand(object), {
    expiresIn: ankiDownloadExpirySeconds,
  });
  await getMediaAssetsS3Client().send(new PutObjectCommand({
    ...object,
    Body: archive.bytes,
    ContentType: archive.contentType,
    ContentDisposition: 'attachment; filename="' + archive.fileName + '"',
    CacheControl: "private, no-store",
  }));
  return url;
}
