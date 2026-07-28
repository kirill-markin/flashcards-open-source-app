export const browserCorsAllowHeaders = [
  "content-type",
  "authorization",
  "x-csrf-token",
  "sentry-trace",
  "baggage",
  "x-chat-request-id",
  "x-chat-resume-attempt-id",
  "x-client-platform",
  "x-client-version",
  "x-media-asset-id",
  "x-media-source-url",
  "x-media-created-at",
  "x-media-client-updated-at",
  "x-media-last-modified-by-replica-id",
  "x-media-last-operation-id",
] as const;

export const browserCorsExposeHeaders = [
  "cache-control",
  "content-disposition",
  "content-encoding",
  "content-length",
  "content-type",
  "x-request-id",
  "x-amz-apigw-id",
  "x-amzn-requestid",
  "x-chat-request-id",
  "retry-after",
] as const;

export function getAllowedBrowserOrigins(): Array<string> {
  const raw = process.env.BACKEND_ALLOWED_ORIGINS
    ?? "http://localhost:3000,http://localhost:3001";
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value !== "");
}

export function createCredentialedBrowserCorsResponseHeaders(
  origin: string | null,
  allowedOrigins: ReadonlyArray<string>,
): Readonly<Record<string, string>> {
  if (origin === null || !allowedOrigins.includes(origin)) {
    return {};
  }

  return {
    "access-control-allow-origin": origin,
    "access-control-allow-credentials": "true",
    "access-control-expose-headers": browserCorsExposeHeaders.join(","),
    vary: "Origin",
  };
}
