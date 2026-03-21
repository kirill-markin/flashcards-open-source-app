// @vitest-environment jsdom

import { act } from "react";
import ReactDOM from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountSettingsScreen } from "./AccountSettingsScreen";

const { mockAppData } = vi.hoisted(() => ({
  mockAppData: {
    session: {
      userId: "user-1",
      selectedWorkspaceId: "workspace-1",
      authTransport: "cookie",
      csrfToken: "csrf-token",
      profile: {
        email: "user@example.com",
        locale: "en-US",
        createdAt: "2026-03-10T09:00:00.000Z",
      },
    },
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

describe("AccountSettingsScreen", () => {
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

  it("renders account settings entries in the unified order", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <AccountSettingsScreen />
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain("Account Settings");
    expect(container.textContent).toContain("Account Status");
    expect(container.textContent).toContain("Support");
    expect(container.textContent).toContain("Legal & Support");
    expect(container.textContent).toContain("Open Source");
    expect(container.textContent).toContain("Connections");
    expect(container.textContent).toContain("Agent Connections");
    expect(container.textContent).toContain("Danger Zone");

    const links = Array.from(container.querySelectorAll(".settings-nav-card")).map((element) => element.getAttribute("href"));
    expect(links).toEqual([
      "/settings/account/status",
      "/settings/account/legal-support",
      "/settings/account/open-source",
      "/settings/account/agent-connections",
      "/settings/account/danger-zone",
    ]);
  });
});
