# Publishing to the MCP Registry

How to publish and refresh our entry in the official MCP Registry. The manifest
lives in the repo root at [`server.json`](../server.json); this doc only covers
the publish flow.

The registry entry publishes under `com.nibomo/flashcards`. Treat this as the
maintenance flow for metadata refreshes: validate the manifest, bump
`server.json` `version` when publishing a changed registry entry, and manually
run the workflow below to publish the new version.

## What is published

`server.json` describes the hosted remote MCP server (a `streamable-http` remote
at `https://mcp.nibomo.com/mcp`). Remote manifests do not enumerate tools, so
the registry entry is independent of the tool inventory; the tool list lives in
[connector-directory-submission.md](connector-directory-submission.md).

The `name` uses the DNS-based namespace `com.nibomo/...`, which we can verify
because we control `nibomo.com`. The registry verifies the namespace against
`name` only and never compares it with the remote URL.

`mcp.flashcards-open-source-app.com` keeps serving the same server on the same
routes, so client configurations that already point at it keep working. The
published `com.flashcards-open-source-app/flashcards` record keeps advertising
that address rather than the new one, because the registry rejects a publish
whose remote URL already belongs to another record and treats a `deprecated`
record as still holding its URL.

## Prerequisites

- The `mcp-publisher` CLI (the official MCP Registry publisher tool).
- Control of DNS for `nibomo.com` (for namespace verification).
- For GitHub Actions publishing, the Ed25519 namespace private key stored as
  the `MCP_PRIVATE_KEY` repository secret.
- For one-time credential bootstrap, the local root `.env` must include
  `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`, and `GITHUB_REPO`, or pass the
  repository explicitly to the setup script. Both Cloudflare values must
  resolve to the `nibomo.com` zone: the setup script uses `--domain` only as
  the DNS record name and always reads and writes in the zone from `.env`.
  Always pass `--domain nibomo.com` explicitly as well, because the script
  otherwise falls back to `DOMAIN_NAME`, which is the old domain.
- That zone repoint is temporary and applies to this one script only. The same
  two variables are the shared Cloudflare config for every helper in
  `scripts/cloudflare/` and for `scripts/setup/setup-resend-domain.sh`, all of
  which operate on the `flashcards-open-source-app.com` zone. Restore the
  `flashcards-open-source-app.com` zone id and API token in `.env` immediately
  after the run, so the next DNS or infrastructure script reads the right zone.

## Validate the manifest

Validate `server.json` against the official MCP Registry schema before
publishing:

```sh
curl -fsS 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json' > /tmp/mcp-server-schema-2025-12-11.json
npx --yes ajv-cli@5 validate -s /tmp/mcp-server-schema-2025-12-11.json -d server.json --strict=false
```

The [`MCP Registry Validate`](../.github/workflows/mcp-registry-validate.yml)
workflow runs the same validation automatically on pull requests and pushes to
`main` that touch `server.json` or the MCP registry workflows. It does not need
`MCP_PRIVATE_KEY` and never publishes.

## One-time credential setup

Use the repo setup script to create the DNS namespace credential. It generates a
fresh Ed25519 keypair, creates the root Cloudflare TXT record for the public key,
stores the private key as the `MCP_PRIVATE_KEY` GitHub Actions secret, and then
deletes the temporary local key file.

```sh
bash scripts/setup/setup-mcp-registry-credential.sh \
  --domain nibomo.com \
  --repo kirill-markin/flashcards-open-source-app
```

Point `CLOUDFLARE_ZONE_ID` and `CLOUDFLARE_API_TOKEN` at the `nibomo.com` zone
before running it, and put the `flashcards-open-source-app.com` values back in
`.env` as soon as it finishes. With the old zone still in `.env`, the script
looks for the `nibomo.com` TXT record in the wrong zone and reports a false
mismatch.

The script is idempotent when both the MCP Registry TXT record and
`MCP_PRIVATE_KEY` already exist. If only one side exists, it fails with an
explicit recovery message instead of silently rotating the namespace key.

## Publish flow

1. From the repo root, validate `server.json`.

2. Confirm `server.json.version` is the intended shared product release version
   and has not already been published. MCP Registry versions are immutable; a
   duplicate version publish fails. The manual workflow checks the exact
   version endpoint before publishing and stops with an actionable error when
   the version already exists.

3. Confirm the one-time credential setup is complete, with
   `CLOUDFLARE_ZONE_ID` pointing at the `nibomo.com` zone:

   ```sh
   bash scripts/setup/setup-mcp-registry-credential.sh \
     --domain nibomo.com \
     --repo kirill-markin/flashcards-open-source-app
   ```

   The `nibomo.com` credential is provisioned, so this must report that the
   credential is already configured. An error saying `MCP_PRIVATE_KEY` exists
   without a TXT record is raised whenever the lookup finds no TXT record while
   the secret exists. The most likely cause is `CLOUDFLARE_ZONE_ID` still
   pointing at another zone; it can also mean `--domain` was omitted and fell
   back to `DOMAIN_NAME`, or that the TXT record was genuinely deleted. Check
   those three, and do not remove the secret.

   Restore the `flashcards-open-source-app.com` Cloudflare values in `.env`
   once this check passes.

4. Run the GitHub Actions publisher manually:

   ```sh
   gh workflow run mcp-registry-publish.yml \
     --repo kirill-markin/flashcards-open-source-app \
     --ref main
   ```

   The workflow validates `server.json`, checks that the exact `server.json`
   `name` and `version` endpoint is not already published, installs
   `mcp-publisher`, authenticates with `mcp-publisher login dns --private-key`,
   publishes the root manifest, and verifies the exact published version
   endpoint.

5. Check the published version through the official registry API:

   ```sh
   server_version="$(jq -r '.version' server.json)"
   curl -fsS "https://registry.modelcontextprotocol.io/v0.1/servers/com.nibomo%2Fflashcards/versions/${server_version}"
   ```

   A `404 Server not found` response means that exact version is not published
   or the publish failed.

## Local manual publish fallback

Use this only when debugging the publisher outside GitHub Actions. From the repo
root, validate `server.json`, confirm the exact version is unpublished, then
authenticate with the private key already stored in `MCP_PRIVATE_KEY` and
publish:

```sh
mcp-publisher login dns --domain nibomo.com --private-key "$MCP_PRIVATE_KEY"
mcp-publisher publish
```

The CLI reads `server.json` from the current directory and submits it.

## Refreshing the entry

Bump `version` in `server.json` (keep it aligned with the shared product
release version per [version-bump.md](version-bump.md)) and run the manual
[`MCP Registry Publish`](../.github/workflows/mcp-registry-publish.yml)
workflow after the version bump is ready on `main`. The remote URL only changes
if the hosted MCP domain changes.

## Manual workflow

`MCP Registry Publish` is intentionally manual-only through
`workflow_dispatch`. It validates `server.json` against the official schema,
checks the exact version endpoint for duplicates, installs `mcp-publisher`,
authenticates against the DNS namespace, publishes from the repo root, and then
verifies the exact published version endpoint.

### Required GitHub secret

The workflow authenticates with `mcp-publisher login dns --private-key`, which
needs the Ed25519 private key for the `nibomo.com` namespace, stored as the
`MCP_PRIVATE_KEY` repository secret.

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

Add the `v=MCPv1; k=ed25519; p=<PUBLIC_KEY>` TXT record on `nibomo.com` to
verify the namespace, then extract the 64-character hex private key:

```sh
openssl pkey -in key.pem -noout -text | grep -A3 "priv:" | tail -n +2 | tr -d ' :\n'
```

The command prints the 64-character hex value to store as the `MCP_PRIVATE_KEY`
secret. The workflow runs
`mcp-publisher login dns --domain nibomo.com --private-key "$MCP_PRIVATE_KEY"`
to authenticate with that key. Provisioning that secret is a one-time
operational step and is not committed to the repo.

## Previous namespace

`com.flashcards-open-source-app/flashcards` is a separate registry record with
its own version history. Changing `name` creates a new record and never moves
the old one, so the old entry is deprecated by hand with a message pointing at
`com.nibomo/flashcards`.

That deprecation authenticates against the old namespace, so it needs an
Ed25519 key for `flashcards-open-source-app.com`, and it needs the opposite
Cloudflare zone from the publish flow above: `CLOUDFLARE_ZONE_ID` and
`CLOUDFLARE_API_TOKEN` in `.env` must point at the
`flashcards-open-source-app.com` zone while this runs, which is also their
normal resting value.

`MCP_PRIVATE_KEY` now holds the `nibomo.com` key and GitHub secrets cannot be
read back, so generate a fresh key on demand and replace the existing
`v=MCPv1; k=ed25519; p=...` TXT record on the `flashcards-open-source-app.com`
root with the new public key instead of adding a second one. Do not use
`setup-mcp-registry-credential.sh` for this step: it never rotates an existing
key and hard-fails when a domain carries more than one matching TXT record.
Then authenticate with
`mcp-publisher login dns --domain flashcards-open-source-app.com --private-key "$OLD_NAMESPACE_KEY"`
and deprecate the old record.
