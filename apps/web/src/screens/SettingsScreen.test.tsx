// @vitest-environment jsdom

import { act } from "react";
import ReactDOM from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsScreen } from "./SettingsScreen";

const { mockAppData } = vi.hoisted(() => ({
  mockAppData: {
    activeWorkspace: {
      workspaceId: "workspace-1",
      name: "Primary workspace",
      createdAt: "2026-03-10T09:00:00.000Z",
      isSelected: true,
    },
    isSessionVerified: true,
    cloudSettings: {
      deviceId: "device-1",
      cloudState: "linked",
      linkedUserId: "user-1",
      linkedWorkspaceId: "workspace-1",
      linkedEmail: "user@example.com",
      onboardingCompleted: true,
      updatedAt: "2026-03-10T09:00:00.000Z",
    },
  },
}));

vi.mock("../appData", () => ({
  useAppData: () => mockAppData,
}));

describe("SettingsScreen", () => {
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

  it("renders the root settings groups in the new order", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/settings"]}>
          <SettingsScreen />
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain("Settings");
    expect(container.textContent).toContain("Current Workspace");
    expect(container.textContent).toContain("Workspace Settings");
    expect(container.textContent).toContain("Account Settings");
    expect(container.textContent).toContain("This Device");
    expect(container.textContent).toContain("Access");
    expect(container.textContent).not.toContain("Workspace Data");
    expect(container.textContent).not.toContain("Connections");

    const tabLinks = Array.from(container.querySelectorAll(".settings-switcher-link")).map((element) => ({
      href: element.getAttribute("href"),
      label: element.textContent,
    }));
    expect(tabLinks).toEqual([
      { href: "/settings", label: "General" },
      { href: "/settings/current-workspace", label: "Current Workspace" },
      { href: "/settings/workspace", label: "Workspace" },
      { href: "/settings/account", label: "Account" },
      { href: "/settings/device", label: "Device" },
      { href: "/settings/access", label: "Access" },
    ]);
    expect(container.querySelector(".settings-switcher-link-active")?.textContent).toBe("General");

    const links = Array.from(container.querySelectorAll(".settings-nav-card")).map((element) => {
      return element.getAttribute("href");
    });
    expect(links).toEqual([
      "/settings/current-workspace",
      "/settings/workspace",
      "/settings/account",
      "/settings/device",
      "/settings/access",
    ]);
  });

  it("keeps the current workspace row clickable while locked and shows a temporary banner", async () => {
    mockAppData.isSessionVerified = false;
    mockAppData.cloudSettings = {
      ...mockAppData.cloudSettings,
      cloudState: "disconnected",
    };

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/settings"]}>
          <SettingsScreen />
        </MemoryRouter>,
      );
    });

    const currentWorkspaceButton = container.querySelector(".settings-nav-card-button");
    expect(currentWorkspaceButton).toBeInstanceOf(HTMLButtonElement);

    await act(async () => {
      currentWorkspaceButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Workspace changes are available only after you create an account.");
    expect(container.querySelector('.settings-nav-card[href="/settings/current-workspace"]')).toBeNull();
  });
});
