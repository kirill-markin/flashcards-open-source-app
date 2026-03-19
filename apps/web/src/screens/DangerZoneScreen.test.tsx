// @vitest-environment jsdom

import { act } from "react";
import ReactDOM from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DangerZoneScreen } from "./DangerZoneScreen";

const {
  getCachedSessionCsrfTokenMock,
  setAccountDeletionPendingMock,
  storeAccountDeletionCsrfTokenMock,
  useAppDataMock,
} = vi.hoisted(() => ({
  getCachedSessionCsrfTokenMock: vi.fn(),
  setAccountDeletionPendingMock: vi.fn(),
  storeAccountDeletionCsrfTokenMock: vi.fn(),
  useAppDataMock: vi.fn(),
}));

vi.mock("../api", () => ({
  getCachedSessionCsrfToken: getCachedSessionCsrfTokenMock,
}));

vi.mock("../accountDeletion", () => ({
  deleteAccountConfirmationText: "delete my account",
  setAccountDeletionPending: setAccountDeletionPendingMock,
  storeAccountDeletionCsrfToken: storeAccountDeletionCsrfTokenMock,
}));

vi.mock("../appData", () => ({
  useAppData: useAppDataMock,
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

describe("DangerZoneScreen", () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    getCachedSessionCsrfTokenMock.mockReset();
    setAccountDeletionPendingMock.mockReset();
    storeAccountDeletionCsrfTokenMock.mockReset();
    useAppDataMock.mockReset();
    getCachedSessionCsrfTokenMock.mockReturnValue("csrf-123");
    useAppDataMock.mockReturnValue({
      isSessionVerified: true,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("requires the exact deletion phrase and starts deletion only after a typed confirmation", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <DangerZoneScreen />
        </MemoryRouter>,
      );
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

  it("keeps account deletion locked while the session is still restoring", async () => {
    useAppDataMock.mockReturnValue({
      isSessionVerified: false,
    });

    await act(async () => {
      root.render(
        <MemoryRouter>
          <DangerZoneScreen />
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain("Restoring session before account deletion...");
    expect(findButtonByText(container, "Delete my account").disabled).toBe(true);
  });
});
