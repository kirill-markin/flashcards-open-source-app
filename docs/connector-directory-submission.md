# Connector / MCP Directory Submission Package

Versioned submission copy for listing the remote MCP server in connector
directories (for example the Anthropic Connectors Directory and the OpenAI Apps
directory). Same spirit as
[app-store-connect-metadata.md](app-store-connect-metadata.md) and
[google-play-store-metadata.md](google-play-store-metadata.md): keep the listing
copy, reviewer walkthrough, example prompts, and per-directory checklist
versioned and reusable.

This package describes the hosted reference deployment. Self-hosters serve the
same surface under their own domain; substitute their domain where the canonical
URLs appear.

## Listing metadata

- **Name:** Flashcards Open Source App
- **Tagline (≤55 chars):** Read and write your flashcards over SQL
- **Categories:** Productivity, Education
- **Icon:** repository icon, vector source at `apps/web/public/icon.svg`
  (512×512 viewBox) with a 512×512 rasterized preview at
  `apps/web/public/icon-preview.png` (also published on the marketing site).
  If a directory requires a PNG at a larger export size, derive it from
  `icon.svg`.
- **Documentation URL:** https://flashcards-open-source-app.com/docs/api/
- **Privacy URL:** https://flashcards-open-source-app.com/privacy/
- **Support URL:** https://flashcards-open-source-app.com/support/
- **Terms URL:** https://flashcards-open-source-app.com/terms/
- **MCP server URL:** https://mcp.flashcards-open-source-app.com/mcp

### Description (≤2000 chars)

Flashcards Open Source App is an open-source, offline-first spaced-repetition
study app for iOS, Android, web, and AI agents. This connector exposes your
flashcard data to an AI client through a remote MCP server so the assistant can
read and write your cards and decks on your behalf.

After you authorize the connector, the assistant works against your own
workspaces. It can list your workspaces, inspect the available tables, read
cards that are due for review, and create or edit cards and decks for you. The
data surface is a small, intentionally limited SQL dialect (it is not full
PostgreSQL): reads use `SHOW TABLES`, `DESCRIBE`, `SHOW COLUMNS`, and `SELECT`,
and writes use `INSERT`, `UPDATE`, and `DELETE`. Reads and writes are split into
two separate tools so a single tool never mixes safe and destructive
operations.

Every card follows one simple contract: the front is only a question or review
prompt (never the answer), and the back holds the answer (optionally with a
concrete example). The assistant uses this contract when it generates new cards,
so the cards it creates are immediately reviewable with spaced repetition.

The whole stack — app, backend, and infrastructure — is open source on GitHub
and can be self-hosted, so you can run the same connector against your own
deployment. Reads are capped at 100 rows per statement and writes at 100 rows
per statement to keep responses small and operations reviewable.

Source: https://github.com/kirill-markin/flashcards-open-source-app

## Authentication

Two authorization paths reach the same per-user data surface.

- **Interactive (directory clients): OAuth 2.1.** The remote MCP server at
  `https://mcp.flashcards-open-source-app.com/mcp` implements the
  authorization-code flow with PKCE and Dynamic Client Registration. Directory
  clients add the MCP URL as a custom connector and authorize in the browser; no
  client secret is pre-shared. Discovery is standard:
  - Protected-resource metadata:
    `https://mcp.flashcards-open-source-app.com/.well-known/oauth-protected-resource`
  - Authorization-server metadata:
    `https://auth.flashcards-open-source-app.com/.well-known/oauth-authorization-server`
- **Headless / agent (CLI, scripts): `fca_` API key Bearer token.** Obtain a
  long-lived agent API key through the email-OTP login flow (see the reviewer
  walkthrough), then send `Authorization: Bearer fca_…`. This is the same key
  the REST agent surface accepts, and it needs no browser or OAuth round-trip.

The canonical machine-readable description of both paths is the discovery
payload at `https://api.flashcards-open-source-app.com/v1/` (mirrored at
`/v1/agent`).

## Tool inventory

The remote MCP server exposes three tools. Reads and writes are split on
purpose.

| Tool | Purpose | Annotations |
| --- | --- | --- |
| `sql_query` | Read-only access to cards and decks (`SHOW TABLES`, `DESCRIBE`, `SHOW COLUMNS`, `SELECT`); every caller mutation is rejected at parse time by the statement-direction guard, so the only writes that can occur on this path are the system's own bounded FSRS repair-on-read, never anything the caller controls. | `readOnlyHint: true`, `idempotentHint: true`, `openWorldHint: false` |
| `sql_execute` | Write access to cards and decks (`INSERT`, `UPDATE`, `DELETE`) as an atomic batch. | `readOnlyHint: false`, `destructiveHint: true`, `openWorldHint: false` |
| `list_workspaces` | List the authenticated user's workspaces so the client can pick one before querying. | `readOnlyHint: true`, `idempotentHint: true`, `openWorldHint: false` |

### SQL DSL safety model

The free-form SQL tools are safe to approve because the surface is a contained,
parser-enforced DSL, not arbitrary database access:

- **Closed statement allowlist.** `sql_query` accepts only `SHOW TABLES`,
  `DESCRIBE`, `SHOW COLUMNS`, and `SELECT`; `sql_execute` accepts only `INSERT`,
  `UPDATE`, and `DELETE`. Anything else is rejected at parse time.
- **Only 4 published resources.** Statements can address just `workspace`,
  `cards`, `decks`, and `review_events` — there is no path to other tables.
- **Workspace-scoped.** Every statement is scoped to the caller's own workspace,
  so there is no cross-tenant or arbitrary-table access.
- **Parser-enforced dialect, not raw Postgres passthrough.** Input is parsed
  against the limited dialect rather than forwarded to the database as raw SQL.
- **Bounded caps.** At most 100 rows per statement, at most 50 statements per
  batch, and a ~12k-token result-size cap; mutation batches are atomic.
- **Contractual read/write split.** The split is encoded in the tool
  annotations: `sql_query` and `list_workspaces` are `readOnlyHint`, while
  `sql_execute` is `destructiveHint`, so a single tool never mixes safe and
  destructive operations.

Enforcement lives in `apps/backend/src/aiTools/agentSql.ts`,
`apps/backend/src/aiTools/agentSql/shared.ts`, and
`apps/backend/src/aiTools/toolContract/sqlToolLimits.ts`.

## Reviewer test walkthrough

### Obtain access (email OTP flow)

The reviewer demo email plus its placeholder code/password are supplied
privately through each directory's submission portal and are never committed to
this repository.

1. Send a one-time code to the reviewer email:
   `POST https://auth.flashcards-open-source-app.com/api/agent/send-code` with
   `{ "email": "<reviewer-email>" }`. Configured review/demo accounts receive a
   deterministic 8-digit placeholder code and no email is sent; normal accounts
   receive the 8-digit code by email.
2. Exchange the code for an agent API key:
   `POST https://auth.flashcards-open-source-app.com/api/agent/verify-code` with
   the returned `otpSessionToken`, the `code`, and a `label`. The response
   includes an `fca_…` API key.
3. For an interactive directory client instead, add the MCP URL
   (`https://mcp.flashcards-open-source-app.com/mcp`) as a custom connector and
   complete the OAuth browser flow.

### Demo workspace data to expect

A configured review/demo account is seeded with at least one workspace
containing a handful of decks and cards, including some cards due today. Each
card follows the front/back contract: the front is a prompt only, the back is
the answer. Expect a small dataset suitable for verifying reads, a due-cards
query, and a single card insert.

### End-to-end script (web and mobile)

The same API works from a desktop client and from the mobile apps signed into
the same account; data created over the connector appears in the iOS, Android,
and web clients after sync.

1. Call `list_workspaces` and note a `workspaceId`.
2. Run `sql_query` with `SHOW TABLES` to see the available tables.
3. Run `sql_query` with a `SELECT` for cards due today (see example prompts).
4. Run `sql_execute` with a single `INSERT` to add one card, respecting the
   front/back contract.
5. Run `sql_query` again to confirm the new card is present.
6. Open the iOS, Android, or web app signed into the same account, sync, and
   confirm the card created in step 4 is visible.

## Example prompts

Three representative prompts and their expected outcomes.

1. **"List my workspaces."**
   The client calls `list_workspaces` and returns the user's workspaces with
   their ids and names. No data is modified.
2. **"Show 5 cards due for review today."**
   The client calls `sql_query` with a `SELECT` over the cards table filtered to
   due cards, limited to 5 rows, and returns the front prompts (and ids). No
   data is modified.
3. **"Add a card: front 'Capital of France?', back 'Paris'."**
   The client calls `sql_execute` with a single `INSERT` that sets the front to
   the question prompt and the back to the answer, then confirms one row was
   written. A follow-up `sql_query` can verify it.

## Submission targets

Submit in this order. The official MCP Registry comes first because it is the
canonical source for MCP `server.json` metadata; PulseMCP builds on upstream
registry entries and its ingestion/re-enrichment runs on daily/weekly cycles,
so downstream discovery works best after the official entry is live.

Verify the official registry entry before submitting to the other directories:

```bash
curl -fsS 'https://registry.modelcontextprotocol.io/v0.1/servers/com.flashcards-open-source-app%2Fflashcards/versions/latest'
```

Success means the command returns a JSON entry for
`com.flashcards-open-source-app/flashcards`. Failure means the submission is not
ready for downstream directories; a `404 Server not found` response means the
entry is not published, the server name is wrong, or the registry publish failed.

| Order | Target | Required URL | Auth / review notes | What to paste |
| --- | --- | --- | --- | --- |
| 1 | Official MCP Registry | https://registry.modelcontextprotocol.io/ | Publish and verify the root `server.json`; no reviewer credentials. | `server.json` metadata: name, title, description/tagline, version, website, icon, repository, and MCP server URL. |
| 2 | Smithery | https://smithery.ai/new | Directory account / GitHub ownership as requested; no shared credentials unless review requires them. | Listing name, tagline, categories, icon, docs, privacy, support, terms, source URL, and MCP server URL from the metadata above. |
| 3 | PulseMCP | https://www.pulsemcp.com/submit | Check whether the official registry entry has already been ingested before filing a manual submission. | Reuse the same listing metadata and point to the official registry entry when available. |
| 4 | Glama | https://glama.ai/mcp/servers | Claim or submit the server using the public repository and hosted MCP URL. | Reuse the concise listing metadata; avoid duplicating the long description unless the form requires it. |
| 5 | MCP.Directory | https://mcp.directory/submit | Submitter account and manual moderation may be required. | Reuse name, tagline, categories, icon, docs, privacy, support, terms, source URL, and MCP server URL. |
| 6 | mcpservers.org | https://mcpservers.org/submit | Submitter account and manual moderation may be required. | Reuse the same listing metadata and source URL. |
| 7 | mcp.so | https://mcp.so/ | Use the site's current submit/claim flow if available. | Reuse the same listing metadata and source URL. |
| 8 | Anthropic Connectors Directory | https://claude.com/docs/connectors/building/submission | Review-heavy product directory: OAuth, tool annotations, policy checks, and reviewer access are evaluated. | Paste listing metadata, tool inventory, allowed links if requested, and private reviewer credentials only in the submission portal. |
| 9 | OpenAI Apps Directory | https://developers.openai.com/apps-sdk/deploy/submission | Review-heavy product directory: dashboard review, verified organization, global data residency, OAuth, and live testing are evaluated. | Paste listing metadata, MCP server URL, tool information, test prompts, screenshots if requested, and private reviewer credentials only in the submission portal. |

## Per-directory submission checklist

Single place for the human submitter to track directory-specific requirements.
These mirror the directories' published expectations; confirm current
requirements against each directory's own documentation at submission time.

### Anthropic Connectors Directory

- [ ] Remote MCP server reachable at the published HTTPS URL with valid TLS.
- [ ] OAuth 2.1 authorization-code + PKCE + Dynamic Client Registration verified
      end-to-end from a fresh client.
- [ ] Tool annotations accurate (`readOnlyHint` / `destructiveHint` match real
      behavior).
- [ ] Listing metadata, icon, and the privacy / terms / support / docs URLs
      above provided.
- [ ] Domain ownership of `flashcards-open-source-app.com` demonstrable.
- [ ] Reviewer test account / walkthrough above shared with the reviewer.

### OpenAI Apps directory

- [ ] Remote MCP server reachable at the published HTTPS URL with valid TLS.
- [ ] OAuth authorization flow verified from the OpenAI client.
- [ ] Listing metadata, icon, and privacy / terms / support / docs URLs
      provided.
- [ ] Developer / organization verification completed as required.
- [ ] EU data-residency note: review the EU-residency requirement and document
      where the reference deployment processes data (AWS); self-hosters control
      their own region.
- [ ] Domain ownership of `flashcards-open-source-app.com` demonstrable.

## Registry manifest

The official MCP Registry entry for the remote server is published from the
root [`server.json`](../server.json). See
[mcp-registry-publishing.md](mcp-registry-publishing.md) for the publish flow.
