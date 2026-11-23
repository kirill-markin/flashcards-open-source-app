import { act, createElement, useEffect, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createJsonResponse, createNewChatSessionResponse, createSessionResponse } from "../../../api/ApiTestSupport";
import {
  BrowserGuestSessionInvalidatedError,
  getCachedSessionCsrfToken,
  getSession,
  pauseBrowserGuestSession,
  resetApiClientStateForTests,
  setNavigationHandlerForTests,
} from "../../../api/transport/transport";
import { createDeferredResponsePromise, createTransportBackedChatSession } from "../../../api/transport/transportTestSupport";
import { AppErrorDialogProvider } from "../../../appError/AppErrorContext";
import { I18nProvider } from "../../../i18n";
import { clearCloudSettings, loadCloudSettings, putCloudSettings } from "../../../localDb/sync/cloudSettings";
import { GuestConversionGate } from "../../../screens/settings/account/guest/GuestConversionGate";
import type { CloudSettings } from "../../../types";
import { AppDataProvider, useAppData } from "../../context/provider";
import type { AppDataContextValue } from "../../context/types";
import { GuestConversionRequiredError, loadBrowserProductSession } from "./browserGuestSession";
import { browserGuestStorageKey, readBrowserGuestState, writeBrowserGuestState } from "./browserGuestStorage";

const retiredOwner: CloudSettings = {
  installationId: "installation-1",
  cloudState: "linked",
  linkedUserId: "user-1",
  linkedWorkspaceId: "workspace-1",
  linkedEmail: "user@example.com",
  onboardingCompleted: true,
  updatedAt: "2026-04-10T00:00:00.000Z",
};

const absentProbe = {
  guestSession: { status: "absent", csrfToken: null, cookieRoundTripVerified: false },
  registeredSession: { present: false, csrfToken: null },
};
const registeredProbe = {
  ...absentProbe,
  registeredSession: { present: true, csrfToken: "csrf-token-1" },
};

beforeEach(() => {
  Object.defineProperty(window.navigator, "locks", {
    configurable: true,
    value: {
      request<Result>(_name: string, _options: LockOptions, action: () => Promise<Result>): Promise<Result> {
        return action();
      },
    },
  });
});

afterEach(async () => {
  document.cookie = "logged_in=; Max-Age=0; Path=/";
  window.localStorage.removeItem(browserGuestStorageKey);
  resetApiClientStateForTests();
  vi.unstubAllGlobals();
  await clearCloudSettings();
});

describe("registered bootstrap in a paused browser tab", () => {
  it.each(["initial probe", "refreshed probe"])("resumes after verification on the %s", async (probeStage) => {
    const fetchMock = vi.fn<typeof fetch>();
    const expectedRequests: Array<ReadonlyArray<string>> = [];
    if (probeStage === "refreshed probe") {
      await putCloudSettings(retiredOwner);
      document.cookie = "logged_in=1; Path=/";
      fetchMock
        .mockResolvedValueOnce(createJsonResponse(absentProbe))
        .mockResolvedValueOnce(new Response(null, { status: 200 }));
      expectedRequests.push(
        ["http://localhost:8080/v1/guest-auth/browser/session", "GET", "include"],
        ["http://localhost:8081/api/refresh-session", "POST", "include"],
      );
    }

    fetchMock
      .mockResolvedValueOnce(createJsonResponse(registeredProbe))
      .mockResolvedValueOnce(createSessionResponse(null))
      .mockResolvedValueOnce(createNewChatSessionResponse("chat-1"));
    vi.stubGlobal("fetch", fetchMock);
    pauseBrowserGuestSession();

    await expect(getSession()).rejects.toBeInstanceOf(BrowserGuestSessionInvalidatedError);
    await expect(createTransportBackedChatSession("chat-1")).rejects.toBeInstanceOf(BrowserGuestSessionInvalidatedError);
    expect(fetchMock).not.toHaveBeenCalled();

    await expect(loadBrowserProductSession()).resolves.toMatchObject({ userId: "user-1", authTransport: "session" });
    await expect(createTransportBackedChatSession("chat-1")).resolves.toMatchObject({ sessionId: "chat-1" });

    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method, init?.credentials])).toEqual([
      ...expectedRequests,
      ["http://localhost:8080/v1/guest-auth/browser/session", "GET", "include"],
      ["http://localhost:8080/v1/me", "GET", "include"],
      ["http://localhost:8080/v1/chat/new", "POST", "include"],
    ]);
    expect(new Headers(fetchMock.mock.lastCall?.[1]?.headers).get("X-CSRF-Token")).toBe("csrf-token-1");
  });

  it("opens cached read-only recovery for an IndexedDB guest owner after credential refresh", async () => {
    const guestSettings: CloudSettings = {
      ...retiredOwner,
      cloudState: "guest",
      linkedUserId: "guest-1",
      linkedWorkspaceId: "guest-workspace",
      linkedEmail: null,
    };
    await putCloudSettings(guestSettings);
    expect(readBrowserGuestState()).toBeNull();
    document.cookie = "logged_in=1; Path=/";
    const firstProbe = createDeferredResponsePromise();
    const fetchMock = vi.fn<typeof fetch>()
      .mockReturnValueOnce(firstProbe.promise)
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(createJsonResponse(registeredProbe));
    vi.stubGlobal("fetch", fetchMock);

    const observeSession = vi.fn<(app: AppDataContextValue) => void>();
    function RecoveryGate(): ReactElement {
      const app = useAppData();
      useEffect(() => observeSession(app), [app]);
      return createElement(GuestConversionGate, { returnUrl: window.location.href, children: null });
    }

    const container = document.createElement("div");
    const root = createRoot(container);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    try {
      await act(async () => {
        root.render(createElement(I18nProvider, {
          children: createElement(AppErrorDialogProvider, {
            children: createElement(AppDataProvider, { children: createElement(RecoveryGate) }),
          }),
        }));
      });
      const app = observeSession.mock.lastCall?.[0];
      if (app === undefined) throw new Error("The workspace lifecycle did not mount");
      await act(async () => {
        const initializing = app.initialize();
        firstProbe.resolve(createJsonResponse(absentProbe));
        await initializing;
      });
      expect(observeSession.mock.calls.map(([snapshot]) => snapshot.sessionLoadState)).not.toContain("guest_conversion");
      expect(container.querySelector("[data-testid='guest-cache-recovery']")).not.toBeNull();
      const error = observeSession.mock.lastCall?.[0].sessionTechnicalError;
      expect(error).toMatchObject({
        message: "Browser credential is missing while local ownership exists. Local data has been preserved; restore the original session.",
      });
      expect(error).not.toBeInstanceOf(GuestConversionRequiredError);
      expect(readBrowserGuestState()).toBeNull();
      await act(async () => {
        await expect(loadCloudSettings()).resolves.toEqual(guestSettings);
        await expect(getSession()).rejects.toBeInstanceOf(BrowserGuestSessionInvalidatedError);
        await expect(createTransportBackedChatSession("chat-1")).rejects.toBeInstanceOf(BrowserGuestSessionInvalidatedError);
      });
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
        "http://localhost:8080/v1/guest-auth/browser/session",
        "http://localhost:8081/api/refresh-session",
        "http://localhost:8080/v1/guest-auth/browser/session",
      ]);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it.each([
    {
      overrides: { userId: "other-user", authTransport: "session" } as const,
      error: "The signed-in account differs from the completed conversion destination.",
    },
    {
      overrides: { userId: "user-1", authTransport: "bearer" } as const,
      error: "The browser session did not verify as a signed-in account.",
    },
  ])("keeps a completed conversion paused when verification refuses $overrides.authTransport for $overrides.userId", async ({ overrides, error }) => {
    writeBrowserGuestState({
      status: "owned",
      owner: {
        userId: "guest-1",
        workspaceId: "guest-workspace",
        initialSeedAllowed: false,
        pending: {
          phase: "completed",
          sourceUserId: "guest-1",
          sourceWorkspaceId: "guest-workspace",
          guestWorkspaceSyncedAndOutboxDrained: true,
          destinationUserId: "user-1",
          selection: { type: "existing", workspaceId: "workspace-1" },
          selectionRequired: false,
          result: { workspace: {
            workspaceId: "workspace-1",
            name: "Default",
            createdAt: "2026-04-10T00:00:00.000Z",
            isSelected: true,
            isVisible: true,
          } },
        },
      },
    });
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(createJsonResponse(registeredProbe))
      .mockResolvedValueOnce(createSessionResponse(overrides));
    vi.stubGlobal("fetch", fetchMock);
    const navigate = vi.fn();
    setNavigationHandlerForTests(navigate);

    await expect(loadBrowserProductSession()).rejects.toThrow(error);
    expect(getCachedSessionCsrfToken()).toBeNull();
    await expect(getSession()).rejects.toBeInstanceOf(BrowserGuestSessionInvalidatedError);
    await expect(createTransportBackedChatSession("chat-1")).rejects.toBeInstanceOf(BrowserGuestSessionInvalidatedError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(navigate).not.toHaveBeenCalled();
  });
});
