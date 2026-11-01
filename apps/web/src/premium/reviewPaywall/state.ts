import type { PaywallShownInput, PaywallState } from "../../apiContracts/paywallState";

export const emptyPaywallState: PaywallState = {
  introShownAt: null, introLocalDate: null, introTimeZone: null, followUpShownAt: null, lastShownAt: null, periodicShownAt: null,
};

function earlier(left: string | null, right: string | null): string | null {
  if (left === null) return right;
  if (right === null) return left;
  return Date.parse(left) <= Date.parse(right) ? left : right;
}

function later(left: string | null, right: string | null): string | null {
  if (left === null) return right;
  if (right === null) return left;
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

export function mergePaywallState(left: PaywallState, right: PaywallState): PaywallState {
  const leftIntro = left.introShownAt;
  const rightIntro = right.introShownAt;
  const rightWins = rightIntro !== null && (leftIntro === null || Date.parse(rightIntro) < Date.parse(leftIntro)
    || (Date.parse(rightIntro) === Date.parse(leftIntro)
      && `${right.introLocalDate}:${right.introTimeZone}` < `${left.introLocalDate}:${left.introTimeZone}`));
  const intro = rightWins ? right : left;
  return {
    introShownAt: intro.introShownAt,
    introLocalDate: intro.introLocalDate,
    introTimeZone: intro.introTimeZone,
    followUpShownAt: earlier(left.followUpShownAt, right.followUpShownAt),
    lastShownAt: later(left.lastShownAt, right.lastShownAt),
    periodicShownAt: later(left.periodicShownAt, right.periodicShownAt),
  };
}

export function applyPaywallShown(state: PaywallState, input: PaywallShownInput): PaywallState {
  return mergePaywallState(state, {
    introShownAt: input.reviewTrigger === "initial" ? input.shownAt : null,
    introLocalDate: input.reviewTrigger === "initial" ? input.localDate : null,
    introTimeZone: input.reviewTrigger === "initial" ? input.timeZone : null,
    followUpShownAt: input.reviewTrigger === "day3" ? input.shownAt : null,
    lastShownAt: input.shownAt,
    periodicShownAt: input.reviewTrigger === "weekly" ? input.shownAt : null,
  });
}
