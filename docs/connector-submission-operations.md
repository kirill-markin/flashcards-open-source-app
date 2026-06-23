# Connector submission operations runbook

Operational, no-code prerequisites for listing the remote MCP server in
connector directories. This is the operator-facing companion to
[connector-directory-submission.md](connector-directory-submission.md): that
file owns the public listing copy and the reviewer walkthrough, while this file
covers the actions an operator performs (enabling the reviewer demo account,
verifying the OAuth/DCR flow end-to-end, and the OpenAI-side prerequisites).

Reviewer credentials (the demo email and shared password) are never committed
here; they are provided to each directory through its private submission portal
only.

## Reviewer demo account

The insecure review/demo bypass lets a directory reviewer sign in to a synthetic
`@example.com` account without OTP and without receiving any email. It is gated
to an explicit allowlist and a single shared password, and it only ever reaches
that account's own workspace.

### Wiring already exists (no infra code needed)

The infrastructure to deliver the demo configuration to the Lambdas is already
in place. Enabling the demo account is a configuration/secret task, not a code
change.

- `infra/aws/lib/gateways/auth-gateway.ts` sets `DEMO_EMAIL_DOSTIP` and
  `DEMO_PASSWORD_SECRET_ARN` on the auth Lambda.
- `infra/aws/lib/gateways/api-gateway.ts` sets `DEMO_EMAIL_DOSTIP` on the agent
  surface.
- `.github/workflows/aws-web-release.yml` forwards the `CDK_DEMO_EMAIL_DOSTIP`
  and `CDK_DEMO_PASSWORD_SECRET_ARN` repo variables into CDK context for both
  the auth and API stacks.
- AWS secret name: `flashcards-open-source-app/demo-password-dostip`
  (see [infra/aws/README.md](../infra/aws/README.md), "Review/demo accounts").

### Operational enablement (operator only — AWS deploys via CI/CD)

AWS is never deployed locally. Make the configuration changes, push to `main`,
and let CI/CD deploy.

1. Choose the review email(s) under the `@example.com` guardian domain — for
   example `directory-review@example.com`, or split telemetry per directory with
   `claude-review@example.com` and `chatgpt-review@example.com`. The allowlist
   rejects any value that is not `@example.com`
   (`apps/auth/src/server/demoEmailAccess.ts`).
2. Create or populate the AWS Secrets Manager secret
   `flashcards-open-source-app/demo-password-dostip` with a strong shared
   password.
3. Create the matching Cognito users manually: these settings do not provision
   Cognito accounts, so each allowlisted email needs a Cognito user whose
   password equals the shared demo password (see the README section above).
4. Set the GitHub repo variables `CDK_DEMO_EMAIL_DOSTIP` (the email, or a
   comma-separated list) and `CDK_DEMO_PASSWORD_SECRET_ARN` (the secret ARN).
5. Push to `main` and let CI/CD deploy.

After deploy, validate the deployed state with:

```bash
bash scripts/checks/check-demo-cognito-users.sh \
  --stack-name FlashcardsOpenSourceApp --region eu-central-1
```

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

- **Browser / OAuth (Claude custom connector and ChatGPT):** enter the review
  email on the auth login page; the server signs in automatically with the
  configured shared password — no OTP, no email
  (`apps/auth/src/routes/browser/sendCode.ts`). The full OAuth + PKCE + DCR +
  consent handshake still runs; only the email-OTP step is replaced.
- **Agent / API key (terminal):** same email, deterministic placeholder code
  `00000000` (`apps/auth/src/routes/agent/agentVerifyCode.ts`).

### Security posture

- Rotate the demo password after review completes.
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

`GET https://mcp.flashcards-open-source-app.com/.well-known/oauth-protected-resource`
and the `/mcp` path-aware variant both return `resource`
(`https://mcp.flashcards-open-source-app.com/mcp`) and `authorization_servers`:

```bash
curl -fsS https://mcp.flashcards-open-source-app.com/.well-known/oauth-protected-resource \
  | jq '.resource, .authorization_servers'
```

### End-to-end live connect

Add the connector pointed at `https://mcp.flashcards-open-source-app.com/mcp` in
both clients and confirm the full DCR → `/register` → `/authorize` → `/token` →
tool-call flow completes using the demo account. Record the result inline:

- **Claude (custom connector):** _pass / fail — date, notes_
- **ChatGPT (developer mode):** _pass / fail — date, notes_

## OpenAI prerequisites

Before submitting to the OpenAI Apps directory:

- Complete identity/business verification in the OpenAI platform dashboard.
- Ensure the OpenAI project is **not** set to EU data residency (global only).
- Confirm demonstrable domain ownership of `flashcards-open-source-app.com`.

CIMD (Client ID Metadata Documents) is optional: the implemented Dynamic Client
Registration already satisfies the requirement, so add CIMD only if OpenAI
explicitly asks for it.
