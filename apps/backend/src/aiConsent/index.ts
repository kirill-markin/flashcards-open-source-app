import {
  transactionWithUserScope,
  type DatabaseExecutor,
} from "../database";
import { HttpError } from "../shared/errors";
import { activeGuestSessionOwnerPredicateSql } from "../guestAuth/shared";
import { currentAiDisclosureVersion, type AiConsentInput, type AiConsentReceipt } from "./input";

type ConsentEventRow = Readonly<{
  event_id: string;
  installation_id: string;
  action: "grant" | "withdraw";
  decision_sequence: string;
  disclosure_version: string;
  locale: string;
  disclosure_text: string;
  app_version: string;
  app_build: string;
  platform: AiConsentInput["platform"];
  occurred_at: Date;
  received_at: Date;
}>;

function receiptFromRow(row: ConsentEventRow): AiConsentReceipt {
  return {
    eventId: row.event_id,
    installationId: row.installation_id,
    action: row.action,
    decisionSequence: Number(row.decision_sequence),
    disclosureVersion: row.disclosure_version,
    occurredAt: row.occurred_at.toISOString(),
    receivedAt: row.received_at.toISOString(),
  };
}

function assertSameDecision(row: ConsentEventRow, input: AiConsentInput): void {
  if (
    row.installation_id !== input.installationId || row.action !== input.action
    || Number(row.decision_sequence) !== input.decisionSequence
    || row.disclosure_version !== input.disclosureVersion || row.locale !== input.locale
    || row.disclosure_text !== input.disclosureText || row.app_version !== input.appVersion
    || row.app_build !== input.appBuild || row.platform !== input.platform
    || row.occurred_at.toISOString() !== input.occurredAt
  ) {
    throw new HttpError(409, "This consent event ID already records a different decision. Retry the original event unchanged.", "AI_CONSENT_EVENT_CONFLICT");
  }
}

export async function recordAiConsentInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  input: AiConsentInput,
  guestSessionId: string | null,
): Promise<AiConsentReceipt> {
  // Shares the profile lock taken by guest upgrade and deletion, keeping the actor stable until commit.
  const profile = await executor.query<Readonly<{ user_id: string }>>(
    "SELECT user_id FROM org.user_settings WHERE user_id = $1 FOR UPDATE", [userId],
  );
  if (profile.rows.length === 0) {
    throw new HttpError(410, "The consent identity is no longer active. Sign in again.", "AI_CONSENT_IDENTITY_DELETED");
  }
  if (guestSessionId !== null) {
    const session = await executor.query<Readonly<{ session_id: string }>>(
      `SELECT session_id FROM auth.guest_sessions WHERE ${activeGuestSessionOwnerPredicateSql} FOR SHARE`,
      [guestSessionId, userId],
    );
    if (session.rows.length === 0) {
      throw new HttpError(410, "The guest consent credential has been retired. Sign in again before submitting decisions.", "AI_CONSENT_IDENTITY_DELETED");
    }
  }
  const existing = await executor.query<ConsentEventRow>(
    "SELECT * FROM ai.consent_events WHERE event_id = $1", [input.eventId],
  );
  const previous = existing.rows[0];
  if (previous !== undefined) {
    assertSameDecision(previous, input);
    return receiptFromRow(previous);
  }

  const sequence = await executor.query<Readonly<{ event_id: string }>>(
    "SELECT event_id FROM ai.consent_events WHERE installation_id = $1 AND decision_sequence = $2",
    [input.installationId, input.decisionSequence],
  );
  if (sequence.rows.length > 0) {
    throw new HttpError(409, "This installation decision sequence is already recorded. Use a higher sequence for a new decision.", "AI_CONSENT_SEQUENCE_CONFLICT");
  }
  await executor.query(
    "INSERT INTO ai.consent_identities (actor_user_id, user_id) VALUES ($1, $1) ON CONFLICT DO NOTHING",
    [userId],
  );
  const inserted = await executor.query<ConsentEventRow>(
    `INSERT INTO ai.consent_events (
       event_id, actor_user_id, installation_id, action, decision_sequence, occurred_at,
       disclosure_version, locale, disclosure_text, provider, purposes, app_version, app_build, platform
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'openai',
               ARRAY['chat', 'transcription', 'image_generation']::text[], $10, $11, $12)
     ON CONFLICT DO NOTHING RETURNING *`,
    [input.eventId, userId, input.installationId, input.action, input.decisionSequence,
      input.occurredAt, input.disclosureVersion, input.locale, input.disclosureText,
      input.appVersion, input.appBuild, input.platform],
  );
  const row = inserted.rows[0];
  if (row === undefined) {
    throw new HttpError(409, "This consent event ID is unavailable. Submit a new event UUID for this identity.", "AI_CONSENT_EVENT_CONFLICT");
  }
  return receiptFromRow(row);
}

export function recordAiConsent(
  userId: string,
  input: AiConsentInput,
  guestSessionId: string | null,
): Promise<AiConsentReceipt> {
  return transactionWithUserScope({ userId }, (executor) => recordAiConsentInExecutor(executor, userId, input, guestSessionId));
}

export async function assertAiConsentReceiptActiveInExecutor(
  executor: DatabaseExecutor,
  eventId: string,
): Promise<void> {
  const result = await executor.query<Readonly<{ active: boolean }>>(
    `SELECT receipt.action = 'grant' AND receipt.disclosure_version = $2
       AND NOT EXISTS (
         SELECT 1 FROM ai.consent_events AS newer
         WHERE newer.installation_id = receipt.installation_id
           AND newer.event_id <> receipt.event_id
           AND newer.decision_sequence >= receipt.decision_sequence
       ) AS active
     FROM ai.consent_events AS receipt WHERE receipt.event_id = $1`,
    [eventId, currentAiDisclosureVersion],
  );
  if (result.rows[0]?.active !== true) {
    throw new HttpError(403, "AI consent is withdrawn, superseded, or belongs to another identity. Review the disclosure and grant consent before retrying.", "AI_CONSENT_REQUIRED");
  }
}

export async function assertAiConsentReceiptActive(userId: string, eventId: string | null): Promise<void> {
  if (eventId === null) return;
  await transactionWithUserScope({ userId }, (executor) => assertAiConsentReceiptActiveInExecutor(executor, eventId));
}

export async function transferGuestAiConsentInExecutor(
  executor: DatabaseExecutor,
  guestUserId: string,
  targetUserId: string,
): Promise<void> {
  await executor.query("SELECT ai.transfer_guest_consent($1, $2)", [guestUserId, targetUserId]);
}
