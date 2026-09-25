import { createHash } from "node:crypto";
import { findProductAnalyticsEventDefinition, type ProductAnalyticsEventName } from "./catalog";
import type { ProductAnalyticsEventRow } from "./types";
import { loadDailyVisitorHashSalt } from "./writer";

// The contract, and why the hash is never an actor, is in
// db/migrations/0144_anonymous_client_daily_visitor_hash.sql.

// The request facts the hash is derived from. Neither is ever stored.
export type DailyVisitorHashInputs = Readonly<{
  sourceIp: string | null;
  userAgent: string | null;
}>;

// The consent decision is never recorded beside a hash, including the grant, which
// consent_granted's and site_consent_granted's catalog entries would otherwise allow: both grants
// are identity-bearing, so the identityFree check below passes them. Every surface that asks the
// question belongs here, the marketing site's own banner included. The database repeats these six
// names in product_events_daily_visitor_hash_shape, where 0156 also names the two site collection
// switch events: those are refused here by the identityFree check below, and the constraint gives
// them the same database backstop a consent fact has. The two agree on the switch through that flag
// alone, so dropping identityFree from either entry would have this function compute a hash the
// constraint still refuses, and the insert would fail with 23514 and lose the whole event rather
// than store a NULL hash. The six names above cannot fail that way: both places refuse them.
const consentEventNames: ReadonlySet<ProductAnalyticsEventName> = new Set<ProductAnalyticsEventName>([
  "consent_prompt_shown",
  "consent_granted",
  "consent_declined",
  "site_consent_prompt_shown",
  "site_consent_granted",
  "site_consent_declined",
]);

const dailyVisitorHashLength = 32;

// Cached per container for the UTC day it was loaded for, and used only for a request on that same
// day: any other day drops it before loading, so a container never hashes with another day's salt.
let cachedDailyVisitorHashSalt: Readonly<{ utcDay: string; salt: Buffer }> | null = null;

function isDailyVisitorHashAllowed(row: ProductAnalyticsEventRow): boolean {
  if (row.trustLevel !== "anonymous_client" || row.anonymousId !== null) {
    return false;
  }

  if (consentEventNames.has(row.eventName)) {
    return false;
  }

  return findProductAnalyticsEventDefinition(row.eventName)?.identityFree !== true;
}

function readNonEmpty(value: string | null): string | null {
  return value === null || value.trim() === "" ? null : value;
}

function toUtcDay(timestamp: Date): string {
  return timestamp.toISOString().slice(0, 10);
}

// Null when the database refuses the day: it has ended, or a later day's salt already exists.
async function readDailyVisitorHashSalt(utcDay: string): Promise<Buffer | null> {
  if (cachedDailyVisitorHashSalt !== null && cachedDailyVisitorHashSalt.utcDay === utcDay) {
    return cachedDailyVisitorHashSalt.salt;
  }

  cachedDailyVisitorHashSalt = null;
  const salt = await loadDailyVisitorHashSalt(utcDay);
  if (salt !== null) {
    cachedDailyVisitorHashSalt = { utcDay, salt };
  }
  return salt;
}

// The NUL byte separates the two variable-length inputs, so no IP and User-Agent pair can hash like
// a different split of the same bytes.
export function computeDailyVisitorHash(salt: Buffer, sourceIp: string, userAgent: string): string {
  return createHash("sha256")
    .update(salt)
    .update(sourceIp, "utf8")
    .update(Buffer.from([0]))
    .update(userAgent, "utf8")
    .digest("hex")
    .slice(0, dailyVisitorHashLength);
}

// NULL for every row the hash is not allowed on, for a request with no source IP or no User-Agent,
// and for a request whose UTC day has already ended: each stores nothing rather than failing the event.
export async function resolveDailyVisitorHash(
  row: ProductAnalyticsEventRow,
  inputs: DailyVisitorHashInputs,
): Promise<string | null> {
  if (isDailyVisitorHashAllowed(row) === false) {
    return null;
  }

  const sourceIp = readNonEmpty(inputs.sourceIp);
  const userAgent = readNonEmpty(inputs.userAgent);
  if (sourceIp === null || userAgent === null) {
    return null;
  }

  const salt = await readDailyVisitorHashSalt(toUtcDay(row.serverReceivedAt));
  if (salt === null) {
    return null;
  }

  return computeDailyVisitorHash(salt, sourceIp, userAgent);
}
