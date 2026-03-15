// @vitest-environment jsdom

import { act, useCallback, useState, type ReactElement } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudSettings, SessionInfo, WorkspaceSummary } from "../types";
import type { SessionLoadState } from "./types";
import { useWorkspaceSession } from "./useWorkspaceSession";

const {
  clearAllLocalBrowserDataMock,
  clearWebSyncCacheMock,
  consumeAccountDeletedMarkerMock,
  createWorkspaceMock,
  getSessionMock,
  getStableDeviceIdMock,
  listWorkspacesMock,
  putCloudSettingsMock,
  relinkWorkspaceCacheMock,
  revalidateSessionMock,
  selectWorkspaceMock,
} = vi.hoisted(() => ({
  clearAllLocalBrowserDataMock: vi.fn(),
  clearWebSyncCacheMock: vi.fn(),
  consumeAccountDeletedMarkerMock: vi.fn(),
  createWorkspaceMock: vi.fn(),
  getSessionMock: vi.fn(),
  getStableDeviceIdMock: vi.fn(),
  listWorkspacesMock: vi.fn(),
  putCloudSettingsMock: vi.fn(),
  relinkWorkspaceCacheMock: vi.fn(),
  revalidateSessionMock: vi.fn(),
  selectWorkspaceMock: vi.fn(),
}));

vi.mock("../api", () => ({
  createWorkspace: createWorkspaceMock,
  getSession: getSessionMock,
  isAuthRedirectError: () => false,
  listWorkspaces: listWorkspacesMock,
  revalidateSession: revalidateSessionMock,
  selectWorkspace: selectWorkspaceMock,
}));

vi.mock("../accountDeletion", () => ({
  clearAllLocalBrowserData: clearAllLocalBrowserDataMock,
  consumeAccountDeletedMarker: consumeAccountDeletedMarkerMock,
}));

vi.mock("../clientIdentity", () => ({
  getStableDeviceId: getStableDeviceIdMock,
}));

vi.mock("../localDb/cache", () => ({
  clearWebSyncCache: clearWebSyncCacheMock,
  relinkWorkspaceCache: relinkWorkspaceCacheMock,
}));

vi.mock("../localDb/cloudSettings", () => ({
  putCloudSettings: putCloudSettingsMock,
}));

const sessionFixture: SessionInfo = {
  userId: "user-1",
  selectedWorkspaceId: "workspace-1",
  authTransport: "cookie",
  csrfToken: "csrf-token",
  profile: {
    email: "test@example.com",
    locale: "en",
    createdAt: "2026-03-10T09:00:00.000Z",
  },
};

const workspaceFixture: WorkspaceSummary = {
  workspaceId: "workspace-1",
  name: "Workspace One",
  createdAt: "2026-03-10T09:00:00.000Z",
  isSelected: true,
};

function WorkspaceSessionHarness(): ReactElement {
  const [sessionLoadState, setSessionLoadState] = useState<SessionLoadState>("loading");
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceSummary | null>(null);
  const [availableWorkspaces, setAvailableWorkspaces] = useState<ReadonlyArray<WorkspaceSummary>>([]);
  const [, setIsChoosingWorkspace] = useState<boolean>(false);
  const [, setSessionErrorMessage] = useState<string>("");
  const [, setErrorMessage] = useState<string>("");
  const [, setCloudSettings] = useState<CloudSettings | null>(null);

  const runSync = useCallback(async function runSync(): Promise<void> {
    void session;
    void activeWorkspace;
  }, [activeWorkspace, session]);

  const refreshLocalData = useCallback(async function refreshLocalData(): Promise<void> {
    await runSync();
  }, [runSync]);

  useWorkspaceSession({
    sessionLoadState,
    session,
    availableWorkspaces,
    setSessionLoadState,
    setSessionErrorMessage,
    setSession,
    setActiveWorkspace,
    setAvailableWorkspaces,
    setIsChoosingWorkspace,
    setErrorMessage,
    setCloudSettings,
    refreshLocalData,
    runSync,
  });

  return (
    <div data-state={sessionLoadState} data-workspace-id={activeWorkspace?.workspaceId ?? ""}>
      {availableWorkspaces.length}
    </div>
  );
}

describe("useWorkspaceSession", () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);

    clearAllLocalBrowserDataMock.mockReset();
    clearWebSyncCacheMock.mockReset();
    consumeAccountDeletedMarkerMock.mockReset();
    createWorkspaceMock.mockReset();
    getSessionMock.mockReset();
    getStableDeviceIdMock.mockReset();
    listWorkspacesMock.mockReset();
    putCloudSettingsMock.mockReset();
    relinkWorkspaceCacheMock.mockReset();
    revalidateSessionMock.mockReset();
    selectWorkspaceMock.mockReset();

    consumeAccountDeletedMarkerMock.mockReturnValue(false);
    getStableDeviceIdMock.mockReturnValue("device-1");
    getSessionMock.mockResolvedValue(sessionFixture);
    listWorkspacesMock.mockResolvedValue([workspaceFixture]);
    putCloudSettingsMock.mockResolvedValue(undefined);
    relinkWorkspaceCacheMock.mockResolvedValue(undefined);
    revalidateSessionMock.mockResolvedValue(sessionFixture);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("bootstraps once even when parent sync callbacks change after session activation", async () => {
    await act(async () => {
      root.render(<WorkspaceSessionHarness />);
    });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(getSessionMock).toHaveBeenCalledTimes(1);
    expect(container.firstElementChild?.getAttribute("data-state")).toBe("ready");
    expect(container.firstElementChild?.getAttribute("data-workspace-id")).toBe("workspace-1");
  });
});
