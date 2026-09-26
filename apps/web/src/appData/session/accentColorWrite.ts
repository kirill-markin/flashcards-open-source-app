import { readEntitlementIdentityGeneration } from "../../premium/entitlementStore";
import type { AccountPreferences, SessionInfo } from "../../types";

type AccountPreferenceWrite = Readonly<{
  userId: string;
  generation: number;
  field: keyof AccountPreferences;
}>;
let pendingWrites: ReadonlyArray<AccountPreferenceWrite> = [];
let latestWrites: Partial<Record<keyof AccountPreferences, AccountPreferenceWrite>> = {};
let writeVersion = 0;

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
  return write;
}

export function isCurrentAccountPreferenceWrite(write: AccountPreferenceWrite): boolean {
  return write.generation === readEntitlementIdentityGeneration() && latestWrites[write.field] === write;
}

export function finishAccountPreferenceWrite(write: AccountPreferenceWrite): void {
  pendingWrites = pendingWrites.filter((pending) => pending !== write);
  writeVersion += 1;
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
