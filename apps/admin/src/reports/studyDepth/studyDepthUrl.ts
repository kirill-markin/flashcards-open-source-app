// The URL codec for the Study depth area's own control, following `../aiUsageCohorts/aiUsageCohortsUrl.ts`:
// the parameter belongs to one area, so `App.tsx` carries it over on this route only. The default
// writes no parameter, and an unknown, repeated or malformed value opens on the default.

/** How many days a person must have had since their first review to enter the cohort. */
export const studyDepthMaturityDayOptions = [7, 14, 30, 60, 90] as const;

export type StudyDepthMaturityDays = (typeof studyDepthMaturityDayOptions)[number];

export const defaultStudyDepthMaturityDays: StudyDepthMaturityDays = 14;

const studyDepthMaturityDaysParamName = "days-to-return";

export function parseStudyDepthMaturityDays(searchParams: URLSearchParams): StudyDepthMaturityDays {
  const values = searchParams.getAll(studyDepthMaturityDaysParamName);
  const rawValue = values.length === 1 ? values[0] : undefined;
  return studyDepthMaturityDayOptions.find((option) => `${option}` === rawValue) ?? defaultStudyDepthMaturityDays;
}

/** A copy of `searchParams` carrying the maturity, left out at its default. */
export function withStudyDepthMaturitySearchParams(
  searchParams: URLSearchParams,
  maturityDays: StudyDepthMaturityDays,
): URLSearchParams {
  const nextSearchParams = new URLSearchParams(searchParams);
  nextSearchParams.delete(studyDepthMaturityDaysParamName);
  if (maturityDays !== defaultStudyDepthMaturityDays) {
    nextSearchParams.set(studyDepthMaturityDaysParamName, `${maturityDays}`);
  }

  return nextSearchParams;
}

/** Replaces the current history entry, as the filter selection does, keeping every other parameter. */
export function writeStudyDepthMaturityToUrl(maturityDays: StudyDepthMaturityDays): void {
  const serializedParams = withStudyDepthMaturitySearchParams(
    new URLSearchParams(window.location.search),
    maturityDays,
  ).toString();
  const nextSearch = serializedParams === "" ? "" : `?${serializedParams}`;
  if (nextSearch === window.location.search) {
    return;
  }

  window.history.replaceState(null, "", `${window.location.pathname}${nextSearch}${window.location.hash}`);
}
