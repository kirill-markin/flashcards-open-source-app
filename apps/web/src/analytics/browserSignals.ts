import { isAutomationRun } from "../automationRun";
import type { AnalyticsBrowserSignals, AnalyticsScreenWidthBucket } from "./events";

// Each reader returns null for a value the catalog would refuse, and null means the key is left out:
// one unfit property would refuse the whole event.
const webglRendererPattern = /^[\x20-\x7E]{1,256}$/u;
const browserLanguagesPattern = /^[A-Za-z0-9-]+(?:,[A-Za-z0-9-]+)*$/u;
const browserLanguagesMaxLength = 200;

/** `window.screen.width` bucketed exactly as the marketing site's `site_page_viewed` does. */
export function readAnalyticsScreenWidthBucket(): AnalyticsScreenWidthBucket {
  const screenWidth = window.screen.width;
  if (screenWidth < 480) {
    return "xs";
  }

  if (screenWidth < 768) {
    return "sm";
  }

  if (screenWidth < 1024) {
    return "md";
  }

  if (screenWidth < 1440) {
    return "lg";
  }

  if (screenWidth < 1920) {
    return "xl";
  }

  return "xxl";
}

function toNonNegativeInteger(value: number | undefined): number | null {
  if (value === undefined || Number.isFinite(value) === false) {
    return null;
  }

  const roundedValue = Math.round(value);
  return roundedValue >= 0 && Number.isSafeInteger(roundedValue) ? roundedValue : null;
}

// Read once per page load, on the first open tracked while analytics collects, and reused after: the
// renderer cannot change within one, and creating a context can block the main thread at the moment
// an open should feel instant. The first result is kept even when it is null, so a failed first read
// means no renderer for this page load.
let webglRendererOfPageLoad: string | null | undefined;

/** The unmasked renderer of a detached canvas; null without WebGL or `WEBGL_debug_renderer_info`. */
export function readAnalyticsWebglRenderer(): string | null {
  if (webglRendererOfPageLoad === undefined) {
    webglRendererOfPageLoad = readWebglRendererFromNewContext();
  }

  return webglRendererOfPageLoad;
}

function readWebglRendererFromNewContext(): string | null {
  let gl: WebGLRenderingContext | null;
  try {
    gl = document.createElement("canvas").getContext("webgl");
  } catch {
    // Some browsers throw instead of returning null when WebGL is blocked; either way there is none.
    return null;
  }

  if (gl === null) {
    return null;
  }

  const debugRendererInfo = gl.getExtension("WEBGL_debug_renderer_info");
  const renderer: unknown = debugRendererInfo === null
    ? null
    : gl.getParameter(debugRendererInfo.UNMASKED_RENDERER_WEBGL);
  // Released at once: browsers cap live WebGL contexts per page, and this one is never read again.
  gl.getExtension("WEBGL_lose_context")?.loseContext();

  return typeof renderer === "string" && webglRendererPattern.test(renderer) ? renderer : null;
}

export function readAnalyticsBrowserLanguages(): string | null {
  const browserLanguages = navigator.languages.join(",");
  return browserLanguages.length <= browserLanguagesMaxLength && browserLanguagesPattern.test(browserLanguages)
    ? browserLanguages
    : null;
}

/** Read at the moment `app_opened` is tracked; headless signs are derived from these at query time. */
export function readAnalyticsBrowserSignals(): AnalyticsBrowserSignals {
  return {
    automation: isAutomationRun ? "webdriver" : "none",
    screenWidthBucket: readAnalyticsScreenWidthBucket(),
    webglRenderer: readAnalyticsWebglRenderer(),
    hardwareConcurrency: toNonNegativeInteger(navigator.hardwareConcurrency),
    browserLanguages: readAnalyticsBrowserLanguages(),
    windowInnerWidth: toNonNegativeInteger(window.innerWidth),
    windowInnerHeight: toNonNegativeInteger(window.innerHeight),
    windowOuterWidth: toNonNegativeInteger(window.outerWidth),
    windowOuterHeight: toNonNegativeInteger(window.outerHeight),
    pluginCount: toNonNegativeInteger(navigator.plugins.length),
  };
}
