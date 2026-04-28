import type {
  CardState,
  DeckState,
  ReviewEventState,
} from "./models";

export function createCardQueryRow(card: CardState): Readonly<Record<string, unknown>> {
  return {
    card_id: card.card_id,
    front_text: card.front_text,
    back_text: card.back_text,
    tags: card.tags,
    effort_level: card.effort_level,
    due_at: card.due_at,
    created_at: card.created_at,
    reps: card.reps,
    lapses: card.lapses,
    fsrs_card_state: card.fsrs_card_state,
    fsrs_step_index: card.fsrs_step_index,
    fsrs_stability: card.fsrs_stability,
    fsrs_difficulty: card.fsrs_difficulty,
    fsrs_last_reviewed_at: card.fsrs_last_reviewed_at,
    fsrs_scheduled_days: card.fsrs_scheduled_days,
    client_updated_at: card.client_updated_at,
    last_modified_by_replica_id: card.last_modified_by_replica_id,
    last_operation_id: card.last_operation_id,
    updated_at: card.updated_at,
    deleted_at: card.deleted_at,
  };
}

export function createDeckQueryRow(deck: DeckState): Readonly<Record<string, unknown>> {
  return {
    deck_id: deck.deck_id,
    workspace_id: deck.workspace_id,
    name: deck.name,
    filter_definition: deck.filter_definition,
    created_at: deck.created_at,
    client_updated_at: deck.client_updated_at,
    last_modified_by_replica_id: deck.last_modified_by_replica_id,
    last_operation_id: deck.last_operation_id,
    updated_at: deck.updated_at,
    deleted_at: deck.deleted_at,
  };
}

export function createReviewEventQueryRow(reviewEvent: ReviewEventState): Readonly<Record<string, unknown>> {
  return {
    review_event_id: reviewEvent.review_event_id,
    workspace_id: reviewEvent.workspace_id,
    card_id: reviewEvent.card_id,
    replica_id: reviewEvent.replica_id,
    client_event_id: reviewEvent.client_event_id,
    rating: reviewEvent.rating,
    reviewed_at_client: reviewEvent.reviewed_at_client,
    reviewed_at_server: reviewEvent.reviewed_at_server,
  };
}
