// @vitest-environment jsdom

import { act, type ReactElement } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppDataProvider, useAppData } from "./provider";

const {
  loadActiveCardCountMock,
  useSyncEngineMock,
  useWorkspaceSessionMock,
} = vi.hoisted(() => ({
  loadActiveCardCountMock: vi.fn(),
  useSyncEngineMock: vi.fn(),
  useWorkspaceSessionMock: vi.fn(),
}));

vi.mock("../localDb/cards", () => ({
  loadActiveCardCount: loadActiveCardCountMock,
}));

vi.mock("./useSyncEngine", () => ({
  useSyncEngine: useSyncEngineMock,
}));

vi.mock("./useWorkspaceSession", () => ({
  useWorkspaceSession: useWorkspaceSessionMock,
}));

function AppDataProbe(): ReactElement {
  const appData = useAppData();
  return (
    <div
      data-state={appData.sessionLoadState}
      data-verification-state={appData.sessionVerificationState}
      data-workspace-id={appData.activeWorkspace?.workspaceId ?? ""}
      data-workspace-name={appData.activeWorkspace?.name ?? ""}
      data-session-user-id={appData.session?.userId ?? ""}
    />
  );
}

describe("AppDataProvider", () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root | null;

  function createMemoryStorage(): Storage {
    const data = new Map<string, string>();
    return {
      get length(): number {
        return data.size;
      },
      clear(): void {
        data.clear();
      },
      getItem(key: string): string | null {
        return data.get(key) ?? null;
      },
      key(index: number): string | null {
        return [...data.keys()][index] ?? null;
      },
      removeItem(key: string): void {
        data.delete(key);
      },
      setItem(key: string, value: string): void {
        data.set(key, value);
      },
    };
  }

  function clearWindowLocalStorage(): void {
    const storage = window.localStorage;
    if (typeof storage.clear === "function") {
      storage.clear();
      return;
    }

    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);
      if (key !== null) {
        storage.removeItem(key);
      }
    }
  }

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("localStorage", createMemoryStorage());
    clearWindowLocalStorage();
    document.cookie = "logged_in=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/";
    loadActiveCardCountMock.mockReset();
    useSyncEngineMock.mockReset();
    useWorkspaceSessionMock.mockReset();
    loadActiveCardCountMock.mockResolvedValue(0);
    useSyncEngineMock.mockReturnValue({
      runSync: vi.fn(async () => undefined),
      runSyncForWorkspace: vi.fn(async () => undefined),
      refreshLocalData: vi.fn(async () => undefined),
      refreshWorkspaceView: vi.fn(async () => undefined),
      getCardById: vi.fn(async () => {
        throw new Error("not used");
      }),
      getDeckById: vi.fn(async () => {
        throw new Error("not used");
      }),
      createCardItem: vi.fn(async () => {
        throw new Error("not used");
      }),
      createDeckItem: vi.fn(async () => {
        throw new Error("not used");
      }),
      updateCardItem: vi.fn(async () => {
        throw new Error("not used");
      }),
      updateDeckItem: vi.fn(async () => {
        throw new Error("not used");
      }),
      deleteCardItem: vi.fn(async () => {
        throw new Error("not used");
      }),
      deleteDeckItem: vi.fn(async () => {
        throw new Error("not used");
      }),
      submitReviewItem: vi.fn(async () => {
        throw new Error("not used");
      }),
    });
    useWorkspaceSessionMock.mockReturnValue({
      initialize: vi.fn(async () => undefined),
      chooseWorkspace: vi.fn(async () => undefined),
      createWorkspace: vi.fn(async () => undefined),
      renameWorkspace: vi.fn(async () => undefined),
      deleteWorkspace: vi.fn(async () => undefined),
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    if (root !== null) {
      act(() => root?.unmount());
      root = null;
    }
    container.remove();
    clearWindowLocalStorage();
    document.cookie = "logged_in=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/";
    vi.unstubAllGlobals();
  });

  it("keeps the cold-start loading state when no warm-start snapshot is available", async () => {
    await act(async () => {
      root!.render(
        <AppDataProvider>
          <AppDataProbe />
        </AppDataProvider>,
      );
    });

    expect(container.firstElementChild?.getAttribute("data-state")).toBe("loading");
    expect(container.firstElementChild?.getAttribute("data-session-user-id")).toBe("");
  });

  it("hydrates the last known shell immediately when the warm-start snapshot and logged-in cookie exist", async () => {
    localStorage.setItem("flashcards-warm-start-snapshot", JSON.stringify({
      version: 1,
      session: {
        userId: "user-1",
        selectedWorkspaceId: "workspace-1",
        authTransport: "session",
        csrfToken: null,
        profile: {
          email: "test@example.com",
          locale: "en",
          createdAt: "2026-03-19T08:00:00.000Z",
        },
      },
      activeWorkspace: {
        workspaceId: "workspace-1",
        name: "Warm Workspace",
        createdAt: "2026-03-19T08:00:00.000Z",
        isSelected: true,
      },
      availableWorkspaces: [{
        workspaceId: "workspace-1",
        name: "Warm Workspace",
        createdAt: "2026-03-19T08:00:00.000Z",
        isSelected: true,
      }],
      savedAt: "2026-03-19T08:05:00.000Z",
    }));
    document.cookie = "logged_in=1;path=/";

    await act(async () => {
      root!.render(
        <AppDataProvider>
          <AppDataProbe />
        </AppDataProvider>,
      );
    });

    expect(container.firstElementChild?.getAttribute("data-state")).toBe("ready");
    expect(container.firstElementChild?.getAttribute("data-verification-state")).toBe("unverified");
    expect(container.firstElementChild?.getAttribute("data-workspace-id")).toBe("workspace-1");
    expect(container.firstElementChild?.getAttribute("data-workspace-name")).toBe("Warm Workspace");
    expect(container.firstElementChild?.getAttribute("data-session-user-id")).toBe("user-1");
  });
});
