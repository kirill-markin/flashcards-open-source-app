import { isIP } from "node:net";
import type { CountryResponse } from "maxmind";
import { GeoLiteDatabaseError } from "./database";
import { createGeoLiteDatabaseLoader } from "./databaseLoader";

const getCountryDatabase = createGeoLiteDatabaseLoader<CountryResponse>(
  "GeoLite2-Country",
  "GEOLITE_COUNTRY_OBJECT_KEY",
  "geolite_country_database_loaded",
);

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
