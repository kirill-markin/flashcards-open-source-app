// @vitest-environment jsdom

import { act } from "react";
import ReactDOM from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LegalSupportScreen } from "./LegalSupportScreen";

describe("LegalSupportScreen", () => {
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

  it("renders hosted legal and support links", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/settings/account/legal-support"]}>
          <LegalSupportScreen />
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain("Legal & Support");
    expect(container.textContent).toContain("Privacy Policy");
    expect(container.textContent).toContain("Terms of Service");
    expect(container.textContent).toContain("Support");
    expect(container.textContent).toContain("kirill+flashcards@kirill-markin.com");
    expect(container.querySelector('a[href="https://flashcards-open-source-app.com/privacy/"]')?.textContent).toBe("Open policy");
    expect(container.querySelector('a[href="https://flashcards-open-source-app.com/terms/"]')?.textContent).toBe("Open terms");
    expect(container.querySelector('a[href="https://flashcards-open-source-app.com/support/"]')?.textContent).toBe("Open support");
    expect(container.querySelector(".settings-switcher-link-active")?.textContent).toBe("Account");
  });
});
