import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import type { ProductAnalyticsEventName } from "./catalog";
import { deriveServerDerivedProductAnalyticsEventId } from "./serverEvents";

// analytics.derive_server_event_id (migration 0119) is a hand-written twin of
// deriveServerDerivedProductAnalyticsEventId, and the backfills that call it depend on the two
// agreeing exactly: a backfilled row and the live emission of the same fact are counted once only
// because they collide on event_id, which is the primary key of an append-only table. If the two
// derivations ever disagree, nothing fails - both rows are simply stored, and every reconstructed
// fact is silently counted twice, forever, with no way to tell the pair apart afterwards. That is
// why this equality is pinned by a test even though this repository does not add unit tests by
// default: it is the only thing standing between a divergence and permanently doubled metrics.

type ServerEventIdDerivationVector = Readonly<{
  eventName: ProductAnalyticsEventName;
  keyParts: ReadonlyArray<string>;
}>;

// The first three are the shapes the live producers actually derive today, so the vectors that
// matter most for the backfill are covered exactly as they occur. The rest pin the cases where the
// two implementations could plausibly drift apart: no key parts at all, an empty-string part, a part
// containing the ':' separator itself, non-ASCII text, which only agrees while both sides hash the
// same UTF-8 bytes, and a NULL part, which the two sides render alike only because 0119 passes
// array_to_string its three-argument null_string form.
const serverEventIdDerivationVectors: ReadonlyArray<ServerEventIdDerivationVector> = [
  {
    eventName: "guest_upgrade_completed",
    keyParts: ["3f1d5b0e-8a2c-4d61-9f77-2b8c4a1e6d05"],
  },
  {
    eventName: "ai_message_sent",
    keyParts: ["b7c0a1d2-3e4f-4a5b-8c6d-7e8f9a0b1c2d", "0c9b8a76-5d4e-4f3a-9b2c-1d0e9f8a7b6c"],
  },
  {
    eventName: "catalog_deck_installed",
    keyParts: ["6a5b4c3d-2e1f-4a09-8b7c-6d5e4f3a2b1c", "install-2026-08-28-0001"],
  },
  {
    eventName: "guest_upgrade_completed",
    keyParts: [],
  },
  {
    eventName: "ai_message_sent",
    keyParts: ["", "part-after-an-empty-part"],
  },
  {
    eventName: "catalog_deck_installed",
    keyParts: ["a:b:c", "café-Ω-über", "trailing-colon:"],
  },
  {
    // Deliberately ill-typed. keyParts is ReadonlyArray<string> because no TypeScript producer can
    // reach a NULL part, but the SQL backfill this function exists for builds key_parts out of
    // production columns that are nullable at the schema level, so it can - and this is the one
    // case the two implementations do not agree on by default: Array.prototype.join renders a null
    // element as an empty string, while a two-argument pg_catalog.array_to_string would drop it and
    // derive an id no live emission could ever collide with. The vector therefore has to carry a
    // real null into both sides, which means casting past the signature on the TypeScript one.
    eventName: "guest_upgrade_completed",
    keyParts: [
      "d4c3b2a1-0f9e-4d8c-9b6a-5f4e3d2c1b0a",
      null as unknown as string,
      "part-after-a-null-part",
    ],
  },
];

function requireOwnerDatabaseUrl(): string {
  const databaseUrl = process.env.TEST_DATABASE_ADMIN_URL?.trim();
  if (databaseUrl === undefined || databaseUrl === "") {
    throw new Error(
      "TEST_DATABASE_ADMIN_URL is required for the server-derived event id derivation integration test.",
    );
  }

  return databaseUrl;
}

test("the SQL and TypeScript server-derived event id derivations agree", async () => {
  const ownerPool = new pg.Pool({
    connectionString: requireOwnerDatabaseUrl(),
    application_name: "product-analytics-server-event-id-integration-owner",
  });

  try {
    for (const vector of serverEventIdDerivationVectors) {
      const derivedInDatabase = await ownerPool.query<Readonly<{ event_id: string }>>(
        "SELECT analytics.derive_server_event_id($1::text, $2::text[])::text AS event_id",
        [vector.eventName, [...vector.keyParts]],
      );
      const derivedInTypeScript = deriveServerDerivedProductAnalyticsEventId(
        vector.eventName,
        vector.keyParts,
      );

      assert.equal(
        derivedInDatabase.rows[0]?.event_id,
        derivedInTypeScript,
        `SQL and TypeScript derivations disagree. eventName=${vector.eventName} keyParts=${JSON.stringify(vector.keyParts)}`,
      );
    }

    // The derivation has to separate the vectors as well as reproduce them: two implementations that
    // both collapsed every input onto one id would satisfy the equality above and make the backfill
    // suppress every row after the first. Checking distinctness on the TypeScript side is enough,
    // because each SQL id was just asserted equal to its TypeScript counterpart.
    const derivedIds = new Set(
      serverEventIdDerivationVectors.map(
        (vector) => deriveServerDerivedProductAnalyticsEventId(vector.eventName, vector.keyParts),
      ),
    );
    assert.equal(derivedIds.size, serverEventIdDerivationVectors.length);
  } finally {
    await ownerPool.end();
  }
});
