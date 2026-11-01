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
import { isStaleBundleReloadScheduled } from "../pageReloadState";

type AppErrorBoundaryProps = Readonly<{
  children: ReactNode;
  fallback: ReactElement;
}>;

type SentryInitOptions = Parameters<typeof Sentry.init>[0];
type SentryBeforeBreadcrumb = NonNullable<SentryInitOptions["beforeBreadcrumb"]>;
type SentryBeforeSend = NonNullable<SentryInitOptions["beforeSend"]>;
type SentryBeforeSendSpan = NonNullable<SentryInitOptions["beforeSendSpan"]>;
type SentryBreadcrumb = Parameters<SentryBeforeBreadcrumb>[0];
type SentryEvent = Parameters<SentryBeforeSend>[0];
type SentryStreamedSpan = Parameters<SentryBeforeSendSpan>[0];

type UnknownObject = Readonly<{
  readonly [key: string]: unknown;
}>;

type MutableUnknownObject = {
  [key: string]: unknown;
};

type SecretTextMask = Readonly<{
  pattern: RegExp;
  replacement: string;
}>;

const localBuildId = "local";
const redactedValue = "[Filtered]";
// Matches the Sentry SDK normalizer marker.
const circularValue = "[Circular ~]";
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
const secretAssignmentTextPattern = /(^|[^A-Za-z0-9_.-])([A-Za-z0-9_.-]+)(["']?\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s"'&,;=]+?(?=[.)!?:=]*(?:[\s"'&,;]|$)))/gu;
const secretTextMasks: ReadonlyArray<SecretTextMask> = [
  { pattern: /\b((?:proxy-)?authorization\s*:\s*)((?:Basic|Bearer|Digest)\s+)?[^\s"',;]+/giu, replacement: `$1$2${redactedValue}` },
  { pattern: /\b((?:set-)?cookie\s*:\s*)[^\r\n"']+/giu, replacement: `$1${redactedValue}` },
  { pattern: /\bBearer\s+[A-Za-z0-9._~+/-]+=*/giu, replacement: `Bearer ${redactedValue}` },
  { pattern: /\b(?:sk|rk)[_-][A-Za-z0-9_-]{16,}\b/gu, replacement: redactedValue },
  { pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/gu, replacement: redactedValue },
  // Replaced for event size, not secrecy.
  { pattern: /\bdata:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,[A-Za-z0-9+/=]+/giu, replacement: `data:$1;base64,${redactedValue}` },
];

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
  if (splitSensitiveKeyWords(key).some((word: string): boolean => word === "query" || word === "search" || word === "fragment")) {
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

function isSecretKey(key: string): boolean {
  const normalizedKey = normalizeSensitiveKey(key);
  return normalizedKey.includes("token")
    || normalizedKey.includes("authorization")
    || normalizedKey.includes("cookie")
    || normalizedKey.includes("csrf")
    || normalizedKey.includes("secret")
    || normalizedKey.includes("password")
    || normalizedKey.includes("credential")
    || normalizedKey.includes("apikey")
    || splitSensitiveKeyWords(key).some((word: string): boolean => word.startsWith("otp"));
}

// `code` and `state` carry OAuth values, `completion` the account-method
// return proof (`accountMethodReturn.ts`), and signatures sign presigned URLs.
function isSecretUrlParameterName(name: string): boolean {
  const normalizedName = normalizeSensitiveKey(name);
  return isSecretKey(name)
    || normalizedName === "code"
    || normalizedName === "state"
    || normalizedName === "completion"
    || normalizedName === "key"
    || normalizedName === "sig"
    || normalizedName.includes("signature");
}

function maskSecretUrlParameters(parameters: string): string {
  return parameters
    .split("&")
    .map((parameter: string): string => {
      const separatorIndex = parameter.indexOf("=");
      if (separatorIndex === -1) {
        return parameter;
      }

      const rawName = parameter.slice(0, separatorIndex);
      return isSecretUrlParameterName(rawName.replace(/^[?#]/u, ""))
        ? `${rawName}=${redactedValue}`
        : parameter;
    })
    .join("&");
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

function maskSecretUrlQueryAndFragment(value: string): string {
  const { token, trailing } = splitTrailingUrlPunctuation(value);
  const fragmentStart = token.indexOf("#");
  const beforeFragment = fragmentStart === -1 ? token : token.slice(0, fragmentStart);
  const fragment = fragmentStart === -1 ? "" : token.slice(fragmentStart);
  const queryStart = beforeFragment.indexOf("?");
  const path = queryStart === -1 ? beforeFragment : beforeFragment.slice(0, queryStart);
  const query = queryStart === -1 ? "" : beforeFragment.slice(queryStart);
  return `${path}${maskSecretUrlParameters(query)}${maskSecretUrlParameters(fragment)}${trailing}`;
}

// Masks `name=value`, `"name": "value"` and `name: "value"` text; unquoted
// `name: value` reads as prose, so only the header masks in `secretTextMasks` cover it.
function maskSecretAssignments(value: string): string {
  return value.replace(
    secretAssignmentTextPattern,
    (match: string, prefix: string, name: string, separator: string, secret: string): string => {
      const quote = secret.startsWith("\"") || secret.startsWith("'") ? secret.charAt(0) : "";
      if (isSecretKey(name) === false || (separator.trim() === ":" && quote === "")) {
        return match;
      }

      return `${prefix}${name}${separator}${quote}${redactedValue}${quote}`;
    },
  );
}

function maskSecretText(value: string): string {
  return maskSecretAssignments(secretTextMasks
    .reduce((text: string, mask: SecretTextMask): string => text.replace(mask.pattern, mask.replacement), value))
    .replace(absoluteUrlPattern, (url: string): string => maskSecretUrlQueryAndFragment(url))
    .replace(relativeUrlPattern, (match: string, prefix: string, url: string): string => `${prefix}${maskSecretUrlQueryAndFragment(url)}`);
}

function sanitizeString(value: string, key: string | null): string {
  if (key !== null && isQuerySearchKey(key, normalizeSensitiveKey(key))) {
    return maskSecretText(maskSecretUrlParameters(value));
  }

  return maskSecretText(value);
}

function isPlainObject(value: unknown): value is UnknownObject {
  return typeof value === "object"
    && value !== null
    && Array.isArray(value) === false;
}

function hasPlainPrototype(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sanitizeObjectEntries(value: object, ancestors: WeakSet<object>): MutableUnknownObject {
  const sanitizedObject: MutableUnknownObject = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    sanitizedObject[entryKey] = sanitizeUnknown(entryValue, entryKey, ancestors);
  }

  return sanitizedObject;
}

// `message` and `stack` are non-enumerable, so they are copied explicitly.
function sanitizeError(error: Error, ancestors: WeakSet<object>): MutableUnknownObject {
  return {
    name: maskSecretText(error.name),
    message: maskSecretText(error.message),
    stack: error.stack === undefined ? undefined : maskSecretText(error.stack),
    ...sanitizeObjectEntries(error, ancestors),
  };
}

// Console breadcrumbs carry raw `console.*` arguments, so this sees DOM nodes,
// React fibers and cycles. Non-plain objects pass through for the SDK's own
// normalization, and `ancestors` holds only the current path, so repeated
// non-cyclic references stay intact.
function sanitizeUnknown(value: unknown, key: string | null, ancestors: WeakSet<object>): unknown {
  if (
    typeof value === "number"
    || typeof value === "boolean"
    || value === null
    || value === undefined
  ) {
    return value;
  }

  // `base64Data` holds chat image bytes, replaced for event size.
  if (key !== null && (isSecretKey(key) || normalizeSensitiveKey(key) === "base64data")) {
    return redactedValue;
  }

  if (typeof value === "string") {
    return sanitizeString(value, key);
  }

  const isArray = Array.isArray(value);
  const isError = value instanceof Error;
  if (typeof value !== "object" || (isArray === false && isError === false && hasPlainPrototype(value) === false)) {
    return value;
  }

  if (ancestors.has(value)) {
    return circularValue;
  }

  ancestors.add(value);
  const sanitizedValue = isArray
    ? value.map((item: unknown): unknown => sanitizeUnknown(item, null, ancestors))
    : isError
      ? sanitizeError(value, ancestors)
      : sanitizeObjectEntries(value, ancestors);
  ancestors.delete(value);
  return sanitizedValue;
}

export function sanitizeSentryEventForPrivacy(event: SentryEvent): SentryEvent {
  return sanitizeUnknown(event, null, new WeakSet<object>()) as SentryEvent;
}

export function sanitizeSentryBreadcrumbForPrivacy(breadcrumb: SentryBreadcrumb): SentryBreadcrumb | null {
  return sanitizeUnknown(breadcrumb, null, new WeakSet<object>()) as SentryBreadcrumb;
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
  // Once a stale-bundle reload is scheduled, Vite resolves the cancelled import
  // to `undefined`, so errors raised before navigation are reload artifacts.
  if (isStaleBundleReloadScheduled()) {
    return null;
  }

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

const beforeSendSpan: SentryBeforeSendSpan = (span: SentryStreamedSpan): SentryStreamedSpan => {
  return sanitizeUnknown(span, null, new WeakSet<object>()) as SentryStreamedSpan;
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
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      genAI: { inputs: false, outputs: false },
      mcp: { inputs: false, outputs: false },
      graphQL: { document: false, variables: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      frameContextLines: 7,
    },
    beforeBreadcrumb,
    beforeSend,
    beforeSendSpan,
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
