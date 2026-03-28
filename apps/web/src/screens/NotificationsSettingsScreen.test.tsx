// @vitest-environment jsdom

import { act } from "react";
import ReactDOM from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NotificationsSettingsScreen } from "./NotificationsSettingsScreen";

describe("NotificationsSettingsScreen", () => {
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

  it("explains that notification settings must be configured on iPhone or Android", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/settings/workspace/notifications"]}>
          <NotificationsSettingsScreen />
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain("Notifications");
    expect(container.textContent).toContain("Set up notifications on iPhone or Android");
    expect(container.textContent).toContain("Review reminder settings belong to this workspace");
    expect(container.textContent).toContain("The web app does not support notifications");
    expect(container.textContent).not.toContain("Enable reminders");
    expect(container.textContent).not.toContain("Reminder mode");
    expect(container.textContent).not.toContain("Allow notifications");
    expect(container.querySelector("input")).toBeNull();
    expect(container.querySelector("button.primary-btn")).toBeNull();
  });
});
