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
- For GitHub Actions publishing, the Ed25519 namespace private key stored as
  the `MCP_PRIVATE_KEY` repository secret.
- For one-time credential bootstrap, the local root `.env` must include
  `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`, and `GITHUB_REPO`, or pass the
  repository explicitly to the setup script.

## Validate the manifest

Validate `server.json` against the official MCP Registry schema before
publishing:

```sh
curl -fsS 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json' > /tmp/mcp-server-schema-2025-12-11.json
npx --yes ajv-cli@5 validate -s /tmp/mcp-server-schema-2025-12-11.json -d server.json --strict=false
```

## One-time credential setup

Use the repo setup script to create the DNS namespace credential. It generates a
fresh Ed25519 keypair, creates the root Cloudflare TXT record for the public key,
stores the private key as the `MCP_PRIVATE_KEY` GitHub Actions secret, and then
deletes the temporary local key file.

```sh
bash scripts/setup/setup-mcp-registry-credential.sh \
  --domain flashcards-open-source-app.com \
  --repo kirill-markin/flashcards-open-source-app
```

The script is idempotent when both the MCP Registry TXT record and
`MCP_PRIVATE_KEY` already exist. If only one side exists, it fails with an
explicit recovery message instead of silently rotating the namespace key.

## Publish flow

1. From the repo root, validate `server.json`.

2. Confirm the one-time credential setup is complete:

   ```sh
   bash scripts/setup/setup-mcp-registry-credential.sh \
     --domain flashcards-open-source-app.com \
     --repo kirill-markin/flashcards-open-source-app
   ```

3. Run the GitHub Actions publisher:

   ```sh
   gh workflow run mcp-registry-publish.yml \
     --repo kirill-markin/flashcards-open-source-app \
     --ref main
   ```

   The workflow validates `server.json`, authenticates with
   `mcp-publisher login dns --private-key`, and publishes the root manifest.

4. Check the published entry through the official registry API:

   ```sh
   curl -fsS 'https://registry.modelcontextprotocol.io/v0.1/servers/com.flashcards-open-source-app%2Fflashcards/versions/latest'
   ```

   A `404 Server not found` response means the entry is not published or the
   publish failed.

## Local manual publish fallback

Use this only when debugging the publisher outside GitHub Actions. From the repo
root, validate `server.json`, then authenticate with the private key already
stored in `MCP_PRIVATE_KEY` and publish:

```sh
mcp-publisher login dns --domain flashcards-open-source-app.com --private-key "$MCP_PRIVATE_KEY"
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
validates `server.json` against the official schema, authenticates against the
DNS namespace, and runs `mcp-publisher publish` from the repo root, so the
registry entry stays in sync with each release without a manual step.

### Required GitHub secret

The workflow authenticates with `mcp-publisher login dns --private-key`, which
needs the Ed25519 private key for the `flashcards-open-source-app.com`
namespace, stored as the `MCP_PRIVATE_KEY` repository secret.

Prefer
[`scripts/setup/setup-mcp-registry-credential.sh`](../scripts/setup/setup-mcp-registry-credential.sh)
for normal setup. The manual equivalent is:

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
