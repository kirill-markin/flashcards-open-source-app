export type SessionInfo = Readonly<{
  userId: string;
  workspaceId: string;
  authTransport: string;
  csrfToken: string | null;
  profile: Readonly<{
    email: string | null;
    locale: string;
  }>;
}>;

export type Card = Readonly<{
  cardId: string;
  frontText: string;
  backText: string;
  dueAt: string | null;
  reps: number;
  lapses: number;
  updatedAt: string;
}>;
