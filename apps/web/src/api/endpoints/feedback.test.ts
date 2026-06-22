// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import "./endpointsTestSupport";
import { createJsonResponse } from "../ApiTestSupport";
import { primeSessionCsrfToken } from "../transport/transport";
import {
  loadFeedbackState,
  recordFeedbackPromptEvent,
  submitFeedback,
} from "./feedback";

describe("feedback API endpoints", () => {
  const emptyFeedbackState = {
    automaticPromptCooldownDays: 30,
    lastAutomaticPromptShownAt: null,
    lastFeedbackSubmittedAt: null,
    nextAutomaticPromptAt: null,
  };

  const nextFeedbackState = {
    automaticPromptCooldownDays: 30,
    lastAutomaticPromptShownAt: "2026-04-18T09:00:00.000Z",
    lastFeedbackSubmittedAt: null,
    nextAutomaticPromptAt: "2026-05-18T09:00:00.000Z",
  };

  it("decodes feedback state responses", async () => {
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createJsonResponse({
        feedbackState: emptyFeedbackState,
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadFeedbackState()).resolves.toEqual(emptyFeedbackState);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/v1/feedback/state",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("sends automatic prompt event payloads and accepts ok envelopes", async () => {
    primeSessionCsrfToken("csrf-token-1");
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createJsonResponse({
        ok: true,
        feedbackState: nextFeedbackState,
      }));
    vi.stubGlobal("fetch", fetchMock);

    const promptEventPayload = {
      feedbackPromptEventId: "feedback-prompt-event-1",
      workspaceId: "workspace-1",
      installationId: "installation-1",
      platform: "web" as const,
      appVersion: "1.14.0",
      locale: "en" as const,
      timezone: "Europe/Madrid",
      eventType: "automatic_prompt_shown",
      createdAtClient: "2026-04-18T09:00:00.000Z",
    };

    await expect(recordFeedbackPromptEvent(promptEventPayload)).resolves.toEqual(nextFeedbackState);

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:8080/v1/feedback/prompt-events");
    expect(requestInit?.method).toBe("POST");
    expect(requestInit?.body).toBe(JSON.stringify(promptEventPayload));
  });

  it("sends feedback submission contract payloads and parses returned state", async () => {
    primeSessionCsrfToken("csrf-token-1");
    const submissionPayload = {
      feedbackSubmissionId: "feedback-submission-1",
      workspaceId: "workspace-1",
      installationId: "installation-1",
      platform: "web" as const,
      appVersion: "1.14.0",
      locale: "en" as const,
      timezone: "Europe/Madrid",
      trigger: "settings" as const,
      message: "Make review faster",
      createdAtClient: "2026-04-18T09:00:00.000Z",
    };
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createJsonResponse({
        ok: true,
        feedbackState: nextFeedbackState,
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(submitFeedback(submissionPayload)).resolves.toEqual(nextFeedbackState);

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:8080/v1/feedback/submissions");
    expect(requestInit?.method).toBe("POST");
    expect(requestInit?.body).toBe(JSON.stringify(submissionPayload));
  });

  it("rejects feedback POST responses with non-true ok values", async () => {
    primeSessionCsrfToken("csrf-token-1");
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createJsonResponse({
        ok: false,
        feedbackState: emptyFeedbackState,
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(recordFeedbackPromptEvent({
      feedbackPromptEventId: "feedback-prompt-event-2",
      workspaceId: "workspace-1",
      installationId: "installation-1",
      platform: "web",
      appVersion: "1.14.0",
      locale: "en",
      timezone: "Europe/Madrid",
      eventType: "automatic_prompt_dismissed",
      createdAtClient: "2026-04-18T09:00:00.000Z",
    })).rejects.toThrow("Invalid API response for POST /feedback/prompt-events: ok must be true");
  });
});
