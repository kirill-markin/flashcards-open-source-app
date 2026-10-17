# AI consent receipts

`POST /v1/ai/consent` records a legal ledger of AI disclosure decisions, independent of analytics preferences and events, under the native guest or signed-in human request context. The [input contract](../apps/backend/src/aiConsent/input.ts) owns the fields, the current disclosure version and the receipt; [the ledger](../apps/backend/src/aiConsent/index.ts) owns conflicts and the active-receipt check; [the migration](../db/migrations/0180_ai_consent_receipts.sql) owns storage, guest transfer and deletion. The actor is always the verified application user; body fields never choose one.

## Client contract

- Create `eventId` once per action and retry it unchanged; `receivedAt` stays the first insert's on every retry. Increase `decisionSequence` for every action on this person's installation. `disclosureText` is the exact localized text displayed to the person, provider and purposes included.
- Store pending decisions under the verified local actor and submit them only under that actor's credential, so an account switch never sends the previous person's queue. Continue the sequence through the same person's guest upgrade, and submit pending guest decisions before merging.
- Decisions are ordered by sequence alone; client and server timestamps are evidence. A delayed lower sequence is kept as history and cannot supersede a higher decision.
- Send `X-AI-Consent-Id: <grant eventId>` on `POST /v1/chat` and `POST /v1/chat/transcriptions`. The receipt must be the caller's own, of the current disclosure version, and the installation's sole highest decision, else the call returns 403 `AI_CONSENT_REQUIRED`; history, session management, file upload staging and stop stay available. An omitted header is accepted, for released clients.
- Regranting creates a new receipt; it does not reactivate a superseded receipt on an older run.

## Server behavior

- Chat persists the receipt on `ai.chat_runs`, and every model, image, transcription and follow-up suggestion call that carries one rechecks it before each send to OpenAI, retries included; that is why those calls disable the SDK's own retries. A withdrawal refuses later calls, while an already-started provider request can finish.
- Merged guest identities keep their decisions for the destination account. If two pre-merge streams tie on the highest sequence, neither grant authorizes calls until a higher decision is recorded. Analytics-only identity linking refuses a guest holding receipts and requires the normal upgrade.
- Receipts survive withdrawal for the account or guest lifetime; deleting the account or guest removes all of them, transferred guest history included, and no acceptance time is reconstructed from old local Boolean values. Reporting reads them column-scoped through `reporting_readonly`; no admin UI shows them.
- Before rolling out another disclosure version, define acceptance semantics for exact event retries and delayed withdrawals carrying the previous version; until then the input contract accepts only the current one.

## Deployment verification

AWS/Web Release runs [`consent.postgres.integration.ts`](../apps/backend/src/aiConsent/consent.postgres.integration.ts) against PostgreSQL 18, selected at migration `0180` in [`boundaries.mjs`](../apps/backend/scripts/postgresIntegrations/boundaries.mjs).

After deployment, use a disposable native guest/account:

1. Grant with the actual displayed disclosure. Retry the identical event and confirm identical
   `receivedAt`. Send chat and dictation with that receipt.
2. Withdraw with a higher sequence. Both producing endpoints must return `AI_CONSENT_REQUIRED`
   for the old receipt, while history and stop still work. Withdraw during a multi-call turn and
   confirm that no later model/image/suggestion attempt starts; already-started requests may finish.
3. Regrant with a higher sequence and send a new turn with the new receipt. Merge the guest into
   its account and repeat the original event; both timestamps must remain unchanged.
4. Use the [read-only database procedure](analytics-db-access.md) to inspect persisted evidence:

   ```sql
   SELECT events.event_id, events.action, events.decision_sequence,
          events.disclosure_version, events.locale, events.occurred_at, events.received_at
   FROM ai.consent_events AS events
   JOIN ai.consent_identities AS identities USING (actor_user_id)
   WHERE identities.user_id = '<disposable-app-user-id>'
   ORDER BY events.installation_id, events.decision_sequence;
   ```

5. Delete the disposable account through Settings and confirm that the query returns no consent
   records or identities for it. Exercise an omitted-header request with a supported released client.
