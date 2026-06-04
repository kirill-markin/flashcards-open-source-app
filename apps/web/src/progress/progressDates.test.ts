// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildProgressDateContext } from "./progressDates";

const observabilityMocks = vi.hoisted(() => ({
  captureWebWarningMock: vi.fn(),
}));

vi.mock("../observability/webObservability", () => ({
  captureWebWarning: observabilityMocks.captureWebWarningMock,
}));

describe("progress date context", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    observabilityMocks.captureWebWarningMock.mockReset();
  });

  it("falls back to UTC when the browser timezone is invalid", () => {
    const resolvedOptions = new Intl.DateTimeFormat().resolvedOptions();
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
      ...resolvedOptions,
      timeZone: "Etc/Unknown",
    });

    expect(buildProgressDateContext(new Date("2026-06-04T12:00:00.000Z"))).toEqual({
      timeZone: "UTC",
      today: "2026-06-04",
    });
    expect(observabilityMocks.captureWebWarningMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "progress_timezone_invalid",
      details: expect.objectContaining({
        eventName: "progress_timezone_invalid",
        observedTimeZone: "Etc/Unknown",
        fallbackTimeZone: "UTC",
        errorName: "RangeError",
      }),
    }));
  });
});
