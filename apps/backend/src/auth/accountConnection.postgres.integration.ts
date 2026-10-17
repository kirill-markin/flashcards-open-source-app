import test from "node:test";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

test("authenticated connection consent composes real PostgreSQL and the coordinator atomically", async () => {
  const ownerUrl = process.env.TEST_DATABASE_ADMIN_URL;
  if (ownerUrl === undefined) throw new Error("TEST_DATABASE_ADMIN_URL is required");
  const previousKey = process.env.SESSION_ENCRYPTION_KEY;
  const previousDatabase = process.env.DATABASE_URL;
  const clients = [new pg.Client({ connectionString: ownerUrl }), new pg.Client({ connectionString: ownerUrl }),
    new pg.Client({ connectionString: ownerUrl })];
  try {
    process.env.SESSION_ENCRYPTION_KEY = randomBytes(32).toString("hex");
    process.env.DATABASE_URL = ownerUrl;
    await Promise.all(clients.map((client) => client.connect()));
    for (const client of clients) await client.query("SET statement_timeout='10s'");
    const [owner, runtime, contender] = clients;
    await runtime.query("SET ROLE auth_app");
    await contender.query("SET ROLE auth_app");
    const gate = await import(pathToFileURL(resolve(__dirname, "../../../auth/src/integration/accountConnectionGate.ts")).href) as Readonly<{
      checkAccountConnection: (runtime: pg.Client, owner: pg.Client, contender: pg.Client) => Promise<void>;
      checkAccountConnectionHttp: () => Promise<void>;
    }>;
    await gate.checkAccountConnection(runtime, owner, contender);
    await gate.checkAccountConnectionHttp();
  } finally {
    await Promise.all(clients.map((client) => client.end()));
    if (previousKey === undefined) delete process.env.SESSION_ENCRYPTION_KEY;
    else process.env.SESSION_ENCRYPTION_KEY = previousKey;
    if (previousDatabase === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabase;
  }
});
