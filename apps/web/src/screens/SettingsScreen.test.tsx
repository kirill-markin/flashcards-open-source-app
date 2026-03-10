// @vitest-environment jsdom

import { act } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsScreen } from "./SettingsScreen";

const { listAgentApiKeysMock, revokeAgentApiKeyMock } = vi.hoisted(() => ({
  listAgentApiKeysMock: vi.fn(),
  revokeAgentApiKeyMock: vi.fn(),
}));

vi.mock("../api", () => ({
  listAgentApiKeys: listAgentApiKeysMock,
  revokeAgentApiKey: revokeAgentApiKeyMock,
}));

describe("SettingsScreen", () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    listAgentApiKeysMock.mockReset();
    revokeAgentApiKeyMock.mockReset();
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
      root.render(<SettingsScreen />);
    });

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
      root.render(<SettingsScreen />);
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
});
