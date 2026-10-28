import { formatDateAsLocalDate } from "../progress/progressDates";
import { ApiContractError, parseEnum, parseObject, parseRequiredField, parseString } from "./core";
import { parseStripeUuid } from "./stripeBilling";

export type ReviewPaywallTrigger = "initial" | "day3" | "weekly";
export type PaywallState = Readonly<{
  introShownAt: string | null;
  introLocalDate: string | null;
  introTimeZone: string | null;
  followUpShownAt: string | null;
  lastShownAt: string | null;
  periodicShownAt: string | null;
}>;
export type PaywallShownInput = Readonly<{
  presentationId: string;
  shownAt: string;
  localDate: string;
  timeZone: string;
  reviewTrigger: ReviewPaywallTrigger | null;
}>;

function parseInstant(value: unknown, endpoint: string, path: string): string {
  const text = parseString(value, endpoint, path);
  const instant = new Date(text);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(text)
    || !Number.isFinite(instant.getTime()) || instant.toISOString().slice(0, 10) !== text.slice(0, 10)) {
    throw new ApiContractError(endpoint, path, "UTC ISO timestamp");
  }
  return text;
}

function parseNullableInstant(value: unknown, endpoint: string, path: string): string | null {
  return value === null ? null : parseInstant(value, endpoint, path);
}

function parseNullableText(value: unknown, endpoint: string, path: string): string | null {
  return value === null ? null : parseString(value, endpoint, path);
}

function assertLocalDate(instant: string, localDate: string, timeZone: string, endpoint: string): void {
  let expectedDate: string;
  try {
    if (/^[+-]/.test(timeZone)) throw new RangeError("Offset is not an IANA timezone");
    expectedDate = formatDateAsLocalDate(new Date(instant), timeZone);
  } catch {
    throw new ApiContractError(endpoint, "timeZone", "IANA timezone");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate) || expectedDate !== localDate) {
    throw new ApiContractError(endpoint, "localDate", "date of shownAt in timeZone");
  }
}

export function parsePaywallState(value: unknown, endpoint: string, path: string): PaywallState {
  const object = parseObject(value, endpoint, path);
  const state: PaywallState = {
    introShownAt: parseRequiredField(object, "introShownAt", endpoint, path, parseNullableInstant),
    introLocalDate: parseRequiredField(object, "introLocalDate", endpoint, path, parseNullableText),
    introTimeZone: parseRequiredField(object, "introTimeZone", endpoint, path, parseNullableText),
    followUpShownAt: parseRequiredField(object, "followUpShownAt", endpoint, path, parseNullableInstant),
    lastShownAt: parseRequiredField(object, "lastShownAt", endpoint, path, parseNullableInstant),
    periodicShownAt: parseRequiredField(object, "periodicShownAt", endpoint, path, parseNullableInstant),
  };
  if (state.introShownAt === null) {
    if (state.introLocalDate !== null || state.introTimeZone !== null) {
      throw new ApiContractError(endpoint, path, "coherent nullable intro fields");
    }
  } else {
    if (state.introLocalDate === null || state.introTimeZone === null) {
      throw new ApiContractError(endpoint, path, "intro date and timezone beside introShownAt");
    }
    assertLocalDate(state.introShownAt, state.introLocalDate, state.introTimeZone, endpoint);
  }
  return state;
}

export function parsePaywallShownInput(value: unknown, endpoint: string, path: string): PaywallShownInput {
  const object = parseObject(value, endpoint, path);
  const input: PaywallShownInput = {
    presentationId: parseRequiredField(object, "presentationId", endpoint, path, parseStripeUuid),
    shownAt: parseRequiredField(object, "shownAt", endpoint, path, parseInstant),
    localDate: parseRequiredField(object, "localDate", endpoint, path, parseString),
    timeZone: parseRequiredField(object, "timeZone", endpoint, path, parseString),
    reviewTrigger: parseRequiredField(object, "reviewTrigger", endpoint, path,
      (field, source, fieldPath) => field === null ? null : parseEnum<ReviewPaywallTrigger>(field, source, fieldPath, ["initial", "day3", "weekly"])),
  };
  assertLocalDate(input.shownAt, input.localDate, input.timeZone, endpoint);
  return input;
}
