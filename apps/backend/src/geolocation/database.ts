import { open, type Reader, type Response } from "maxmind";

const maximumDatabaseAgeMs = 30 * 24 * 60 * 60 * 1000;
const geoLiteEditions = ["GeoLite2-Country", "GeoLite2-ASN"] as const;

/** A MaxMind edition id, which is also its `databaseType` and, with `.mmdb`, its private S3 object key. */
export type GeoLiteEdition = typeof geoLiteEditions[number];

export class GeoLiteDatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeoLiteDatabaseError";
  }
}

export function parseGeoLiteEdition(value: string): GeoLiteEdition {
  const edition = geoLiteEditions.find((candidate) => candidate === value);
  if (edition === undefined) {
    throw new GeoLiteDatabaseError(`Unsupported GeoLite edition "${value}"; expected one of ${geoLiteEditions.join(", ")}.`);
  }
  return edition;
}

export function assertGeoLiteDatabaseFresh<T extends Response>(reader: Reader<T>, edition: GeoLiteEdition, now: number): void {
  const buildTime = reader.metadata.buildEpoch.getTime();
  if (reader.metadata.databaseType !== edition || reader.metadata.ipVersion !== 6) {
    throw new GeoLiteDatabaseError(`Expected a ${edition} database supporting IPv4 and IPv6.`);
  }
  if (!Number.isFinite(buildTime) || buildTime > now || now - buildTime >= maximumDatabaseAgeMs) {
    throw new GeoLiteDatabaseError(`${edition} database is expired or has an invalid build date. Run GeoLite Country Refresh in GitHub Actions.`);
  }
}

export async function openGeoLiteDatabase<T extends Response>(path: string, edition: GeoLiteEdition): Promise<Reader<T>> {
  // maxmind caches decoded database offsets, never visitor IP addresses.
  const reader = await open<T>(path, { watchForUpdates: false });
  assertGeoLiteDatabaseFresh(reader, edition, Date.now());
  return reader;
}
