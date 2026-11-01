// @vitest-environment jsdom
import * as Sentry from "@sentry/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiNetworkError } from "../api";
import {
  prepareSentryEventForSend,
  sanitizeSentryBreadcrumbForPrivacy,
  sanitizeSentryEventForPrivacy,
} from "./instrument";
import {
  captureWebException,
  type WebExceptionEvent,
  type WebObservationScope,
} from "./webObservability";
import { captureAppOperationError } from "./appOperationObservation";

vi.mock("@sentry/react", () => {
  const createScope = () => ({
    setContext: vi.fn(),
    setFingerprint: vi.fn(),
    setLevel: vi.fn(),
    setTag: vi.fn(),
    setUser: vi.fn(),
  });

  return {
    addBreadcrumb: vi.fn(),
    captureException: vi.fn(),
    captureMessage: vi.fn(),
    ErrorBoundary: vi.fn(),
    init: vi.fn(),
    reactErrorHandler: vi.fn(),
    reactRouterV7BrowserTracingIntegration: vi.fn(() => ({ name: "mock.react_router" })),
    setUser: vi.fn(),
    withScope: vi.fn((callback: (scope: ReturnType<typeof createScope>) => void): void => {
      callback(createScope());
    }),
    withSentryReactRouterV7Routing: vi.fn((routes: unknown): unknown => routes),
  };
});

vi.mock("./instrument", async () => {
  const actual = await vi.importActual<typeof import("./instrument")>("./instrument");
  return {
    ...actual,
    isWebSentryEnabled: true,
  };
});

type SentryPrivacyEvent = Parameters<typeof sanitizeSentryEventForPrivacy>[0];
type SentryPrivacyBreadcrumb = Parameters<typeof sanitizeSentryBreadcrumbForPrivacy>[0];

const cardText = "What is the answer on this card?";
const aiText = "Generate cards from this AI prompt and completion.";
const sensitiveTokenText = "Authorization: Bearer private-token-value";
const base64Text = "data:image/png;base64,cHJpdmF0ZS1jYXJkLWltYWdlLWRhdGE=";
const messageText = "User message contains the backText answer.";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Sentry privacy sanitizer", () => {
  it("keeps event message, logentry message, exception values, and card and AI content", () => {
    const event: SentryPrivacyEvent = {
      type: undefined,
      message: "Can't find variable: indexedDB",
      logentry: {
        message: "React error boundary captured a render failure",
      },
      exception: {
        values: [
          {
            type: "RootRenderError",
            value: "Root render failed for route /review",
            stacktrace: {
              frames: [
                {
                  filename: "/src/App.tsx",
                  function: "App",
                  lineno: 42,
                },
              ],
            },
          },
          {
            type: "Error",
            value: "Chat completion request failed with status 503",
          },
        ],
      },
      breadcrumbs: [
        {
          message: "Opened card 0192f0c1-0000-7000-8000-000000000001",
        },
      ],
      extra: {
        aiInput: aiText,
        cardFrontText: cardText,
        completionText: aiText,
        prompt: aiText,
      },
    };

    const sanitizedEvent = sanitizeSentryEventForPrivacy(event);

    expect(sanitizedEvent.message).toBe("Can't find variable: indexedDB");
    expect(sanitizedEvent.logentry?.message).toBe("React error boundary captured a render failure");
    expect(sanitizedEvent.exception?.values?.[0]?.value).toBe("Root render failed for route /review");
    expect(sanitizedEvent.exception?.values?.[1]?.value).toBe("Chat completion request failed with status 503");
    expect(sanitizedEvent.breadcrumbs?.[0]?.message).toBe("Opened card 0192f0c1-0000-7000-8000-000000000001");
    expect(sanitizedEvent.exception?.values?.[0]?.type).toBe("RootRenderError");
    expect(sanitizedEvent.exception?.values?.[0]?.stacktrace?.frames?.[0]?.function).toBe("App");
    expect(sanitizedEvent.extra).toEqual(event.extra);
  });

  it("keeps breadcrumb messages and console arguments while masking secrets", () => {
    const breadcrumb: SentryPrivacyBreadcrumb = {
      category: "console",
      level: "warning",
      message: `Console warning with card text: ${cardText}`,
      data: {
        arguments: [
          sensitiveTokenText,
          `frontText=${cardText}`,
          `AI prompt and completion: ${aiText}`,
          base64Text,
          { message: messageText, token: sensitiveTokenText },
          [cardText, aiText],
          409,
          true,
          null,
        ],
        logger: "console",
      },
    };

    const sanitizedBreadcrumb = sanitizeSentryBreadcrumbForPrivacy(breadcrumb);

    if (sanitizedBreadcrumb === null) {
      throw new Error("Expected console breadcrumb to be kept after privacy sanitization");
    }

    expect(sanitizedBreadcrumb.message).toBe(`Console warning with card text: ${cardText}`);
    expect(sanitizedBreadcrumb.data?.arguments).toEqual([
      "Authorization: Bearer [Filtered]",
      `frontText=${cardText}`,
      `AI prompt and completion: ${aiText}`,
      "data:image/png;base64,[Filtered]",
      { message: messageText, token: "[Filtered]" },
      [cardText, aiText],
      409,
      true,
      null,
    ]);
    expect(sanitizedBreadcrumb.data?.logger).toBe("console");
    expect(JSON.stringify(sanitizedBreadcrumb)).not.toContain("private-token-value");

    const domBreadcrumb: SentryPrivacyBreadcrumb = {
      category: "ui.click",
      level: "info",
      message: `div[role="option"][aria-label="${cardText}"]`,
    };

    const sanitizedDomBreadcrumb = sanitizeSentryBreadcrumbForPrivacy(domBreadcrumb);

    if (sanitizedDomBreadcrumb === null) {
      throw new Error("Expected DOM breadcrumb to be kept after privacy sanitization");
    }

    expect(sanitizedDomBreadcrumb.message).toBe(`div[role="option"][aria-label="${cardText}"]`);
    expect(sanitizedDomBreadcrumb.category).toBe("ui.click");

    const capturedEventBreadcrumb: SentryPrivacyBreadcrumb = {
      category: "sentry.event",
      level: "error",
      message: "TypeError: Can't find variable: indexedDB",
    };

    const sanitizedCapturedEventBreadcrumb = sanitizeSentryBreadcrumbForPrivacy(capturedEventBreadcrumb);

    if (sanitizedCapturedEventBreadcrumb === null) {
      throw new Error("Expected captured event breadcrumb to be kept after privacy sanitization");
    }

    expect(sanitizedCapturedEventBreadcrumb.message).toBe("TypeError: Can't find variable: indexedDB");
    expect(sanitizedCapturedEventBreadcrumb.category).toBe("sentry.event");
  });

  it("keeps safe observability messages for Sentry issue grouping", () => {
    const event: SentryPrivacyEvent = {
      type: undefined,
      message: "web.api_contract_warning",
      exception: {
        values: [
          {
            type: "ApiContractError",
            value: "web.api_contract_failed",
          },
        ],
      },
      breadcrumbs: [
        {
          message: "web.route_change",
        },
      ],
    };

    const sanitizedEvent = sanitizeSentryEventForPrivacy(event);

    expect(sanitizedEvent.message).toBe("web.api_contract_warning");
    expect(sanitizedEvent.exception?.values?.[0]?.value).toBe("web.api_contract_failed");
    expect(sanitizedEvent.breadcrumbs?.[0]?.message).toBe("web.route_change");
  });

  it("keeps arbitrary TypeError exception values readable", () => {
    const event: SentryPrivacyEvent = {
      type: undefined,
      exception: {
        values: [
          {
            type: "TypeError",
            value: "Cannot read properties of undefined (reading 'reviewState')",
          },
        ],
      },
    };

    const sanitizedEvent = sanitizeSentryEventForPrivacy(event);

    expect(sanitizedEvent.exception?.values?.[0]?.value).toBe("Cannot read properties of undefined (reading 'reviewState')");
  });

  it("keeps structured stale bundle breadcrumb diagnostics", () => {
    const breadcrumb: SentryPrivacyBreadcrumb = {
      category: "web.stale_bundle_reload",
      level: "info",
      message: "web.stale_bundle_preload_error",
      data: {
        app: "web",
        feature: "app",
        route: "/settings",
        assetPath: "/assets/SettingsScreen-abc123.js",
        reloadScheduled: true,
        reloadSkipReason: null,
      },
    };

    const sanitizedBreadcrumb = sanitizeSentryBreadcrumbForPrivacy(breadcrumb);

    if (sanitizedBreadcrumb === null) {
      throw new Error("Expected stale bundle breadcrumb to be kept after privacy sanitization");
    }

    expect(sanitizedBreadcrumb.message).toBe("web.stale_bundle_preload_error");
    expect(sanitizedBreadcrumb.data?.assetPath).toBe("/assets/SettingsScreen-abc123.js");
    expect(sanitizedBreadcrumb.data?.reloadScheduled).toBe(true);
    expect(sanitizedBreadcrumb.data?.reloadSkipReason).toBe(null);
  });

  it("masks only secret parameters in query values and URLs", () => {
    const event: SentryPrivacyEvent = {
      type: undefined,
      extra: {
        query_string: "frontText=card-front",
        "url.query": "code=oauth-code&state=oauth-state&locale=de",
        "http.query": "prompt=ai-prompt",
        searchParams: "?premium_checkout_token=checkout-token&premium=checkout",
        route: "review.search",
        errorMessage: "Request failed for https://chat-live.example.com/?sessionId=s1&runId=r1&access_token=t1.",
      },
    };

    const sanitizedEvent = sanitizeSentryEventForPrivacy(event);

    expect(sanitizedEvent.extra?.query_string).toBe("frontText=card-front");
    expect(sanitizedEvent.extra?.["url.query"]).toBe("code=[Filtered]&state=[Filtered]&locale=de");
    expect(sanitizedEvent.extra?.["http.query"]).toBe("prompt=ai-prompt");
    expect(sanitizedEvent.extra?.searchParams).toBe("?premium_checkout_token=[Filtered]&premium=checkout");
    expect(sanitizedEvent.extra?.route).toBe("review.search");
    expect(sanitizedEvent.extra?.errorMessage)
      .toBe("Request failed for https://chat-live.example.com/?sessionId=s1&runId=r1&access_token=[Filtered].");
  });

  it("keeps message-like and content context fields", () => {
    const event: SentryPrivacyEvent = {
      type: undefined,
      message: "web.chat_live_stream_failed",
      extra: {
        errorMessage: "Request failed with status 502 for POST /v1/chat/live",
        statusMessage: "Backend returned an empty body",
        aiText,
        cardFrontText: cardText,
        messageCount: 3,
      },
    };

    const sanitizedEvent = sanitizeSentryEventForPrivacy(event);

    expect(sanitizedEvent.message).toBe("web.chat_live_stream_failed");
    expect(sanitizedEvent.extra?.errorMessage).toBe("Request failed with status 502 for POST /v1/chat/live");
    expect(sanitizedEvent.extra?.statusMessage).toBe("Backend returned an empty body");
    expect(sanitizedEvent.extra?.aiText).toBe(aiText);
    expect(sanitizedEvent.extra?.cardFrontText).toBe(cardText);
    expect(sanitizedEvent.extra?.messageCount).toBe(3);
  });

  it("drops non-actionable unknown progress timezone warnings", () => {
    const event: SentryPrivacyEvent = {
      type: undefined,
      message: "web.progress_timezone_invalid",
      contexts: {
        "web.warning": {
          eventName: "progress_timezone_invalid",
          observedTimeZone: "Etc/Unknown",
          fallbackTimeZone: "UTC",
          errorName: "RangeError",
        },
      },
    };

    expect(prepareSentryEventForSend(event)).toBeNull();
  });

  it("keeps unusual invalid timezone warnings and masks secret fields", () => {
    const event: SentryPrivacyEvent = {
      type: undefined,
      message: "web.progress_timezone_invalid",
      contexts: {
        "web.warning": {
          eventName: "progress_timezone_invalid",
          observedTimeZone: "Invalid/Timezone",
          fallbackTimeZone: "UTC",
          errorName: "RangeError",
        },
      },
      extra: {
        authorization: sensitiveTokenText,
        cardFrontText: cardText,
      },
    };

    const preparedEvent = prepareSentryEventForSend(event);

    if (preparedEvent === null) {
      throw new Error("Expected unusual invalid timezone warning to be kept");
    }

    expect(preparedEvent.message).toBe("web.progress_timezone_invalid");
    expect(preparedEvent.contexts?.["web.warning"]?.observedTimeZone).toBe("Invalid/Timezone");
    expect(preparedEvent.extra?.authorization).toBe("[Filtered]");
    expect(preparedEvent.extra?.cardFrontText).toBe(cardText);
  });

  it("keeps unrelated errors and masks their secrets before send", () => {
    const event: SentryPrivacyEvent = {
      type: undefined,
      exception: {
        values: [
          {
            type: "ReferenceError",
            value: "Can't find variable: indexedDB",
          },
        ],
      },
      extra: {
        authorization: sensitiveTokenText,
        cardFrontText: cardText,
      },
    };

    const preparedEvent = prepareSentryEventForSend(event);

    if (preparedEvent === null) {
      throw new Error("Expected unrelated error event to be kept");
    }

    expect(preparedEvent.exception?.values?.[0]?.value).toBe("Can't find variable: indexedDB");
    expect(preparedEvent.extra?.authorization).toBe("[Filtered]");
    expect(preparedEvent.extra?.cardFrontText).toBe(cardText);
  });

  it("does not capture browser API network errors as Sentry exceptions", () => {
    const scope: WebObservationScope = {
      app: "web",
      feature: "chat",
      userId: "user-1",
      workspaceId: "workspace-1",
      installationId: "installation-1",
      route: "/review",
      requestId: null,
      statusCode: 0,
      code: "API_NETWORK_ERROR",
    };
    const event: WebExceptionEvent = {
      action: "chat_snapshot_failed",
      error: new ApiNetworkError({
        statusCode: 0,
        requestId: null,
        responseBodyKind: "empty",
        endpoint: "GET /chat",
        originalErrorName: "TypeError",
        originalErrorMessage: "Failed to fetch",
        attemptCount: 3,
        source: "fetch",
      }),
      scope,
      details: {
        sessionId: "session-1",
        workspaceId: "workspace-1",
        trigger: "initial_hydration",
        resumeAttemptId: null,
      },
    };

    captureWebException(event);

    expect(Sentry.withScope).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it("treats browser API network app operation errors as expected", () => {
    const wasCaptured = captureAppOperationError(
      new ApiNetworkError({
        statusCode: 0,
        requestId: null,
        responseBodyKind: "empty",
        endpoint: "GET /me",
        originalErrorName: "TypeError",
        originalErrorMessage: "Failed to fetch",
        attemptCount: 3,
        source: "fetch",
      }),
      {
        feature: "app",
        operation: "cards_page_load",
        userId: "user-1",
        workspaceId: "workspace-1",
        installationId: "installation-1",
        entityId: null,
      },
    );

    expect(wasCaptured).toBe(false);
    expect(Sentry.withScope).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it("captures non-network exceptions as Sentry exceptions", () => {
    const scope: WebObservationScope = {
      app: "web",
      feature: "app",
      userId: "user-1",
      workspaceId: "workspace-1",
      installationId: "installation-1",
      route: "/settings",
      requestId: null,
      statusCode: null,
      code: null,
    };
    const event: WebExceptionEvent = {
      action: "app_operation_failed",
      error: new Error("IndexedDB open failed"),
      scope,
      details: {
        operation: "cards_page_load",
        entityId: null,
      },
    };

    captureWebException(event);

    expect(Sentry.withScope).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });
});
