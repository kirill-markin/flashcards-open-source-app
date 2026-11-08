import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * A current Anki collection declares Anki's own `unicase` collation on names, which reading those tables
 * then needs: without it sqlite fails with "no such collation sequence: unicase", or "no query solution"
 * on a WITHOUT ROWID table keyed by one. The sandbox's sqlite3 is sql.js, which cannot register a
 * collation, so the schema names SQLite's built-in NOCASE instead, case-insensitive for ASCII only, and
 * REINDEX rebuilds every index and WITHOUT ROWID table in its order. A collection without `unicase`
 * comes back unchanged.
 */
export function replaceUnicaseCollation(collection: Uint8Array): Uint8Array {
  const directory = mkdtempSync(join(tmpdir(), "anki-collection-"));
  try {
    const path = join(directory, "collection.sqlite");
    writeFileSync(path, collection, { mode: 0o600 });
    // Defensive mode, on by default since Node 24.12, forbids writing the schema.
    const database = new DatabaseSync(path, { defensive: false });
    let changed: boolean;
    try {
      database.exec("PRAGMA writable_schema = ON");
      changed = Number(database.prepare(
        "UPDATE sqlite_schema SET sql = replace(sql, 'COLLATE unicase', 'COLLATE NOCASE') WHERE instr(sql, 'COLLATE unicase') > 0",
      ).run().changes) > 0;
      database.exec("PRAGMA writable_schema = RESET");
      if (changed) {
        database.exec("REINDEX NOCASE");
      }
    } finally {
      database.close();
    }

    return changed ? readFileSync(path) : collection;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
