# Published API origin (`PUBLIC_API_BASE_URL`)

The REST API address the backend, auth, MCP, and catalog-dump Lambdas *publish*. It is what the canonical machine API entrypoint (`GET /v1/`) tells an AI agent to call, so it is the one string that decides which host agents adopt. It also lands in agent next-step URLs, API-key error envelopes, the auth service's server-to-server calls and the catalog dump's fallback media URLs.

No shipped client or external system validates it, signs with it, or stores it as an identity, so it may name a second API host while the original host keeps answering. The post-deploy [agent API](../scripts/checks/check-agent-api-smoke.sh) and [MCP](../scripts/checks/check-mcp-smoke.sh) smokes deliberately assert the advertised base separately from the host they call.

## AWS deployment

It defaults to `https://api.<domainName>/v1`. To override it, set the optional GitHub variable `CDK_API_BASE_URL` to an origin without a path (for example `https://api.nibomo.com`); each gateway appends `/v1`. Synth accepts only the primary API host or the [second API host](backend-web-deployment.md#optional-second-api-and-auth-host) once declared live ([`published-api-origin.ts`](../infra/aws/lib/published-api-origin.ts)). The override changes only what is advertised: it creates no host and removes nothing from any CORS or redirect allowlist.

## Why the auth origin has no companion override

`PUBLIC_AUTH_BASE_URL` stays pinned to `https://auth.<domainName>`, because it is bound rather than advertised: it is the OAuth issuer shipped MCP clients compare ([`auth-gateway.ts`](../infra/aws/lib/gateways/auth-gateway.ts)) and an exact entry of the backend's anonymous-analytics CORS allowlist ([`api-gateway.ts`](../infra/aws/lib/gateways/api-gateway.ts)). Moving it needs those consumers separated from the advertised address first; it is not a configuration change.

Related: [Public site URLs](public-site-urls.md).
