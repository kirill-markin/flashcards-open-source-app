const directImageIngestionPathPattern =
  /^\/(?:v1\/)*workspaces\/[^/]+\/media-assets\/images\/?$/u;
const catalogCardImageIngestionPathPattern =
  /^\/(?:v1\/)*admin\/catalog\/packages\/[^/]+\/media-assets\/images\/?$/u;
const catalogCoverImageIngestionPathPattern =
  /^\/(?:v1\/)*admin\/catalog\/packages\/[^/]+\/cover\/?$/u;

export type RequestTarget = Readonly<{
  method: string;
  path: string;
}>;

const multipartCompletionPathPattern =
  /^\/(?:v1\/)*workspaces\/[^/]+\/media-assets\/upload-sessions\/[^/]+\/complete\/?$/u;

function toRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null
    ? value as Readonly<Record<string, unknown>>
    : null;
}

export function readApiGatewayRequestTarget(event: unknown): RequestTarget | null {
  const eventRecord = toRecord(event);
  if (eventRecord === null) return null;

  if (eventRecord.version === "2.0") {
    const requestContext = toRecord(eventRecord.requestContext);
    const http = toRecord(requestContext?.http);
    return typeof eventRecord.rawPath === "string"
      && typeof http?.method === "string"
      ? { method: http.method, path: eventRecord.rawPath }
      : null;
  }

  return typeof eventRecord.httpMethod === "string"
    && typeof eventRecord.path === "string"
    ? { method: eventRecord.httpMethod, path: eventRecord.path }
    : null;
}

export function isDirectImageIngestionTarget(
  target: RequestTarget | null,
): boolean {
  if (target === null) {
    return false;
  }
  return (
    target.method === "POST"
    && (
      directImageIngestionPathPattern.test(target.path)
      || catalogCardImageIngestionPathPattern.test(target.path)
    )
  ) || (
    target.method === "PUT"
    && catalogCoverImageIngestionPathPattern.test(target.path)
  );
}

export function isMultipartCompletionPostTarget(
  target: RequestTarget | null,
): boolean {
  return target !== null
    && target.method === "POST"
    && multipartCompletionPathPattern.test(target.path);
}
