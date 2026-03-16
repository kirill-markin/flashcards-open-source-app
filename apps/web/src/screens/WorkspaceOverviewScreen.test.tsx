// @vitest-environment jsdom

import { act } from "react";
import ReactDOM from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceOverviewScreen } from "./WorkspaceOverviewScreen";

const {
  loadWorkspaceDeletePreviewMock,
  mockAppData,
} = vi.hoisted(() => ({
  loadWorkspaceDeletePreviewMock: vi.fn(),
  mockAppData: {
    activeWorkspace: {
      workspaceId: "workspace-1",
      name: "Primary workspace",
      createdAt: "2026-03-10T09:00:00.000Z",
      isSelected: true,
    },
    localReadVersion: 0,
    refreshLocalData: vi.fn(async () => undefined),
    renameWorkspace: vi.fn(async () => undefined),
    deleteWorkspace: vi.fn(async () => undefined),
  },
}));

const { loadWorkspaceOverviewSnapshotMock } = vi.hoisted(() => ({
  loadWorkspaceOverviewSnapshotMock: vi.fn(),
}));

vi.mock("../appData", () => ({
  useAppData: () => mockAppData,
}));

vi.mock("../api", () => ({
  loadWorkspaceDeletePreview: loadWorkspaceDeletePreviewMock,
}));

vi.mock("../localDb/workspace", () => ({
  loadWorkspaceOverviewSnapshot: loadWorkspaceOverviewSnapshotMock,
}));

function findButtonByText(container: HTMLDivElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find((element) => element.textContent?.trim() === text);
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${text}`);
  }

  return button;
}

function findLastButtonByText(container: HTMLDivElement, text: string): HTMLButtonElement {
  const buttons = Array.from(container.querySelectorAll("button")).filter((element) => element.textContent?.trim() === text);
  const button = buttons.at(-1);
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${text}`);
  }

  return button;
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const valueDescriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  valueDescriptor?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("WorkspaceOverviewScreen", () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    mockAppData.renameWorkspace.mockReset();
    mockAppData.deleteWorkspace.mockReset();
    mockAppData.refreshLocalData.mockReset();
    loadWorkspaceDeletePreviewMock.mockReset();
    loadWorkspaceOverviewSnapshotMock.mockReset();
    loadWorkspaceOverviewSnapshotMock.mockResolvedValue({
      workspaceName: "Primary workspace",
      deckCount: 2,
      tagsCount: 3,
      totalCards: 5,
      dueCount: 1,
      newCount: 2,
      reviewedCount: 2,
    });
    loadWorkspaceDeletePreviewMock.mockResolvedValue({
      workspaceId: "workspace-1",
      workspaceName: "Primary workspace",
      activeCardCount: 5,
      confirmationText: "delete workspace",
      isLastAccessibleWorkspace: true,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renames the active workspace from the overview form", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <WorkspaceOverviewScreen />
        </MemoryRouter>,
      );
    });

    const workspaceInput = container.querySelector("#workspace-name");
    expect(workspaceInput).toBeInstanceOf(HTMLInputElement);

    await act(async () => {
      setInputValue(workspaceInput as HTMLInputElement, "Renamed workspace");
    });

    await act(async () => {
      findButtonByText(container, "Save name").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(mockAppData.renameWorkspace).toHaveBeenCalledWith("workspace-1", "Renamed workspace");
  });

  it("requires the exact delete phrase before deleting the workspace", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <WorkspaceOverviewScreen />
        </MemoryRouter>,
      );
    });

    await act(async () => {
      findButtonByText(container, "Delete workspace").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(loadWorkspaceDeletePreviewMock).toHaveBeenCalledWith("workspace-1");
    expect(container.textContent).toContain("delete workspace");
    expect(container.textContent).toContain("5 active cards");

    const confirmationInput = container.querySelector("#delete-workspace-confirmation");
    expect(confirmationInput).toBeInstanceOf(HTMLInputElement);

    const confirmDeleteButton = findLastButtonByText(container, "Delete workspace");
    expect(confirmDeleteButton.disabled).toBe(true);

    const pasteEvent = new Event("paste", { bubbles: true, cancelable: true });
    const dropEvent = new Event("drop", { bubbles: true, cancelable: true });
    confirmationInput?.dispatchEvent(pasteEvent);
    confirmationInput?.dispatchEvent(dropEvent);
    expect(pasteEvent.defaultPrevented).toBe(true);
    expect(dropEvent.defaultPrevented).toBe(true);

    await act(async () => {
      setInputValue(confirmationInput as HTMLInputElement, "delete");
    });
    expect(findLastButtonByText(container, "Delete workspace").disabled).toBe(true);

    await act(async () => {
      setInputValue(confirmationInput as HTMLInputElement, "delete workspace");
    });
    expect(findLastButtonByText(container, "Delete workspace").disabled).toBe(false);

    await act(async () => {
      findLastButtonByText(container, "Delete workspace").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(mockAppData.deleteWorkspace).toHaveBeenCalledWith("workspace-1", "delete workspace");
  });
});
