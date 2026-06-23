# Public site URLs (`PUBLIC_SITE_BASE_URL`)

This is an open-source, self-hostable project, so the public marketing-site,
legal, and docs links must not be hardcoded to the reference domain. They are
env-driven through `PUBLIC_SITE_BASE_URL`, following the same pattern as
`PUBLIC_API_BASE_URL` and `PUBLIC_AUTH_BASE_URL`.

## Purpose

`PUBLIC_SITE_BASE_URL` is the public origin of your marketing site (the apex
domain), with no trailing slash, for example
`https://flashcards-open-source-app.com`. It feeds:

- the discovery envelope `links` block (`GET /v1/` and `GET /v1/agent`), which
  surfaces the website, privacy, terms, support, and docs URLs to AI agents;
- the remote MCP server implementation metadata (`websiteUrl`).

## Default

When `PUBLIC_SITE_BASE_URL` is unset, the value is derived automatically:

- The backend discovery surface strips a leading `api.`/`auth.`/`mcp.`
  subdomain from the incoming request origin to reach the apex origin.
- The MCP and backend Lambdas default to `https://<baseDomain>` (the deployment
  apex domain), so the reference deployment works without setting anything.

## Derived legal links

The legal/docs paths are conventional trailing-slash constants appended to the
base URL (the marketing site uses `trailingSlash: true`):

| Link        | Path        |
| ----------- | ----------- |
| `websiteUrl` | `/`        |
| `privacyUrl` | `/privacy/`|
| `termsUrl`   | `/terms/`  |
| `supportUrl` | `/support/`|
| `docsUrl`    | `/docs/`   |

## AWS deployment

In CDK, the value defaults to `https://<domainName>` for the backend and MCP
Lambda environments. To override it (for example when the marketing site lives
on a different host than the API apex), set the optional GitHub Actions
repository variable `CDK_SITE_BASE_URL`; it flows through
`CDK_CONTEXT_SITE_BASE_URL` into the `siteBaseUrl` CDK context. Production works
without setting it because the value defaults from the domain.
