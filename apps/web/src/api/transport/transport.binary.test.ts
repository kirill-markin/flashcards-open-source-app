// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { ApiError, ApiNetworkError } from "./errors";
import {
  allowAuthRecovery,
  allowAuthRecoveryWithTransientNetworkRetry,
  primeSessionCsrfToken,
  requestBlob,
} from "./transport";
import { createFailingBlobResponse } from "./transportTestSupport";

describe("API transport binary responses", () => {
  it("retries a successful response whose blob body cannot be read", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation((): void => {});
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createFailingBlobResponse(new TypeError("Load failed"), "blob-request-1"))
      .mockResolvedValueOnce(new Response("workspace-package", {
        status: 200,
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Request-Id": "blob-request-2",
        },
      }));
    vi.stubGlobal("fetch", fetchMock);

    const payload = await requestBlob(
      "/workspaces/workspace-1/packages/export",
      { method: "GET" },
      allowAuthRecoveryWithTransientNetworkRetry,
    );

    await expect(payload.blob.text()).resolves.toBe("workspace-package");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(consoleWarnSpy).toHaveBeenCalledWith("API transport retry", expect.objectContaining({
      endpoint: "GET /workspaces/workspace-1/packages/export",
      attemptCount: 1,
      source: "response_body",
      statusCode: 200,
      requestId: "blob-request-1",
    }));
  });

  it("does not retry a blob body read failure without network retry", async () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation((): void => {});
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createFailingBlobResponse(
        new TypeError("Load failed"),
        "blob-request-no-retry",
      ));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestBlob(
      "/workspaces/workspace-1/packages/export",
      { method: "GET" },
      allowAuthRecovery,
    )).rejects.toMatchObject({
      statusCode: 200,
      code: "API_NETWORK_ERROR",
      requestId: "blob-request-no-retry",
      endpoint: "GET /workspaces/workspace-1/packages/export",
      attemptCount: 1,
      source: "response_body",
    } satisfies Partial<ApiNetworkError>);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  it("raises a structured API network error after blob body retry attempts are exhausted", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation((): void => {});
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockImplementation(() => Promise.resolve(createFailingBlobResponse(
        new TypeError("Load failed"),
        "blob-request-terminal",
      )));
    vi.stubGlobal("fetch", fetchMock);
    const blobPromise = requestBlob(
      "/workspaces/workspace-1/packages/export",
      { method: "GET" },
      allowAuthRecoveryWithTransientNetworkRetry,
    );

    await expect(blobPromise).rejects.toMatchObject({
      statusCode: 200,
      code: "API_NETWORK_ERROR",
      requestId: "blob-request-terminal",
      endpoint: "GET /workspaces/workspace-1/packages/export",
      originalErrorName: "TypeError",
      originalErrorMessage: "Load failed",
      attemptCount: 4,
      source: "response_body",
    } satisfies Partial<ApiNetworkError>);

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(consoleWarnSpy).toHaveBeenCalledTimes(3);
  });

  it("converts non-OK JSON errors into ApiError metadata", async () => {
    primeSessionCsrfToken("csrf-token-1");
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: "Workspace package export failed.",
        code: "WORKSPACE_PACKAGE_EXPORT_FAILED",
        requestId: "body-request-id",
      }), {
        status: 413,
        headers: {
          "Content-Type": "application/json",
          "X-Request-Id": "header-request-id",
        },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestBlob("/workspaces/workspace-1/packages/export", {
      method: "POST",
      body: JSON.stringify({ ok: true }),
    }, allowAuthRecovery)).rejects.toMatchObject({
      statusCode: 413,
      message: "Workspace package export failed.",
      code: "WORKSPACE_PACKAGE_EXPORT_FAILED",
      requestId: "header-request-id",
      endpoint: "POST /workspaces/workspace-1/packages/export",
      responseBodyKind: "json",
    } satisfies Partial<ApiError>);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
