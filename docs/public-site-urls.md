# Public site URLs (`PUBLIC_SITE_BASE_URL`)

This is an open-source, self-hostable project, so the marketing-site, legal, and docs links the backend publishes are not hardcoded to the reference domain. `PUBLIC_SITE_BASE_URL` is the marketing site's origin; it feeds the discovery envelope `links` block and the remote MCP server's `websiteUrl`, and it is the site's entry in the backend's public catalog, anonymous analytics and visitor CORS allowlists. The default derivation and the legal paths are in [`publicUrls.ts`](../apps/backend/src/shared/publicUrls.ts) and [`lambda-mcp.ts`](../apps/backend/src/entrypoints/lambda-mcp.ts).

In CDK it defaults to `https://<domainName>`; the optional GitHub variable `CDK_SITE_BASE_URL` overrides it. The reference deployment sets it to `https://nibomo.com` and must keep it set: its deployment apex stays `flashcards-open-source-app.com`, which serves no marketing site, and the explicit value makes both API hosts answer with the same links.
