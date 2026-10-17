import test from "node:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

test("private account connection proofs reserve exact fresh principals without enrollment or union", async () => {
  const ownerUrl = process.env.TEST_DATABASE_ADMIN_URL;
  if (ownerUrl === undefined) throw new Error("TEST_DATABASE_ADMIN_URL is required");
  const owner = new pg.Client({ connectionString: ownerUrl });
  const runtime = new pg.Client({ connectionString: ownerUrl });
  const contender = new pg.Client({ connectionString: ownerUrl });
  try {
    await owner.connect();
    await runtime.connect();
    await contender.connect();
    for (const client of [owner, runtime, contender]) await client.query("SET statement_timeout='10s'");
    await runtime.query("SET ROLE auth_app");
    const moduleUrl = pathToFileURL(resolve(__dirname, "../../../auth/src/integration/accountConnectionProofGate.ts")).href;
    const gate = await import(moduleUrl) as Readonly<{
      checkAccountConnectionProofs: (runtime: pg.Client, owner: pg.Client, contender: pg.Client) => Promise<void>;
    }>;
    await gate.checkAccountConnectionProofs(runtime, owner, contender);
  } finally {
    await Promise.all([runtime.end(), owner.end(), contender.end()]);
  }
});
