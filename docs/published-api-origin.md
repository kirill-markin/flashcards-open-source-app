# Published API origin (`PUBLIC_API_BASE_URL`)

The address the backend, auth, MCP, and catalog-dump Lambdas *publish* as the
public REST API. It is what the canonical machine API entrypoint
(`GET /v1/`) tells an AI agent to call, so it is the one string that decides
which host agents adopt.

## Purpose

`PUBLIC_API_BASE_URL` is the public API origin with the `/v1` contract prefix and
no trailing slash, for example `https://api.nibomo.com/v1`. Every consumer only
ever puts it into something the caller reads and follows:

- the discovery envelope and agent next-step URLs (`apps/backend/src/agent/`),
- `docs.discoveryUrl` on every agent envelope and on the source-discovery probes,
- the API-key error envelopes of both direct image ingestion entrypoints,
- the published catalog dump, only in the fallback `downloadUrl` of a media
  asset the CDN cannot deliver
  (`apps/backend/src/catalog/distribution/public/snapshot.ts`); deliverable media
  carry CDN URLs, so the override leaves the dump effectively unchanged,
- the auth service's own server-to-server calls into the backend
  (`apps/auth/src/server/analytics/client.ts`).

No shipped client or external system validates it, signs with it, or stores it
as an identity, so it may name a second API host while the original host keeps
answering. The post-deploy smokes do compare it, deliberately:
`scripts/checks/check-agent-api-smoke.sh` and `scripts/checks/check-mcp-smoke.sh`
assert the advertised base against `*_EXPECTED_ADVERTISED_API_BASE_URL`, which
the release workflow derives from the same `CDK_API_BASE_URL`, separately from
the host they call.

## AWS deployment

In CDK the value defaults to `https://api.<domainName>/v1`. To override it, set
the optional GitHub Actions repository variable `CDK_API_BASE_URL` to an origin
without a path (for example `https://api.nibomo.com`); it flows through
`CDK_CONTEXT_API_BASE_URL` into the `apiBaseUrl` CDK context, and each gateway
appends `/v1`. Unset leaves the synthesized template exactly as it was.

Synth fails unless the value is `https://api.<domainName>` or the alternate API
host with its certificate configured and `CDK_API_ALTERNATE_HOST_LIVE=true`
(`infra/aws/lib/published-api-origin.ts`), so a typo or a host that does not
answer yet is never advertised.

The override changes only what is advertised. It creates no host: the second API
host is a separate switch (`apiAlternateDomainName`, `infra/aws/lib/alternate-host.ts`),
and it removes nothing from any CORS or redirect allowlist.

## Why the auth origin has no companion override

`PUBLIC_AUTH_BASE_URL` looks symmetric and is not. It is pinned to
`https://auth.<domainName>` on purpose, because two of its consumers are bound
rather than advertised:

- It is the OAuth 2.0 issuer of the RFC 8414 authorization server metadata
  (`apps/auth/src/routes/oauth/metadata.ts`) and the RFC 9207 `iss` parameter
  (`apps/auth/src/routes/oauth/authorize.ts`). Shipped MCP clients compare it,
  and the backend names the same string as `authorization_servers` in every
  protected-resource document (`apps/backend/src/entrypoints/lambda-mcp.ts`).
- It is an exact-match entry of the backend's anonymous-analytics CORS allowlist
  (`getConfiguredAnonymousAnalyticsCorsOrigins` in
  `apps/backend/src/shared/publicUrls.ts`). Repointing it would stop the backend
  accepting the origin the login page is actually served from.

Moving the published auth address therefore needs those two consumers separated
from the advertised one first; it is not a configuration change.

Related: [Public site URLs](public-site-urls.md).
