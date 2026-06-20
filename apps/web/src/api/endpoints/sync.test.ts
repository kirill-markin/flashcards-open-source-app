// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import "./endpointsTestSupport";
import { primeSessionCsrfToken } from "../transport/transport";
import { pullReviewHistorySync } from "./sync";

describe("sync API endpoints", () => {
  it("decodes review-history events with optional reviewed timezone", async () => {
    primeSessionCsrfToken("csrf-token-1");
    const reviewEventWithTimeZone = {
      reviewEventId: "review-1",
      workspaceId: "workspace-1",
      cardId: "card-1",
      replicaId: "device-1",
      clientEventId: "client-event-1",
      rating: 2,
      reviewedAtClient: "2026-03-10T10:00:00.000Z",
      reviewedTimeZone: "Europe/Madrid",
      reviewedAtServer: "2026-03-10T10:00:01.000Z",
    } as const;
    const reviewEventWithoutTimeZone = {
      reviewEventId: "review-2",
      workspaceId: "workspace-1",
      cardId: "card-2",
      replicaId: "device-1",
      clientEventId: "client-event-2",
      rating: 3,
      reviewedAtClient: "2026-03-10T11:00:00.000Z",
      reviewedAtServer: "2026-03-10T11:00:01.000Z",
    } as const;
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        reviewEvents: [
          reviewEventWithTimeZone,
          reviewEventWithoutTimeZone,
        ],
        nextReviewSequenceId: 43,
        hasMore: false,
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await pullReviewHistorySync("workspace-1", "device-1", "web", "1.0.0", 41, 100);

    expect(result).toEqual({
      reviewEvents: [
        reviewEventWithTimeZone,
        reviewEventWithoutTimeZone,
      ],
      nextReviewSequenceId: 43,
      hasMore: false,
    });
    expect(result.reviewEvents[1]).not.toHaveProperty("reviewedTimeZone");
  });
});
