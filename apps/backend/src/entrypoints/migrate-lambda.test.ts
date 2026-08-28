import assert from "node:assert/strict";
import test from "node:test";
import { parseMigrationInvocation } from "./migrate-lambda";

test("migration Lambda distinguishes direct and CloudFormation invocations", () => {
  assert.deepEqual(parseMigrationInvocation({}), { kind: "direct" });
  assert.deepEqual(parseMigrationInvocation({ RequestType: "Delete" }), { kind: "delete" });
  assert.deepEqual(parseMigrationInvocation({
    RequestType: "Update",
    ResourceProperties: {
      RequiredMigration: "0116_guest_session_web_platform.sql",
      UnrelatedProperty: "ignored",
    },
  }), {
    kind: "provision",
    requiredMigration: "0116_guest_session_web_platform.sql",
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
