# Architecture

## v1 system overview

```
Mobile app (iOS first) -> Cloudflare -> api.<domain> -> API Gateway -> Lambda backend -> Postgres
Web app                -> Cloudflare -> app.<domain> -> CloudFront -> SPA
Browser auth           -> Cloudflare -> auth.<domain> -> API Gateway -> Auth Lambda -> Cognito (EMAIL_OTP)
Apex fallback          -> Cloudflare -> <domain> -> CloudFront redirect -> app.<domain>
```

## Principles

1. Separate public perimeters in v1: `app.<domain>`, `api.<domain>`, and `auth.<domain>`.
   The apex domain is only a bootstrap redirect fallback when it is not already used by a marketing site.
2. No background scheduling worker in v1.
3. Postgres is the source of truth.
4. Mobile clients are offline-first and synchronize when online.

## Data flow

1. Mobile app writes locally (SQLite).
2. App selects an explicit workspace.
3. App sends batched sync operations to `/v1/workspaces/:workspaceId/sync/push`.
4. App fetches remote updates via `/v1/workspaces/:workspaceId/sync/pull`.
5. API updates scheduling fields on review submit (compute-on-write).

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
- Browser login still uses one shared domain-wide session cookie so sign-in works across `auth.<domain>` and `app.<domain>` without a second login.
- Backend Lambda verifies JWT from `Authorization: Bearer` header via `aws-jwt-verify`.
- `AUTH_MODE=none` for local dev (no auth, `userId=local`), `AUTH_MODE=cognito` in production.
- First authenticated request auto-provisions only the `user_settings` row. Workspace creation and selection are explicit.

## Security

- Database lives in private subnets.
- Lambdas access DB via VPC security groups.
- Cloudflare manages DNS and edge TLS.
- API custom domain is optional and configured via ACM certificate.
- OTP session cookies are HMAC-signed (SESSION_ENCRYPTION_KEY in Secrets Manager).
- CSRF token + 3-min TTL on OTP sessions.
- Browser session-authenticated mutating API requests require exact allowed `Origin` (or `Referer` fallback), `X-CSRF-Token`, and reject explicit `Sec-Fetch-Site: cross-site`.
- The browser CSRF token is derived from the current `session` JWT with a dedicated backend HMAC secret in Secrets Manager, so no SQL state is needed.
- Host-only `__Host-` CSRF cookies are not used in v1 because `app.<domain>` is a static CloudFront/S3 SPA and `api.<domain>` is a separate origin that cannot mint an `app.<domain>` host-only cookie without adding a proxy or edge layer.
