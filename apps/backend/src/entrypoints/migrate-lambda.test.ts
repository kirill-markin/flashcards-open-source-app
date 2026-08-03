import assert from "node:assert/strict";
import test from "node:test";
import { parseMigrationInvocation } from "./migrate-lambda";

test("migration Lambda distinguishes direct and CloudFormation invocations", () => {
  assert.deepEqual(parseMigrationInvocation({}), { kind: "direct" });
  assert.deepEqual(parseMigrationInvocation({ RequestType: "Delete" }), { kind: "delete" });
  assert.deepEqual(parseMigrationInvocation({
    RequestType: "Update",
    ResourceProperties: {
      RequiredMigration: "0106_catalog_install_idempotency.sql",
      UnrelatedProperty: "ignored",
    },
  }), {
    kind: "provision",
    requiredMigration: "0106_catalog_install_idempotency.sql",
  });
});

test("migration Lambda rejects invalid CloudFormation migration requirements", () => {
  assert.throws(
    () => parseMigrationInvocation({ RequestType: "Replace" }),
    /RequestType is invalid/u,
  );
  assert.throws(
    () => parseMigrationInvocation({ RequestType: "Create", ResourceProperties: {} }),
    /RequiredMigration must be a non-empty string/u,
  );
});
