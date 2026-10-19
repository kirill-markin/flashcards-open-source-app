import { GetObjectCommand, NoSuchKey, S3Client } from "@aws-sdk/client-s3";
import { rm, writeFile } from "node:fs/promises";
import { type GeoLiteEdition, GeoLiteDatabaseError, openGeoLiteDatabase, parseGeoLiteEdition } from "../src/geolocation/database";
import { runGeoLiteStorageOperation } from "../src/geolocation/storage";

const maximumDatabaseBytes = 32 * 1024 * 1024;
const maximumPublishedAgeMs = 24 * 60 * 60 * 1000;

type PublishedDatabase = { bytes: Uint8Array; lastModified: Date };

async function downloadPublishedDatabase(
  client: S3Client,
  bucket: string,
  edition: GeoLiteEdition,
  objectKey: string,
): Promise<PublishedDatabase | null> {
  try {
    return await runGeoLiteStorageOperation("download", async () => {
      const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }), {
        abortSignal: AbortSignal.timeout(5_000),
      });
      if (response.Body === undefined) {
        throw new GeoLiteDatabaseError(`Published ${edition} S3 object has no body.`);
      }
      if (response.ContentLength === undefined || !Number.isSafeInteger(response.ContentLength)
        || response.ContentLength <= 0 || response.ContentLength > maximumDatabaseBytes) {
        throw new GeoLiteDatabaseError(`Published ${edition} object size is invalid or exceeds 32 MiB.`);
      }
      const lastModified = response.LastModified;
      if (lastModified === undefined || !Number.isFinite(lastModified.getTime()) || lastModified.getTime() > Date.now()) {
        throw new GeoLiteDatabaseError(`Published ${edition} object has a missing, invalid or future LastModified timestamp.`);
      }
      const bytes = await response.Body.transformToByteArray();
      if (bytes.length !== response.ContentLength || bytes.length > maximumDatabaseBytes) {
        throw new GeoLiteDatabaseError(`Published ${edition} body size differs from ContentLength or exceeds 32 MiB.`);
      }
      return { bytes, lastModified };
    });
  } catch (error) {
    if (error instanceof NoSuchKey) return null;
    throw error;
  }
}

async function checkPublishedDatabase(client: S3Client, bucket: string, edition: GeoLiteEdition, path: string): Promise<number> {
  const objectKey = `${edition}.mmdb`;
  const object = await downloadPublishedDatabase(client, bucket, edition, objectKey);
  if (object === null) {
    console.info(JSON.stringify({ action: "geolite_country_release_check", result: "missing", bucket, key: objectKey }));
    return 2;
  }
  try {
    await writeFile(path, object.bytes, { mode: 0o600, flag: "wx" });
    const reader = await openGeoLiteDatabase(path, edition);
    const stale = Date.now() - object.lastModified.getTime() >= maximumPublishedAgeMs;
    console.info(JSON.stringify({
      action: "geolite_country_release_check",
      result: stale ? "stale" : "fresh",
      bucket,
      key: objectKey,
      bytes: object.bytes.length,
      publishedAt: object.lastModified.toISOString(),
      buildDate: reader.metadata.buildEpoch.toISOString(),
    }));
    return stale ? 3 : 0;
  } finally {
    await rm(path, { force: true });
  }
}

async function main(): Promise<void> {
  const [editionArgument, bucket, path] = process.argv.slice(2);
  if (!editionArgument || !bucket || !path) {
    throw new Error("Usage: check-published-geolite-country.ts <GeoLite2-Country|GeoLite2-ASN> <private-bucket> <temporary-mmdb-path>");
  }
  const edition = parseGeoLiteEdition(editionArgument);
  const client = new S3Client({ maxAttempts: 1 });
  try {
    process.exitCode = await checkPublishedDatabase(client, bucket, edition, path);
  } finally {
    client.destroy();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
