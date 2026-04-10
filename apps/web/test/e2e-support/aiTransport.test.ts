import { describe, expect, it } from "vitest";

import { classifyAiTransportGetRequest } from "../../e2e/support/aiTransport";

describe("classifyAiTransportGetRequest", () => {
  it("classifies lambda SSE attaches as live attach requests", () => {
    expect(classifyAiTransportGetRequest({
      method: "GET",
      url: "https://live.example.com/?sessionId=session-1&runId=run-1&afterCursor=42",
      resourceType: "fetch",
      headers: {
        accept: "text/event-stream",
      },
    })).toBe("live_attach");
  });

  it("classifies /v1/chat snapshot polls without runId", () => {
    expect(classifyAiTransportGetRequest({
      method: "GET",
      url: "https://api.example.com/v1/chat?sessionId=session-1",
      resourceType: "fetch",
      headers: {
        accept: "application/json",
      },
    })).toBe("snapshot_poll");
  });

  it("does not classify unrelated requests as live attach", () => {
    expect(classifyAiTransportGetRequest({
      method: "GET",
      url: "https://api.example.com/v1/chat",
      resourceType: "xhr",
      headers: {
        accept: "application/json",
      },
    })).toBe("sessionless_chat_snapshot");

    expect(classifyAiTransportGetRequest({
      method: "GET",
      url: "https://api.example.com/v1/cards?sessionId=session-1&runId=run-1",
      resourceType: "fetch",
      headers: {
        accept: "application/json",
      },
    })).toBe("other");
  });
});
