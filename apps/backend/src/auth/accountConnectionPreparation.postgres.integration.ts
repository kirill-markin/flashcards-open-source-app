import test from "node:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

test("private collision preparation, durable workspace choices and deletion use real PostgreSQL", async () => {
  const ownerUrl = process.env.TEST_DATABASE_ADMIN_URL;
  if (ownerUrl === undefined) throw new Error("TEST_DATABASE_ADMIN_URL is required");
  const owner = new pg.Client({ connectionString: ownerUrl });
  const runtime = new pg.Client({ connectionString: ownerUrl });
  try {
    await Promise.all([owner.connect(), runtime.connect()]);
    for (const client of [owner, runtime]) await client.query("SET statement_timeout='10s'");
    await runtime.query("SET ROLE auth_app");
    const gate = await import(pathToFileURL(resolve(__dirname, "../../../auth/src/integration/accountConnectionPreparationGate.ts")).href) as Readonly<{
      checkAccountConnectionPreparation: (runtime: pg.Client, owner: pg.Client) => Promise<void>;
    }>;
    await gate.checkAccountConnectionPreparation(runtime, owner);
  } finally {
    await Promise.all([runtime.end(), owner.end()]);
  }
});
