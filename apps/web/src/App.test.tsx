// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import ReactDOM from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell, RoutedShell } from "./App";

const { buildLogoutUrlMock, useAppDataMock, useChatLayoutMock } = vi.hoisted(() => ({
  buildLogoutUrlMock: vi.fn(),
  useAppDataMock: vi.fn(),
  useChatLayoutMock: vi.fn(),
}));

vi.mock("./appData", () => ({
  AppDataProvider: ({ children }: Readonly<{ children: ReactNode }>) => <>{children}</>,
  useAppData: useAppDataMock,
}));

vi.mock("./api", () => ({
  buildLogoutUrl: buildLogoutUrlMock,
}));

vi.mock("./chat/ChatLayoutContext", () => ({
  ChatLayoutProvider: ({ children }: Readonly<{ children: ReactNode }>) => <>{children}</>,
  useChatLayout: useChatLayoutMock,
}));

vi.mock("./chat/ChatPanel", () => ({
  ChatPanel: ({ mode }: Readonly<{ mode: "sidebar" | "fullscreen" }>) => (
    <div data-testid="chat-panel" data-mode={mode}>
      chat-panel
    </div>
  ),
}));

vi.mock("./chat/ChatToggle", () => ({
  ChatToggle: () => <button type="button">chat-toggle</button>,
}));

vi.mock("./screens/CardsScreen", () => ({
  CardsScreen: () => <div>cards-screen</div>,
}));

vi.mock("./screens/CardFormScreen", () => ({
  CardFormScreen: () => <div>card-form-screen</div>,
}));

vi.mock("./screens/DecksScreen", () => ({
  DecksScreen: () => <div>decks-screen</div>,
}));

vi.mock("./screens/DeckFormScreen", () => ({
  DeckFormScreen: () => <div>deck-form-screen</div>,
}));

vi.mock("./screens/ReviewScreen", () => ({
  ReviewScreen: () => <div>review-screen</div>,
}));

vi.mock("./screens/TagsScreen", () => ({
  TagsScreen: () => <div>tags-screen</div>,
}));

vi.mock("./screens/SettingsScreen", () => ({
  SettingsScreen: () => <div>settings-screen</div>,
}));

vi.mock("./screens/WorkspaceSettingsScreen", () => ({
  WorkspaceSettingsScreen: () => <div>workspace-settings-screen</div>,
}));

vi.mock("./screens/WorkspaceOverviewScreen", () => ({
  WorkspaceOverviewScreen: () => <div>workspace-overview-screen</div>,
}));

vi.mock("./screens/WorkspaceSchedulerScreen", () => ({
  WorkspaceSchedulerScreen: () => <div>workspace-scheduler-screen</div>,
}));

vi.mock("./screens/ThisDeviceSettingsScreen", () => ({
  ThisDeviceSettingsScreen: () => <div>this-device-settings-screen</div>,
}));

vi.mock("./screens/AccessSettingsScreen", () => ({
  AccessSettingsScreen: () => <div>access-settings-screen</div>,
}));

vi.mock("./screens/AccessPermissionDetailScreen", () => ({
  AccessPermissionDetailScreen: () => <div>access-permission-detail-screen</div>,
}));

vi.mock("./screens/AccountSettingsScreen", () => ({
  AccountSettingsScreen: () => <div>account-settings-screen</div>,
}));

vi.mock("./screens/AccountStatusScreen", () => ({
  AccountStatusScreen: () => <div>account-status-screen</div>,
}));

vi.mock("./screens/OpenSourceSettingsScreen", () => ({
  OpenSourceSettingsScreen: () => <div>open-source-settings-screen</div>,
}));

vi.mock("./screens/AgentConnectionsScreen", () => ({
  AgentConnectionsScreen: () => <div>agent-connections-screen</div>,
}));

vi.mock("./screens/DangerZoneScreen", () => ({
  DangerZoneScreen: () => <div>danger-zone-screen</div>,
}));

function LocationProbe(): ReactNode {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

describe("AppShell", () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    buildLogoutUrlMock.mockReset();
    useAppDataMock.mockReset();
    useChatLayoutMock.mockReset();
    buildLogoutUrlMock.mockReturnValue("/logout");
    useChatLayoutMock.mockReturnValue({
      isOpen: false,
      setIsOpen: vi.fn(),
      chatWidth: 560,
      setChatWidth: vi.fn(),
    });
    useAppDataMock.mockReturnValue({
      sessionLoadState: "ready",
      sessionErrorMessage: "",
      activeWorkspace: {
        workspaceId: "workspace-1",
        name: "Workspace One",
        createdAt: "2026-03-10T09:00:00.000Z",
      },
      availableWorkspaces: [{
        workspaceId: "workspace-1",
        name: "Workspace One",
        createdAt: "2026-03-10T09:00:00.000Z",
      }],
      isChoosingWorkspace: false,
      errorMessage: "",
      initialize: vi.fn(async () => undefined),
      chooseWorkspace: vi.fn(async () => undefined),
      createWorkspace: vi.fn(async () => undefined),
      renameWorkspace: vi.fn(async () => undefined),
      deleteWorkspace: vi.fn(async () => undefined),
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders the primary nav in the aligned workspace order and exposes account settings from the account menu", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/review"]}>
          <AppShell />
        </MemoryRouter>,
      );
    });

    const navItems = Array.from(container.querySelectorAll(".nav-link")).map((element) => element.textContent?.trim());
    expect(navItems).toEqual(["Review", "Cards", "AI chat", "Settings"]);
    expect(container.textContent).not.toContain("Decks");
    expect(container.textContent).not.toContain("Tags");

    const settingsNavLink = Array.from(container.querySelectorAll(".nav-link")).find((element) => element.textContent?.trim() === "Settings");
    expect(settingsNavLink?.getAttribute("href")).toBe("/settings/workspace");

    const accountMenuButton = container.querySelector(".account-menu-button");
    expect(accountMenuButton).not.toBeNull();

    await act(async () => {
      accountMenuButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Account settings");
    expect(container.querySelector('.account-menu-link[href="/settings/account"]')?.textContent).toBe("Account settings");
  });
});

describe("RoutedShell", () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    useChatLayoutMock.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("adds sidebar-open layout classes and renders the sidebar chat on desktop routes", async () => {
    useChatLayoutMock.mockReturnValue({
      isOpen: true,
      setIsOpen: vi.fn(),
      chatWidth: 560,
      setChatWidth: vi.fn(),
    });

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/cards"]}>
          <RoutedShell />
        </MemoryRouter>,
      );
    });

    expect(container.querySelector(".chat-layout-shell-sidebar-open")).not.toBeNull();
    expect(container.querySelector(".chat-main-content-sidebar-open")).not.toBeNull();
    expect(container.querySelector('[data-testid="chat-panel"][data-mode="sidebar"]')).not.toBeNull();
    expect(container.textContent).not.toContain("chat-toggle");
  });

  it("adds sidebar-closed layout classes and renders the chat toggle when the sidebar is hidden", async () => {
    useChatLayoutMock.mockReturnValue({
      isOpen: false,
      setIsOpen: vi.fn(),
      chatWidth: 560,
      setChatWidth: vi.fn(),
    });

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/cards"]}>
          <RoutedShell />
        </MemoryRouter>,
      );
    });

    expect(container.querySelector(".chat-layout-shell-sidebar-closed")).not.toBeNull();
    expect(container.querySelector(".chat-main-content-sidebar-closed")).not.toBeNull();
    expect(container.querySelector('[data-testid="chat-panel"]')).toBeNull();
    expect(container.textContent).toContain("chat-toggle");
  });

  it("redirects the root route to review", async () => {
    useChatLayoutMock.mockReturnValue({
      isOpen: false,
      setIsOpen: vi.fn(),
      chatWidth: 560,
      setChatWidth: vi.fn(),
    });

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/"]}>
          <RoutedShell />
          <LocationProbe />
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain("review-screen");
    expect(container.querySelector('[data-testid="location"]')?.textContent).toBe("/review");
  });

  it("redirects legacy deck edit routes to workspace settings routes", async () => {
    useChatLayoutMock.mockReturnValue({
      isOpen: false,
      setIsOpen: vi.fn(),
      chatWidth: 560,
      setChatWidth: vi.fn(),
    });

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/decks/deck-1/edit"]}>
          <RoutedShell />
          <LocationProbe />
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain("deck-form-screen");
    expect(container.querySelector('[data-testid="location"]')?.textContent).toBe("/settings/workspace/decks/deck-1/edit");
  });

  it("redirects legacy tags routes to workspace settings routes", async () => {
    useChatLayoutMock.mockReturnValue({
      isOpen: false,
      setIsOpen: vi.fn(),
      chatWidth: 560,
      setChatWidth: vi.fn(),
    });

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/tags"]}>
          <RoutedShell />
          <LocationProbe />
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain("tags-screen");
    expect(container.querySelector('[data-testid="location"]')?.textContent).toBe("/settings/workspace/tags");
  });

  it("renders the settings hub route", async () => {
    useChatLayoutMock.mockReturnValue({
      isOpen: false,
      setIsOpen: vi.fn(),
      chatWidth: 560,
      setChatWidth: vi.fn(),
    });

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/settings"]}>
          <RoutedShell />
          <LocationProbe />
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain("settings-screen");
    expect(container.querySelector('[data-testid="location"]')?.textContent).toBe("/settings");
  });

  it("renders the dedicated account settings route", async () => {
    useChatLayoutMock.mockReturnValue({
      isOpen: false,
      setIsOpen: vi.fn(),
      chatWidth: 560,
      setChatWidth: vi.fn(),
    });

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/settings/account"]}>
          <RoutedShell />
          <LocationProbe />
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain("account-settings-screen");
    expect(container.querySelector('[data-testid="location"]')?.textContent).toBe("/settings/account");
  });

  it("renders the dedicated access settings route", async () => {
    useChatLayoutMock.mockReturnValue({
      isOpen: false,
      setIsOpen: vi.fn(),
      chatWidth: 560,
      setChatWidth: vi.fn(),
    });

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/settings/access"]}>
          <RoutedShell />
          <LocationProbe />
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain("access-settings-screen");
    expect(container.querySelector('[data-testid="location"]')?.textContent).toBe("/settings/access");
  });
});
