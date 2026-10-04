# Publishing to the MCP Registry

The companion repository owns the [manifest](https://github.com/kirill-markin/nibomo-plugins/blob/main/server.json),
validator, and manual publisher. Follow the
[canonical publisher procedure](https://github.com/kirill-markin/nibomo-plugins/blob/main/docs/mcp-registry-publishing.md)
and the [MCP release gate](release/mcp-and-plugins.md#mcp).
Backend source and deployment remain in this repository, which is still the
manifest's `repository.url`.

## Validate the manifest

See [companion validation](https://github.com/kirill-markin/nibomo-plugins/blob/main/docs/mcp-registry-publishing.md#validate-the-manifest).

## One-time credential setup

See [companion credential setup](https://github.com/kirill-markin/nibomo-plugins/blob/main/docs/mcp-registry-publishing.md#one-time-credential-setup).
The shared Cloudflare helpers and operator `.env` remain in the core main checkout.

## Publish flow

See [companion publication](https://github.com/kirill-markin/nibomo-plugins/blob/main/docs/mcp-registry-publishing.md#publish-flow).

## Manual workflow

See [companion manual workflow](https://github.com/kirill-markin/nibomo-plugins/blob/main/docs/mcp-registry-publishing.md#manual-workflow).

### Required GitHub secret

See [the companion secret requirement](https://github.com/kirill-markin/nibomo-plugins/blob/main/docs/mcp-registry-publishing.md#required-github-secret).
