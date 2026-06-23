# Publishing to the MCP Registry

How to publish and refresh our entry in the official MCP Registry. The manifest
lives in the repo root at [`server.json`](../server.json); this doc only covers
the publish flow.

## What is published

`server.json` describes the hosted remote MCP server (a `streamable-http` remote
at `https://mcp.flashcards-open-source-app.com/mcp`). Remote manifests do not
enumerate tools, so the registry entry is independent of the tool inventory; the
tool list lives in
[connector-directory-submission.md](connector-directory-submission.md).

The `name` uses the DNS-based namespace `com.flashcards-open-source-app/...`,
which we can verify because we control `flashcards-open-source-app.com`.

## Prerequisites

- The `mcp-publisher` CLI (the official MCP Registry publisher tool).
- Control of DNS for `flashcards-open-source-app.com` (for namespace
  verification).

## Publish flow

1. From the repo root, authenticate against the DNS namespace. `mcp-publisher`
   prints a TXT record to add to `flashcards-open-source-app.com`; add it, then
   complete login:

   ```sh
   mcp-publisher login dns --domain flashcards-open-source-app.com
   ```

2. Publish (or refresh) the entry from the root manifest:

   ```sh
   mcp-publisher publish
   ```

   The CLI reads `server.json` from the current directory and submits it.

## Refreshing the entry

Bump `version` in `server.json` (keep it aligned with the backend/API package
version per [version-bump.md](version-bump.md)) and run `mcp-publisher publish`
again. The remote URL only changes if the hosted MCP domain changes.

## Automating on release

This can be automated later: a release job can run `mcp-publisher publish`
after a successful deploy, using a stored DNS-verified credential, so the
registry entry stays in sync with each release without a manual step.
