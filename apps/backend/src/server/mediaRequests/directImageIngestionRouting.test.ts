import assert from "node:assert/strict";
import test from "node:test";
import {
  isDirectImageIngestionTarget,
  isMultipartCompletionPostTarget,
  readApiGatewayRequestTarget,
} from "./directImageIngestionRouting";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const directPath = `/workspaces/${workspaceId}/media-assets/images`;
const catalogCardImagePath =
  `/admin/catalog/packages/${workspaceId}/media-assets/images`;
const catalogCoverImagePath = `/admin/catalog/packages/${workspaceId}/cover`;
const multipartSessionId = "22222222-2222-4222-8222-222222222222";
const multipartCompletionPath =
  `/workspaces/${workspaceId}/media-assets/upload-sessions/${multipartSessionId}/complete`;

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

function matchesDirectImageTarget(event: unknown): boolean {
  return isDirectImageIngestionTarget(
    readApiGatewayRequestTarget(event),
  );
}

function matchesMultipartCompletionPost(event: unknown): boolean {
  return isMultipartCompletionPostTarget(
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
    ["catalog card image", catalogCardImagePath],
    ["catalog card image trailing slash", `${catalogCardImagePath}/`],
    ["catalog card image v1", `/v1${catalogCardImagePath}`],
  ] as const;
  const eventFactories = [
    ["REST v1", createRestApiEvent],
    ["HTTP v2", createHttpApiEvent],
  ] as const;

  for (const [eventLabel, createEvent] of eventFactories) {
    for (const [pathLabel, path] of directPostPaths) {
      assert.equal(
        matchesDirectImageTarget(createEvent(path, "POST")),
        true,
        `${eventLabel}: ${pathLabel}`,
      );
    }
  }
});

test("shared Lambda matches only PUT for the exact catalog cover path", () => {
  const eventFactories = [createRestApiEvent, createHttpApiEvent] as const;
  for (const createEvent of eventFactories) {
    assert.equal(matchesDirectImageTarget(createEvent(catalogCoverImagePath, "PUT")), true);
    assert.equal(matchesDirectImageTarget(createEvent(`/v1${catalogCoverImagePath}/`, "PUT")), true);
    assert.equal(matchesDirectImageTarget(createEvent(catalogCoverImagePath, "POST")), false);
    assert.equal(
      matchesDirectImageTarget(createEvent(`${catalogCoverImagePath}/unexpected`, "PUT")),
      false,
    );
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
    ["catalog card image wrong method", catalogCardImagePath, "PUT"],
  ] as const;
  const eventFactories = [createRestApiEvent, createHttpApiEvent] as const;

  for (const createEvent of eventFactories) {
    for (const [label, path, method] of preservedTargets) {
      assert.equal(
        matchesDirectImageTarget(createEvent(path, method)),
        false,
        label,
      );
    }
  }
});

test("shared Lambda matches multipart completion POST paths across REST v1 and HTTP v2 events", () => {
  const completionPaths = [
    multipartCompletionPath,
    `${multipartCompletionPath}/`,
    `/v1${multipartCompletionPath}`,
    `/v1/v1${multipartCompletionPath}`,
  ];
  const eventFactories = [createRestApiEvent, createHttpApiEvent] as const;

  for (const createEvent of eventFactories) {
    for (const path of completionPaths) {
      assert.equal(
        matchesMultipartCompletionPost(createEvent(path, "POST")),
        true,
        path,
      );
    }
  }
});

test("multipart completion timing guard excludes other methods and adjacent routes", () => {
  const excludedTargets = [
    [multipartCompletionPath, "GET"],
    [multipartCompletionPath, "OPTIONS"],
    [
      `/workspaces/${workspaceId}/media-assets/upload-sessions/${multipartSessionId}/abort`,
      "POST",
    ],
    [
      `/workspaces/${workspaceId}/media-assets/upload-sessions/${multipartSessionId}/parts`,
      "POST",
    ],
    [`${multipartCompletionPath}/unexpected`, "POST"],
  ] as const;
  const eventFactories = [createRestApiEvent, createHttpApiEvent] as const;

  for (const createEvent of eventFactories) {
    for (const [path, method] of excludedTargets) {
      assert.equal(
        matchesMultipartCompletionPost(createEvent(path, method)),
        false,
        `${method} ${path}`,
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

  assert.equal(matchesDirectImageTarget(event), false);
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

  assert.equal(matchesDirectImageTarget(event), false);
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
    assert.equal(matchesDirectImageTarget(event), false);
  }
});
