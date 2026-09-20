import * as Sentry from "@sentry/react";
import { createElement, useEffect, type ReactElement, type ReactNode } from "react";
import type { RootOptions } from "react-dom/client";
import {
  createRoutesFromChildren,
  matchRoutes,
  useLocation,
  useNavigationType,
  type Routes,
} from "react-router";
import webPackageInfo from "../../package.json";
import { getAppConfig } from "../config";

type AppErrorBoundaryProps = Readonly<{
  children: ReactNode;
  fallback: ReactElement;
}>;

type SentryInitOptions = Parameters<typeof Sentry.init>[0];
type SentryBeforeBreadcrumb = NonNullable<SentryInitOptions["beforeBreadcrumb"]>;
type SentryBeforeSend = NonNullable<SentryInitOptions["beforeSend"]>;
type SentryBeforeSendSpan = NonNullable<SentryInitOptions["beforeSendSpan"]>;
type SentryBeforeSendTransaction = NonNullable<SentryInitOptions["beforeSendTransaction"]>;
type SentryBreadcrumb = Parameters<SentryBeforeBreadcrumb>[0];
type SentryEvent = Parameters<SentryBeforeSend>[0];
type SentrySpan = Parameters<SentryBeforeSendSpan>[0];
type SentryTransactionEvent = Parameters<SentryBeforeSendTransaction>[0];

type UnknownObject = Readonly<{
  readonly [key: string]: unknown;
}>;

type MutableUnknownObject = {
  [key: string]: unknown;
};

const localBuildId = "local";
const redactedValue = "[Filtered]";
const redactedMessageValue = "[Filtered message]";
const chatLiveLambdaFunctionUrlPattern = /^https:\/\/[a-z0-9-]+\.lambda-url\.[a-z0-9-]+\.on\.aws\/\?(?=[^#]*\bsessionId=)(?=[^#]*\brunId=)/u;
const absoluteUrlPattern = /\bhttps?:\/\/[^\s"'<>]+/giu;
const relativeUrlPattern = /(^|[\s"'(])((?:\/|\.\.?\/)[^\s"'<>]*)/gu;
const normalizedQuerySearchNames = [
  "query",
  "queryparameters",
  "queryparams",
  "querystring",
  "search",
  "searchparameters",
  "searchparams",
  "searchstring",
] as const;
const normalizedQuerySearchNameSet = new Set<string>(normalizedQuerySearchNames);
const normalizedQuerySearchContainerNames = [
  "browser",
  "document",
  "http",
  "location",
  "request",
  "response",
  "uri",
  "url",
  "window",
] as const;
const keptBreadcrumbMessageCategoryPrefixes = ["web.", "sentry."] as const;

export const webSentryRelease = `web@${webPackageInfo.version}+${resolveBuildId()}`;
export const isWebSentryEnabled = resolveSentryDsn() !== null;

function resolveSentryDsn(): string | null {
  const dsn = import.meta.env.VITE_SENTRY_DSN?.trim();
  return dsn === undefined || dsn === "" ? null : dsn;
}

function resolveBuildId(): string {
  const buildId = import.meta.env.VITE_APP_BUILD?.trim();
  return buildId === undefined || buildId === "" ? localBuildId : buildId;
}

function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "::1"
    || hostname === "[::1]";
}

function resolveSentryEnvironment(): string {
  const configuredEnvironment = import.meta.env.VITE_SENTRY_ENVIRONMENT?.trim();
  if (configuredEnvironment !== undefined && configuredEnvironment !== "") {
    return configuredEnvironment;
  }

  return isLocalHostname(window.location.hostname) ? "development" : "production";
}

function resolveTracesSampleRate(): number {
  const rawSampleRate = import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE?.trim();
  if (rawSampleRate === undefined || rawSampleRate === "") {
    return 0;
  }

  const sampleRate = Number(rawSampleRate);
  if (Number.isFinite(sampleRate) === false || sampleRate < 0 || sampleRate > 1) {
    throw new Error(`VITE_SENTRY_TRACES_SAMPLE_RATE must be a number between 0 and 1: ${rawSampleRate}`);
  }

  return sampleRate;
}

function normalizeUrlOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function resolveBaseDomainFromAppUrl(appBaseUrl: string): string | null {
  const appOrigin = normalizeUrlOrigin(appBaseUrl);
  if (appOrigin === null) {
    return null;
  }

  const hostname = new URL(appOrigin).hostname;
  return hostname.startsWith("app.") ? hostname.slice(4) : hostname;
}

function appendUniqueTraceTarget(
  targets: Array<string | RegExp>,
  seenTargets: Set<string>,
  target: string | RegExp | null,
): void {
  if (target === null) {
    return;
  }

  const key = target instanceof RegExp ? target.source : target;
  if (seenTargets.has(key)) {
    return;
  }

  seenTargets.add(key);
  targets.push(target);
}

function buildTracePropagationTargets(): Array<string | RegExp> {
  const config = getAppConfig();
  const targets: Array<string | RegExp> = [];
  const seenTargets = new Set<string>();
  const apiOrigin = normalizeUrlOrigin(config.apiBaseUrl);
  const authOrigin = normalizeUrlOrigin(config.authBaseUrl);
  const baseDomain = resolveBaseDomainFromAppUrl(config.appBaseUrl);

  appendUniqueTraceTarget(targets, seenTargets, config.apiBaseUrl);
  appendUniqueTraceTarget(targets, seenTargets, apiOrigin);
  appendUniqueTraceTarget(targets, seenTargets, config.authBaseUrl);
  appendUniqueTraceTarget(targets, seenTargets, authOrigin);
  appendUniqueTraceTarget(targets, seenTargets, "http://localhost:8080");
  appendUniqueTraceTarget(targets, seenTargets, "http://localhost:8080/v1");
  appendUniqueTraceTarget(targets, seenTargets, "http://localhost:8081");
  if (baseDomain !== null && isLocalHostname(baseDomain) === false) {
    appendUniqueTraceTarget(targets, seenTargets, `https://chat-live.${baseDomain}`);
  }
  appendUniqueTraceTarget(targets, seenTargets, chatLiveLambdaFunctionUrlPattern);

  return targets;
}

function normalizeSensitiveKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/gu, "");
}

function splitSensitiveKeyWords(key: string): ReadonlyArray<string> {
  return key
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/gu)
    .filter((word: string): boolean => word !== "");
}

function isQuerySearchKey(key: string, normalizedKey: string): boolean {
  if (splitSensitiveKeyWords(key).some((word: string): boolean => word === "query" || word === "search")) {
    return true;
  }

  if (normalizedQuerySearchNameSet.has(normalizedKey)) {
    return true;
  }

  return normalizedQuerySearchContainerNames.some((containerName: string): boolean => {
    return normalizedQuerySearchNames.some((querySearchName: string): boolean => {
      return normalizedKey === `${containerName}${querySearchName}`;
    });
  });
}

function shouldRedactValueForKey(key: string): boolean {
  const normalizedKey = normalizeSensitiveKey(key);
  return normalizedKey.includes("token")
    || normalizedKey.includes("authorization")
    || normalizedKey.includes("cookie")
    || normalizedKey.includes("csrf")
    || normalizedKey.includes("sessionsecret")
    || normalizedKey.includes("password")
    || normalizedKey.includes("credential")
    || normalizedKey === "secret"
    || isQuerySearchKey(key, normalizedKey)
    || normalizedKey === "fragment"
    || normalizedKey.includes("fronttext")
    || normalizedKey.includes("backtext")
    || normalizedKey.includes("cardtext")
    || normalizedKey.includes("cardfront")
    || normalizedKey.includes("cardback")
    || normalizedKey.includes("aitext")
    || normalizedKey.endsWith("input")
    || normalizedKey.endsWith("output")
    || normalizedKey.includes("prompt")
    || normalizedKey.includes("completion")
    || normalizedKey === "text"
    || normalizedKey === "base64data"
    || normalizedKey === "payloadsnippet";
}

function pathMatches(path: ReadonlyArray<string>, expectedPath: ReadonlyArray<string>): boolean {
  if (path.length !== expectedPath.length) {
    return false;
  }

  return expectedPath.every((expectedSegment, index) => path[index] === expectedSegment);
}

function isBreadcrumbArgumentsPath(path: ReadonlyArray<string>): boolean {
  return pathMatches(path, ["data", "arguments"])
    || pathMatches(path, ["breadcrumbs", "data", "arguments"]);
}

function getUrlBase(): string {
  if (typeof window === "undefined") {
    return "https://flashcards-open-source-app.invalid";
  }

  return window.location.origin;
}

function splitTrailingUrlPunctuation(value: string): Readonly<{
  token: string;
  trailing: string;
}> {
  const match = value.match(/[),.;:!?]+$/u);
  if (match === null || match.index === undefined) {
    return { token: value, trailing: "" };
  }

  return {
    token: value.slice(0, match.index),
    trailing: match[0],
  };
}

function stripUrlQueryAndFragment(value: string): string {
  const { token, trailing } = splitTrailingUrlPunctuation(value);
  try {
    const url = new URL(token);
    url.search = "";
    url.hash = "";
    return `${url.toString()}${trailing}`;
  } catch {
    try {
      const url = new URL(token, getUrlBase());
      url.search = "";
      url.hash = "";
      if (token.startsWith("//")) {
        return `//${url.host}${url.pathname}${trailing}`;
      }

      return `${url.pathname}${trailing}`;
    } catch {
      return value;
    }
  }
}

function sanitizeUrlText(value: string): string {
  return value
    .replace(absoluteUrlPattern, (url: string): string => stripUrlQueryAndFragment(url))
    .replace(relativeUrlPattern, (match: string, prefix: string, url: string): string => `${prefix}${stripUrlQueryAndFragment(url)}`);
}

function isPlainObject(value: unknown): value is UnknownObject {
  return typeof value === "object"
    && value !== null
    && Array.isArray(value) === false;
}

function sanitizeConsoleBreadcrumbArgument(value: unknown): unknown {
  if (
    typeof value === "number"
    || typeof value === "boolean"
    || value === null
    || value === undefined
  ) {
    return value;
  }

  return redactedValue;
}

function sanitizeConsoleBreadcrumbArguments(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item: unknown): unknown => sanitizeConsoleBreadcrumbArgument(item));
  }

  return sanitizeConsoleBreadcrumbArgument(value);
}

// A breadcrumb keeps its message only when this app authored that message or
// when the message merely restates an event this app itself captured. The
// `web.` categories come from `addWebBreadcrumb` in `webObservability.ts`, the
// single place this app adds breadcrumbs, and the SDK's `sentry.` categories
// describe the captured event or transaction whose own text already ships.
// Everything else the SDK derives from the page or from user actions: console
// breadcrumbs join the console arguments, and the default DOM breadcrumbs
// serialize the clicked element path including its `aria-label`, `title`,
// `alt`, `name` and `id`, all of which carry user-authored content in this app.
// Every breadcrumb this app and the Sentry SDK emit carries a `category`, and
// the event itself, `logentry` and `exception.values[]` never do, so a missing
// or non-string `category` means keep the message. A new breadcrumb source that
// omits `category`, or that reuses a kept prefix for page-derived text, would
// ship its message unredacted, so re-check this when adding one.
function shouldRedactBreadcrumbMessage(value: UnknownObject): boolean {
  const category = value.category;
  return typeof category === "string"
    && keptBreadcrumbMessageCategoryPrefixes.some((prefix: string): boolean => category.startsWith(prefix)) === false;
}

function sanitizeUnknown(value: unknown, key: string | null, path: ReadonlyArray<string>): unknown {
  if (isBreadcrumbArgumentsPath(path)) {
    return sanitizeConsoleBreadcrumbArguments(value);
  }

  if (typeof value === "string") {
    if (key !== null && shouldRedactValueForKey(key)) {
      return redactedValue;
    }

    return sanitizeUrlText(value);
  }

  if (key !== null && shouldRedactValueForKey(key)) {
    return redactedValue;
  }

  if (
    typeof value === "number"
    || typeof value === "boolean"
    || value === null
    || value === undefined
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item: unknown): unknown => sanitizeUnknown(item, null, path));
  }

  if (isPlainObject(value)) {
    // Checked here, where the sibling `category` is still visible.
    const redactsMessage = shouldRedactBreadcrumbMessage(value);
    const sanitizedObject: MutableUnknownObject = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      sanitizedObject[entryKey] = redactsMessage && entryKey === "message"
        ? redactedMessageValue
        : sanitizeUnknown(entryValue, entryKey, [...path, entryKey]);
    }

    return sanitizedObject;
  }

  return value;
}

export function sanitizeSentryEventForPrivacy(event: SentryEvent): SentryEvent {
  return sanitizeUnknown(event, null, []) as SentryEvent;
}

export function sanitizeSentryBreadcrumbForPrivacy(breadcrumb: SentryBreadcrumb): SentryBreadcrumb | null {
  return sanitizeUnknown(breadcrumb, null, []) as SentryBreadcrumb;
}

function getEventContextObject(event: SentryEvent, name: string): UnknownObject | null {
  if (isPlainObject(event.contexts) === false) {
    return null;
  }

  const context = event.contexts[name];
  return isPlainObject(context) ? context : null;
}

function getEventMessage(event: SentryEvent): string | null {
  if (typeof event.message === "string") {
    return event.message;
  }

  if (isPlainObject(event.logentry) && typeof event.logentry.message === "string") {
    return event.logentry.message;
  }

  return null;
}

function shouldDropNonActionableSentryEvent(event: SentryEvent): boolean {
  if (getEventMessage(event) !== "web.progress_timezone_invalid") {
    return false;
  }

  const warningContext = getEventContextObject(event, "web.warning");
  return warningContext?.observedTimeZone === "Etc/Unknown";
}

export function prepareSentryEventForSend(event: SentryEvent): SentryEvent | null {
  if (shouldDropNonActionableSentryEvent(event)) {
    return null;
  }

  return sanitizeSentryEventForPrivacy(event);
}

const beforeBreadcrumb: SentryBeforeBreadcrumb = (breadcrumb: SentryBreadcrumb): SentryBreadcrumb | null => {
  return sanitizeSentryBreadcrumbForPrivacy(breadcrumb);
};

const beforeSend: SentryBeforeSend = (event: SentryEvent): SentryEvent | null => {
  return prepareSentryEventForSend(event);
};

const beforeSendSpan: SentryBeforeSendSpan = (span: SentrySpan): SentrySpan => {
  return sanitizeUnknown(span, null, []) as SentrySpan;
};

const beforeSendTransaction: SentryBeforeSendTransaction = (event: SentryTransactionEvent): SentryTransactionEvent => {
  return sanitizeUnknown(event, null, []) as SentryTransactionEvent;
};

const sentryDsn = resolveSentryDsn();

if (sentryDsn !== null) {
  Sentry.init({
    dsn: sentryDsn,
    release: webSentryRelease,
    environment: resolveSentryEnvironment(),
    integrations: [
      Sentry.reactRouterV7BrowserTracingIntegration({
        useEffect,
        useLocation,
        useNavigationType,
        createRoutesFromChildren,
        matchRoutes,
      }),
    ],
    tracesSampleRate: resolveTracesSampleRate(),
    tracePropagationTargets: buildTracePropagationTargets(),
    sendDefaultPii: false,
    beforeBreadcrumb,
    beforeSend,
    beforeSendSpan,
    beforeSendTransaction,
  });
}

export function buildReactRootOptions(): RootOptions {
  if (isWebSentryEnabled === false) {
    return {};
  }

  return {
    onCaughtError: Sentry.reactErrorHandler(),
    onRecoverableError: Sentry.reactErrorHandler(),
    onUncaughtError: Sentry.reactErrorHandler(),
  };
}

export function AppErrorBoundary(props: AppErrorBoundaryProps): ReactElement {
  const { children, fallback } = props;
  return createElement(Sentry.ErrorBoundary, { fallback }, children);
}

export function wrapRoutesComponent(routes: typeof Routes): typeof Routes {
  return Sentry.withSentryReactRouterV7Routing(routes);
}
