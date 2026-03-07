# Architecture

## v1 system overview

```
Mobile app (iOS first) -> Cloudflare -> api.<domain> -> API Gateway -> Lambda backend -> Postgres
Web app                -> Cloudflare -> app.<domain> -> CloudFront -> SPA
Browser auth           -> Cloudflare -> auth.<domain> -> API Gateway -> Auth Lambda -> Cognito (EMAIL_OTP)
```

## Principles

1. Separate public perimeters in v1: `app.<domain>`, `api.<domain>`, and `auth.<domain>`.
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
- `user_settings`
- `devices`
- `cards`
- `review_events`
- `applied_operations`
- `sync_state`

## Auth

- Cognito User Pool with EMAIL_OTP (passwordless, Essentials tier).
- Auth Lambda (`auth.<domain>`) handles OTP send/verify, token refresh/revoke, and the browser login page.
- Backend Lambda verifies JWT from `Authorization: Bearer` header via `aws-jwt-verify`.
- `AUTH_MODE=none` for local dev (no auth, `userId=local`), `AUTH_MODE=cognito` in production.
- First authenticated request auto-provisions `user_settings` row and a default workspace.

## Security

- Database lives in private subnets.
- Lambdas access DB via VPC security groups.
- Cloudflare manages DNS and edge TLS.
- API custom domain is optional and configured via ACM certificate.
- OTP session cookies are HMAC-signed (SESSION_ENCRYPTION_KEY in Secrets Manager).
- CSRF token + 3-min TTL on OTP sessions.
