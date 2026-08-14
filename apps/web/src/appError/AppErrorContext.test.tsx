// @vitest-environment jsdom
import { act, useEffect, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import type { IndexedDbOpenRecoveryError } from "../localDb/core/indexedDbOpenRecovery";
import {
  buildWebExceptionFingerprint,
  type WebExceptionEvent,
} from "../observability/webObservability";
import {
  AppErrorDialogProvider,
  useAppErrorDialog,
  type IndexedDbOpenRecoveryMarkResult,
  type IndexedDbOpenRecoveryState,
} from "./AppErrorContext";

const observabilityMocks = vi.hoisted(() => ({
  captureWebExceptionMock: vi.fn<(event: WebExceptionEvent) => void>(),
}));

vi.mock("../observability/webObservability", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../observability/webObservability")>();
  return {
    ...actual,
    captureWebException: observabilityMocks.captureWebExceptionMock,
  };
});

type RecoveryError = IndexedDbOpenRecoveryError & Readonly<{
  databaseName: string;
  databaseVersion: number;
}>;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function buildRecoveryError(message: string, databaseName: string): RecoveryError {
  return Object.assign(new Error(message), {
    indexedDbOperation: "open" as const,
    indexedDbErrorName: "UnknownError" as const,
    databaseName,
    databaseVersion: 7,
  });
}

function renderRecoveryHarness(events: Array<string>): Readonly<{
  getRecoveryState: () => IndexedDbOpenRecoveryState;
}> {
  let recoveryState: IndexedDbOpenRecoveryState | null = null;

  function RecoveryHarness(): ReactElement {
    const { indexedDbOpenRecoveryState } = useAppErrorDialog();
    recoveryState = indexedDbOpenRecoveryState;

    useEffect(() => {
      const handleAbort = (): void => {
        events.push("abort");
      };
      indexedDbOpenRecoveryState.signal.addEventListener("abort", handleAbort, { once: true });

      return (): void => {
        indexedDbOpenRecoveryState.signal.removeEventListener("abort", handleAbort);
        events.push("unmount");
      };
    }, [indexedDbOpenRecoveryState]);

    return <main data-testid="recovery-child" />;
  }

  if (root === null) {
    throw new Error("App error context test root is not ready");
  }

  act(() => {
    root?.render(
      <I18nProvider>
        <AppErrorDialogProvider>
          <RecoveryHarness />
        </AppErrorDialogProvider>
      </I18nProvider>,
    );
  });

  return {
    getRecoveryState(): IndexedDbOpenRecoveryState {
      if (recoveryState === null) {
        throw new Error("Expected IndexedDB recovery state to be available");
      }

      return recoveryState;
    },
  };
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  observabilityMocks.captureWebExceptionMock.mockReset();
  window.history.replaceState(null, "", "/review?mode=due#current-card");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  container = null;
  root = null;
  window.history.replaceState(null, "", "/");
});

describe("AppErrorDialogProvider IndexedDB open recovery", () => {
  it("captures only the first canonical failure before aborting and unmounting the active tree", () => {
    const events: Array<string> = [];
    const harness = renderRecoveryHarness(events);
    const recoveryState = harness.getRecoveryState();
    const firstError = buildRecoveryError("First IndexedDB open failure", "flashcards");
    const laterError = buildRecoveryError("Later IndexedDB open failure", "flashcards-later");
    const markResults: Array<IndexedDbOpenRecoveryMarkResult> = [];

    observabilityMocks.captureWebExceptionMock.mockImplementation((event: WebExceptionEvent): void => {
      expect(event.error).toBe(firstError);
      expect(event.error).toMatchObject({
        databaseName: "flashcards",
        databaseVersion: 7,
        indexedDbOperation: "open",
        indexedDbErrorName: "UnknownError",
      });
      expect(recoveryState.signal.aborted).toBe(false);
      expect(container?.querySelector("[data-testid='recovery-child']")).not.toBeNull();
      events.push("capture");
    });

    act(() => {
      markResults.push(recoveryState.markFailed(firstError));
      markResults.push(recoveryState.markFailed(firstError));
      markResults.push(recoveryState.markFailed(laterError));
    });

    expect(markResults).toEqual(["first_failure", "first_failure_repeat", "later_failure"]);
    expect(observabilityMocks.captureWebExceptionMock).toHaveBeenCalledTimes(1);
    const capturedEvent = observabilityMocks.captureWebExceptionMock.mock.calls[0]?.[0];
    expect(capturedEvent).toEqual({
      action: "indexed_db_open_recovery_failed",
      error: firstError,
      scope: {
        app: "web",
        feature: "app",
        userId: null,
        workspaceId: null,
        installationId: null,
        route: "/review?mode=due#current-card",
        requestId: null,
        statusCode: null,
        code: null,
      },
      details: {
        recoveryOwner: "app_error_dialog_provider",
      },
    });
    if (capturedEvent === undefined) {
      throw new Error("Expected the canonical IndexedDB recovery exception event");
    }
    expect(buildWebExceptionFingerprint(capturedEvent)).toEqual(["web.indexeddb.open.unknown_error"]);
    expect(recoveryState.signal.reason).toBe(firstError);
    expect(events).toEqual(["capture", "abort", "unmount"]);
    expect(container?.querySelector("[data-testid='recovery-child']")).toBeNull();
  });
});
