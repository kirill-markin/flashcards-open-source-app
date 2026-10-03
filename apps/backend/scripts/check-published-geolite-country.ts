import { GetObjectCommand, NoSuchKey, S3Client } from "@aws-sdk/client-s3";
import { rm, writeFile } from "node:fs/promises";
import { GeoLiteDatabaseError, openCountryDatabase } from "../src/geolocation/database";
import { runGeoLiteStorageOperation } from "../src/geolocation/storage";

const maximumDatabaseBytes = 32 * 1024 * 1024;
const maximumPublishedAgeMs = 24 * 60 * 60 * 1000;
const objectKey = "GeoLite2-Country.mmdb";

type PublishedDatabase = { bytes: Uint8Array; lastModified: Date };

async function downloadPublishedDatabase(client: S3Client, bucket: string): Promise<PublishedDatabase | null> {
  try {
    return await runGeoLiteStorageOperation("download", async () => {
      const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }), {
        abortSignal: AbortSignal.timeout(5_000),
      });
      if (response.Body === undefined) {
        throw new GeoLiteDatabaseError("Published GeoLite Country S3 object has no body.");
      }
      if (response.ContentLength === undefined || !Number.isSafeInteger(response.ContentLength)
        || response.ContentLength <= 0 || response.ContentLength > maximumDatabaseBytes) {
        throw new GeoLiteDatabaseError("Published GeoLite Country object size is invalid or exceeds 32 MiB.");
      }
      const lastModified = response.LastModified;
      if (lastModified === undefined || !Number.isFinite(lastModified.getTime()) || lastModified.getTime() > Date.now()) {
        throw new GeoLiteDatabaseError("Published GeoLite Country object has a missing, invalid or future LastModified timestamp.");
      }
      const bytes = await response.Body.transformToByteArray();
      if (bytes.length !== response.ContentLength || bytes.length > maximumDatabaseBytes) {
        throw new GeoLiteDatabaseError("Published GeoLite Country body size differs from ContentLength or exceeds 32 MiB.");
      }
      return { bytes, lastModified };
    });
  } catch (error) {
    if (error instanceof NoSuchKey) return null;
    throw error;
  }
}

async function checkPublishedDatabase(client: S3Client, bucket: string, path: string): Promise<number> {
  const object = await downloadPublishedDatabase(client, bucket);
  if (object === null) {
    console.info(JSON.stringify({ action: "geolite_country_release_check", result: "missing", bucket, key: objectKey }));
    return 2;
  }
  try {
    await writeFile(path, object.bytes, { mode: 0o600, flag: "wx" });
    const reader = await openCountryDatabase(path);
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
  const [bucket, path] = process.argv.slice(2);
  if (!bucket || !path) throw new Error("Usage: check-published-geolite-country.ts <private-bucket> <temporary-mmdb-path>");
  const client = new S3Client({ maxAttempts: 1 });
  try {
    process.exitCode = await checkPublishedDatabase(client, bucket, path);
  } finally {
    client.destroy();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
