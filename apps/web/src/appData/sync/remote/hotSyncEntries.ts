import { loadCardsByIds } from "../../../localDb/cards/cards";
import type { WorkspaceSchedulerSettings } from "../../../types";
import { doesCardMutationAffectReviewSchedule } from "../../domain";
import type {
  CardHotSyncEntry,
  HotSyncEntry,
  WorkspaceRemoteSyncInput,
} from "./types";

function findLastWorkspaceSettingsEntry(
  entries: ReadonlyArray<HotSyncEntry>,
): WorkspaceSchedulerSettings | null {
  let lastSettings: WorkspaceSchedulerSettings | null = null;

  for (const entry of entries) {
    if (entry.entityType === "workspace_scheduler_settings") {
      lastSettings = entry.payload;
    }
  }

  return lastSettings;
}

export function publishWorkspaceSettingsFromEntries(
  input: WorkspaceRemoteSyncInput,
  entries: ReadonlyArray<HotSyncEntry>,
): void {
  const lastSettings = findLastWorkspaceSettingsEntry(entries);
  if (lastSettings !== null) {
    input.publishWorkspaceSettings(input.workspaceId, lastSettings);
  }
}

function isCardHotSyncEntry(entry: HotSyncEntry): entry is CardHotSyncEntry {
  return entry.entityType === "card";
}

export async function doHotSyncEntriesAffectReviewSchedule(
  workspaceId: string,
  entries: ReadonlyArray<HotSyncEntry>,
): Promise<boolean> {
  const cardEntries = entries.filter(isCardHotSyncEntry);
  if (cardEntries.length === 0) {
    return false;
  }

  const existingCards = await loadCardsByIds(
    workspaceId,
    cardEntries.map((entry) => entry.payload.cardId),
  );

  return cardEntries.some((entry) => doesCardMutationAffectReviewSchedule(
    existingCards.get(entry.payload.cardId) ?? null,
    entry.payload,
  ));
}
