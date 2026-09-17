import { open, type CountryResponse, type Reader } from "maxmind";

const maximumDatabaseAgeMs = 30 * 24 * 60 * 60 * 1000;

export class GeoLiteDatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeoLiteDatabaseError";
  }
}

export function assertCountryDatabaseFresh(reader: Reader<CountryResponse>, now: number): void {
  const buildTime = reader.metadata.buildEpoch.getTime();
  if (reader.metadata.databaseType !== "GeoLite2-Country" || reader.metadata.ipVersion !== 6) {
    throw new GeoLiteDatabaseError("Expected a GeoLite2-Country database supporting IPv4 and IPv6.");
  }
  if (!Number.isFinite(buildTime) || buildTime > now || now - buildTime >= maximumDatabaseAgeMs) {
    throw new GeoLiteDatabaseError("GeoLite Country database is expired or has an invalid build date. Run GeoLite Country Refresh in GitHub Actions.");
  }
}

export async function openCountryDatabase(path: string): Promise<Reader<CountryResponse>> {
  // maxmind caches decoded database offsets, never visitor IP addresses.
  const reader = await open<CountryResponse>(path, { watchForUpdates: false });
  assertCountryDatabaseFresh(reader, Date.now());
  return reader;
}
