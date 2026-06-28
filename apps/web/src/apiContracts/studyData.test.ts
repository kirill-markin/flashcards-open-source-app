import { describe, expect, it } from "vitest";
import type { CardMetadata, LegacyEffortLevel } from "../types";
import { parseSyncPullResultResponse } from "./sync";
import { parseCard } from "./studyData";

type CardPayload = Readonly<{
  cardId: string;
  frontText: string;
  backText: string;
  cardType?: string;
  metadata?: CardMetadata;
  tags: ReadonlyArray<string>;
  effortLevel?: LegacyEffortLevel;
  dueAt: string | null;
  createdAt: string;
  reps: number;
  lapses: number;
  fsrsCardState: "new" | "learning" | "review" | "relearning";
  fsrsStepIndex: number | null;
  fsrsStability: number | null;
  fsrsDifficulty: number | null;
  fsrsLastReviewedAt: string | null;
  fsrsScheduledDays: number | null;
  clientUpdatedAt: string;
  lastModifiedByReplicaId: string;
  lastOperationId: string;
  updatedAt: string;
  deletedAt: string | null;
}>;

function makeCardPayload(input: Readonly<{
  cardId: string;
  cardType?: string;
  metadata?: CardMetadata;
}>): CardPayload {
  return {
    cardId: input.cardId,
    frontText: "Front",
    backText: "Back",
    ...(input.cardType === undefined ? {} : { cardType: input.cardType }),
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    tags: ["grammar"],
    effortLevel: "fast",
    dueAt: null,
    createdAt: "2026-03-10T09:00:00.000Z",
    reps: 0,
    lapses: 0,
    fsrsCardState: "new",
    fsrsStepIndex: null,
    fsrsStability: null,
    fsrsDifficulty: null,
    fsrsLastReviewedAt: null,
    fsrsScheduledDays: null,
    clientUpdatedAt: "2026-03-10T09:00:00.000Z",
    lastModifiedByReplicaId: "device-1",
    lastOperationId: `operation-${input.cardId}`,
    updatedAt: "2026-03-10T09:00:00.000Z",
    deletedAt: null,
  };
}

describe("study data API contracts", () => {
  it("defaults missing legacy card type and metadata", () => {
    const card = parseCard(makeCardPayload({
      cardId: "legacy-card",
    }), "GET /cards", "cards[0]");

    expect(card.cardType).toBe("basic");
    expect(card.metadata).toEqual({
      version: 1,
      source: {
        label: null,
        author: null,
        comment: null,
        createdAt: "2026-03-10T09:00:00.000Z",
        importedAt: null,
        importId: null,
      },
    });
  });

  it("preserves unknown card type strings and metadata in sync changes", () => {
    const metadata: CardMetadata = {
      version: 1,
      source: {
        label: "Imported deck",
        author: "Author",
        comment: "Import note",
        createdAt: "2026-03-01T00:00:00.000Z",
        importedAt: "2026-03-10T09:00:00.000Z",
        importId: "import-1",
      },
    };
    const result = parseSyncPullResultResponse({
      changes: [
        {
          changeId: 10,
          entityType: "card",
          entityId: "custom-card",
          action: "upsert",
          payload: makeCardPayload({
            cardId: "custom-card",
            cardType: "custom-renderer",
            metadata,
          }),
        },
      ],
      nextHotChangeId: 10,
      hasMore: false,
    }, "POST /sync/pull");

    const change = result.changes[0];
    expect(change?.entityType).toBe("card");
    if (change?.entityType !== "card") {
      throw new Error("Expected sync change to parse as a card");
    }
    expect(change.payload.cardType).toBe("custom-renderer");
    expect(change.payload.metadata).toEqual(metadata);
  });
});
