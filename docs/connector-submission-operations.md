# Connector submission operations runbook

Operational, no-code prerequisites for listing the remote MCP server in
connector directories. This is the operator-facing companion to
[connector-directory-submission.md](connector-directory-submission.md): that
file owns the public listing copy and the reviewer walkthrough, while this file
covers the actions an operator performs (enabling the reviewer demo account,
verifying the OAuth/DCR flow end-to-end, and the OpenAI-side prerequisites).

Active reviewer emails, passwords, and tokens are never committed here. Share
access details only through the directory's private submission portal.
`mcp-review@example.com` is a generic example, not a claimed live account.

## Pre-submit gate

Do not submit to any directory until all checks pass.

- The [companion manifest](https://github.com/kirill-markin/nibomo-plugins/blob/main/server.json)
  passes the official MCP Registry schema check; use
  [companion cloud validation](https://github.com/kirill-markin/nibomo-plugins/blob/main/docs/mcp-registry-publishing.md#validate-the-manifest)
  and record the run and schema URL used.
- The official registry lookup returns the published entry:

  ```bash
  curl -fsS 'https://registry.modelcontextprotocol.io/v0.1/servers/com.nibomo%2Fflashcards/versions/latest'
  ```

  A JSON response for `com.nibomo/flashcards` is pass. A
  `404 Server not found` response means the entry is not published yet, the
  server name is wrong, or the publish failed. Use the credential setup and
  publish flow in
  [the companion publisher procedure](https://github.com/kirill-markin/nibomo-plugins/blob/main/docs/mcp-registry-publishing.md#one-time-credential-setup)
  before submitting to downstream directories.
- Unauthenticated access to the MCP endpoint returns a standards-compatible
  OAuth challenge:

  ```bash
  curl -isS https://mcp.nibomo.com/mcp
  ```

  Pass requires an unauthorized response with a `WWW-Authenticate` Bearer
  challenge that points clients to the protected-resource metadata.
- Protected-resource metadata returns valid JSON for both the root well-known
  path and the `/mcp` path-aware variant, and the resource value is
  `https://mcp.nibomo.com/mcp`:

  ```bash
  curl -fsS https://mcp.nibomo.com/.well-known/oauth-protected-resource | jq .
  curl -fsS https://mcp.nibomo.com/.well-known/oauth-protected-resource/mcp | jq .
  ```

- Authorization-server metadata returns valid JSON with the expected OAuth and
  Dynamic Client Registration endpoints:

  ```bash
  curl -fsS https://auth.flashcards-open-source-app.com/.well-known/oauth-authorization-server | jq .
  ```

- The selected review/demo account is enabled, can complete
  OAuth, and has a seeded workspace with decks and cards suitable for the
  reviewer walkthrough.
- Active reviewer access details stay out of public listing copy, screenshots,
  repository files, and PRs. Share them only through the private submission portal.

## Reviewer demo account

The insecure review/demo bypass lets a directory reviewer sign in to a synthetic
`@example.com` account without OTP and without receiving any email. A
comma-separated allowlist selects eligible accounts; the server supplies one
shared Cognito password for all of them. Browser users need only the allowlisted
email, so treat each active email as an access credential. Use a separate
synthetic account for each directory review, with only disposable data and no
access to real users' workspaces.

### Wiring already exists (no infra code needed)

The infrastructure to deliver the demo configuration to the Lambdas is already
in place. Enabling the demo account is a configuration/secret task, not a code
change.

- `infra/aws/lib/gateways/auth-gateway.ts` sets `DEMO_EMAIL_DOSTIP` and
  `DEMO_PASSWORD_SECRET_ARN` on the auth Lambda.
- `infra/aws/lib/gateways/api-gateway.ts` sets `DEMO_EMAIL_DOSTIP` on the agent
  surface.
- `.github/workflows/aws-web-release.yml` forwards the repository secret
  `CDK_DEMO_EMAIL_DOSTIP` and variable `CDK_DEMO_PASSWORD_SECRET_ARN` into CDK
  context for both the auth and API stacks. The allowlist is a secret so GitHub
  masks it in release step headers.
- AWS secret name: `flashcards-open-source-app/demo-password-dostip`
  (see [infra/aws/README.md](../infra/aws/README.md), "Review/demo accounts").

### Operational enablement (operator only — AWS deploys via CI/CD)

AWS is never deployed locally. Make the configuration changes, push to `main`,
and let CI/CD deploy.

Before switching an existing deployment from the GitHub variable to the
secret, privately reconcile that variable with the canonical root `.env` and
deployed auth/API allowlists. Populate the same-named repository secret with
that exact list before merging the workflow change. Keep the variable while
older workflow runs may still need it; remove it only after the new release
succeeds and its deployed list and public-log masking are verified. Preserve
the existing accounts and shared password throughout this transition.

1. Privately compare deployed auth/API `DEMO_EMAIL_DOSTIP` with the canonical
   `DEMO_EMAIL_DOSTIP` in the main checkout's ignored root `.env`. GitHub cannot
   return secret plaintext, so reconcile those readable sources before editing.
   Preserve every existing entry, including accounts serving Apple, Google, and
   OpenAI reviews. Choose a new synthetic `@example.com` email for the directory.
2. Reuse the deployed Secrets Manager secret
   `flashcards-open-source-app/demo-password-dostip` and its existing password.
   Preserve `CDK_DEMO_PASSWORD_SECRET_ARN`. Never replace or rotate the shared
   password while any review is active; do not run a secret setup helper with a
   new password merely to add an account.
3. Manually create the new Cognito user in the deployed user pool with the
   selected email and a permanent password equal to that existing shared
   password. Suppress invitation email and mark the synthetic email verified;
   it cannot receive mail. These settings do not provision Cognito users.
4. Append the selected email to the canonical local allowlist, preserving the
   complete existing list. Keep local `DEMO_PASSWORD_DOSTIP` aligned with the
   existing AWS secret. Update the GitHub repository secret
   `CDK_DEMO_EMAIL_DOSTIP` with the complete list via `gh secret set`, passing
   its value through standard input from the loaded local config, without shell
   tracing or printing it. `scripts/setup/setup-github.sh` only creates missing
   secrets and does not update an existing allowlist.
5. Confirm `CDK_DEMO_EMAIL_DOSTIP` is present with
   `gh secret list --repo kirill-markin/flashcards-open-source-app --json name`
   before queuing the release. Presence does not verify its value. Merge a
   release-triggering change to `main` and watch `AWS/Web Release` through a
   successful platform deploy and post-deploy checks. Configuration changes
   alone do not trigger a deployment; do not deploy AWS locally.

After deploy, privately compare the auth and every API Lambda allowlist with
the exact expected list, including every previously active account. Check the
new public release logs, including synthesis and deployment step headers, for
masking of all active identities; keep the comparison output private. An
operator can check Cognito user presence and the configured password policy with:

```bash
AWS_PROFILE=flashcards-open-source-app bash scripts/checks/check-demo-cognito-users.sh \
  --stack-name FlashcardsOpenSourceApp --region eu-central-1
```

This check does not prove that each user's password matches the shared secret.
Verify fresh browser sign-in for the new account and the existing review
accounts, then complete OAuth and a tool call for the new directory. Keep
account identifiers and verification output private.

### Seed the demo workspace

The Cognito user must already exist (see step 3). The first authenticated
sign-in then auto-provisions the application-level default workspace for that
account. Once the workspace exists, seed throwaway demo data so reviewer
`SELECT`s return meaningful rows. Insert decks and cards through the agent SQL
write surface — either `POST /v1/agent/sql/execute` or the `sql_execute` MCP
tool — using the demo account's own API key/connection. `review_events` cannot be
seeded this way (it is immutable/append-only and rejects `INSERT` — the write
surface only accepts `INSERT`/`UPDATE`/`DELETE` on `cards` and `decks`); to
populate review history, review some of the seeded cards in a client.

Honor the flashcard side contract: `front_text` is a question/review prompt only
(never the answer) and `back_text` holds the answer. Keep the dataset small and
treat the whole workspace as disposable.

### Reviewer access cheatsheet (paste into the PRIVATE submission portal only)

Never put these credentials in this repository. Paste them into each directory's
private submission portal.

- **Browser / OAuth (Claude custom connector and ChatGPT):** enter the selected
  allowlisted email on the auth login page. No password entry, OTP, or email
  delivery is required: the server supplies the shared password
  (`apps/auth/src/routes/browser/sendCode.ts`). If a private portal requires a
  password field, provide the existing shared password there and explain that
  the browser login only needs the email. OAuth, PKCE, DCR, and consent still run.
- **Agent / API key (terminal):** call `POST /api/agent/send-code` on the auth
  host with the selected email. Pass the returned `otpSessionToken`, code
  `00000000`, and an API-key `label` to `POST /api/agent/verify-code` before
  the challenge expires. The placeholder is not the shared password; the server
  supplies that password. Start a fresh challenge if it expires or is consumed
  (`apps/auth/src/routes/agent/agentSendCode.ts` and `agentVerifyCode.ts`).
- **Workspace data:** before submission, seed a small disposable workspace
  through `sql_execute` or `POST /v1/agent/sql/execute` using the review
  account's own connection.

### Post-review cleanup and security posture

- Keep the shared password unchanged until all concurrent reviews finish.
  Then rotate it together with the passwords of every retained allowlisted
  Cognito user and the local secret config; refresh the deployed auth runtime
  through CI/CD and verify sign-in before reusing any account.
- When no active review needs an account, remove only its entry from the GitHub
  secret and local allowlists and redeploy through CI/CD, or disable/delete that
  Cognito user. Preserve all other accounts, their data, and the shared secret.
- Keep the seeded workspace disposable and replace it before future submissions
  if it accumulates irrelevant data.
- The demo account only ever sees its own workspace (per-user workspace
  scoping); it cannot read any other user's data.
- `@example.com` is IANA-reserved and can never receive real mail, so the
  synthetic addresses cannot be hijacked through email delivery.

## OAuth / DCR verification

Verify the discovery documents and the live connect flow before submitting.

### Authorization-server metadata

`GET https://auth.flashcards-open-source-app.com/.well-known/oauth-authorization-server`
must return `registration_endpoint`, `authorization_endpoint`, `token_endpoint`,
PKCE `code_challenge_methods_supported: ["S256"]`, and
`token_endpoint_auth_methods_supported: ["none"]`
(`apps/auth/src/routes/oauth/metadata.ts`):

```bash
curl -fsS https://auth.flashcards-open-source-app.com/.well-known/oauth-authorization-server \
  | jq '.registration_endpoint, .code_challenge_methods_supported, .token_endpoint_auth_methods_supported'
```

### Protected-resource metadata (RFC 9728)

`GET https://mcp.nibomo.com/.well-known/oauth-protected-resource`
and the `/mcp` path-aware variant both return `resource`
(`https://mcp.nibomo.com/mcp`) and `authorization_servers`:

```bash
curl -fsS https://mcp.nibomo.com/.well-known/oauth-protected-resource \
  | jq '.resource, .authorization_servers'
```

### End-to-end live connect

Add the connector pointed at `https://mcp.nibomo.com/mcp` in both clients and
confirm the full DCR → `/register` → `/authorize` → `/token` → tool-call flow
completes using the demo account. Record the result inline:

- **Claude (custom connector):** _pass / fail — date, notes_
- **ChatGPT (developer mode):** _pass / fail — date, notes_

## OpenAI prerequisites

Before submitting to the OpenAI Apps directory:

- Complete identity/business verification in the OpenAI platform dashboard.
- Ensure the OpenAI project is **not** set to EU data residency (global only).
- Confirm demonstrable domain ownership of `nibomo.com`, which covers both the
  listing metadata URLs and the MCP server host.
- Keep domain ownership of `flashcards-open-source-app.com` available too: the
  OAuth authorization server stays on `auth.flashcards-open-source-app.com`.

CIMD (Client ID Metadata Documents) is optional: the implemented Dynamic Client
Registration already satisfies the requirement, so add CIMD only if OpenAI
explicitly asks for it.
