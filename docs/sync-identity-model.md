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
- `agent_connection`
- `ai_chat`

Client-authenticated writes never send actor ids in payloads. The backend resolves the active workspace replica from `(workspaceId, installationId)` and stamps the canonical `replicaId` into stored rows and sync logs.

## Why The Split Exists

The old `sync.devices` model let one mutable row move between workspaces. That broke historical integrity because cards, review history, scheduler metadata, and hot changes pointed at a row whose workspace ownership could later change.

The new model fixes that by keeping:

- installations global and movable
- replicas immutable and workspace-scoped

This lets one physical installation switch users, switch workspaces, return later, upgrade guest sessions, and delete workspaces without rewriting historical actor ownership.
