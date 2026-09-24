import {
  aiUsageAudiences,
  aiUsagePeriodWeekOptions,
  defaultAiUsageAudience,
  defaultAiUsagePeriodWeeks,
  type AiUsageAudience,
  type AiUsagePeriodWeeks,
} from "./reportModel";

// The URL codec for the two controls of the Study-vs-AI area. It follows the funnels' anchor and
// group-by codecs in `../funnels/funnelAnchorUrl.ts` and `../funnels/funnelGroupBy.ts` rather than
// the shared filter codec, for the same reason those exist: these two parameters belong to one area,
// so `App.tsx` carries them over on this route only and they cannot leak into another area's links.
//
// A control holding its default writes no parameter, so a default view carries none. Reading is
// tolerant of anything a person can type: an unknown, repeated or malformed value opens on the
// default instead of throwing.
//
// The audience parameter is deliberately not called `audience`: the funnels' audience mode already
// owns that name in the shared filter codec, and that one is written on every area because it lives
// in `AnalyticsFilterState`. Two controls under one name would overwrite each other.

const aiUsagePeriodWeeksParamName = "period-weeks";
const aiUsageAudienceParamName = "ai-audience";

/** The part of this area's view that is not the shared filter selection. */
export type AiUsageControls = Readonly<{
  periodWeeks: AiUsagePeriodWeeks;
  audience: AiUsageAudience;
}>;

export const defaultAiUsageControls: AiUsageControls = {
  periodWeeks: defaultAiUsagePeriodWeeks,
  audience: defaultAiUsageAudience,
};

function readSingleParam(searchParams: URLSearchParams, paramName: string): string | undefined {
  const values = searchParams.getAll(paramName);
  return values.length === 1 ? values[0] : undefined;
}

export function parseAiUsageControls(searchParams: URLSearchParams): AiUsageControls {
  const rawPeriodWeeks = readSingleParam(searchParams, aiUsagePeriodWeeksParamName);
  const rawAudience = readSingleParam(searchParams, aiUsageAudienceParamName);
  return {
    // Matching against the option list itself is what narrows this: a value outside the presets is
    // exactly the free-form period length the area refuses to offer, so it opens on the default.
    periodWeeks: aiUsagePeriodWeekOptions.find((option) => `${option}` === rawPeriodWeeks)
      ?? defaultAiUsagePeriodWeeks,
    audience: aiUsageAudiences.find((option) => option === rawAudience) ?? defaultAiUsageAudience,
  };
}

/** A copy of `searchParams` carrying the controls, with every default left out. */
export function withAiUsageControlSearchParams(
  searchParams: URLSearchParams,
  controls: AiUsageControls,
): URLSearchParams {
  const nextSearchParams = new URLSearchParams(searchParams);
  nextSearchParams.delete(aiUsagePeriodWeeksParamName);
  nextSearchParams.delete(aiUsageAudienceParamName);

  if (controls.periodWeeks !== defaultAiUsageControls.periodWeeks) {
    nextSearchParams.set(aiUsagePeriodWeeksParamName, `${controls.periodWeeks}`);
  }

  if (controls.audience !== defaultAiUsageControls.audience) {
    nextSearchParams.set(aiUsageAudienceParamName, controls.audience);
  }

  return nextSearchParams;
}

/**
 * Writes the controls into the current URL the way the filter selection and the funnel anchors are
 * written: it replaces the current history entry rather than pushing one, so Back leaves the area
 * instead of stepping through every click, and every other parameter is kept as it is.
 */
export function writeAiUsageControlsToUrl(controls: AiUsageControls): void {
  const searchParams = withAiUsageControlSearchParams(
    new URLSearchParams(window.location.search),
    controls,
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
