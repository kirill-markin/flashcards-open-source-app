import assert from "node:assert/strict";
import test from "node:test";
import { parseMigrationInvocation } from "./migrate-lambda";

test("migration Lambda distinguishes direct and CloudFormation invocations", () => {
  assert.deepEqual(parseMigrationInvocation({}), { kind: "direct" });
  assert.deepEqual(parseMigrationInvocation({ RequestType: "Delete" }), { kind: "delete" });
  assert.deepEqual(parseMigrationInvocation({
    RequestType: "Update",
    ResourceProperties: {
      RequiredMigration: "0121_backfill_synthetic_app_opened_days.sql",
      UnrelatedProperty: "ignored",
    },
  }), {
    kind: "provision",
    requiredMigration: "0121_backfill_synthetic_app_opened_days.sql",
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
