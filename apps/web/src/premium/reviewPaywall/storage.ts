import { ApiContractError } from "../../apiContracts/core";
import { parsePaywallShownInput, parsePaywallState, type PaywallShownInput, type PaywallState } from "../../apiContracts/paywallState";
import { applyPaywallShown, mergePaywallState } from "./state";

// v2: cached states from before `periodicShownAt` fail the current contract, so they are not read.
const storageKeyPrefix = "flashcards-paywall-state-v2:";
const pendingKeyPrefix = "flashcards-paywall-pending:";

function decode(raw: string): unknown {
  try { return JSON.parse(raw) as unknown; } catch {
    throw new ApiContractError("localStorage", "paywallState", "valid JSON");
  }
}

function read(userId: string): PaywallState | null {
  const raw = window.localStorage.getItem(`${storageKeyPrefix}${userId}`);
  return raw === null ? null : parsePaywallState(decode(raw), "localStorage", "paywallState");
}

function write(userId: string, state: PaywallState): void {
  const stored = read(userId);
  window.localStorage.setItem(`${storageKeyPrefix}${userId}`,
    JSON.stringify(stored === null ? state : mergePaywallState(stored, state)));
}

export function readPendingPaywallShown(userIds: ReadonlyArray<string>): ReadonlyArray<PaywallShownInput> {
  const prefixes = userIds.map((userId) => `${pendingKeyPrefix}${userId}:`);
  const keys = Object.keys(window.localStorage).filter((key) => prefixes.some((prefix) => key.startsWith(prefix)));
  const pending = keys.flatMap((key) => {
    const raw = window.localStorage.getItem(key);
    return raw === null ? [] : [parsePaywallShownInput(decode(raw), "localStorage", "paywallShown")];
  });
  return [...new Map(pending.map((input) => [input.presentationId, input])).values()];
}

export function readEffectivePaywallState(userIds: ReadonlyArray<string>): PaywallState | null {
  const pending = readPendingPaywallShown(userIds);
  const state = userIds.map(read).reduce<PaywallState | null>((merged, item) => item === null ? merged
    : merged === null ? item : mergePaywallState(merged, item), null);
  // A cache miss is unknown until the account answers, even if a manual offer just appeared.
  return state === null ? null : pending.reduce(applyPaywallShown, state);
}

export function storePaywallShown(userId: string, input: PaywallShownInput): void {
  window.localStorage.setItem(`${pendingKeyPrefix}${userId}:${input.presentationId}`, JSON.stringify(input));
}

export async function storeFetchedPaywallState(userId: string, state: PaywallState, signal: AbortSignal): Promise<void> {
  await navigator.locks.request(storageKeyPrefix, { signal }, () => write(userId, state));
}

export async function acknowledgePaywallShown(
  userIds: ReadonlyArray<string>, input: PaywallShownInput, state: PaywallState, signal: AbortSignal,
): Promise<void> {
  await navigator.locks.request(storageKeyPrefix, { signal }, () => {
    for (const userId of userIds) {
      write(userId, state);
      window.localStorage.removeItem(`${pendingKeyPrefix}${userId}:${input.presentationId}`);
    }
  });
}
