import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CountryResponse, Reader } from "maxmind";
import { writeCloudWatchRecord } from "../observability/cloudWatch";
import { createBackendRuntimeObservationScope } from "../observability/sentry";
import { assertCountryDatabaseFresh, GeoLiteDatabaseError, openCountryDatabase } from "./database";
import { runGeoLiteStorageOperation } from "./storage";

const databaseRefreshIntervalMs = 60 * 60 * 1000;
const maximumDatabaseBytes = 32 * 1024 * 1024;
const s3 = new S3Client({ maxAttempts: 1 });
let cachedDatabase: { reader: Reader<CountryResponse>; loadedAt: number } | null = null;
let pendingDownload: Promise<Reader<CountryResponse>> | null = null;

/**
 * Publishes how long ago the object being served was written to S3, so a refresh that stops landing
 * is watchable before it becomes failure. Measured from `LastModified` rather than the MaxMind
 * build date because the bucket's lifecycle expiry (infra/aws/lib/geolite-country.ts) counts from
 * that same write and deletes the object long before any build date could reach the 30-day limit in
 * ./database.ts, so build age never gets near that limit in the failure it would need to signal.
 * Emitted per load rather than per lookup: a load happens at most once per
 * `databaseRefreshIntervalMs` per container, which bounds the reported age's lag at one hour
 * against a threshold measured in days.
 */
function reportCountryDatabasePublishedAge(lastModified: Date): void {
  writeCloudWatchRecord({
    action: "geolite_country_database_loaded",
    scope: createBackendRuntimeObservationScope(),
    details: {
      publishedAgeHours: Math.floor((Date.now() - lastModified.getTime()) / (60 * 60 * 1000)),
    },
  }, "breadcrumb");
}

async function downloadCountryDatabase(): Promise<Reader<CountryResponse>> {
  const bucket = process.env.GEOLITE_COUNTRY_BUCKET;
  const key = process.env.GEOLITE_COUNTRY_OBJECT_KEY;
  if (!bucket || !key) {
    throw new GeoLiteDatabaseError("GEOLITE_COUNTRY_BUCKET and GEOLITE_COUNTRY_OBJECT_KEY must be configured before country lookup is enabled.");
  }
  const object = await runGeoLiteStorageOperation("download", async () => {
    const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }), {
      abortSignal: AbortSignal.timeout(5_000),
    });
    if (response.Body === undefined) {
      throw new GeoLiteDatabaseError("GeoLite Country S3 object has no body. Run GeoLite Country Refresh in GitHub Actions.");
    }
    if (response.ContentLength === undefined || response.ContentLength <= 0 || response.ContentLength > maximumDatabaseBytes) {
      throw new GeoLiteDatabaseError("GeoLite Country S3 object size is invalid or exceeds 32 MiB.");
    }
    if (response.LastModified === undefined) {
      throw new GeoLiteDatabaseError("GeoLite Country S3 object has no LastModified timestamp, so its age cannot be reported.");
    }
    return { bytes: await response.Body.transformToByteArray(), lastModified: response.LastModified };
  });
  const directory = await mkdtemp(join(tmpdir(), "geolite-country-"));
  try {
    const path = join(directory, "GeoLite2-Country.mmdb");
    await writeFile(path, object.bytes, { mode: 0o600 });
    const reader = await openCountryDatabase(path);
    reportCountryDatabasePublishedAge(object.lastModified);
    return reader;
  } finally {
    // open() loads all bytes into memory; do not retain old databases in /tmp.
    await rm(directory, { recursive: true, force: true });
  }
}

async function getCountryDatabase(): Promise<Reader<CountryResponse>> {
  if (cachedDatabase !== null && Date.now() - cachedDatabase.loadedAt < databaseRefreshIntervalMs) {
    assertCountryDatabaseFresh(cachedDatabase.reader, Date.now());
    return cachedDatabase.reader;
  }
  if (pendingDownload === null) {
    cachedDatabase = null;
    pendingDownload = downloadCountryDatabase().then((reader) => {
      cachedDatabase = { reader, loadedAt: Date.now() };
      return reader;
    }).finally(() => {
      pendingDownload = null;
    });
  }
  return pendingDownload;
}

/** Accept only the trusted transport source address; never pass forwarded headers. */
export async function resolveCountryCode(ipAddress: string): Promise<string | null> {
  if (isIP(ipAddress) === 0) {
    throw new GeoLiteDatabaseError("Country lookup requires a valid IPv4 or IPv6 transport source address.");
  }
  const reader = await getCountryDatabase();
  const countryCode = reader.get(ipAddress)?.country?.iso_code;
  if (countryCode === undefined) return null;
  if (!/^[A-Z]{2}$/.test(countryCode)) {
    throw new GeoLiteDatabaseError("GeoLite Country database contains an invalid country code.");
  }
  return countryCode;
}
