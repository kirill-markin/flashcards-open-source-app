// The URL codec for the Study depth area's own controls, following `../aiUsageCohorts/aiUsageCohortsUrl.ts`:
// the parameters belong to one area, so `App.tsx` carries them over on this route only. A default
// writes no parameter, and an unknown, repeated or malformed value opens on the default.

/** How many days a person must have had since their first review to enter the cohort. */
export const studyDepthMaturityDayOptions = [7, 14, 30, 60, 90] as const;

export type StudyDepthMaturityDays = (typeof studyDepthMaturityDayOptions)[number];

/** How a matrix cell counts people: reached both thresholds, or sits in both buckets now. */
export const studyDepthMatrixModes = ["at-least", "exactly"] as const;

export type StudyDepthMatrixMode = (typeof studyDepthMatrixModes)[number];

export type StudyDepthControls = Readonly<{
  maturityDays: StudyDepthMaturityDays;
  matrixMode: StudyDepthMatrixMode;
}>;

export const defaultStudyDepthControls: StudyDepthControls = {
  maturityDays: 14,
  matrixMode: "at-least",
};

const studyDepthMaturityDaysParamName = "days-to-return";
const studyDepthMatrixModeParamName = "matrix";

function readSingleParam(searchParams: URLSearchParams, paramName: string): string | undefined {
  const values = searchParams.getAll(paramName);
  return values.length === 1 ? values[0] : undefined;
}

export function parseStudyDepthControls(searchParams: URLSearchParams): StudyDepthControls {
  const rawMaturityDays = readSingleParam(searchParams, studyDepthMaturityDaysParamName);
  const rawMatrixMode = readSingleParam(searchParams, studyDepthMatrixModeParamName);
  return {
    maturityDays: studyDepthMaturityDayOptions.find((option) => `${option}` === rawMaturityDays)
      ?? defaultStudyDepthControls.maturityDays,
    matrixMode: studyDepthMatrixModes.find((option) => option === rawMatrixMode)
      ?? defaultStudyDepthControls.matrixMode,
  };
}

/** A copy of `searchParams` carrying the controls, with every default left out. */
export function withStudyDepthControlSearchParams(
  searchParams: URLSearchParams,
  controls: StudyDepthControls,
): URLSearchParams {
  const nextSearchParams = new URLSearchParams(searchParams);
  nextSearchParams.delete(studyDepthMaturityDaysParamName);
  nextSearchParams.delete(studyDepthMatrixModeParamName);
  if (controls.maturityDays !== defaultStudyDepthControls.maturityDays) {
    nextSearchParams.set(studyDepthMaturityDaysParamName, `${controls.maturityDays}`);
  }

  if (controls.matrixMode !== defaultStudyDepthControls.matrixMode) {
    nextSearchParams.set(studyDepthMatrixModeParamName, controls.matrixMode);
  }

  return nextSearchParams;
}

/** Replaces the current history entry, as the filter selection does, keeping every other parameter. */
export function writeStudyDepthControlsToUrl(controls: StudyDepthControls): void {
  const serializedParams = withStudyDepthControlSearchParams(
    new URLSearchParams(window.location.search),
    controls,
  ).toString();
  const nextSearch = serializedParams === "" ? "" : `?${serializedParams}`;
  if (nextSearch === window.location.search) {
    return;
  }

  window.history.replaceState(null, "", `${window.location.pathname}${nextSearch}${window.location.hash}`);
}
