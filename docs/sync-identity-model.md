# Sync Identity Model

The sync layer now treats installation identity and workspace actor identity as two different concepts.

## Installation Id

`installationId` is a stable physical app or browser identity.

- It is generated once per Android install, iOS install, or browser profile.
- It is global across users and workspaces.
- It may change users over time without rewriting history.
- Clients send `installationId` on authenticated sync requests.

`sync.installations` stores this global client identity. These rows are not historical actors and must never be used as foreign keys from cards, decks, review events, scheduler settings, or sync logs.

## Replica Id

`replicaId` is an immutable actor inside one workspace.

- Client replicas are derived from `(workspaceId, installationId)`.
- System replicas are derived from `(workspaceId, actorKind, actorKey)`.
- History points to replicas, never to mutable installation rows.

`sync.workspace_replicas` is the canonical actor table for:

- `content.cards.last_modified_by_replica_id`
- `content.decks.last_modified_by_replica_id`
- `org.workspaces.fsrs_last_modified_by_replica_id`
- `content.review_events.replica_id`
- `sync.hot_changes.replica_id`
- `sync.applied_operations_current.replica_id`

## Actor Kinds

`sync.workspace_replicas.actor_kind` is one of:

- `client_installation`
- `workspace_seed`
- `workspace_reset`
- `agent_connection`
- `ai_chat`

`workspace_reset` is a deterministic system actor per workspace. The reset-progress flow uses it so destructive scheduler-state resets remain workspace-scoped and auditable without pretending to be a client installation.

Client-authenticated writes never send actor ids in payloads. The backend resolves the active workspace replica from `(workspaceId, installationId)` and stamps the canonical `replicaId` into stored rows and sync logs.

## Why The Split Exists

The old `sync.devices` model let one mutable row move between workspaces. That broke historical integrity because cards, review history, scheduler metadata, and hot changes pointed at a row whose workspace ownership could later change.

The new model fixes that by keeping:

- installations global and movable
- replicas immutable and workspace-scoped

This lets one physical installation switch users, switch workspaces, return later, upgrade guest sessions, and delete workspaces without rewriting historical actor ownership.

## Entity Id Rules

Cards, decks, and review events use globally keyed ids. Guest upgrade and true workspace copy/fork flows handle those ids differently.

Guest upgrade preserves ids and merges already-synced guest cloud state into the selected destination workspace. Before calling `/guest-auth/upgrade/complete`, clients fully sync the guest workspace with guest authentication and verify that the local guest outbox is empty. Completion does not carry pending local operations through linked migration, does not depend on entity-id alias mappings, and clients must not fork guest ids before or after linked sync. After upgrade, clients continue syncing the same card, deck, and review event ids.

True workspace copy/fork flows create a separate copy of the data and must deterministically fork every globally keyed entity id. Reusing the original ids in an independent workspace copy is invalid because these tables are keyed globally, not by `(workspace_id, entity_id)`.

- Fork card ids with UUID v5 namespace `5b0c7f2e-6f2a-4b7e-9e1b-2b5f0a4a91b1`
- Fork deck ids with UUID v5 namespace `98e66f2c-d3c7-4e3f-a7df-55d8e19ad2b4`
- Fork review event ids with UUID v5 namespace `3a214a3e-9c89-426d-a21f-11a5f5c1d6e8`

When review events are copied into another workspace, their `cardId` references must be rewritten to the forked card ids from the same copy operation.

If guest upgrade encounters an impossible conflict where a guest entity id belongs to a third workspace, the backend may drop the conflicting guest entity only for clients that send request capability `supportsDroppedEntities`; otherwise it rejects completion. When a guest card does not merge, the backend also drops dependent guest review events for that card, even if the review event ids do not conflict. `droppedEntities` is durable replay, audit, and reconciliation metadata that lets capable clients understand exceptional server-side drops. Current Android and iOS merge-required recovery discards or switches away from the local guest workspace shell, then hydrates the target workspace from remote state instead of requiring per-row deletion of matching local rows. Because completion requires an empty local guest outbox, `droppedEntities` is not a pending-outbox migration path.
