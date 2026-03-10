import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../errors";
import { parseWorkspaceIdParam } from "./requestContext";

test("parseWorkspaceIdParam accepts UUID values", () => {
  assert.equal(
    parseWorkspaceIdParam("123e4567-e89b-42d3-a456-426614174000"),
    "123e4567-e89b-42d3-a456-426614174000",
  );
});

test("parseWorkspaceIdParam rejects non-UUID values", () => {
  assert.throws(
    () => parseWorkspaceIdParam("not-a-uuid"),
    (error: unknown) => error instanceof HttpError
      && error.code === "WORKSPACE_ID_INVALID"
      && error.message === "workspaceId must be a UUID",
  );
});
