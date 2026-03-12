// @vitest-environment jsdom

import { act } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountSettingsScreen } from "./AccountSettingsScreen";

const {
  getCachedSessionCsrfTokenMock,
  listAgentApiKeysMock,
  revokeAgentApiKeyMock,
  setAccountDeletionPendingMock,
  storeAccountDeletionCsrfTokenMock,
} = vi.hoisted(() => ({
  getCachedSessionCsrfTokenMock: vi.fn(),
  listAgentApiKeysMock: vi.fn(),
  revokeAgentApiKeyMock: vi.fn(),
  setAccountDeletionPendingMock: vi.fn(),
  storeAccountDeletionCsrfTokenMock: vi.fn(),
}));

vi.mock("../api", () => ({
  getCachedSessionCsrfToken: getCachedSessionCsrfTokenMock,
  listAgentApiKeys: listAgentApiKeysMock,
  revokeAgentApiKey: revokeAgentApiKeyMock,
}));

vi.mock("../accountDeletion", () => ({
  deleteAccountConfirmationText: "delete my account",
  setAccountDeletionPending: setAccountDeletionPendingMock,
  storeAccountDeletionCsrfToken: storeAccountDeletionCsrfTokenMock,
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

describe("AccountSettingsScreen", () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    getCachedSessionCsrfTokenMock.mockReset();
    listAgentApiKeysMock.mockReset();
    revokeAgentApiKeyMock.mockReset();
    setAccountDeletionPendingMock.mockReset();
    storeAccountDeletionCsrfTokenMock.mockReset();
    getCachedSessionCsrfTokenMock.mockReturnValue("csrf-123");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("loads and renders agent connections", async () => {
    listAgentApiKeysMock.mockResolvedValue({
      connections: [{
        connectionId: "conn-1",
        label: "Claude Code on MacBook",
        createdAt: "2026-03-10T13:00:00.000Z",
        lastUsedAt: null,
        revokedAt: null,
      }],
      instructions: "These are the current long-lived bot connections for this account.",
    });

    await act(async () => {
      root.render(<AccountSettingsScreen />);
    });

    expect(container.textContent).toContain("Account settings");
    expect(container.textContent).toContain("Claude Code on MacBook");
    expect(container.textContent).toContain("These are the current long-lived bot connections for this account.");
    expect(listAgentApiKeysMock).toHaveBeenCalledTimes(1);
  });

  it("updates a connection after revoke", async () => {
    listAgentApiKeysMock.mockResolvedValue({
      connections: [{
        connectionId: "conn-1",
        label: "Claude Code on MacBook",
        createdAt: "2026-03-10T13:00:00.000Z",
        lastUsedAt: "2026-03-10T13:10:00.000Z",
        revokedAt: null,
      }],
      instructions: "Active connections.",
    });
    revokeAgentApiKeyMock.mockResolvedValue({
      ok: true,
      connection: {
        connectionId: "conn-1",
        label: "Claude Code on MacBook",
        createdAt: "2026-03-10T13:00:00.000Z",
        lastUsedAt: "2026-03-10T13:10:00.000Z",
        revokedAt: "2026-03-10T13:30:00.000Z",
      },
      instructions: "This bot connection has been revoked.",
    });

    await act(async () => {
      root.render(<AccountSettingsScreen />);
    });

    const revokeButton = container.querySelector("button");
    expect(revokeButton).not.toBeNull();

    await act(async () => {
      revokeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(revokeAgentApiKeyMock).toHaveBeenCalledWith("conn-1");
    expect(container.textContent).toContain("2026-03-10T13:30:00.000Z");
    expect(container.textContent).toContain("This bot connection has been revoked.");
  });

  it("requires the exact deletion phrase and starts deletion only after a typed confirmation", async () => {
    listAgentApiKeysMock.mockResolvedValue({
      connections: [],
      instructions: "Manage your account.",
    });

    await act(async () => {
      root.render(<AccountSettingsScreen />);
    });

    await act(async () => {
      findButtonByText(container, "Delete my account").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const input = container.querySelector("#delete-account-confirmation");
    expect(input).toBeInstanceOf(HTMLInputElement);
    expect(container.textContent).toContain("Warning! This action is permanent.");
    expect(container.textContent).toContain("delete my account");

    const confirmDeleteButton = findLastButtonByText(container, "Delete my account");
    expect(confirmDeleteButton.disabled).toBe(true);

    const pasteEvent = new Event("paste", { bubbles: true, cancelable: true });
    const dropEvent = new Event("drop", { bubbles: true, cancelable: true });
    input?.dispatchEvent(pasteEvent);
    input?.dispatchEvent(dropEvent);
    expect(pasteEvent.defaultPrevented).toBe(true);
    expect(dropEvent.defaultPrevented).toBe(true);

    await act(async () => {
      setInputValue(input as HTMLInputElement, "delete");
    });
    expect(findLastButtonByText(container, "Delete my account").disabled).toBe(true);

    await act(async () => {
      setInputValue(input as HTMLInputElement, "delete my account");
    });
    const enabledConfirmDeleteButton = findLastButtonByText(container, "Delete my account");
    expect(enabledConfirmDeleteButton.disabled).toBe(false);

    await act(async () => {
      enabledConfirmDeleteButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(storeAccountDeletionCsrfTokenMock).toHaveBeenCalledWith("csrf-123");
    expect(setAccountDeletionPendingMock).toHaveBeenCalledWith(true);
  });
});
