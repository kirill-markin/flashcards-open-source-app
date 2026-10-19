import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { openGeoLiteDatabase, parseGeoLiteEdition } from "../src/geolocation/database";
import { runGeoLiteStorageOperation } from "../src/geolocation/storage";

async function main(): Promise<void> {
  const [editionArgument, path, bucket] = process.argv.slice(2);
  if (!editionArgument || !path || !bucket) {
    throw new Error("Usage: publish-geolite-country.ts <GeoLite2-Country|GeoLite2-ASN> <mmdb-path> <private-bucket>");
  }
  const edition = parseGeoLiteEdition(editionArgument);
  const key = `${edition}.mmdb`;
  const reader = await openGeoLiteDatabase(path, edition);
  const bytes = await readFile(path);
  if (bytes.length > 32 * 1024 * 1024) throw new Error(`${edition} database exceeds the runtime 32 MiB limit.`);
  const client = new S3Client({ maxAttempts: 1 });
  await runGeoLiteStorageOperation("publish", () => client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: bytes,
    ContentType: "application/octet-stream",
    ServerSideEncryption: "AES256",
    ChecksumSHA256: createHash("sha256").update(bytes).digest("base64"),
    Metadata: { "build-date": reader.metadata.buildEpoch.toISOString() },
  })));
  console.info(JSON.stringify({ action: "geolite_country_published", key, buildDate: reader.metadata.buildEpoch.toISOString() }));
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
