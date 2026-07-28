import assert from "node:assert/strict";
import test from "node:test";
import {
  isDirectImageIngestionPostTarget,
  readApiGatewayRequestTarget,
} from "./directImageIngestionRouting";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const directPath = `/workspaces/${workspaceId}/media-assets/images`;

function createRestApiEvent(path: string, method: string): unknown {
  return {
    path,
    httpMethod: method,
    headers: {},
    requestContext: {
      httpMethod: method,
      path: `/v1${path}`,
      stage: "v1",
    },
  };
}

function createHttpApiEvent(path: string, method: string): unknown {
  return {
    version: "2.0",
    rawPath: path,
    headers: {},
    requestContext: {
      http: {
        method,
        path,
      },
      stage: "$default",
    },
  };
}

function matchesDirectImagePost(event: unknown): boolean {
  return isDirectImageIngestionPostTarget(
    readApiGatewayRequestTarget(event),
  );
}

test("shared Lambda matches every direct-image POST path across REST v1 and HTTP v2 events", () => {
  const directPostPaths = [
    ["custom-domain stripped", directPath],
    ["custom-domain stripped trailing slash", `${directPath}/`],
    ["single v1 prefix", `/v1${directPath}`],
    ["single v1 prefix trailing slash", `/v1${directPath}/`],
    ["execute-api double-v1 spelling", `/v1/v1${directPath}`],
    ["repeated v1 prefixes", `/v1/v1/v1${directPath}`],
  ] as const;
  const eventFactories = [
    ["REST v1", createRestApiEvent],
    ["HTTP v2", createHttpApiEvent],
  ] as const;

  for (const [eventLabel, createEvent] of eventFactories) {
    for (const [pathLabel, path] of directPostPaths) {
      assert.equal(
        matchesDirectImagePost(createEvent(path, "POST")),
        true,
        `${eventLabel}: ${pathLabel}`,
      );
    }
  }
});

test("shared Lambda preserves other methods and unrelated shared routes", () => {
  const preservedTargets = [
    ["direct GET", directPath, "GET"],
    ["direct PATCH", directPath, "PATCH"],
    ["direct PUT", directPath, "PUT"],
    ["direct DELETE", directPath, "DELETE"],
    ["direct OPTIONS", directPath, "OPTIONS"],
    ["direct HEAD", directPath, "HEAD"],
    [
      "multipart upload",
      `/workspaces/${workspaceId}/media-assets/upload-sessions`,
      "POST",
    ],
    ["media collection", `/v1/workspaces/${workspaceId}/media-assets`, "POST"],
    ["direct child path", `${directPath}/unexpected`, "POST"],
    ["double trailing slash", `${directPath}//`, "POST"],
    ["missing workspace id", "/workspaces//media-assets/images", "POST"],
    ["discovery", "/v1/agent", "POST"],
  ] as const;
  const eventFactories = [createRestApiEvent, createHttpApiEvent] as const;

  for (const createEvent of eventFactories) {
    for (const [label, path, method] of preservedTargets) {
      assert.equal(
        matchesDirectImagePost(createEvent(path, method)),
        false,
        label,
      );
    }
  }
});

test("route selection ignores client headers and uses REST v1 method and path fields", () => {
  const event = {
    ...createRestApiEvent("/health", "GET") as Readonly<Record<string, unknown>>,
    headers: {
      "x-http-method-override": "POST",
      "x-original-uri": directPath,
      "x-forwarded-uri": directPath,
    },
    requestContext: {
      http: {
        method: "POST",
        path: directPath,
      },
    },
  };

  assert.equal(matchesDirectImagePost(event), false);
});

test("route selection ignores client headers and uses HTTP v2 method and raw path fields", () => {
  const event = {
    ...createHttpApiEvent("/health", "GET") as Readonly<Record<string, unknown>>,
    httpMethod: "POST",
    path: directPath,
    headers: {
      "x-http-method-override": "POST",
      "x-original-uri": directPath,
      "x-forwarded-uri": directPath,
    },
  };

  assert.equal(matchesDirectImagePost(event), false);
});

test("malformed and unsupported events do not match the guarded route", () => {
  const malformedEvents = [
    null,
    [],
    {},
    { version: "2.0", rawPath: directPath },
    {
      version: "2.0",
      rawPath: directPath,
      requestContext: { http: { method: 1 } },
    },
    { version: "1.0", path: directPath },
    { version: "1.0", httpMethod: "POST" },
  ];

  for (const event of malformedEvents) {
    assert.equal(matchesDirectImagePost(event), false);
  }
});
