// @vitest-environment jsdom

import { act } from "react";
import ReactDOM from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessPermissionDetailScreen } from "./AccessPermissionDetailScreen";

const {
  queryBrowserPermissionStateMock,
  requestBrowserMediaPermissionMock,
} = vi.hoisted(() => ({
  queryBrowserPermissionStateMock: vi.fn(),
  requestBrowserMediaPermissionMock: vi.fn(),
}));

vi.mock("../access/browserAccess", () => ({
  browserPermissionSettingsGuidance: (kind: string) => `Guidance for ${kind}`,
  explainBrowserMediaPermissionError: () => "Permission request failed",
  formatBrowserPermissionState: (state: string) => state.toUpperCase(),
  queryBrowserPermissionState: queryBrowserPermissionStateMock,
  requestBrowserMediaPermission: requestBrowserMediaPermissionMock,
}));

describe("AccessPermissionDetailScreen", () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    queryBrowserPermissionStateMock.mockReset();
    requestBrowserMediaPermissionMock.mockReset();
    queryBrowserPermissionStateMock.mockResolvedValue("granted");
    requestBrowserMediaPermissionMock.mockResolvedValue(undefined);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("keeps the Access tab active on detail routes", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/settings/access/camera"]}>
          <Routes>
            <Route path="/settings/access/:accessKind" element={<AccessPermissionDetailScreen />} />
          </Routes>
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain("Camera");
    expect(container.textContent).toContain("GRANTED");
    expect(container.querySelector(".settings-switcher-link-active")?.textContent).toBe("Access");
  });
});
