// The URL codec for the step the Funnels chart is anchored on. It follows the filter codec in
// `filters/analyticsFiltersUrl.ts`: the anchor lives in the query string so a reload or a shared link
// reopens the same view, the default (the first step) is never written, and reading ignores anything
// it does not accept - an unknown, repeated or empty value opens on the default rather than throwing.
//
// The value is a stable step identifier rather than the display label, so renaming a step on screen
// does not break links that are already shared. The parameter belongs to the Funnels area only: area
// links carry a bare path, and the filter writer in `App.tsx` keeps it only on the Funnels route.

/** The eight main funnel steps in chart order; `buildMainStages` takes its order from this list. */
export const funnelMainStepIds = [
  "site-visit",
  "import-screen",
  "import-confirm",
  "install-started",
  "installed",
  "one-review",
  "engaged",
  "engaged-returning",
] as const;

export type FunnelMainStepId = (typeof funnelMainStepIds)[number];

const funnelAnchorParamName = "funnelFrom";

const funnelMainStepIdValues: ReadonlySet<string> = new Set<string>(funnelMainStepIds);

function isFunnelMainStepId(value: string): value is FunnelMainStepId {
  return funnelMainStepIdValues.has(value);
}

/**
 * The anchor a query string asks for, or `null` for the default view. The first step is the default,
 * so naming it is the same as naming nothing; the writer then drops it from the URL.
 */
export function parseFunnelAnchorStepId(searchParams: URLSearchParams): FunnelMainStepId | null {
  const values = searchParams.getAll(funnelAnchorParamName);
  const value = values.length === 1 ? values[0] : undefined;
  if (value === undefined || !isFunnelMainStepId(value) || value === funnelMainStepIds[0]) {
    return null;
  }

  return value;
}

/** A copy of `searchParams` carrying `stepId` as the anchor, or no anchor for the default view. */
export function withFunnelAnchorSearchParams(
  searchParams: URLSearchParams,
  stepId: FunnelMainStepId | null,
): URLSearchParams {
  const nextSearchParams = new URLSearchParams(searchParams);
  nextSearchParams.delete(funnelAnchorParamName);
  if (stepId !== null && stepId !== funnelMainStepIds[0]) {
    nextSearchParams.set(funnelAnchorParamName, stepId);
  }

  return nextSearchParams;
}

/**
 * Writes the anchor into the current URL the way the filter selection is written: it replaces the
 * current history entry rather than pushing one, so Back leaves the area instead of stepping through
 * every click, and every other parameter is kept as it is.
 */
export function writeFunnelAnchorToUrl(stepId: FunnelMainStepId | null): void {
  const searchParams = withFunnelAnchorSearchParams(new URLSearchParams(window.location.search), stepId);
  const serializedParams = searchParams.toString();
  const nextSearch = serializedParams === "" ? "" : `?${serializedParams}`;
  if (nextSearch === window.location.search) {
    return;
  }

  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${nextSearch}${window.location.hash}`,
  );
}
