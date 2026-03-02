export interface DueCardRow {
  card_id: string;
  user_id: string;
  due_at: string | null;
  reps: number;
  lapses: number;
}
