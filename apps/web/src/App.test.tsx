// @vitest-environment jsdom

import { act } from "react";
import type { ReactNode } from "react";
import ReactDOM from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RoutedShell } from "./App";

const { useChatLayoutMock } = vi.hoisted(() => ({
  useChatLayoutMock: vi.fn(),
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
});
