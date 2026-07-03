// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import "./endpointsTestSupport";
import { createJsonResponse } from "../ApiTestSupport";
import { loadReviewPlatformSummary } from "./reviewPlatformSummary";

describe("review platform summary API endpoint", () => {
  it("decodes the mobile review summary response", async () => {
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createJsonResponse({
        hasMobileReviewEvent: false,
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadReviewPlatformSummary()).resolves.toEqual({
      hasMobileReviewEvent: false,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/v1/me/review-platform-summary",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("rejects malformed summary responses", async () => {
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createJsonResponse({
        hasMobileReviewEvent: "false",
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadReviewPlatformSummary()).rejects.toThrow(
      "Invalid API response for GET /me/review-platform-summary: hasMobileReviewEvent must be boolean",
    );
  });
});
