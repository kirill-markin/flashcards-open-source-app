import {
  GetObjectCommand,
  HeadObjectCommand,
  type HeadObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import type { MediaAssetStorageDependencies } from "./contracts";

function isReadableObjectBody(value: unknown): value is AsyncIterable<Uint8Array | string> {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value;
}

/**
 * HEAD of a media object carrying the full-object SHA-256 that media proofs compare. Where the store
 * cannot prove that checksum, the object is read in one GET instead and the SHA-256 and length of the
 * bytes that response carried stand in as the FULL_OBJECT checksum and length of the entity whose
 * ETag, type and metadata arrived with them. S3 errors are thrown unchanged, as from a HEAD.
 */
export async function headMediaObjectWithFullObjectChecksum(
  dependencies: MediaAssetStorageDependencies,
  bucketName: string,
  storageKey: string,
  signal: AbortSignal | null,
): Promise<HeadObjectCommandOutput> {
  const sendOptions = signal === null ? undefined : { abortSignal: signal };
  if (dependencies.getMediaAssetsStorageConfigFn().fullObjectChecksumSource === "store") {
    return dependencies.s3Client.send(new HeadObjectCommand({
      Bucket: bucketName,
      Key: storageKey,
      ChecksumMode: "ENABLED",
    }), sendOptions);
  }

  const response = await dependencies.s3Client.send(new GetObjectCommand({
    Bucket: bucketName,
    Key: storageKey,
  }), sendOptions);
  const body = response.Body;
  if (isReadableObjectBody(body) === false) {
    throw new Error(`S3 get_object did not return a readable body while hashing media object storageKey=${storageKey}.`);
  }

  const hash = createHash("sha256");
  let sizeBytes = 0;
  for await (const chunk of body) {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    sizeBytes += bytes.byteLength;
    hash.update(bytes);
  }

  return {
    $metadata: response.$metadata,
    ContentLength: sizeBytes,
    ContentType: response.ContentType,
    ETag: response.ETag,
    Metadata: response.Metadata,
    ChecksumSHA256: hash.digest("base64"),
    ChecksumType: "FULL_OBJECT",
  };
}
