import { normalizeTagKey } from "../shared/tagKey";
import { authoredTagsChanged, toNumber } from "./shared";
import type { Card, CardMaintenanceRow, CardSnapshotInput } from "./types";

const scheduleFields = [
  "dueAt", "reps", "lapses", "fsrsCardState", "fsrsStepIndex", "fsrsStability", "fsrsDifficulty",
  "fsrsLastReviewedAt", "fsrsScheduledDays",
] as const;

type SnapshotSchedule = Pick<CardSnapshotInput, typeof scheduleFields[number]>;

export function mergeMaintenanceIntoCardSnapshot(
  row: CardMaintenanceRow,
  card: Card,
  snapshot: CardSnapshotInput,
  reportedRevision: number,
): Readonly<{ tags: ReadonlyArray<string>; schedule: SnapshotSchedule; needsCorrection: boolean }> {
  const currentRevision = toNumber(row.maintenance_revision);
  if (currentRevision === 0 && row.maintenance_reset_at === null) {
    return { tags: snapshot.tags, schedule: snapshot, needsCorrection: false };
  }

  const observedRevision = reportedRevision <= currentRevision ? reportedRevision : 0;
  const protectedTags = new Set(Object.keys(row.maintenance_tag_removals).filter(
    (key) => row.maintenance_tag_removals[key] > observedRevision,
  ));
  const mergedTags = protectedTags.size === 0
    ? snapshot.tags
    : [
      ...snapshot.tags.filter((tag) => !protectedTags.has(normalizeTagKey(tag))),
      ...card.tags.filter((tag) => protectedTags.has(normalizeTagKey(tag))),
    ];
  const tagsChanged = authoredTagsChanged(snapshot.tags, mergedTags);
  const schedule = row.maintenance_reset_at === null ? snapshot : card;

  return {
    tags: tagsChanged ? mergedTags : snapshot.tags,
    schedule,
    needsCorrection: tagsChanged
      || reportedRevision !== currentRevision
      || scheduleFields.some((field) => schedule[field] !== snapshot[field]),
  };
}

export function nextCardCorrectionTimestamp(publishedAt: string, incomingAt: string): string {
  return new Date(Math.max(Date.parse(publishedAt), Date.parse(incomingAt)) + 1).toISOString();
}
