// @vitest-environment jsdom

import { act } from "react";
import ReactDOM from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessSettingsScreen } from "./AccessSettingsScreen";

const { queryBrowserPermissionStateMock } = vi.hoisted(() => ({
  queryBrowserPermissionStateMock: vi.fn(),
}));

vi.mock("../access/browserAccess", () => ({
  browserPermissionSettingsGuidance: (kind: string) => `Guidance for ${kind}`,
  formatBrowserPermissionState: (state: string) => state.toUpperCase(),
  queryBrowserPermissionState: queryBrowserPermissionStateMock,
}));

describe("AccessSettingsScreen", () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    queryBrowserPermissionStateMock.mockReset();
    queryBrowserPermissionStateMock.mockResolvedValueOnce("granted");
    queryBrowserPermissionStateMock.mockResolvedValueOnce("denied");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders access entries for notifications, photos, camera, and microphone", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/settings/access"]}>
          <AccessSettingsScreen />
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain("Access");
    expect(container.textContent).toContain("Notifications");
    expect(container.textContent).toContain("This device");
    expect(container.textContent).toContain("Photos and files");
    expect(container.textContent).toContain("Per action");
    expect(container.textContent).toContain("Camera");
    expect(container.textContent).toContain("GRANTED");
    expect(container.textContent).toContain("Microphone");
    expect(container.textContent).toContain("DENIED");
    expect(container.querySelector(".settings-switcher-link-active")?.textContent).toBe("Access");
  });
});
