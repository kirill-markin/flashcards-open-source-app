// The URL codec for the step each Funnels chart is anchored on. It follows the filter codec in
// `filters/analyticsFiltersUrl.ts`: the anchor lives in the query string so a reload or a shared link
// reopens the same view, the default (the first step) is never written, and reading ignores anything
// it does not accept - an unknown, repeated or empty value opens on the default rather than throwing.
//
// The value is a stable step identifier rather than the display label, so renaming a step on screen
// does not break links that are already shared. Each funnel has its own parameter, so anchoring one
// chart leaves the others alone. The parameters belong to the Funnels area only: area links carry a
// bare path, and the filter writer in `App.tsx` keeps them only on the Funnels route.

/** One funnel's anchor contract: its URL parameter comes from `funnelId`, and `stepIds` are its steps in chart order. */
export type FunnelAnchor<StepId extends string> = Readonly<{
  funnelId: string;
  stepIds: readonly [StepId, ...StepId[]];
}>;

// The deck funnel had the area to itself when shared links started carrying `funnelFrom`, so it keeps
// that name; every other funnel uses `<funnelId>From`.
const deckFunnelId = "deck";

function getFunnelAnchorParamName(funnelId: string): string {
  return funnelId === deckFunnelId ? "funnelFrom" : `${funnelId}From`;
}

/**
 * The anchor a query string asks for, or `null` for the default view. The first step is the default,
 * so naming it is the same as naming nothing; the writer then drops it from the URL.
 */
export function parseFunnelAnchorStepId<StepId extends string>(
  searchParams: URLSearchParams,
  anchor: FunnelAnchor<StepId>,
): StepId | null {
  const values = searchParams.getAll(getFunnelAnchorParamName(anchor.funnelId));
  const value = values.length === 1 ? values[0] : undefined;
  const stepId = anchor.stepIds.find((candidate) => candidate === value);
  if (stepId === undefined || stepId === anchor.stepIds[0]) {
    return null;
  }

  return stepId;
}

/** A copy of `searchParams` carrying `stepId` as the funnel's anchor, or no anchor for the default view. */
export function withFunnelAnchorSearchParams<StepId extends string>(
  searchParams: URLSearchParams,
  anchor: FunnelAnchor<StepId>,
  stepId: StepId | null,
): URLSearchParams {
  const paramName = getFunnelAnchorParamName(anchor.funnelId);
  const nextSearchParams = new URLSearchParams(searchParams);
  nextSearchParams.delete(paramName);
  if (stepId !== null && stepId !== anchor.stepIds[0]) {
    nextSearchParams.set(paramName, stepId);
  }

  return nextSearchParams;
}

/**
 * Writes the anchor into the current URL the way the filter selection is written: it replaces the
 * current history entry rather than pushing one, so Back leaves the area instead of stepping through
 * every click, and every other parameter is kept as it is.
 */
export function writeFunnelAnchorToUrl<StepId extends string>(
  anchor: FunnelAnchor<StepId>,
  stepId: StepId | null,
): void {
  const searchParams = withFunnelAnchorSearchParams(
    new URLSearchParams(window.location.search),
    anchor,
    stepId,
  );
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
