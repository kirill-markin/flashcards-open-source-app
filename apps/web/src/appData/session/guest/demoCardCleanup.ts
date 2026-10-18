import { buildDemoCardText } from "../../sync/local/demoCard";
import { loadCardsIncludingDeleted } from "../../../localDb/cards/cards";
import type { Card } from "../../../types";

export type GuestDemoCapture = Readonly<{
  guestCardIds: ReadonlySet<string>;
  demoCardIds: ReadonlyArray<string>;
}>;

export async function captureGuestDemoCards(workspaceId: string): Promise<GuestDemoCapture> {
  const [cards, seed] = await Promise.all([loadCardsIncludingDeleted(workspaceId), buildDemoCardText()]);
  return {
    guestCardIds: new Set(cards.map((card) => card.cardId)),
    demoCardIds: cards.filter((card) => card.deletedAt === null && card.tags.length === 1 && card.tags[0] === "demo"
      && card.frontText === seed.frontText && card.backText === seed.backText).map((card) => card.cardId),
  };
}

export async function deleteMergedGuestDemoCards(workspaceId: string, capture: GuestDemoCapture,
  deleteCard: (cardId: string) => Promise<Card>): Promise<void> {
  const cards = await loadCardsIncludingDeleted(workspaceId);
  if (!cards.some((card) => !capture.guestCardIds.has(card.cardId))) return;
  const activeIds = new Set(cards.filter((card) => card.deletedAt === null).map((card) => card.cardId));
  for (const cardId of capture.demoCardIds) {
    if (activeIds.has(cardId)) await deleteCard(cardId);
  }
}
