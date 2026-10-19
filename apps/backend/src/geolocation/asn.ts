import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AsnResponse, Reader } from "maxmind";
import { writeCloudWatchRecord } from "../observability/cloudWatch";
import { createBackendRuntimeObservationScope } from "../observability/sentry";
import { assertGeoLiteDatabaseFresh, GeoLiteDatabaseError, openGeoLiteDatabase } from "./database";
import { runGeoLiteStorageOperation } from "./storage";

// The ASN reader mirrors ./country.ts: same bucket, cache, refresh interval and published-age record,
// whose rationale lives there.
const databaseRefreshIntervalMs = 60 * 60 * 1000;
const maximumDatabaseBytes = 32 * 1024 * 1024;
const maximumAutonomousSystemNumber = 4_294_967_295;
const s3 = new S3Client({ maxAttempts: 1 });
let cachedDatabase: { reader: Reader<AsnResponse>; loadedAt: number } | null = null;
let pendingDownload: Promise<Reader<AsnResponse>> | null = null;

function reportAsnDatabasePublishedAge(lastModified: Date): void {
  writeCloudWatchRecord({
    action: "geolite_asn_database_loaded",
    scope: createBackendRuntimeObservationScope(),
    details: {
      publishedAgeHours: Math.floor((Date.now() - lastModified.getTime()) / (60 * 60 * 1000)),
    },
  }, "breadcrumb");
}

async function downloadAsnDatabase(): Promise<Reader<AsnResponse>> {
  const bucket = process.env.GEOLITE_COUNTRY_BUCKET;
  const key = process.env.GEOLITE_ASN_OBJECT_KEY;
  if (!bucket || !key) {
    throw new GeoLiteDatabaseError("GEOLITE_COUNTRY_BUCKET and GEOLITE_ASN_OBJECT_KEY must be configured before ASN lookup is enabled.");
  }
  const object = await runGeoLiteStorageOperation("download", async () => {
    const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }), {
      abortSignal: AbortSignal.timeout(5_000),
    });
    if (response.Body === undefined) {
      throw new GeoLiteDatabaseError("GeoLite ASN S3 object has no body. Run GeoLite Country Refresh in GitHub Actions.");
    }
    if (response.ContentLength === undefined || response.ContentLength <= 0 || response.ContentLength > maximumDatabaseBytes) {
      throw new GeoLiteDatabaseError("GeoLite ASN S3 object size is invalid or exceeds 32 MiB.");
    }
    if (response.LastModified === undefined) {
      throw new GeoLiteDatabaseError("GeoLite ASN S3 object has no LastModified timestamp, so its age cannot be reported.");
    }
    return { bytes: await response.Body.transformToByteArray(), lastModified: response.LastModified };
  });
  const directory = await mkdtemp(join(tmpdir(), "geolite-asn-"));
  try {
    const path = join(directory, "GeoLite2-ASN.mmdb");
    await writeFile(path, object.bytes, { mode: 0o600 });
    const reader = await openGeoLiteDatabase<AsnResponse>(path, "GeoLite2-ASN");
    reportAsnDatabasePublishedAge(object.lastModified);
    return reader;
  } finally {
    // open() loads all bytes into memory; do not retain old databases in /tmp.
    await rm(directory, { recursive: true, force: true });
  }
}

async function getAsnDatabase(): Promise<Reader<AsnResponse>> {
  if (cachedDatabase !== null && Date.now() - cachedDatabase.loadedAt < databaseRefreshIntervalMs) {
    assertGeoLiteDatabaseFresh(cachedDatabase.reader, "GeoLite2-ASN", Date.now());
    return cachedDatabase.reader;
  }
  if (pendingDownload === null) {
    cachedDatabase = null;
    pendingDownload = downloadAsnDatabase().then((reader) => {
      cachedDatabase = { reader, loadedAt: Date.now() };
      return reader;
    }).finally(() => {
      pendingDownload = null;
    });
  }
  return pendingDownload;
}

/** Accept only the trusted transport source address; never pass forwarded headers. */
export async function resolveAutonomousSystemNumber(ipAddress: string): Promise<number | null> {
  if (isIP(ipAddress) === 0) {
    throw new GeoLiteDatabaseError("ASN lookup requires a valid IPv4 or IPv6 transport source address.");
  }
  const reader = await getAsnDatabase();
  const autonomousSystemNumber = reader.get(ipAddress)?.autonomous_system_number;
  if (autonomousSystemNumber === undefined) return null;
  if (
    !Number.isSafeInteger(autonomousSystemNumber)
    || autonomousSystemNumber <= 0
    || autonomousSystemNumber > maximumAutonomousSystemNumber
  ) {
    throw new GeoLiteDatabaseError("GeoLite ASN database contains an invalid autonomous system number.");
  }
  return autonomousSystemNumber;
}
