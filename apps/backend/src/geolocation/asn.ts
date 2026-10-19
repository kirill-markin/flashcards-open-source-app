import { isIP } from "node:net";
import type { AsnResponse } from "maxmind";
import { GeoLiteDatabaseError } from "./database";
import { createGeoLiteDatabaseLoader } from "./databaseLoader";

const maximumAutonomousSystemNumber = 4_294_967_295;
const getAsnDatabase = createGeoLiteDatabaseLoader<AsnResponse>(
  "GeoLite2-ASN",
  "GEOLITE_ASN_OBJECT_KEY",
  "geolite_asn_database_loaded",
);

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
