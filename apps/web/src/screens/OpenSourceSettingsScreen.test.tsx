// @vitest-environment jsdom

import { act } from "react";
import ReactDOM from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OpenSourceSettingsScreen } from "./OpenSourceSettingsScreen";

describe("OpenSourceSettingsScreen", () => {
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

  it("renders repository and self-hosting copy", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <OpenSourceSettingsScreen />
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain("Open Source");
    expect(container.textContent).toContain("The iOS app and the backend are fully open source.");
    expect(container.textContent).toContain("GitHub Repository (MIT License)");
    expect(container.querySelector('a[href="https://github.com/kirill-markin/flashcards-open-source-app"]')?.textContent).toBe("Open repository");
    expect(container.textContent).toContain("deploy the same open-source stack on your infrastructure");
  });
});
