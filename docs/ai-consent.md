# AI consent receipts

`POST /v1/ai/consent` uses the existing native guest or signed-in human request context. The
[input contract](../apps/backend/src/aiConsent/input.ts) owns the disclosure version, validation,
and flat receipt response. The actor is the verified application user ID; body identity fields
never choose an actor. This legal ledger is independent of analytics preferences and events.

Send these required fields:

| Field | Type and meaning |
| --- | --- |
| `eventId` | UUID created once for this action; reuse unchanged on retry |
| `installationId` | Stable installation UUID |
| `action` | `grant` or `withdraw` |
| `decisionSequence` | Positive JavaScript-safe integer; increase for every action on this person's installation |
| `occurredAt` | RFC3339 client action time with a timezone |
| `disclosureVersion` | Current version from the input contract |
| `locale` | Displayed disclosure's language tag |
| `disclosureText` | Exact localized text displayed to the person, including the provider and purposes |
| `appVersion`, `appBuild` | Nonempty strings |
| `platform` | `ios`, `macos`, `android`, or `web` |

A successful request returns HTTP 200 with `eventId`, `installationId`, `action`,
`decisionSequence`, `disclosureVersion`, `occurredAt`, and `receivedAt`. UUIDs and both times are
strings; sequence is a number. Times are normalized UTC ISO strings. `receivedAt` is assigned by
PostgreSQL on the first insert and remains unchanged on every retry. Reusing an event ID with
changed evidence or reusing a decision sequence for another event returns 409. Invalid input
returns 400 through the existing error envelope (`error`, `code`, `requestId`).

Store pending decisions under the verified local actor, and submit them only under that actor's
credential. Account switching must never send the previous person's pending queue. Continue the
sequence through the same person's guest upgrade; submit pending guest decisions before merging.
The server accepts delayed lower sequences as historical evidence, but they cannot supersede a
higher decision. Client and server timestamps are evidence, never decision ordering.

Send `X-AI-Consent-Id: <grant eventId>` on `POST /v1/chat` and `POST /v1/chat/transcriptions`.
The [active receipt check](../apps/backend/src/aiConsent/index.ts) requires ownership, the supported
disclosure version, and the sole highest installation decision to be that grant. Invalid UUID
headers return 400 `AI_CONSENT_ID_INVALID`; withdrawn, superseded, unsupported, foreign, or
missing supplied receipts return 403 `AI_CONSENT_REQUIRED`. History, session management, file
upload staging, and stop remain available. An omitted header preserves released clients.

Chat persists the optional receipt on `ai.chat_runs`. Every new model attempt, image attempt, and
terminal follow-up suggestion rechecks it before contacting OpenAI. Receipt-bearing model,
transcription, and suggestion calls disable internal SDK retries and make at most three explicit
attempts, rechecking before each send and honoring the SDK's retry hints and bounded backoff. The
existing empty-stream overload retry remains separate and rechecks each send as well. A withdrawal refuses later
calls; an already-started provider request can finish. Follow-up suggestions are skipped after
withdrawal. The client can also use the existing stop endpoint for a running turn. Regranting
creates a new receipt; it does not reactivate a superseded receipt on an older run.

The [migration](../db/migrations/0180_ai_consent_receipts.sql) stores original server actor identity,
installation, immutable evidence, OpenAI/provider purposes, and both timestamps. Only the identity's
current owner moves through verified guest upgrade. Bound guest upgrades keep the same identity.
Merged guest identities retain their decisions and become accessible to the destination account.
If pre-merge streams have tied highest sequences, neither grant authorizes calls until a higher
decision is recorded. Analytics-only identity linking refuses a guest holding consent receipts and
requires the normal upgrade instead.

Receipts survive withdrawal for the account/guest lifetime. Account deletion and guest deletion
remove the corresponding `org.user_settings` row, cascading through consent identities to all
their decisions, including transferred guest history. No identifiable legal receipt is retained
after that deletion. There is no reconstruction of acceptance time from old local Boolean values.
Reporting access is column-scoped through `reporting_readonly`, as with the existing operational
data; no new admin UI is involved.

Before rolling out another disclosure version, define acceptance semantics for exact event retries
and delayed withdrawals carrying the previous version. Current input accepts only the version in
the input contract; a future rollout must settle that ordering before changing it.

## Deployment verification

The cloud PostgreSQL runner selects
[`consent.postgres.integration.ts`](../apps/backend/src/aiConsent/consent.postgres.integration.ts)
at migration `0180` in
[`boundaries.mjs`](../apps/backend/scripts/postgresIntegrations/boundaries.mjs). AWS/Web Release
runs it against PostgreSQL 18 before deployment. It exercises real guest-authenticated HTTP and
the runtime role, immutable timestamp replay, ownership isolation, out-of-order withdrawal,
regrant, chat-run receipt persistence, readable history/stop, tied guest/destination sequences through
guest merge and higher-decision recovery, and deletion cascades.

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
