// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  invalidateLocalReviewSchedule,
  resetProgressInvalidationStateForTests,
  useProgressInvalidationRefresh,
  useProgressInvalidationState,
} from "./progressInvalidation";
import { resetProgressTimeContextStateForTests } from "./progressTimeContext";

type ProgressInvalidationSnapshot = ReturnType<typeof useProgressInvalidationState>;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function setDocumentVisibilityState(nextVisibilityState: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: (): DocumentVisibilityState => nextVisibilityState,
  });
}

function renderHarness(): Readonly<{
  getSnapshot: () => ProgressInvalidationSnapshot;
}> {
  let latestSnapshot: ProgressInvalidationSnapshot | null = null;

  function Harness(): null {
    useProgressInvalidationRefresh();
    latestSnapshot = useProgressInvalidationState();
    return null;
  }

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(<Harness />);
  });

  return {
    getSnapshot(): ProgressInvalidationSnapshot {
      if (latestSnapshot === null) {
        throw new Error("Expected progress invalidation snapshot to be available.");
      }

      return latestSnapshot;
    },
  };
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  resetProgressInvalidationStateForTests();
  resetProgressTimeContextStateForTests(new Date("2026-04-20T12:00:00.000Z"));
  setDocumentVisibilityState("visible");
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  vi.useRealTimers();
  container?.remove();
  root = null;
  container = null;
  resetProgressInvalidationStateForTests();
  resetProgressTimeContextStateForTests(new Date("2026-04-20T12:00:00.000Z"));
  setDocumentVisibilityState("visible");
});

describe("useProgressInvalidationRefresh", () => {
  it("coalesces focus and visible events into a single shared progress refresh when the time context changes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-20T12:00:00.000Z"));
    const harness = renderHarness();

    expect(harness.getSnapshot()).toEqual({
      progressLocalVersion: 0,
      progressScheduleLocalVersion: 0,
      progressServerInvalidationVersion: 0,
    });

    act(() => {
      vi.setSystemTime(new Date("2026-04-21T12:00:00.000Z"));
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flushEffects();

    expect(harness.getSnapshot()).toEqual({
      progressLocalVersion: 1,
      progressScheduleLocalVersion: 0,
      progressServerInvalidationVersion: 1,
    });
  });

  it("refreshes shared progress after the local day changes while the app stays open", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-20T12:00:00.000Z"));
    const harness = renderHarness();

    expect(harness.getSnapshot()).toEqual({
      progressLocalVersion: 0,
      progressScheduleLocalVersion: 0,
      progressServerInvalidationVersion: 0,
    });

    act(() => {
      vi.setSystemTime(new Date("2026-04-22T12:00:00.000Z"));
      vi.advanceTimersByTime(60_000);
    });

    expect(harness.getSnapshot()).toEqual({
      progressLocalVersion: 1,
      progressScheduleLocalVersion: 0,
      progressServerInvalidationVersion: 1,
    });
  });

  it("tracks review schedule local invalidation independently from shared progress refreshes", () => {
    const harness = renderHarness();

    act(() => {
      invalidateLocalReviewSchedule();
    });

    expect(harness.getSnapshot()).toEqual({
      progressLocalVersion: 0,
      progressScheduleLocalVersion: 1,
      progressServerInvalidationVersion: 0,
    });
  });
});
