import test from "node:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

test("Apple consent reconnection preserves the principal, account and guarded login lifecycle", async () => {
  const ownerUrl = process.env.TEST_DATABASE_ADMIN_URL;
  if (ownerUrl === undefined) throw new Error("TEST_DATABASE_ADMIN_URL is required");
  const owner = new pg.Client({ connectionString: ownerUrl });
  const runtime = new pg.Client({ connectionString: ownerUrl });
  try {
    await owner.connect();
    await runtime.connect();
    await runtime.query("SET ROLE auth_app");
    const moduleUrl = pathToFileURL(resolve(__dirname, "../../../auth/src/integration/principalEnrollmentGate.ts")).href;
    const gate = await import(moduleUrl) as Readonly<{
      checkAppleConsentReconnect: (runtime: pg.Client, owner: pg.Client) => Promise<void>;
    }>;
    await gate.checkAppleConsentReconnect(runtime, owner);
  } finally {
    await Promise.all([runtime.end(), owner.end()]);
  }
});
