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

This is automated by the
[`MCP Registry Publish`](../.github/workflows/mcp-registry-publish.yml)
workflow. It runs on every push to `main` that changes `server.json` (and can be
re-run manually via `workflow_dispatch`). The workflow installs `mcp-publisher`,
authenticates against the DNS namespace, and runs `mcp-publisher publish` from
the repo root, so the registry entry stays in sync with each release without a
manual step.

### Required GitHub secret

The workflow authenticates with `mcp-publisher login dns --private-key`, which
needs the Ed25519 private key for the `flashcards-open-source-app.com`
namespace, stored as the `MCP_PRIVATE_KEY` repository secret.

Generate the Ed25519 keypair with `openssl`:

```sh
openssl genpkey -algorithm Ed25519 -out key.pem
```

Derive the public key for the TXT record:

```sh
openssl pkey -in key.pem -pubout -outform DER | tail -c 32 | base64
```

Add the `v=MCPv1; k=ed25519; p=<PUBLIC_KEY>` TXT record on
`flashcards-open-source-app.com` to verify the namespace, then extract the
64-character hex private key:

```sh
openssl pkey -in key.pem -noout -text | grep -A3 "priv:" | tail -n +2 | tr -d ' :\n'
```

The command prints the 64-character hex value to store as the `MCP_PRIVATE_KEY`
secret. The workflow runs
`mcp-publisher login dns --domain flashcards-open-source-app.com --private-key "$MCP_PRIVATE_KEY"`
to authenticate with that key. Provisioning that secret is a one-time
operational step and is not committed to the repo.
