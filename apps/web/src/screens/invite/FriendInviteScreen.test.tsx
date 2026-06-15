// @vitest-environment jsdom
import { act } from "react";
import ReactDOM from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import type { SessionInfo } from "../../types";
import { FriendInviteScreen } from "./FriendInviteScreen";

const {
  acceptFriendInvitationMock,
  clearPersistedProgressLeaderboardMock,
  getOptionalSessionMock,
  invalidateServerProgressMock,
  previewFriendInvitationMock,
} = vi.hoisted(() => ({
  acceptFriendInvitationMock: vi.fn(),
  clearPersistedProgressLeaderboardMock: vi.fn(),
  getOptionalSessionMock: vi.fn(),
  invalidateServerProgressMock: vi.fn(),
  previewFriendInvitationMock: vi.fn(),
}));

vi.mock("../../api", () => ({
  acceptFriendInvitation: acceptFriendInvitationMock,
  buildLoginUrl: (returnUrl: string, localeHint: string): string => (
    `https://auth.example.test/login?redirect_uri=${encodeURIComponent(returnUrl)}&locale=${encodeURIComponent(localeHint)}`
  ),
  getOptionalSession: getOptionalSessionMock,
  isAuthRedirectError: (_error: unknown): boolean => false,
  previewFriendInvitation: previewFriendInvitationMock,
}));

vi.mock("../../appData/progress/invalidation/progressInvalidation", () => ({
  invalidateServerProgress: invalidateServerProgressMock,
}));

vi.mock("../../appData/progress/storage/progressStorage", () => ({
  clearPersistedProgressLeaderboard: clearPersistedProgressLeaderboardMock,
}));

function createSession(): SessionInfo {
  return {
    userId: "user-1",
    selectedWorkspaceId: "workspace-1",
    authTransport: "session",
    csrfToken: "csrf-token-1",
    preferences: {
      reviewReactionAnimationsEnabled: true,
    },
    profile: {
      email: "user@example.com",
      locale: "en",
      createdAt: "2026-04-10T00:00:00.000Z",
    },
  };
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (valueSetter === undefined) {
    throw new Error("HTMLInputElement value setter is unavailable");
  }

  valueSetter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function waitForEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("FriendInviteScreen", () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    previewFriendInvitationMock.mockReset();
    getOptionalSessionMock.mockReset();
    acceptFriendInvitationMock.mockReset();
    clearPersistedProgressLeaderboardMock.mockReset();
    invalidateServerProgressMock.mockReset();
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.clearAllMocks();
  });

  async function renderInviteScreen(): Promise<void> {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/invite/raw-token"]}>
          <I18nProvider>
            <Routes>
              <Route path="/invite/:token" element={<FriendInviteScreen />} />
            </Routes>
          </I18nProvider>
        </MemoryRouter>,
      );
    });
    await waitForEffects();
  }

  it("renders inactive invite copy without loading a session", async () => {
    previewFriendInvitationMock.mockResolvedValue({ status: "inactive" });

    await renderInviteScreen();

    expect(container.querySelector("[data-testid='friend-invite-inactive']")).not.toBeNull();
    expect(container.textContent).toContain("This link is no longer active. Ask for a new one.");
    expect(getOptionalSessionMock).not.toHaveBeenCalled();
  });

  it("renders preview failures without inactive invite copy", async () => {
    previewFriendInvitationMock.mockRejectedValue(new Error("Preview request failed"));

    await renderInviteScreen();

    expect(container.querySelector("[data-testid='friend-invite-error']")).not.toBeNull();
    expect(container.querySelector("[data-testid='friend-invite-inactive']")).toBeNull();
    expect(container.textContent).toContain("Preview request failed");
    expect(getOptionalSessionMock).not.toHaveBeenCalled();
  });

  it("accepts an active invite and renders the success links", async () => {
    previewFriendInvitationMock.mockResolvedValue({
      status: "active",
      expiresAt: "2026-04-22T10:00:00.000Z",
    });
    getOptionalSessionMock.mockResolvedValue(createSession());
    acceptFriendInvitationMock.mockResolvedValue({ status: "accepted" });

    await renderInviteScreen();

    const input = container.querySelector("[data-testid='friend-invite-display-name-input']");
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("Invite display name input was not found");
    }
    const acceptButton = container.querySelector("[data-testid='friend-invite-accept-button']");
    if (!(acceptButton instanceof HTMLButtonElement)) {
      throw new Error("Invite accept button was not found");
    }

    await act(async () => {
      setInputValue(input, "Alex");
      acceptButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(acceptFriendInvitationMock).toHaveBeenCalledWith("raw-token", {
      inviterDisplayName: "Alex",
    });
    expect(clearPersistedProgressLeaderboardMock).toHaveBeenCalledTimes(1);
    expect(invalidateServerProgressMock).toHaveBeenCalledTimes(1);
    expect(container.querySelector("[data-testid='friend-invite-success']")).not.toBeNull();
    expect(container.textContent).toContain("You are now friends");
    expect(container.textContent).toContain("Mobile apps require signing in with the same email.");
    expect(container.querySelector("[data-testid='friend-invite-success-links']")).not.toBeNull();
    expect(container.querySelector("a[href='/progress#leaderboard']")).not.toBeNull();
  });

  it("requires a display name before accepting", async () => {
    previewFriendInvitationMock.mockResolvedValue({
      status: "active",
      expiresAt: "2026-04-22T10:00:00.000Z",
    });
    getOptionalSessionMock.mockResolvedValue(createSession());

    await renderInviteScreen();

    const acceptButton = container.querySelector("[data-testid='friend-invite-accept-button']");
    if (!(acceptButton instanceof HTMLButtonElement)) {
      throw new Error("Invite accept button was not found");
    }

    await act(async () => {
      acceptButton.click();
      await Promise.resolve();
    });

    expect(container.querySelector("[data-testid='friend-invite-display-name-error']")?.textContent).toContain("Enter a name.");
    expect(acceptFriendInvitationMock).not.toHaveBeenCalled();
  });
});
