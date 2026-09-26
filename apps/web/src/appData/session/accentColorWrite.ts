import { readEntitlementIdentityGeneration, subscribeToEntitlement } from "../../premium/entitlementStore";
import type { AccountPreferences, SessionInfo } from "../../types";

type AccountPreferenceWrite = Readonly<{
  userId: string;
  generation: number;
  field: keyof AccountPreferences;
}>;
let pendingWrites: ReadonlyArray<AccountPreferenceWrite> = [];
let latestWrites: Partial<Record<keyof AccountPreferences, AccountPreferenceWrite>> = {};
let writeVersion = 0;
const writeListeners = new Set<() => void>();

export function subscribeToAccountPreferenceWrites(listener: () => void): () => void {
  writeListeners.add(listener);
  return (): void => { writeListeners.delete(listener); };
}

function notifyWriteListeners(): void {
  writeListeners.forEach((listener) => listener());
}

export function readAccountPreferencesWriteVersion(): number {
  return writeVersion;
}

export function hasPendingAccentColorWrite(userId: string | null): boolean {
  return pendingWrites.some((write) => write.userId === userId
    && write.field === "accentColor"
    && write.generation === readEntitlementIdentityGeneration());
}

export function beginAccountPreferenceWrite(userId: string, field: keyof AccountPreferences): AccountPreferenceWrite {
  const write = { userId, field, generation: readEntitlementIdentityGeneration() };
  pendingWrites = [...pendingWrites, write];
  latestWrites = { ...latestWrites, [field]: write };
  writeVersion += 1;
  notifyWriteListeners();
  return write;
}

export function isCurrentAccountPreferenceWrite(write: AccountPreferenceWrite): boolean {
  return write.generation === readEntitlementIdentityGeneration() && latestWrites[write.field] === write;
}

export function finishAccountPreferenceWrite(write: AccountPreferenceWrite): void {
  pendingWrites = pendingWrites.filter((pending) => pending !== write);
  writeVersion += 1;
  notifyWriteListeners();
}

/** A GET overlapping a preference PATCH cannot replace that write's optimistic or completed value. */
export function mergeRefreshedSessionPreferences(
  previous: SessionInfo,
  refreshed: SessionInfo,
  startedAtWriteVersion: number,
): SessionInfo {
  const hasPendingWrite = pendingWrites.some((write) => write.userId === previous.userId
    && write.generation === readEntitlementIdentityGeneration());
  if (previous.userId !== refreshed.userId || (!hasPendingWrite && startedAtWriteVersion === writeVersion)) {
    return refreshed;
  }
  return { ...refreshed, preferences: previous.preferences };
}

type AccentColorWriter = Readonly<{
  save: (color: string, signal: AbortSignal) => Promise<string>;
  apply: (color: string) => void;
  onError: (error: unknown) => void;
}>;

type PendingAccentColor = {
  write: AccountPreferenceWrite;
  confirmedColor: string;
  queuedColor: string | null;
  readyAt: number;
  timer: ReturnType<typeof setTimeout> | null;
  isSaving: boolean;
  controller: AbortController;
  unsubscribe: () => void;
  writer: AccentColorWriter;
};

// Keep one in-flight PATCH and one latest value across editor navigation.
let pendingAccentColor: PendingAccentColor | null = null;

function finishAccentColor(pending: PendingAccentColor): void {
  if (pending.timer !== null) {
    clearTimeout(pending.timer);
  }
  pending.unsubscribe();
  if (pendingAccentColor === pending) {
    pendingAccentColor = null;
    finishAccountPreferenceWrite(pending.write);
  }
}

function scheduleAccentColor(pending: PendingAccentColor): void {
  if (pending.timer !== null) {
    clearTimeout(pending.timer);
  }
  pending.timer = setTimeout(() => {
    pending.timer = null;
    void savePendingAccentColor(pending);
  }, Math.max(0, pending.readyAt - Date.now()));
}

async function savePendingAccentColor(pending: PendingAccentColor): Promise<void> {
  if (pending.isSaving) {
    return;
  }
  if (!isCurrentAccountPreferenceWrite(pending.write)) {
    finishAccentColor(pending);
    return;
  }
  const color = pending.queuedColor;
  if (color === null) {
    finishAccentColor(pending);
    return;
  }
  pending.queuedColor = null;
  pending.isSaving = true;
  try {
    const savedColor = await pending.writer.save(color, pending.controller.signal);
    if (isCurrentAccountPreferenceWrite(pending.write)) {
      pending.confirmedColor = savedColor;
      if (pending.queuedColor === null) {
        pending.writer.apply(savedColor);
      }
    }
  } catch (error) {
    if (isCurrentAccountPreferenceWrite(pending.write)) {
      if (pending.queuedColor === null) {
        pending.writer.apply(pending.confirmedColor);
      }
      pending.writer.onError(error);
    }
  } finally {
    pending.isSaving = false;
    if (isCurrentAccountPreferenceWrite(pending.write) && pending.queuedColor !== null) {
      scheduleAccentColor(pending);
    } else {
      finishAccentColor(pending);
    }
  }
}

export function queueAccentColorWrite(
  userId: string,
  color: string,
  previousColor: string,
  writer: AccentColorWriter,
): void {
  if (pendingAccentColor !== null && !isCurrentAccountPreferenceWrite(pendingAccentColor.write)) {
    pendingAccentColor.controller.abort();
    finishAccentColor(pendingAccentColor);
  }
  let pending = pendingAccentColor;
  if (pending === null) {
    const controller = new AbortController();
    const write = beginAccountPreferenceWrite(userId, "accentColor");
    pending = {
      write, confirmedColor: previousColor, queuedColor: null, readyAt: 0,
      timer: null, isSaving: false, controller, writer,
      unsubscribe: subscribeToEntitlement(() => {
        if (!isCurrentAccountPreferenceWrite(write)) {
          controller.abort();
          if (pendingAccentColor?.write === write) {
            finishAccentColor(pendingAccentColor);
          }
        }
      }),
    };
    pendingAccentColor = pending;
  }
  pending.writer = writer;
  pending.queuedColor = color;
  pending.readyAt = Date.now() + 250;
  writer.apply(color);
  scheduleAccentColor(pending);
}
