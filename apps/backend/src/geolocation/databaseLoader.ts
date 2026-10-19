import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Reader, Response } from "maxmind";
import { writeCloudWatchRecord } from "../observability/cloudWatch";
import { createBackendRuntimeObservationScope } from "../observability/sentry";
import { assertGeoLiteDatabaseFresh, GeoLiteDatabaseError, type GeoLiteEdition, openGeoLiteDatabase } from "./database";
import { runGeoLiteStorageOperation } from "./storage";

type GeoLiteObjectKeyVariable = "GEOLITE_COUNTRY_OBJECT_KEY" | "GEOLITE_ASN_OBJECT_KEY";
type GeoLiteDatabaseLoadedAction = "geolite_country_database_loaded" | "geolite_asn_database_loaded";

const databaseRefreshIntervalMs = 60 * 60 * 1000;
const maximumDatabaseBytes = 32 * 1024 * 1024;
const s3 = new S3Client({ maxAttempts: 1 });

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
function reportDatabasePublishedAge(loadedAction: GeoLiteDatabaseLoadedAction, lastModified: Date): void {
  writeCloudWatchRecord({
    action: loadedAction,
    scope: createBackendRuntimeObservationScope(),
    details: {
      publishedAgeHours: Math.floor((Date.now() - lastModified.getTime()) / (60 * 60 * 1000)),
    },
  }, "breadcrumb");
}

async function downloadDatabase<T extends Response>(
  edition: GeoLiteEdition,
  objectKeyVariable: GeoLiteObjectKeyVariable,
  loadedAction: GeoLiteDatabaseLoadedAction,
): Promise<Reader<T>> {
  const bucket = process.env.GEOLITE_COUNTRY_BUCKET;
  const key = process.env[objectKeyVariable];
  if (!bucket || !key) {
    throw new GeoLiteDatabaseError(`GEOLITE_COUNTRY_BUCKET and ${objectKeyVariable} must be configured before ${edition} lookup is enabled.`);
  }
  const object = await runGeoLiteStorageOperation("download", async () => {
    const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }), {
      abortSignal: AbortSignal.timeout(5_000),
    });
    if (response.Body === undefined) {
      throw new GeoLiteDatabaseError(`${edition} S3 object has no body. Run GeoLite Country Refresh in GitHub Actions.`);
    }
    if (response.ContentLength === undefined || response.ContentLength <= 0 || response.ContentLength > maximumDatabaseBytes) {
      throw new GeoLiteDatabaseError(`${edition} S3 object size is invalid or exceeds 32 MiB.`);
    }
    if (response.LastModified === undefined) {
      throw new GeoLiteDatabaseError(`${edition} S3 object has no LastModified timestamp, so its age cannot be reported.`);
    }
    return { bytes: await response.Body.transformToByteArray(), lastModified: response.LastModified };
  });
  const directory = await mkdtemp(join(tmpdir(), `${edition}-`));
  try {
    const path = join(directory, `${edition}.mmdb`);
    await writeFile(path, object.bytes, { mode: 0o600 });
    const reader = await openGeoLiteDatabase<T>(path, edition);
    reportDatabasePublishedAge(loadedAction, object.lastModified);
    return reader;
  } finally {
    // open() loads all bytes into memory; do not retain old databases in /tmp.
    await rm(directory, { recursive: true, force: true });
  }
}

/**
 * Returns this edition's reader, reloaded from S3 at most once per `databaseRefreshIntervalMs` per
 * container. Concurrent callers share one in-flight download, so a failed download rejects every
 * awaiter with the same error instance.
 */
export function createGeoLiteDatabaseLoader<T extends Response>(
  edition: GeoLiteEdition,
  objectKeyVariable: GeoLiteObjectKeyVariable,
  loadedAction: GeoLiteDatabaseLoadedAction,
): () => Promise<Reader<T>> {
  let cachedDatabase: { reader: Reader<T>; loadedAt: number } | null = null;
  let pendingDownload: Promise<Reader<T>> | null = null;

  return async () => {
    if (cachedDatabase !== null && Date.now() - cachedDatabase.loadedAt < databaseRefreshIntervalMs) {
      assertGeoLiteDatabaseFresh(cachedDatabase.reader, edition, Date.now());
      return cachedDatabase.reader;
    }
    if (pendingDownload === null) {
      cachedDatabase = null;
      pendingDownload = downloadDatabase<T>(edition, objectKeyVariable, loadedAction).then((reader) => {
        cachedDatabase = { reader, loadedAt: Date.now() };
        return reader;
      }).finally(() => {
        pendingDownload = null;
      });
    }
    return pendingDownload;
  };
}
