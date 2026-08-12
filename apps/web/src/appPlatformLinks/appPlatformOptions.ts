import type { ClientPlatform } from "./clientPlatform";

export type AppPlatformKind = "ios" | "android" | "web" | "mcp";

export type AppPlatformStoreKind = "ios" | "android";

export type AppPlatformStoreLinks = Readonly<{
  ios: string;
  android: string;
}>;

export type AppPlatformLabels = Readonly<{
  ios: string;
  android: string;
  web: string;
  mcp: string;
}>;

export type AppPlatformQrTitles = Readonly<{
  ios: string;
  android: string;
}>;

export type AppPlatformOption = Readonly<{
  kind: AppPlatformKind;
  href: string | null;
  label: string;
  qrTitle: string | null;
}>;

export type BuildAppPlatformOptionsInput = Readonly<{
  platforms: ReadonlyArray<AppPlatformKind>;
  storeLinks: AppPlatformStoreLinks;
  webHref: string | null;
  labels: AppPlatformLabels;
  qrTitles: AppPlatformQrTitles;
  clientPlatform: ClientPlatform;
}>;

/**
 * A QR code only helps when the visitor can scan it with another physical device,
 * so the platform they are already browsing from never shows one, and the web and
 * MCP options never show one at all.
 */
function buildStoreOption(
  kind: AppPlatformStoreKind,
  input: BuildAppPlatformOptionsInput,
): AppPlatformOption {
  return {
    kind,
    href: input.storeLinks[kind],
    label: input.labels[kind],
    qrTitle: input.clientPlatform === kind ? null : input.qrTitles[kind],
  };
}

function buildWebOption(input: BuildAppPlatformOptionsInput): AppPlatformOption {
  if (input.webHref === null) {
    throw new Error('App platform option "web" was requested without a web href.');
  }

  return {
    kind: "web",
    href: input.webHref,
    label: input.labels.web,
    qrTitle: null,
  };
}

function buildOption(kind: AppPlatformKind, input: BuildAppPlatformOptionsInput): AppPlatformOption {
  if (kind === "ios" || kind === "android") {
    return buildStoreOption(kind, input);
  }

  if (kind === "web") {
    return buildWebOption(input);
  }

  return {
    kind: "mcp",
    href: null,
    label: input.labels.mcp,
    qrTitle: null,
  };
}

/**
 * Orders the requested platform options the way the visitor's own device expects:
 * the Android store leads on Android, the App Store leads everywhere else, and the
 * web and MCP options always follow both store options in that order.
 */
export function buildAppPlatformOptions(
  input: BuildAppPlatformOptionsInput,
): ReadonlyArray<AppPlatformOption> {
  const storeOrder: ReadonlyArray<AppPlatformKind> = input.clientPlatform === "android"
    ? ["android", "ios"]
    : ["ios", "android"];
  const orderedKinds: ReadonlyArray<AppPlatformKind> = [...storeOrder, "web", "mcp"];

  return orderedKinds
    .filter((kind) => input.platforms.includes(kind))
    .map((kind) => buildOption(kind, input));
}
