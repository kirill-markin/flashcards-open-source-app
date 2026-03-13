// @vitest-environment jsdom

import { act } from "react";
import ReactDOM from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SettingsScreen } from "./SettingsScreen";

describe("SettingsScreen", () => {
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

  it("renders the settings hub with workspace and account entry points", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <SettingsScreen />
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain("Settings");
    expect(container.textContent).toContain("Workspace Settings");
    expect(container.textContent).toContain("Account Settings");

    const links = Array.from(container.querySelectorAll(".settings-nav-card")).map((element) => element.getAttribute("href"));
    expect(links).toEqual(["/settings/workspace", "/settings/account"]);
  });
});
