import type pg from "pg";
import {
  type GuestUpgradeExecutorParam,
  type GuestUpgradeHandlerContext,
} from "../models";
import { createQueryResult } from "../queryResult";
import { parseGuestUpgradeDroppedEntitiesState } from "../stateOperations";

export function handleAuthExecutorQuery<Row extends pg.QueryResultRow>(
  context: GuestUpgradeHandlerContext,
  text: string,
  params: ReadonlyArray<GuestUpgradeExecutorParam>,
): pg.QueryResult<Row> | null {
  const { state } = context;

  if (text.includes("FROM auth.guest_sessions")) {
    const requestedHash = params[0];
    const guestSession = state.guestSession;
    const rows = guestSession !== null && requestedHash === guestSession.session_secret_hash ? [{
      session_id: guestSession.session_id,
      user_id: guestSession.user_id,
      revoked_at: guestSession.revoked_at,
    } as unknown as Row] : [];
    return createQueryResult<Row>(rows);
  }

  if (
    text.includes("FROM auth.guest_upgrade_history")
    && text.includes("WHERE source_guest_session_id = $1")
  ) {
    const guestSessionId = params[0];
    const guestUpgradeHistory = typeof guestSessionId === "string"
      ? state.guestUpgradeHistory.find((row) => row.source_guest_session_id === guestSessionId)
      : undefined;
    const rows = guestUpgradeHistory === undefined ? [] : [{
      source_guest_session_id: guestUpgradeHistory.source_guest_session_id,
      target_subject_user_id: guestUpgradeHistory.target_subject_user_id,
      target_user_id: guestUpgradeHistory.target_user_id,
      target_workspace_id: guestUpgradeHistory.target_workspace_id,
      dropped_entities: guestUpgradeHistory.dropped_entities,
    } as unknown as Row];
    return createQueryResult<Row>(rows);
  }

  if (
    text.includes("FROM auth.guest_upgrade_history")
    && text.includes("WHERE source_guest_session_secret_hash = $1")
  ) {
    const guestSessionSecretHash = params[0];
    const guestUpgradeHistory = typeof guestSessionSecretHash === "string"
      ? state.guestUpgradeHistory.find((row) => row.source_guest_session_secret_hash === guestSessionSecretHash)
      : undefined;
    const rows = guestUpgradeHistory === undefined ? [] : [{
      source_guest_session_id: guestUpgradeHistory.source_guest_session_id,
      target_subject_user_id: guestUpgradeHistory.target_subject_user_id,
      target_user_id: guestUpgradeHistory.target_user_id,
      target_workspace_id: guestUpgradeHistory.target_workspace_id,
      dropped_entities: guestUpgradeHistory.dropped_entities,
    } as unknown as Row];
    return createQueryResult<Row>(rows);
  }

  if (text.includes("FROM auth.user_identities") && text.includes("provider_subject = $1")) {
    const providerSubject = params[0];
    const mappedUserId = typeof providerSubject === "string"
      ? state.identityMappings.get(providerSubject) ?? null
      : null;
    const rows = mappedUserId === null ? [] : [{ user_id: mappedUserId } as unknown as Row];
    return createQueryResult<Row>(rows);
  }

  if (text.includes("FROM auth.user_identities") && text.includes("user_id = $1")) {
    const userId = params[0];
    const hasMapping = typeof userId === "string"
      ? [...state.identityMappings.values()].some((mappedUserId) => mappedUserId === userId)
      : false;
    const rows = hasMapping ? [{ user_id: String(userId) } as unknown as Row] : [];
    return createQueryResult<Row>(rows);
  }

  if (text.includes("INSERT INTO auth.user_identities")) {
    const providerSubject = String(params[0]);
    const userId = String(params[1]);
    if (!state.identityMappings.has(providerSubject)) {
      state.identityMappings.set(providerSubject, userId);
    }
    return createQueryResult<Row>([]);
  }

  if (text.includes("INSERT INTO auth.guest_upgrade_history")) {
    state.guestUpgradeHistory.push({
      upgrade_id: String(params[0]),
      source_guest_user_id: String(params[1]),
      source_guest_workspace_id: String(params[2]),
      source_guest_session_id: String(params[3]),
      source_guest_session_secret_hash: String(params[4]),
      target_subject_user_id: String(params[5]),
      target_user_id: String(params[6]),
      target_workspace_id: String(params[7]),
      selection_type: String(params[8]),
      dropped_entities: params[9] === null
        ? null
        : parseGuestUpgradeDroppedEntitiesState(String(params[9])),
    });
    return createQueryResult<Row>([]);
  }

  if (text.includes("INSERT INTO auth.guest_replica_aliases")) {
    state.guestReplicaAliases.push({
      source_guest_replica_id: String(params[0]),
      upgrade_id: String(params[1]),
      target_replica_id: String(params[2]),
    });
    return createQueryResult<Row>([]);
  }

  if (text === "UPDATE auth.guest_sessions SET revoked_at = now() WHERE session_id = $1") {
    if (state.guestSession === null) {
      return createQueryResult<Row>([]);
    }

    state.guestSession = {
      ...state.guestSession,
      revoked_at: "2026-04-02T14:01:16.000Z",
    };
    return createQueryResult<Row>([]);
  }

  return null;
}
