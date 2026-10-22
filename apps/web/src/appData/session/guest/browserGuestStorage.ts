import type { BrowserGuestUpgradeResult, GuestUpgradeSelection } from "../../../apiContracts/guestAuth";
import { parseBrowserGuestUpgradeResult } from "../../../apiContracts/guestAuth";
import { ApiContractError, parseBoolean, parseEnum, parseNullableString, parseObject, parseString } from "../../../apiContracts/core";

export const browserGuestStorageKey = "flashcards-browser-guest-owner";
export const browserGuestLockName = "flashcards-browser-guest-lifecycle";
const browserGuestOwnershipGenerationKey = "flashcards-browser-guest-ownership-generation";
export type PendingGuestConversion = Readonly<{
  phase: "draining" | "awaiting_auth" | "prepared" | "completing" | "completed";
  sourceUserId: string;
  sourceWorkspaceId: string;
  guestWorkspaceSyncedAndOutboxDrained: boolean;
  destinationUserId: string | null;
  selection: GuestUpgradeSelection | null;
  result: BrowserGuestUpgradeResult | null;
}>;
export type BrowserGuestOwner = Readonly<{
  userId: string;
  workspaceId: string;
  initialSeedAllowed: boolean;
  pending: PendingGuestConversion | null;
}>;
export type BrowserGuestStoredState = Readonly<{ status: "creating" }> | Readonly<{ status: "owned"; owner: BrowserGuestOwner }>;
let drainingInThisTab = false;

export function readBrowserGuestState(): BrowserGuestStoredState | null {
  const raw = window.localStorage.getItem(browserGuestStorageKey);
  if (raw === null) return null;
  const value = parseObject(JSON.parse(raw) as unknown, "browser guest storage", "");
  if (value.status === "creating") return { status: "creating" };
  if (value.status !== "owned") throw new Error("Browser guest ownership metadata is invalid; preserve local data before recovery");
  const owner = parseObject(value.owner, "browser guest storage", "owner");
  let pending: PendingGuestConversion | null = null;
  if (owner.pending !== null) {
    const saved = parseObject(owner.pending, "browser guest storage", "owner.pending");
    let selection: GuestUpgradeSelection | null = null;
    if (saved.selection !== null) {
      const selected = parseObject(saved.selection, "browser guest storage", "selection");
      const type = parseEnum(selected.type, "browser guest storage", "selection.type", ["existing", "create_new"] as const);
      selection = type === "existing" ? {
        type, workspaceId: parseString(selected.workspaceId, "browser guest storage", "selection.workspaceId"),
        ...(selected.discardDemoOnly === undefined ? {} : { discardDemoOnly: parseBoolean(selected.discardDemoOnly, "browser guest storage", "selection.discardDemoOnly") }),
      } : { type, ...(selected.name === undefined ? {} : { name: parseString(selected.name, "browser guest storage", "selection.name") }) };
      if ((selection.type === "existing" && selection.workspaceId.trim() === "")
        || (selection.type === "create_new" && (selected.discardDemoOnly !== undefined || selection.name?.trim() === ""))) {
        throw new ApiContractError("browser guest storage", "selection", "existing non-empty workspace ID or create_new with an optional non-empty name and without demo disposal");
      }
    }
    pending = {
      phase: parseEnum(saved.phase, "browser guest storage", "phase", ["draining", "awaiting_auth", "prepared", "completing", "completed"] as const),
      sourceUserId: parseString(saved.sourceUserId, "browser guest storage", "sourceUserId"),
      sourceWorkspaceId: parseString(saved.sourceWorkspaceId, "browser guest storage", "sourceWorkspaceId"),
      guestWorkspaceSyncedAndOutboxDrained: parseBoolean(saved.guestWorkspaceSyncedAndOutboxDrained, "browser guest storage", "guestWorkspaceSyncedAndOutboxDrained"),
      destinationUserId: parseNullableString(saved.destinationUserId, "browser guest storage", "destinationUserId"),
      selection,
      result: saved.result === null ? null : parseBrowserGuestUpgradeResult(saved.result, "browser guest storage"),
    };
  }
  return { status: "owned", owner: {
    userId: parseString(owner.userId, "browser guest storage", "owner.userId"),
    workspaceId: parseString(owner.workspaceId, "browser guest storage", "owner.workspaceId"),
    initialSeedAllowed: parseBoolean(owner.initialSeedAllowed, "browser guest storage", "owner.initialSeedAllowed"),
    pending,
  } };
}

export function writeBrowserGuestState(state: BrowserGuestStoredState): void {
  window.localStorage.setItem(browserGuestStorageKey, JSON.stringify(state));
  window.dispatchEvent(new Event(browserGuestStorageKey));
}

export function readBrowserGuestOwnershipGeneration(): string | null {
  return window.localStorage.getItem(browserGuestOwnershipGenerationKey);
}

export function invalidateBrowserGuestOwnership(): void {
  window.localStorage.setItem(browserGuestOwnershipGenerationKey, crypto.randomUUID());
  window.dispatchEvent(new Event(browserGuestStorageKey));
}

export function hasSavedBrowserGuestOwnership(): boolean {
  try { return window.localStorage.getItem(browserGuestStorageKey) !== null; }
  catch { return true; }
}

export function readPendingGuestConversion(): PendingGuestConversion | null {
  const state = readBrowserGuestState();
  return state?.status === "owned" ? state.owner.pending : null;
}

export function requireBrowserGuestWritesReady(userId: string): void {
  const state = readBrowserGuestState();
  if (state?.status !== "owned" || state.owner.userId !== userId || state.owner.pending !== null) {
    throw new Error("Browser guest ownership changed or sign-in is pending. Resume the saved session before writing.");
  }
}

export function requireBrowserGuestSyncReady(userId: string): void {
  const state = readBrowserGuestState();
  if (state?.status !== "owned" || state.owner.userId !== userId
    || (state.owner.pending !== null && !(drainingInThisTab && state.owner.pending.phase === "draining"))) {
    throw new Error("Browser guest sync is paused while ownership is being converted.");
  }
}

export async function runWithBrowserGuestLock<T>(mode: LockMode, action: () => Promise<T>): Promise<T> {
  if (typeof navigator.locks?.request !== "function") {
    throw new Error("This browser cannot coordinate guest ownership between tabs (Web Locks unavailable).");
  }
  return navigator.locks.request(browserGuestLockName, { mode }, action);
}

export async function runWithBrowserGuestWorkLock<T>(signal: AbortSignal, action: () => Promise<T>): Promise<T> {
  if (typeof navigator.locks?.request !== "function") {
    throw new Error("This browser cannot coordinate guest ownership between tabs (Web Locks unavailable).");
  }
  return navigator.locks.request(browserGuestLockName, { mode: "shared", signal }, action);
}

export function isDrainingBrowserGuestInThisTab(): boolean { return drainingInThisTab; }

export async function drainBrowserGuestInThisTab(action: () => Promise<void>): Promise<void> {
  drainingInThisTab = true;
  try { await action(); } finally { drainingInThisTab = false; }
}

export function subscribeToBrowserGuestChanges(listener: () => void): () => void {
  const onStorage = (event: StorageEvent): void => {
    if (event.key === browserGuestStorageKey || event.key === browserGuestOwnershipGenerationKey || event.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(browserGuestStorageKey, listener);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(browserGuestStorageKey, listener);
  };
}
