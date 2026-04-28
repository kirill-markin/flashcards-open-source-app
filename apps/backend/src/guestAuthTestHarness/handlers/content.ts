import type pg from "pg";
import {
  type CardState,
  type DeckState,
  type GuestUpgradeExecutorParam,
  type GuestUpgradeHandlerContext,
  type ReviewEventState,
} from "../models";
import { createQueryResult } from "../queryResult";
import {
  createCardQueryRow,
  createDeckQueryRow,
  createReviewEventQueryRow,
} from "../rowShapes";

export function handleContentExecutorQuery<Row extends pg.QueryResultRow>(
  context: GuestUpgradeHandlerContext,
  text: string,
  params: ReadonlyArray<GuestUpgradeExecutorParam>,
): pg.QueryResult<Row> | null {
  const { state } = context;

  if (text.startsWith("SELECT") && text.includes("FROM content.cards")) {
    const workspaceId = params[0];
    if (typeof workspaceId !== "string") {
      return createQueryResult<Row>([]);
    }

    const cardId = text.includes("WHERE workspace_id = $1 AND card_id = $2")
      ? (typeof params[1] === "string" ? params[1] : null)
      : null;
    const rows = state.cards
      .filter((card) => (
        card.workspace_id === workspaceId
        && (cardId === null || card.card_id === cardId)
      ))
      .sort((left, right) => left.created_at.localeCompare(right.created_at) || left.card_id.localeCompare(right.card_id))
      .map((card) => createCardQueryRow(card) as unknown as Row);
    return createQueryResult<Row>(rows);
  }

  if (text.startsWith("SELECT") && text.includes("FROM content.decks")) {
    const workspaceId = params[0];
    if (typeof workspaceId !== "string") {
      return createQueryResult<Row>([]);
    }

    const deckId = text.includes("WHERE workspace_id = $1 AND deck_id = $2")
      ? (typeof params[1] === "string" ? params[1] : null)
      : null;
    const rows = state.decks
      .filter((deck) => (
        deck.workspace_id === workspaceId
        && (deckId === null || deck.deck_id === deckId)
      ))
      .sort((left, right) => left.created_at.localeCompare(right.created_at) || left.deck_id.localeCompare(right.deck_id))
      .map((deck) => createDeckQueryRow(deck) as unknown as Row);
    return createQueryResult<Row>(rows);
  }

  if (text.startsWith("SELECT") && text.includes("FROM content.review_events")) {
    const workspaceId = params[0];
    if (typeof workspaceId !== "string") {
      return createQueryResult<Row>([]);
    }

    const reviewEventId = text.includes("review_event_id = $2")
      ? (typeof params[1] === "string" ? params[1] : null)
      : null;
    const replicaId = text.includes("replica_id = $3")
      ? (typeof params[2] === "string" ? params[2] : null)
      : null;
    const clientEventId = text.includes("client_event_id = $4")
      ? (typeof params[3] === "string" ? params[3] : null)
      : null;
    const rows = state.reviewEvents
      .filter((reviewEvent) => {
        if (reviewEvent.workspace_id !== workspaceId) {
          return false;
        }

        if (reviewEventId === null && replicaId === null && clientEventId === null) {
          return true;
        }

        return reviewEvent.review_event_id === reviewEventId
          || (
            replicaId !== null
            && clientEventId !== null
            && reviewEvent.replica_id === replicaId
            && reviewEvent.client_event_id === clientEventId
          );
      })
      .sort((left, right) => left.reviewed_at_server.localeCompare(right.reviewed_at_server) || left.review_event_id.localeCompare(right.review_event_id))
      .map((reviewEvent) => createReviewEventQueryRow(reviewEvent) as unknown as Row);
    return createQueryResult<Row>(rows);
  }

  if (
    text === "DELETE FROM content.review_events WHERE workspace_id = $1"
    || text === "DELETE FROM content.decks WHERE workspace_id = $1"
    || text === "DELETE FROM content.cards WHERE workspace_id = $1"
  ) {
    const workspaceId = String(params[0]);
    if (text.includes("content.review_events")) {
      state.reviewEvents = state.reviewEvents.filter((reviewEvent) => reviewEvent.workspace_id !== workspaceId);
    } else if (text.includes("content.decks")) {
      state.decks = state.decks.filter((deck) => deck.workspace_id !== workspaceId);
    } else {
      state.cards = state.cards.filter((card) => card.workspace_id !== workspaceId);
    }
    return createQueryResult<Row>([]);
  }

  if (
    text.startsWith("INSERT INTO content.cards")
    && text.includes("ON CONFLICT DO NOTHING")
  ) {
    const cardId = String(params[0]);
    const workspaceId = String(params[1]);
    const existingCard = state.cards.find((card) => card.card_id === cardId);
    if (existingCard !== undefined) {
      return createQueryResult<Row>([]);
    }

    const insertedCard: CardState = {
      card_id: cardId,
      workspace_id: workspaceId,
      front_text: String(params[2]),
      back_text: String(params[3]),
      tags: Array.isArray(params[4]) ? params[4].map(String) : [],
      effort_level: String(params[5]),
      due_at: params[6] === null ? null : String(params[6]),
      created_at: String(params[7]),
      reps: Number(params[8]),
      lapses: Number(params[9]),
      fsrs_card_state: String(params[10]),
      fsrs_step_index: params[11] === null ? null : Number(params[11]),
      fsrs_stability: params[12] === null ? null : Number(params[12]),
      fsrs_difficulty: params[13] === null ? null : Number(params[13]),
      fsrs_last_reviewed_at: params[14] === null ? null : String(params[14]),
      fsrs_scheduled_days: params[15] === null ? null : Number(params[15]),
      client_updated_at: String(params[16]),
      last_modified_by_replica_id: String(params[17]),
      last_operation_id: String(params[18]),
      updated_at: String(params[16]),
      deleted_at: params[19] === null ? null : String(params[19]),
    };
    state.cards.push(insertedCard);
    return createQueryResult<Row>([createCardQueryRow(insertedCard) as unknown as Row]);
  }

  if (text.startsWith("UPDATE content.cards")) {
    const workspaceId = String(params[17]);
    const cardId = String(params[18]);
    const index = state.cards.findIndex((card) => card.workspace_id === workspaceId && card.card_id === cardId);
    if (index === -1) {
      return createQueryResult<Row>([]);
    }

    const current = state.cards[index];
    if (current === undefined) {
      return createQueryResult<Row>([]);
    }

    const updatedCard: CardState = {
      ...current,
      front_text: String(params[0]),
      back_text: String(params[1]),
      tags: Array.isArray(params[2]) ? params[2].map(String) : [],
      effort_level: String(params[3]),
      due_at: params[4] === null ? null : String(params[4]),
      reps: Number(params[5]),
      lapses: Number(params[6]),
      fsrs_card_state: String(params[7]),
      fsrs_step_index: params[8] === null ? null : Number(params[8]),
      fsrs_stability: params[9] === null ? null : Number(params[9]),
      fsrs_difficulty: params[10] === null ? null : Number(params[10]),
      fsrs_last_reviewed_at: params[11] === null ? null : String(params[11]),
      fsrs_scheduled_days: params[12] === null ? null : Number(params[12]),
      deleted_at: params[13] === null ? null : String(params[13]),
      client_updated_at: String(params[14]),
      last_modified_by_replica_id: String(params[15]),
      last_operation_id: String(params[16]),
      updated_at: String(params[14]),
    };
    state.cards[index] = updatedCard;
    return createQueryResult<Row>([createCardQueryRow(updatedCard) as unknown as Row]);
  }

  if (
    text.startsWith("INSERT INTO content.decks")
    && text.includes("ON CONFLICT DO NOTHING")
  ) {
    const deckId = String(params[0]);
    const workspaceId = String(params[1]);
    const existingDeck = state.decks.find((deck) => deck.deck_id === deckId);
    if (existingDeck !== undefined) {
      return createQueryResult<Row>([]);
    }

    const insertedDeck: DeckState = {
      deck_id: deckId,
      workspace_id: workspaceId,
      name: String(params[2]),
      filter_definition: JSON.parse(String(params[3])) as Readonly<Record<string, unknown>>,
      created_at: String(params[4]),
      client_updated_at: String(params[5]),
      last_modified_by_replica_id: String(params[6]),
      last_operation_id: String(params[7]),
      updated_at: String(params[5]),
      deleted_at: params[8] === null ? null : String(params[8]),
    };
    state.decks.push(insertedDeck);
    return createQueryResult<Row>([createDeckQueryRow(insertedDeck) as unknown as Row]);
  }

  if (text.startsWith("UPDATE content.decks")) {
    const workspaceId = String(params[7]);
    const deckId = String(params[8]);
    const index = state.decks.findIndex((deck) => deck.workspace_id === workspaceId && deck.deck_id === deckId);
    if (index === -1) {
      return createQueryResult<Row>([]);
    }

    const current = state.decks[index];
    if (current === undefined) {
      return createQueryResult<Row>([]);
    }

    const updatedDeck: DeckState = {
      ...current,
      name: String(params[0]),
      filter_definition: JSON.parse(String(params[1])) as Readonly<Record<string, unknown>>,
      created_at: String(params[2]),
      deleted_at: params[3] === null ? null : String(params[3]),
      client_updated_at: String(params[4]),
      last_modified_by_replica_id: String(params[5]),
      last_operation_id: String(params[6]),
      updated_at: String(params[4]),
    };
    state.decks[index] = updatedDeck;
    return createQueryResult<Row>([createDeckQueryRow(updatedDeck) as unknown as Row]);
  }

  if (
    text.startsWith("INSERT INTO content.review_events")
    && text.includes("ON CONFLICT DO NOTHING")
  ) {
    const reviewEventId = String(params[0]);
    const workspaceId = String(params[1]);
    const replicaId = String(params[3]);
    const clientEventId = String(params[4]);
    const existingReviewEvent = state.reviewEvents.find((reviewEvent) => (
      reviewEvent.review_event_id === reviewEventId
      || (
        reviewEvent.workspace_id === workspaceId
        && reviewEvent.replica_id === replicaId
        && reviewEvent.client_event_id === clientEventId
      )
    ));
    if (existingReviewEvent !== undefined) {
      return createQueryResult<Row>([]);
    }

    const insertedReviewEvent: ReviewEventState = {
      review_event_id: reviewEventId,
      workspace_id: workspaceId,
      card_id: String(params[2]),
      replica_id: replicaId,
      client_event_id: clientEventId,
      rating: Number(params[5]),
      reviewed_at_client: String(params[6]),
      reviewed_at_server: String(params[7]),
    };
    state.reviewEvents.push(insertedReviewEvent);
    return createQueryResult<Row>([createReviewEventQueryRow(insertedReviewEvent) as unknown as Row]);
  }

  return null;
}
