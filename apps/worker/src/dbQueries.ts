import { query } from "./db";
import type { DueCardRow } from "./types";

export async function getOverdueCards(limit: number): Promise<DueCardRow[]> {
  const result = await query(
    "SELECT card_id, user_id, due_at::text, reps, lapses " +
      "FROM cards " +
      "WHERE deleted_at IS NULL AND due_at IS NOT NULL AND due_at <= now() " +
      "ORDER BY due_at ASC " +
      "LIMIT $1",
    [limit],
  );

  return result.rows as DueCardRow[];
}

export async function markCardRescheduled(cardId: string, nextDueAtIso: string): Promise<void> {
  await query(
    "UPDATE cards " +
      "SET due_at = $2::timestamptz, reps = reps + 1, updated_at = now() " +
      "WHERE card_id = $1",
    [cardId, nextDueAtIso],
  );
}
