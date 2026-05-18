// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { sanitizeSentryBreadcrumbForPrivacy, sanitizeSentryEventForPrivacy } from "./instrument";

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

describe("Sentry privacy sanitizer", () => {
  it("scrubs automatic event message, logentry message, and exception values", () => {
    const event: SentryPrivacyEvent = {
      message: `React root render failed while showing: ${sensitiveCardText}`,
      logentry: {
        message: `React error boundary captured AI text: ${sensitiveAiText}`,
      },
      exception: {
        values: [
          {
            type: "RootRenderError",
            value: `Root render leaked card front: ${sensitiveCardText}`,
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
            value: `Completion output leaked: ${sensitiveAiText}`,
          },
        ],
      },
      breadcrumbs: [
        {
          message: `User opened card with answer: ${sensitiveCardText}`,
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

    expect(sanitizedEvent.message).toBe("[Filtered message]");
    expect(sanitizedEvent.logentry?.message).toBe("[Filtered message]");
    expect(sanitizedEvent.exception?.values?.[0]?.value).toBe("[Filtered exception value]");
    expect(sanitizedEvent.exception?.values?.[1]?.value).toBe("[Filtered exception value]");
    expect(sanitizedEvent.breadcrumbs?.[0]?.message).toBe("[Filtered message]");
    expect(sanitizedEvent.exception?.values?.[0]?.type).toBe("RootRenderError");
    expect(sanitizedEvent.exception?.values?.[0]?.stacktrace?.frames?.[0]?.function).toBe("App");
    expect(serializeEvent(sanitizedEvent)).not.toContain(sensitiveCardText);
    expect(serializeEvent(sanitizedEvent)).not.toContain(sensitiveAiText);
  });

  it("scrubs raw console breadcrumb arguments before Sentry stores them", () => {
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

  it("redacts message-like context fields while keeping safe web telemetry messages", () => {
    const event: SentryPrivacyEvent = {
      message: "web.chat_live_stream_failed",
      extra: {
        errorMessage: `Request failed with private card text: ${sensitiveCardText}`,
        statusMessage: `Backend returned private AI text: ${sensitiveAiText}`,
        message: `Raw message leaked private data: ${sensitiveCardText}`,
        telemetryMessage: "web.auth_reset_cleanup_deferred",
        messageCount: 3,
      },
    };

    const sanitizedEvent = sanitizeSentryEventForPrivacy(event);

    expect(sanitizedEvent.message).toBe("web.chat_live_stream_failed");
    expect(sanitizedEvent.extra?.errorMessage).toBe("[Filtered message]");
    expect(sanitizedEvent.extra?.statusMessage).toBe("[Filtered message]");
    expect(sanitizedEvent.extra?.message).toBe("[Filtered message]");
    expect(sanitizedEvent.extra?.telemetryMessage).toBe("web.auth_reset_cleanup_deferred");
    expect(sanitizedEvent.extra?.messageCount).toBe(3);
    expect(serializeEvent(sanitizedEvent)).not.toContain(sensitiveCardText);
    expect(serializeEvent(sanitizedEvent)).not.toContain(sensitiveAiText);
  });
});
