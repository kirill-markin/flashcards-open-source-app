// @vitest-environment jsdom

import { act } from "react";
import ReactDOM from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CurrentWorkspaceScreen } from "./CurrentWorkspaceScreen";

const { mockAppData } = vi.hoisted(() => ({
  mockAppData: {
    activeWorkspace: {
      workspaceId: "workspace-1",
      name: "Primary workspace",
      createdAt: "2026-03-10T09:00:00.000Z",
      isSelected: true,
    },
    availableWorkspaces: [
      {
        workspaceId: "workspace-1",
        name: "Primary workspace",
        createdAt: "2026-03-10T09:00:00.000Z",
        isSelected: true,
      },
      {
        workspaceId: "workspace-2",
        name: "Shared workspace",
        createdAt: "2026-03-11T09:00:00.000Z",
        isSelected: false,
      },
    ],
    chooseWorkspace: vi.fn(async () => undefined),
    createWorkspace: vi.fn(async () => undefined),
    isChoosingWorkspace: false,
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

describe("CurrentWorkspaceScreen", () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    mockAppData.chooseWorkspace.mockClear();
    mockAppData.createWorkspace.mockClear();
    mockAppData.isSessionVerified = true;
    mockAppData.cloudSettings = {
      ...mockAppData.cloudSettings,
      cloudState: "linked",
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("expands the workspace flow for linked users", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/settings/current-workspace"]}>
          <CurrentWorkspaceScreen />
        </MemoryRouter>,
      );
    });

    expect(container.querySelector(".settings-switcher-link-active")?.textContent).toBe("Current Workspace");

    const workspaceButton = container.querySelector(".settings-nav-card-button");
    expect(workspaceButton).toBeInstanceOf(HTMLButtonElement);

    await act(async () => {
      workspaceButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Primary workspace");
    expect(container.textContent).toContain("Shared workspace");
    expect(container.textContent).toContain("New Workspace");

    const workspaceChoices = Array.from(container.querySelectorAll(".settings-workspace-choice"));
    await act(async () => {
      workspaceChoices[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(mockAppData.chooseWorkspace).toHaveBeenCalledWith("workspace-2");
  });

  it("shows a temporary banner instead of opening workspace management when locked", async () => {
    mockAppData.isSessionVerified = false;
    mockAppData.cloudSettings = {
      ...mockAppData.cloudSettings,
      cloudState: "disconnected",
    };

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/settings/current-workspace"]}>
          <CurrentWorkspaceScreen />
        </MemoryRouter>,
      );
    });

    const workspaceButton = container.querySelector(".settings-nav-card-button");
    await act(async () => {
      workspaceButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Workspace changes are available only after you create an account.");
    expect(container.textContent).not.toContain("Shared workspace");
    expect(mockAppData.chooseWorkspace).not.toHaveBeenCalled();
  });
});
