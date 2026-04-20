import { useSyncExternalStore } from "react";

const progressTimeContextPollIntervalMs = 60_000;

export type ProgressTimeContext = Readonly<{
  timeZone: string;
  today: string;
}>;

type ProgressTimeContextListener = () => void;

let progressTimeContextSnapshot: ProgressTimeContext | null = null;

const progressTimeContextListeners = new Set<ProgressTimeContextListener>();

function getRequiredDatePart(
  parts: ReadonlyArray<Intl.DateTimeFormatPart>,
  partType: "year" | "month" | "day",
): string {
  const partValue = parts.find((part) => part.type === partType)?.value;

  if (partValue === undefined || partValue === "") {
    throw new Error(`Browser timezone date is missing ${partType}`);
  }

  return partValue;
}

function getBrowserTimeZone(): string {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  if (typeof timeZone !== "string" || timeZone.trim() === "") {
    throw new Error("Browser timezone is unavailable");
  }

  return timeZone;
}

function formatDateAsLocalDate(date: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const year = getRequiredDatePart(parts, "year");
  const month = getRequiredDatePart(parts, "month");
  const day = getRequiredDatePart(parts, "day");

  return `${year}-${month}-${day}`;
}

export function buildProgressTimeContext(now: Date): ProgressTimeContext {
  const timeZone = getBrowserTimeZone();

  return {
    timeZone,
    today: formatDateAsLocalDate(now, timeZone),
  };
}

function areProgressTimeContextsEqual(
  left: ProgressTimeContext,
  right: ProgressTimeContext,
): boolean {
  return left.timeZone === right.timeZone && left.today === right.today;
}

function notifyProgressTimeContextListeners(): void {
  for (const listener of progressTimeContextListeners) {
    listener();
  }
}

function getProgressTimeContextSnapshot(): ProgressTimeContext {
  if (progressTimeContextSnapshot === null) {
    progressTimeContextSnapshot = buildProgressTimeContext(new Date());
  }

  return progressTimeContextSnapshot;
}

function subscribeToProgressTimeContext(
  listener: ProgressTimeContextListener,
): () => void {
  progressTimeContextListeners.add(listener);

  return (): void => {
    progressTimeContextListeners.delete(listener);
  };
}

export function updateProgressTimeContext(now: Date): boolean {
  const nextSnapshot = buildProgressTimeContext(now);
  const currentSnapshot = getProgressTimeContextSnapshot();

  if (areProgressTimeContextsEqual(currentSnapshot, nextSnapshot)) {
    return false;
  }

  progressTimeContextSnapshot = nextSnapshot;
  notifyProgressTimeContextListeners();
  return true;
}

export function resetProgressTimeContextStateForTests(now: Date): void {
  progressTimeContextSnapshot = buildProgressTimeContext(now);
  notifyProgressTimeContextListeners();
}

export function useProgressTimeContext(): ProgressTimeContext {
  return useSyncExternalStore(
    subscribeToProgressTimeContext,
    getProgressTimeContextSnapshot,
    getProgressTimeContextSnapshot,
  );
}

export {
  progressTimeContextPollIntervalMs,
};
