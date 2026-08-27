import type { LangfuseObservation } from "@langfuse/tracing";
import * as Sentry from "@sentry/aws-serverless";
import {
  formatCapturedConsoleMessage,
} from "../../../observability/consoleCapture.testSupport";
import {
  sentryModule,
} from "../../../observability/sentry/testHelpers";

export type ProviderTelemetryCapture = Readonly<{
  cloudWatchLogs: Array<string>;
  cloudWatchWarnings: Array<string>;
  sentryBreadcrumbs: Array<Parameters<typeof Sentry.addBreadcrumb>[0]>;
  sentryContexts: Array<Readonly<{
    name: string;
    context: Parameters<Sentry.Scope["setContext"]>[1];
  }>>;
}>;

type MutableSentryTelemetryModule = typeof sentryModule & Readonly<{
  addBreadcrumb: typeof Sentry.addBreadcrumb;
}>;

export type RecordedLangfuseTelemetry = Readonly<{
  rootObservation: LangfuseObservation;
  starts: Array<Readonly<{
    name: string;
    attributes: unknown;
    options: unknown;
  }>>;
  updates: Array<unknown>;
  getEndCount: () => number;
}>;

export function createRecordedLangfuseTelemetry(): RecordedLangfuseTelemetry {
  const starts: RecordedLangfuseTelemetry["starts"] = [];
  const updates: RecordedLangfuseTelemetry["updates"] = [];
  let endCount = 0;
  const childObservation = {
    updateOtelSpanAttributes: (attributes: unknown): void => {
      updates.push(attributes);
    },
    end: (): void => {
      endCount += 1;
    },
  };
  const rootObservation = {
    startObservation: (name: string, attributes: unknown, options: unknown) => {
      starts.push({
        name,
        attributes,
        options,
      });
      return childObservation;
    },
  } as unknown as LangfuseObservation;

  return {
    rootObservation,
    starts,
    updates,
    getEndCount: (): number => endCount,
  };
}

export async function withProviderTelemetryCapture<Result>(
  run: (capture: ProviderTelemetryCapture) => Promise<Result>,
): Promise<Readonly<{
  capture: ProviderTelemetryCapture;
  result: Result;
}>> {
  const capture: ProviderTelemetryCapture = {
    cloudWatchLogs: [],
    cloudWatchWarnings: [],
    sentryBreadcrumbs: [],
    sentryContexts: [],
  };
  const mutableSentryModule = sentryModule as MutableSentryTelemetryModule;
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalAddBreadcrumb = mutableSentryModule.addBreadcrumb;
  const originalCaptureMessage = sentryModule.captureMessage;
  const originalSetContext = Sentry.Scope.prototype.setContext;

  try {
    console.log = (message?: unknown): void => {
      capture.cloudWatchLogs.push(formatCapturedConsoleMessage(message));
    };
    console.warn = (message?: unknown): void => {
      capture.cloudWatchWarnings.push(formatCapturedConsoleMessage(message));
    };
    mutableSentryModule.addBreadcrumb = (breadcrumb): void => {
      capture.sentryBreadcrumbs.push(breadcrumb);
    };
    sentryModule.captureMessage = (_message, _captureContext) => "provider-test-sentry-event";
    Sentry.Scope.prototype.setContext = function setContext(name, context) {
      capture.sentryContexts.push({
        name,
        context,
      });
      return this;
    };

    return {
      capture,
      result: await run(capture),
    };
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    mutableSentryModule.addBreadcrumb = originalAddBreadcrumb;
    sentryModule.captureMessage = originalCaptureMessage;
    Sentry.Scope.prototype.setContext = originalSetContext;
  }
}
