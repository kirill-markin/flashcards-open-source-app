import { endPool } from "./db";
import { getOverdueCards, markCardRescheduled } from "./dbQueries";

const BATCH_SIZE = 500;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export async function handler(): Promise<{ statusCode: number; body: string }> {
  let processed = 0;

  try {
    const overdueCards = await getOverdueCards(BATCH_SIZE);

    for (const card of overdueCards) {
      const nextDueAtIso = new Date(Date.now() + ONE_DAY_MS).toISOString();
      await markCardRescheduled(card.card_id, nextDueAtIso);
      processed += 1;
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ status: "ok", processed }),
    };
  } finally {
    await endPool();
  }
}
