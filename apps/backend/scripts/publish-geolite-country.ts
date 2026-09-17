import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { openCountryDatabase } from "../src/geolocation/database";
import { runGeoLiteStorageOperation } from "../src/geolocation/storage";

async function main(): Promise<void> {
  const [path, bucket] = process.argv.slice(2);
  if (!path || !bucket) throw new Error("Usage: publish-geolite-country.ts <mmdb-path> <private-bucket>");
  const reader = await openCountryDatabase(path);
  const bytes = await readFile(path);
  if (bytes.length > 32 * 1024 * 1024) throw new Error("GeoLite Country database exceeds the runtime 32 MiB limit.");
  const client = new S3Client({ maxAttempts: 1 });
  await runGeoLiteStorageOperation("publish", () => client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: "GeoLite2-Country.mmdb",
    Body: bytes,
    ContentType: "application/octet-stream",
    ServerSideEncryption: "AES256",
    ChecksumSHA256: createHash("sha256").update(bytes).digest("base64"),
    Metadata: { "build-date": reader.metadata.buildEpoch.toISOString() },
  })));
  console.info(JSON.stringify({ action: "geolite_country_published", buildDate: reader.metadata.buildEpoch.toISOString() }));
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
