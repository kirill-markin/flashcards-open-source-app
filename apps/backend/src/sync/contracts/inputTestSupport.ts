import type pg from "pg";
import type { CardMetadata, CardSnapshotInput } from "../../cards";

export type CardDueAtFixture = Readonly<{
  dueAt: string | null;
}>;

export type MediaAssetPayload = Readonly<{
  mediaAssetId: string;
  workspaceId: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  sourceUrl: string | null;
  createdAt: string;
  clientUpdatedAt: string;
  lastModifiedByReplicaId: string;
  lastOperationId: string;
  updatedAt: string;
  deletedAt: string | null;
}>;

export const mediaAssetId = "22222222-2222-4222-8222-222222222222";
const mediaAssetSha256 =
  "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8";

export function createCardMetadata(createdAt: string): CardMetadata {
  return {
    version: 1,
    source: {
      label: null,
      author: null,
      comment: null,
      createdAt,
      importedAt: null,
      importId: null,
    },
  };
}

export function createCardSnapshotPayload(fixture: CardDueAtFixture): CardSnapshotInput {
  const hasDueAt = fixture.dueAt !== null;

  return {
    cardId: "card-1",
    frontText: "Question",
    backText: "Answer",
    cardType: "basic",
    metadata: createCardMetadata("2026-02-28T09:00:00.000Z"),
    tags: ["sync"],
    dueAt: fixture.dueAt,
    createdAt: "2026-02-28T09:00:00.000Z",
    reps: hasDueAt ? 1 : 0,
    lapses: 0,
    fsrsCardState: hasDueAt ? "review" : "new",
    fsrsStepIndex: null,
    fsrsStability: hasDueAt ? 2.5 : null,
    fsrsDifficulty: hasDueAt ? 4.5 : null,
    fsrsLastReviewedAt: hasDueAt ? "2026-02-28T09:00:00.000Z" : null,
    fsrsScheduledDays: hasDueAt ? 1 : null,
    deletedAt: null,
  };
}

export function createMediaAssetPayload(deletedAt: string | null): MediaAssetPayload {
  return {
    mediaAssetId,
    workspaceId: "workspace-1",
    mimeType: "image/png",
    sizeBytes: 42,
    sha256: mediaAssetSha256,
    sourceUrl: "https://example.com/source.png",
    createdAt: "2026-02-28T09:00:00.000Z",
    clientUpdatedAt: "2026-02-28T09:30:00.000Z",
    lastModifiedByReplicaId: "replica-1",
    lastOperationId: "operation-media-1",
    updatedAt: "2026-02-28T09:30:00.000Z",
    deletedAt,
  };
}

export function createQueryResult<Row extends pg.QueryResultRow>(
  rows: ReadonlyArray<Row>,
): pg.QueryResult<Row> {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows: [...rows],
  };
}
