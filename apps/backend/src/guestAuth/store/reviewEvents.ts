import {
  applyWorkspaceDatabaseScopeInExecutor,
  type DatabaseExecutor,
} from "../../database";

type ReviewEventRow = Readonly<{
  review_event_id: string;
  card_id: string;
  replica_id: string;
  client_event_id: string;
  rating: number;
  reviewed_at_client: Date | string;
  reviewed_at_server: Date | string;
}>;

export type GuestReviewEventRecord = Readonly<{
  reviewEventId: string;
  cardId: string;
  replicaId: string;
  clientEventId: string;
  rating: number;
  reviewedAtClient: Date | string;
  reviewedAtServer: Date | string;
}>;

function mapGuestReviewEventRecord(row: ReviewEventRow): GuestReviewEventRecord {
  return {
    reviewEventId: row.review_event_id,
    cardId: row.card_id,
    replicaId: row.replica_id,
    clientEventId: row.client_event_id,
    rating: row.rating,
    reviewedAtClient: row.reviewed_at_client,
    reviewedAtServer: row.reviewed_at_server,
  };
}

export async function loadGuestReviewEventsInExecutor(
  executor: DatabaseExecutor,
  guestUserId: string,
  guestWorkspaceId: string,
): Promise<ReadonlyArray<GuestReviewEventRecord>> {
  await applyWorkspaceDatabaseScopeInExecutor(executor, {
    userId: guestUserId,
    workspaceId: guestWorkspaceId,
  });

  const result = await executor.query<ReviewEventRow>(
    [
      "SELECT review_event_id, card_id, replica_id, client_event_id, rating, reviewed_at_client, reviewed_at_server",
      "FROM content.review_events",
      "WHERE workspace_id = $1",
      "ORDER BY review_sequence ASC, review_event_id ASC",
    ].join(" "),
    [guestWorkspaceId],
  );

  return result.rows.map(mapGuestReviewEventRecord);
}
