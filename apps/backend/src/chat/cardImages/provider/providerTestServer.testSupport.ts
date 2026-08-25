import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

export type CapturedProviderRequest = Readonly<{
  method: string | null;
  path: string | null;
  authorization: string | null;
  contentType: string | null;
  body: unknown;
}>;

type ProviderRequestResponder = (
  request: CapturedProviderRequest,
  requestNumber: number,
  response: ServerResponse,
) => void | Promise<void>;

type ProviderTestServer = Readonly<{
  baseURL: string;
  requests: Array<CapturedProviderRequest>;
  waitForRequestCount: (expectedCount: number) => Promise<void>;
}>;

type RunningProviderTestServer = ProviderTestServer & Readonly<{
  handlerErrors: Array<Error>;
  close: () => Promise<void>;
}>;

const providerRequestWaitTimeoutMs = 2_000;

function toRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected a JSON object.");
  }

  return value as Readonly<Record<string, unknown>>;
}

function parseJsonObject(value: string): Readonly<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(value);
  return toRecord(parsed);
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Array<Buffer> = [];
    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.once("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    request.once("error", reject);
  });
}

function normalizeServerHandlerError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error(`Provider test server handler threw a non-Error value: ${String(error)}`);
}

async function captureProviderRequest(request: IncomingMessage): Promise<CapturedProviderRequest> {
  const requestBody = await readRequestBody(request);
  return {
    method: request.method ?? null,
    path: request.url ?? null,
    authorization: request.headers.authorization ?? null,
    contentType: request.headers["content-type"] ?? null,
    body: parseJsonObject(requestBody),
  };
}

function createRequestCountWaiter(
  requests: ReadonlyArray<CapturedProviderRequest>,
  requestListeners: Set<() => void>,
  expectedCount: number,
): Promise<void> {
  if (requests.length >= expectedCount) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const handleRequest = (): void => {
      if (requests.length < expectedCount) {
        return;
      }

      clearTimeout(timeout);
      requestListeners.delete(handleRequest);
      resolve();
    };
    const timeout = setTimeout(() => {
      requestListeners.delete(handleRequest);
      reject(
        new Error(
          `Timed out waiting for ${expectedCount} provider requests; received ${requests.length}.`,
        ),
      );
    }, providerRequestWaitTimeoutMs);

    requestListeners.add(handleRequest);
  });
}

async function closeProviderTestServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }

      resolve();
    });
    server.closeAllConnections();
  });
}

async function startProviderTestServer(
  responder: ProviderRequestResponder,
): Promise<RunningProviderTestServer> {
  const requests: Array<CapturedProviderRequest> = [];
  const handlerErrors: Array<Error> = [];
  const requestListeners: Set<() => void> = new Set();
  const server = createServer((request, response) => {
    void (async (): Promise<void> => {
      const capturedRequest = await captureProviderRequest(request);
      requests.push(capturedRequest);
      for (const listener of requestListeners) {
        listener();
      }

      await responder(capturedRequest, requests.length, response);
    })().catch((error: unknown) => {
      const handlerError = normalizeServerHandlerError(error);
      handlerErrors.push(handlerError);
      response.destroy(handlerError);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    await closeProviderTestServer(server);
    throw new Error("Provider test server did not expose a TCP address.");
  }

  const tcpAddress = address as AddressInfo;
  return {
    baseURL: `http://127.0.0.1:${tcpAddress.port}/v1`,
    requests,
    handlerErrors,
    waitForRequestCount: async (expectedCount: number): Promise<void> => {
      await createRequestCountWaiter(requests, requestListeners, expectedCount);
    },
    close: async (): Promise<void> => {
      await closeProviderTestServer(server);
    },
  };
}

export async function withProviderTestServer<Result>(
  responder: ProviderRequestResponder,
  run: (server: ProviderTestServer) => Promise<Result>,
): Promise<Result> {
  const server = await startProviderTestServer(responder);
  try {
    try {
      const result = await run(server);
      if (server.handlerErrors.length > 0) {
        throw server.handlerErrors[0];
      }

      return result;
    } catch (error) {
      if (server.handlerErrors.length > 0) {
        throw server.handlerErrors[0];
      }

      throw error;
    }
  } finally {
    await server.close();
  }
}

export function writeJsonResponse(
  response: ServerResponse,
  statusCode: number,
  requestId: string,
  body: Readonly<Record<string, unknown>>,
): void {
  writeJsonResponseWithHeaders(response, statusCode, requestId, body, {});
}

export function writeJsonResponseWithHeaders(
  response: ServerResponse,
  statusCode: number,
  requestId: string,
  body: Readonly<Record<string, unknown>>,
  headers: Readonly<Record<string, string>>,
): void {
  response.writeHead(statusCode, {
    "content-type": "application/json",
    "x-request-id": requestId,
    ...headers,
  });
  response.end(JSON.stringify(body));
}

export function writeRawResponse(
  response: ServerResponse,
  statusCode: number,
  requestId: string,
  contentType: string,
  body: string,
): void {
  response.writeHead(statusCode, {
    "content-type": contentType,
    "x-request-id": requestId,
  });
  response.end(body);
}
