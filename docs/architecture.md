# Architecture

## v1 system overview

```
Mobile app (iOS first) -> Cloudflare -> API Gateway -> Lambda backend -> Postgres
                                                  |
                                                  +-> EventBridge -> Lambda worker -> Postgres
```

## Principles

1. Single public gateway in v1: API Gateway only.
2. Worker is internal and event-driven (no public HTTP surface).
3. Postgres is the source of truth.
4. Mobile clients are offline-first and synchronize when online.

## Data flow

1. Mobile app writes locally (SQLite).
2. App sends batched sync operations to `/v1/sync/push`.
3. App fetches remote updates via `/v1/sync/pull`.
4. Worker periodically recalculates review scheduling data.

## Core schema (v1)

- `users`
- `decks`
- `notes`
- `cards`
- `review_events` (append-only)
- `sync_operations` (idempotent operation log)

## Security

- Database lives in private subnets.
- Lambdas access DB via VPC security groups.
- Cloudflare manages DNS and edge TLS.
- API custom domain is optional and configured via ACM certificate.
