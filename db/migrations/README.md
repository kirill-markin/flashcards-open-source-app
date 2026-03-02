# Migrations

Schema migrations are intentionally not finalized yet.

Planned process:
1. Agree on v1 domain model and sync invariants.
2. Write initial migration from scratch (`0001_initial_schema.sql`).
3. Apply only additive migrations after `0001` is committed.
