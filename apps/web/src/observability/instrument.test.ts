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

const sensitiveCardText = "What is the private answer on this card?";
const sensitiveAiText = "Generate cards from this private AI prompt and completion.";
const sensitiveTokenText = "Authorization: Bearer private-token-value";
const sensitiveBase64Text = "data:image/png;base64,cHJpdmF0ZS1jYXJkLWltYWdlLWRhdGE=";
const sensitiveMessageText = "User message contains the backText private answer.";

function serializeEvent(event: SentryPrivacyEvent): string {
  return JSON.stringify(event);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Sentry privacy sanitizer", () => {
  it("keeps event message, logentry message, and exception values while redacting sensitive keys", () => {
    const event: SentryPrivacyEvent = {
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
        aiInput: sensitiveAiText,
        cardFrontText: sensitiveCardText,
        completionText: sensitiveAiText,
        prompt: sensitiveAiText,
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
    expect(serializeEvent(sanitizedEvent)).not.toContain(sensitiveCardText);
    expect(serializeEvent(sanitizedEvent)).not.toContain(sensitiveAiText);
  });

  it("scrubs page-derived breadcrumb messages and raw console arguments while keeping the captured event description", () => {
    const breadcrumb: SentryPrivacyBreadcrumb = {
      category: "console",
      level: "warning",
      message: `Console warning leaked card text: ${sensitiveCardText}`,
      data: {
        arguments: [
          sensitiveTokenText,
          `frontText=${sensitiveCardText}`,
          `AI prompt and completion: ${sensitiveAiText}`,
          sensitiveBase64Text,
          { message: sensitiveMessageText, token: sensitiveTokenText },
          [sensitiveCardText, sensitiveAiText],
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

    expect(sanitizedBreadcrumb.message).toBe("[Filtered message]");
    expect(sanitizedBreadcrumb.data?.arguments).toEqual([
      "[Filtered]",
      "[Filtered]",
      "[Filtered]",
      "[Filtered]",
      "[Filtered]",
      "[Filtered]",
      409,
      true,
      null,
    ]);
    expect(sanitizedBreadcrumb.data?.logger).toBe("console");
    const serializedBreadcrumb = JSON.stringify(sanitizedBreadcrumb);
    expect(serializedBreadcrumb).not.toContain(sensitiveTokenText);
    expect(serializedBreadcrumb).not.toContain(sensitiveCardText);
    expect(serializedBreadcrumb).not.toContain(sensitiveAiText);
    expect(serializedBreadcrumb).not.toContain(sensitiveBase64Text);
    expect(serializedBreadcrumb).not.toContain(sensitiveMessageText);

    const domBreadcrumb: SentryPrivacyBreadcrumb = {
      category: "ui.click",
      level: "info",
      message: `div[role="option"][aria-label="${sensitiveCardText}"]`,
    };

    const sanitizedDomBreadcrumb = sanitizeSentryBreadcrumbForPrivacy(domBreadcrumb);

    if (sanitizedDomBreadcrumb === null) {
      throw new Error("Expected DOM breadcrumb to be kept after privacy sanitization");
    }

    expect(sanitizedDomBreadcrumb.message).toBe("[Filtered message]");
    expect(sanitizedDomBreadcrumb.category).toBe("ui.click");
    expect(JSON.stringify(sanitizedDomBreadcrumb)).not.toContain(sensitiveCardText);

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

  it("redacts normalized query and search key variants without redacting route names", () => {
    const event: SentryPrivacyEvent = {
      extra: {
        query_string: "frontText=private-card-front",
        "url.query": "cardBack=private-card-back",
        "http.query": "prompt=private-ai-prompt",
        searchParams: "completion=private-ai-completion",
        route: "review.search",
      },
    };

    const sanitizedEvent = sanitizeSentryEventForPrivacy(event);

    expect(sanitizedEvent.extra?.query_string).toBe("[Filtered]");
    expect(sanitizedEvent.extra?.["url.query"]).toBe("[Filtered]");
    expect(sanitizedEvent.extra?.["http.query"]).toBe("[Filtered]");
    expect(sanitizedEvent.extra?.searchParams).toBe("[Filtered]");
    expect(sanitizedEvent.extra?.route).toBe("review.search");
  });

  it("keeps message-like context fields while still redacting sensitive keys", () => {
    const event: SentryPrivacyEvent = {
      message: "web.chat_live_stream_failed",
      extra: {
        errorMessage: "Request failed with status 502 for POST /v1/chat/live",
        statusMessage: "Backend returned an empty body",
        aiText: sensitiveAiText,
        cardFrontText: sensitiveCardText,
        messageCount: 3,
      },
    };

    const sanitizedEvent = sanitizeSentryEventForPrivacy(event);

    expect(sanitizedEvent.message).toBe("web.chat_live_stream_failed");
    expect(sanitizedEvent.extra?.errorMessage).toBe("Request failed with status 502 for POST /v1/chat/live");
    expect(sanitizedEvent.extra?.statusMessage).toBe("Backend returned an empty body");
    expect(sanitizedEvent.extra?.aiText).toBe("[Filtered]");
    expect(sanitizedEvent.extra?.cardFrontText).toBe("[Filtered]");
    expect(sanitizedEvent.extra?.messageCount).toBe(3);
    expect(serializeEvent(sanitizedEvent)).not.toContain(sensitiveCardText);
    expect(serializeEvent(sanitizedEvent)).not.toContain(sensitiveAiText);
  });

  it("drops non-actionable unknown progress timezone warnings", () => {
    const event: SentryPrivacyEvent = {
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

  it("keeps unusual invalid timezone warnings and sanitizes sensitive fields", () => {
    const event: SentryPrivacyEvent = {
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
        cardFrontText: sensitiveCardText,
      },
    };

    const preparedEvent = prepareSentryEventForSend(event);

    if (preparedEvent === null) {
      throw new Error("Expected unusual invalid timezone warning to be kept");
    }

    expect(preparedEvent.message).toBe("web.progress_timezone_invalid");
    expect(preparedEvent.contexts?.["web.warning"]?.observedTimeZone).toBe("Invalid/Timezone");
    expect(preparedEvent.extra?.cardFrontText).toBe("[Filtered]");
    expect(serializeEvent(preparedEvent)).not.toContain(sensitiveCardText);
  });

  it("keeps unrelated errors and sanitizes them before send", () => {
    const event: SentryPrivacyEvent = {
      exception: {
        values: [
          {
            type: "ReferenceError",
            value: "Can't find variable: indexedDB",
          },
        ],
      },
      extra: {
        cardFrontText: sensitiveCardText,
      },
    };

    const preparedEvent = prepareSentryEventForSend(event);

    if (preparedEvent === null) {
      throw new Error("Expected unrelated error event to be kept");
    }

    expect(preparedEvent.exception?.values?.[0]?.value).toBe("Can't find variable: indexedDB");
    expect(preparedEvent.extra?.cardFrontText).toBe("[Filtered]");
    expect(serializeEvent(preparedEvent)).not.toContain(sensitiveCardText);
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
