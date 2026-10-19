# Sync Identity Model

The sync layer treats installation identity and workspace actor identity as two different concepts. The tables, columns and actor kinds are defined in [0035](../db/migrations/0035_sync_installations_and_workspace_replicas.sql) and the migrations that follow it.

## Installation Id

`installationId` is a stable UUID identifying a physical app installation or browser profile.

- It is generated once per Android install, iOS install, or browser profile.
- It is global across users and workspaces.
- It may change users over time without rewriting history.
- Clients send `installationId` on authenticated sync requests.

`sync.installations` stores this global client identity. These rows are not historical actors and must never be used as foreign keys from cards, decks, review events, scheduler settings, or sync logs. It also carries the automation and test-distribution markers a client declares about itself, documented in [Audience analytics](analytics-audience.md).

## Replica Id

`replicaId` is an immutable actor inside one workspace, stored in `sync.workspace_replicas`.

- Client replicas are derived from `(workspaceId, installationId)`.
- System replicas are derived from `(workspaceId, actorKind, actorKey)`; `workspace_reset`, for example, lets destructive scheduler-state resets stay workspace-scoped and auditable without pretending to be a client installation.
- History points to replicas, never to mutable installation rows.

Client-authenticated writes never send actor ids in payloads. The backend resolves the active workspace replica from `(workspaceId, installationId)` and stamps the canonical `replicaId` into stored rows and sync logs.

## Why The Split Exists

A single mutable device row that could move between workspaces broke historical integrity: cards, review history, scheduler metadata, and hot changes pointed at a row whose workspace ownership could later change. Keeping installations global and movable and replicas immutable and workspace-scoped lets one physical installation switch users, switch workspaces, return later, upgrade guest sessions, and delete workspaces without rewriting historical actor ownership.

## Entity Id Rules

Cards, decks, and review events use globally keyed ids. Guest upgrade and true workspace copy/fork flows handle those ids differently.

Guest upgrade preserves ids and merges already-synced guest cloud state into the selected destination workspace. Before calling `/guest-auth/upgrade/complete`, clients fully sync the guest workspace with guest authentication and verify that the local guest outbox is empty. Completion does not carry pending local operations through linked migration, does not depend on entity-id alias mappings, and clients must not fork guest ids before or after linked sync. After upgrade, clients continue syncing the same card, deck, review event, and media asset ids. Media assets merge as workspace-scoped `content.media_assets` registry rows only: each row keeps pointing at the same deduplicated `content.media_blobs` row, so no object storage bytes are copied or re-keyed.

True workspace copy/fork flows create a separate copy of the data and must deterministically fork every globally keyed entity id. Reusing the original ids in an independent workspace copy is invalid because these tables are keyed globally, not by `(workspace_id, entity_id)`. The fork contract is these UUID v5 namespaces. [iOS](../apps/ios/Flashcards/Flashcards/Database/Workspace/WorkspaceIdentityForking.swift) implements all four; [Android](../apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/cloud/identity/WorkspaceIdentityFork.kt) matches card, deck and review event, but its `mediaAssetIdentityForkNamespace` differs — an open cross-client mismatch:

- Fork card ids with UUID v5 namespace `5b0c7f2e-6f2a-4b7e-9e1b-2b5f0a4a91b1`
- Fork deck ids with UUID v5 namespace `98e66f2c-d3c7-4e3f-a7df-55d8e19ad2b4`
- Fork review event ids with UUID v5 namespace `3a214a3e-9c89-426d-a21f-11a5f5c1d6e8`
- Fork media asset ids with UUID v5 namespace `c1f3a5d7-8b62-4e9a-9f14-7d3c6a2b58e0`

When review events are copied into another workspace, their `cardId` references must be rewritten to the forked card ids from the same copy operation.

Media assets must be forked with the cards that reference them, including tombstoned registry rows, because the registry row belongs to the workspace while the bytes stay deduplicated by `sha256`. Copied card text and pending card operations carry `fcasset:` links, so those references must be rewritten to the forked media asset ids from the same copy operation. Queued media byte transfers must move to the forked workspace and asset ids so an interrupted upload still completes after the copy.

If guest upgrade encounters an impossible conflict where a guest entity id belongs to a third workspace, the backend may drop the conflicting guest entity only for clients that send request capability `supportsDroppedEntities`; otherwise it rejects completion. When a guest card does not merge, the backend also drops dependent guest review events for that card, even if the review event ids do not conflict. `droppedEntities` is durable replay, audit, and reconciliation metadata that lets capable clients understand exceptional server-side drops. Current Android and iOS merge-required recovery discards or switches away from the local guest workspace shell, then hydrates the target workspace from remote state instead of requiring per-row deletion of matching local rows. Because completion requires an empty local guest outbox, `droppedEntities` is not a pending-outbox migration path.
