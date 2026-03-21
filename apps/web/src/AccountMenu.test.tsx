// @vitest-environment jsdom

import { act } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountMenu } from "./AccountMenu";
import type { WorkspaceSummary } from "./types";

function createWorkspaceSummary(overrides: Partial<WorkspaceSummary>): WorkspaceSummary {
  return {
    workspaceId: "workspace-1",
    name: "Primary workspace",
    createdAt: "2026-03-10T09:00:00.000Z",
    isSelected: true,
    ...overrides,
  };
}

describe("AccountMenu", () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  let onSelectWorkspace: ReturnType<typeof vi.fn>;
  let onCreateWorkspace: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    onSelectWorkspace = vi.fn(async () => undefined);
    onCreateWorkspace = vi.fn(async () => undefined);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("lets linked users switch workspaces from the account menu", async () => {
    await act(async () => {
      root.render(
        <AccountMenu
          workspaces={[
            createWorkspaceSummary({ workspaceId: "workspace-1", name: "Primary workspace" }),
            createWorkspaceSummary({ workspaceId: "workspace-2", name: "Shared workspace", isSelected: false }),
          ]}
          currentWorkspaceId="workspace-1"
          currentWorkspaceName="Primary workspace"
          isBusy={false}
          isWorkspaceManagementLocked={false}
          workspaceManagementLockedMessage="Workspace changes are available only after you create an account."
          accountSettingsUrl="/settings/account"
          logoutUrl="/logout"
          onSelectWorkspace={onSelectWorkspace}
          onCreateWorkspace={onCreateWorkspace}
        />,
      );
    });

    const menuButton = container.querySelector(".account-menu-button");
    await act(async () => {
      menuButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Current Workspace");
    expect(container.textContent).toContain("Primary workspace");
    expect(container.textContent).toContain("Shared workspace");
    expect(container.textContent).toContain("New workspace");

    const items = Array.from(container.querySelectorAll(".account-menu-item"));
    const sharedWorkspaceButton = items.find((element) => element.textContent?.trim() === "Shared workspace");
    await act(async () => {
      sharedWorkspaceButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSelectWorkspace).toHaveBeenCalledWith("workspace-2");
  });

  it("shows the locked banner instead of mutating workspaces when not linked", async () => {
    await act(async () => {
      root.render(
        <AccountMenu
          workspaces={[createWorkspaceSummary({ workspaceId: "workspace-1", name: "Primary workspace" })]}
          currentWorkspaceId="workspace-1"
          currentWorkspaceName="Primary workspace"
          isBusy={false}
          isWorkspaceManagementLocked
          workspaceManagementLockedMessage="Workspace changes are available only after you create an account."
          accountSettingsUrl="/settings/account"
          logoutUrl="/logout"
          onSelectWorkspace={onSelectWorkspace}
          onCreateWorkspace={onCreateWorkspace}
        />,
      );
    });

    const menuButton = container.querySelector(".account-menu-button");
    await act(async () => {
      menuButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const currentWorkspaceButton = Array.from(container.querySelectorAll(".account-menu-item")).find((element) => {
      return element.textContent?.trim() === "Primary workspace";
    });
    await act(async () => {
      currentWorkspaceButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Workspace changes are available only after you create an account.");
    expect(onSelectWorkspace).not.toHaveBeenCalled();
    expect(onCreateWorkspace).not.toHaveBeenCalled();
  });
});
