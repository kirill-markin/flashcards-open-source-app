# Publishing to the MCP Registry

The companion repository owns the [manifest](https://github.com/kirill-markin/nibomo-plugins/blob/main/server.json),
validator, and manual publisher. Follow its
[publisher procedure](https://github.com/kirill-markin/nibomo-plugins/blob/main/docs/mcp-registry-publishing.md),
covering validation, one-time credential setup, publication and the required
GitHub secret, and the [MCP release gate](release/mcp-and-plugins.md#mcp).
Backend source and deployment stay in this repository, which is the manifest's
`repository.url`; the shared Cloudflare helpers and the operator `.env` used by
credential setup stay in this repository's main checkout.
