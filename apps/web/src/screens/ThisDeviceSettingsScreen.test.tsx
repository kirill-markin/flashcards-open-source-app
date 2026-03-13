// @vitest-environment jsdom

import { act } from "react";
import ReactDOM from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThisDeviceSettingsScreen } from "./ThisDeviceSettingsScreen";

const { mockAppData } = vi.hoisted(() => ({
  mockAppData: {
    activeWorkspace: {
      workspaceId: "workspace-1",
      name: "Workspace One",
      createdAt: "2026-03-10T09:00:00.000Z",
    },
  },
}));

vi.mock("../appData", () => ({
  useAppData: () => mockAppData,
}));

vi.mock("../clientIdentity", () => ({
  getStableDeviceId: () => "device-123",
  webAppBuild: "20260313.1",
  webAppVersion: "1.2.3",
}));

describe("ThisDeviceSettingsScreen", () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders technical device details for the current workspace", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <ThisDeviceSettingsScreen />
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain("This Device");
    expect(container.textContent).toContain("Workspace");
    expect(container.textContent).toContain("Workspace One");
    expect(container.textContent).toContain("Operating system");
    expect(container.textContent).toContain("Browser");
    expect(container.textContent).toContain("App version");
    expect(container.textContent).toContain("1.2.3");
    expect(container.textContent).toContain("Build");
    expect(container.textContent).toContain("20260313.1");
    expect(container.textContent).toContain("Client");
    expect(container.textContent).toContain("Browser");
    expect(container.textContent).toContain("Storage");
    expect(container.textContent).toContain("IndexedDB + localStorage");
    expect(container.textContent).toContain("Device ID");
    expect(container.textContent).toContain("device-123");
  });
});
