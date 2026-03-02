# Architecture

## v1 system overview

```
Mobile app (iOS first) -> Cloudflare -> API Gateway -> Lambda backend -> Postgres
```

## Principles

1. Single public gateway in v1: API Gateway only.
2. No background scheduling worker in v1.
3. Postgres is the source of truth.
4. Mobile clients are offline-first and synchronize when online.

## Data flow

1. Mobile app writes locally (SQLite).
2. App sends batched sync operations to `/v1/sync/push`.
3. App fetches remote updates via `/v1/sync/pull`.
4. API updates scheduling fields on review submit (compute-on-write).

## Core schema (v1)

- `workspaces`
- `workspace_members`
- `devices`
- `cards`
- `review_events`
- `applied_operations`
- `sync_state`

## Security

- Database lives in private subnets.
- Lambdas access DB via VPC security groups.
- Cloudflare manages DNS and edge TLS.
- API custom domain is optional and configured via ACM certificate.
