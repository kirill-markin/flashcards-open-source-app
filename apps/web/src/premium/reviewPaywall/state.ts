import type { PaywallShownInput, PaywallState } from "../../apiContracts/paywallState";

export const emptyPaywallState: PaywallState = {
  introShownAt: null, introLocalDate: null, introTimeZone: null, followUpShownAt: null, lastShownAt: null,
};

function earlier(left: string | null, right: string | null): string | null {
  if (left === null) return right;
  if (right === null) return left;
  return Date.parse(left) <= Date.parse(right) ? left : right;
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
    lastShownAt: left.lastShownAt === null ? right.lastShownAt : right.lastShownAt === null ? left.lastShownAt
      : Date.parse(left.lastShownAt) >= Date.parse(right.lastShownAt) ? left.lastShownAt : right.lastShownAt,
  };
}

export function applyPaywallShown(state: PaywallState, input: PaywallShownInput): PaywallState {
  return mergePaywallState(state, {
    introShownAt: input.reviewTrigger === "initial" ? input.shownAt : null,
    introLocalDate: input.reviewTrigger === "initial" ? input.localDate : null,
    introTimeZone: input.reviewTrigger === "initial" ? input.timeZone : null,
    followUpShownAt: input.reviewTrigger === "day3" ? input.shownAt : null,
    lastShownAt: input.shownAt,
  });
}
