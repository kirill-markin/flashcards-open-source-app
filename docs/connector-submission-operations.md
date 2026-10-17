# Connector submission operations runbook

Operational prerequisites for listing the remote MCP server in connector
directories: enabling the reviewer demo account, verifying OAuth/DCR end to
end, and the OpenAI-side prerequisites. The public listing copy and reviewer
walkthrough are in
[connector-directory-submission.md](connector-directory-submission.md).

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
- Protected-resource metadata (RFC 9728) returns valid JSON for both the root
  well-known path and the `/mcp` path-aware variant, with `resource`
  `https://mcp.nibomo.com/mcp` and its `authorization_servers`
  ([`mcp/hosts.ts`](../apps/backend/src/mcp/hosts.ts)):

  ```bash
  curl -fsS https://mcp.nibomo.com/.well-known/oauth-protected-resource | jq .
  curl -fsS https://mcp.nibomo.com/.well-known/oauth-protected-resource/mcp | jq .
  ```

- Authorization-server metadata returns valid JSON with the registration,
  authorization and token endpoints, PKCE `S256` and public-client token
  authentication ([`metadata.ts`](../apps/auth/src/routes/oauth/metadata.ts)):

  ```bash
  curl -fsS https://auth.flashcards-open-source-app.com/.well-known/oauth-authorization-server | jq .
  ```

- The selected review/demo account is enabled, can complete
  OAuth, and has a seeded workspace with decks and cards suitable for the
  reviewer walkthrough.
- Active reviewer access details stay out of public listing copy, screenshots,
  repository files, and PRs. Share them only through the private submission portal.
- Domain ownership of `nibomo.com`, which covers both the listing metadata URLs
  and the MCP server host, is demonstrable, and ownership of
  `flashcards-open-source-app.com` is available if a directory asks: the OAuth
  authorization server stays on `auth.flashcards-open-source-app.com`.

## Reviewer demo account

The insecure review/demo bypass lets a directory reviewer sign in to a synthetic
`@example.com` account without OTP and without receiving any email. A
comma-separated allowlist selects eligible accounts; the server supplies one
shared Cognito password for all of them. Browser users need only the allowlisted
email, so treat each active email as an access credential. Use a separate
synthetic account for each directory review, with only disposable data and no
access to real users' workspaces.

The deployment wiring already exists, so enabling an account is configuration,
not code: `AWS/Web Release` passes the repository secret `CDK_DEMO_EMAIL_DOSTIP`
(a secret so GitHub masks the allowlist in release step headers) and the
variable `CDK_DEMO_PASSWORD_SECRET_ARN`, which names the Secrets Manager secret
`flashcards-open-source-app/demo-password-dostip`, as CDK context, consumed in
[`infra/aws/lib/stack.ts`](../infra/aws/lib/stack.ts)
([infra/aws/README.md](../infra/aws/README.md#reviewdemo-accounts)).

### Operational enablement (operator only — AWS deploys via CI/CD)

AWS is never deployed locally. Make the configuration changes, push to `main`,
and let CI/CD deploy.

A deployment that still carries the allowlist in the older same-named GitHub
variable: populate the secret with that exact list, privately reconciled with
the root `.env` and the deployed auth/API allowlists, before the first release
that reads it, and delete the variable only after that release's deployed list
and log masking are verified. Preserve the existing accounts and shared
password throughout.

1. Privately compare deployed auth/API `DEMO_EMAIL_DOSTIP` with the canonical
   `DEMO_EMAIL_DOSTIP` in the main checkout's ignored root `.env`. GitHub cannot
   return secret plaintext, so reconcile those readable sources before editing.
   Preserve every existing entry, including accounts serving Apple, Google, and
   OpenAI reviews. Choose a new synthetic `@example.com` email for the directory.
2. Reuse the deployed Secrets Manager secret and its existing password.
   Preserve `CDK_DEMO_PASSWORD_SECRET_ARN`. Never replace or rotate the shared
   password while any review is active; do not run a secret setup helper with a
   new password merely to add an account.
3. Manually create the new Cognito user in the deployed user pool with the
   selected email and a permanent password equal to that existing shared
   password. Suppress invitation email and mark the synthetic email verified;
   it cannot receive mail. The allowlist settings do not provision Cognito users.
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

The first authenticated sign-in of the Cognito user from step 3 provisions its
default workspace. Seed small, disposable decks and cards through `sql_execute`
or `POST /v1/agent/sql/execute` on the demo account's own connection, honoring
the front/back card contract, so reviewer `SELECT`s return meaningful rows. SQL
cannot write review history: review some seeded cards to populate it.

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
  Never empty the allowlist or unset the secret ARN: synthesis fails without
  both ([`native-proof-gate.ts`](../infra/aws/lib/native-proof-gate.ts)).
- Keep the seeded workspace disposable and replace it before future submissions
  if it accumulates irrelevant data.
- The demo account only ever sees its own workspace (per-user workspace
  scoping); it cannot read any other user's data.
- `@example.com` is IANA-reserved and can never receive real mail, so the
  synthetic addresses cannot be hijacked through email delivery.

## OAuth / DCR verification

After the [pre-submit gate](#pre-submit-gate) metadata checks pass, add the
connector pointed at `https://mcp.nibomo.com/mcp` in both clients and confirm
the full DCR → `/register` → `/authorize` → `/token` → tool-call flow completes
using the demo account. Record the result inline:

- **Claude (custom connector):** _pass / fail — date, notes_
- **ChatGPT (developer mode):** _pass / fail — date, notes_

## OpenAI prerequisites

Publisher login, plugin, identity and the update procedure are in the
[OpenAI release gate](release/mcp-and-plugins.md#openai) and the companion's
[canonical OpenAI ZIP procedure](https://github.com/kirill-markin/nibomo-plugins/blob/main/docs/publishing.md#openai).
Before an applicable update/submission, also:

- Confirm organization-owner access or **Apps Management Write** in the owning
  organization.
- Supply private reviewer credentials and sign-in instructions only through
  **Review details**, keeping the account and sample data available for
  subsequent reviews.
- Ensure the MCP-review project is **not** set to EU data residency (global
  only), as required by [OpenAI app review](https://developers.openai.com/plugins/deploy/app-review).
  Use the [current submission guide](https://developers.openai.com/plugins/deploy/submission)
  for the actual package/update flow.

CIMD (Client ID Metadata Documents) is optional: the implemented Dynamic Client
Registration already satisfies the requirement, so add CIMD only if OpenAI
explicitly asks for it.
