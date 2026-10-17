# Backend and Web Deployment

## Local start

```bash
cp .env.example .env
make db-up
npm install --prefix apps/auth
npm install --prefix apps/backend
npm install --prefix apps/web
npm install --prefix apps/admin
```

Run the dev servers in separate terminals:

```bash
make auth-dev
make backend-dev
make web-dev
make admin-dev
```

`make db-up` starts Postgres on `5432` and applies migrations through [`migrate.sh`](../scripts/deploy/migrate.sh); auth serves on `8081`, the backend on `8080`, the web app on `3000` and the admin app on `3001`. [`.env.example`](../.env.example) explains every local value, including the `AUTH_MODE` choice. Stop with `make db-down`.

## Local browser smoke with auth

The local web smoke validates the current branch without relying on production auth redirect allowlists; the deployed post-release smoke is described in [release gates](./release-gates.md).

1. Keep root `.env` in `AUTH_MODE=cognito` with the Cognito values, `SESSION_ENCRYPTION_KEY` and `PUBLIC_APP_BASE_URL=http://localhost:3000`.
2. Set `DEMO_EMAIL_DOSTIP` and `DEMO_PASSWORD_DOSTIP` for the local review account.
3. Start `make db-up`, `make auth-dev` and `make backend-dev`.
4. Run `npm run test:e2e:local --prefix apps/web`. Playwright serves the web preview itself; [the preflight](../apps/web/scripts/check-local-e2e-stack.mjs) fails when local auth or backend is missing.

## Non-CDK/self-hosted backend runtime

Set `PUBLIC_APP_BASE_URL` to the public origin of the web app ([rules](../.env.example)); CDK deployments inject `https://app.<baseDomain>`.

### Client compatibility

Before connecting a newer client, deploy the current backend and request
`GET <API_BASE_URL>/health`. A compatible response returns HTTP `200` and
includes an integer `cloudContractVersion`. This version identifies the
supported guest-session and workspace-sync protocol generation; it is not an
app release version or proof that the database is correct. If the field is
missing or the client does not support the advertised version, update and
redeploy the backend before connecting the client.

### iOS custom-server compatibility and guest recovery

Validate this flow manually on the supported iOS device or simulator after an
iOS build is available. Keep a copy of the local workspace, card, and pending
outbox counts before each recovery action.

1. Connect a custom deployment whose API `GET /health` returns HTTP `200`,
   `service: "flashcards-open-source-app-backend"`, and integer
   `cloudContractVersion: 1`, and whose auth health endpoint returns HTTP `2xx`.
   Confirm iOS shows the destructive switch confirmation only after both checks
   succeed.
2. Repeat with the API health response missing `service`, using another service
   value, missing or malformed `cloudContractVersion`, and using an unsupported
   integer version. Confirm iOS explains that the custom server must be updated
   and redeployed, does not show the switch confirmation, and keeps the saved
   server configuration and credentials unchanged. Also confirm an auth health
   failure still rejects the server. Make either health endpoint redirect to a
   different scheme, host, or effective port and confirm iOS rejects it with the
   final URL shown; confirm a same-origin redirect remains valid.
3. On a compatible custom deployment, create or retain a guest session and make
   its `POST /workspaces/<guest-workspace-id>/sync/bootstrap` return HTTP `404`
   with `code: "WORKSPACE_NOT_FOUND"`. Exercise both the first bootstrap before
   local-to-remote workspace migration and a later sync. Confirm Account Status
   shows the paused custom-server explanation, server, HTTP status, backend code,
   request reference when supplied, Retry, and Change Server. Confirm local
   review, card editing, cards, pending outbox operations, and the stored guest
   identity remain available, while polling and passive AI snapshot preparation
   do not produce more requests or repeated error captures.
4. Force-quit and relaunch while the custom server still returns the classified
   `404`. Confirm the same pause and original diagnostics remain without an
   automatic bootstrap attempt. Separately remove the paused guest credential
   and relaunch: confirm iOS enters the existing guest-credential recovery flow
   instead of creating a replacement guest. Repeat with an unreadable guest
   credential and confirm iOS enters invalid stored-state recovery. Simulate an
   interrupted local identity reset that leaves the pause record behind but
   starts the app with a new installation ID; confirm the stale pause is cleared
   and does not enter guest-credential recovery for the new installation.
5. Repair the server so the same guest token, user, and workspace are accepted,
   then tap Retry. Confirm immediate native loading feedback, a successful sync,
   the pause clearing, and the same guest identity and local data remaining in
   use. Repeat with the server still broken and confirm the failed retry remains
   paused without creating another guest or workspace.
6. Re-enter the paused state, choose Change Server, and switch through the
   existing Server screen. Confirm the old pause cannot block or be revived by a
   stale response from the previous server, and confirm local workspace and card
   data remain on the device after the switch. The old guest credential belongs
   to the previous server and follows the existing explicit server-switch
   credential cleanup behavior.

## First AWS deploy

Keep the operator config in root `.env`; [`.env.example`](../.env.example) lists the base values: the Resend, OpenAI and review-account keys and the `Local operator / deploy setup` block. The second-host inputs are below. Then run [`first-deploy.sh`](../scripts/deploy/first-deploy.sh), which stores the runtime secrets, requests the certificates, deploys CDK, uploads the web and admin assets and fills missing GitHub variables:

```bash
bash scripts/deploy/first-deploy.sh \
  --region eu-central-1 \
  --domain flashcards-open-source-app.com \
  --alert-email alerts@example.com
```

Public hosts after deploy: `https://<domain>` (an optional redirect to the app, left untouched when the apex already points at a site), `https://app.<domain>`, `https://admin.<domain>`, `https://api.<domain>/v1`, `https://auth.<domain>` and `https://mcp.<domain>/mcp`, plus the optional second hosts below.

Adding `admin.<domain>` to an existing deploy follows the [admin rollout](./admin-app.md#self-hosted-deploy). Adding `mcp.<domain>`:

1. `bash scripts/cloudflare/setup-mcp-domain.sh --domain <domain> --region <region>` requests the certificate.
2. `bash scripts/setup/setup-github.sh`, then deploy. GitHub variables bind when a workflow run is created, so a run queued before the certificate variable exists deploys without it and still goes green; deploy again after the variable exists.
3. `bash scripts/cloudflare/setup-dns.sh --stack-name <stack-name> --domain <domain>` creates the CNAME from the `McpCustomDomainTarget` output.

### Second hosts outside `<domain>`

The API, auth, MCP, web and admin hosts can each answer on one extra hostname outside `<domain>`, for example a rebranded domain. Each is off until both of its variables are set, never replaces the `<domain>` host, and is configured by hand: `setup-github.sh` cannot derive these hosts, and `setup-dns.sh` manages only records under `<domain>`, so the certificates and DNS records are manual too. For a local context file, set the root `.env` variables that [`generate-cdk-context.sh`](../scripts/generate/generate-cdk-context.sh) reads; the web and admin certificate ARNs must be set explicitly there, because a multi-SAN certificate cannot be discovered by the extra host's name.

Never move `CDK_DOMAIN_NAME` to add a host. Every host name derives from it, so changing it makes CloudFormation delete `api.<domain>` and `auth.<domain>`, which every shipped mobile build has compiled in.

An API, auth or MCP host is created by one deploy and policed by a later one, because its CNAME can only point at a stack output that exists once the custom domain is deployed ([`mcp-alternate-host.ts`](../infra/aws/lib/mcp-alternate-host.ts), [`stack.ts`](../infra/aws/lib/stack.ts)). Synth refuses a name the stack already serves ([`alternate-host.ts`](../infra/aws/lib/alternate-host.ts), [`cloudfront-additional-host.ts`](../infra/aws/lib/cloudfront-additional-host.ts)).

### Optional second API and auth host

Variables: `CDK_API_ALTERNATE_DOMAIN_NAME` with `CDK_API_ALTERNATE_CERTIFICATE_ARN`, and `CDK_AUTH_ALTERNATE_DOMAIN_NAME` with `CDK_AUTH_ALTERNATE_CERTIFICATE_ARN`, each certificate issued in the stack region; `CDK_API_ALTERNATE_HOST_LIVE` and `CDK_AUTH_ALTERNATE_HOST_LIVE` declare the host live.

A browser reaches these hosts with cookies, so a host outside `<domain>` needs `CDK_COOKIE_DOMAIN` set no later than the deploy that creates it; synth refuses it otherwise, and why `<domain>` is never dropped is in [`cookie-domains.ts`](../infra/aws/lib/cookie-domains.ts). Setting it only adds a cookie domain, so it never invalidates a working cookie, and a browser first seen on the new domain is a new analytics visitor.

1. Request and validate the certificates, set the domain and certificate variables and `CDK_COOKIE_DOMAIN` (unless the hosts sit under `<domain>`), and deploy. The stack emits `ApiAlternateCustomDomainTarget` and `AuthAlternateCustomDomainTarget`.
2. Create each CNAME in its own zone, then confirm by hand that `GET https://<extra-api-host>/v1/` and `GET https://<extra-auth-host>/health` answer.
3. Set both `*_HOST_LIVE` variables to `true` and deploy again; the hosts join the liveness heartbeat and its alarms.
4. Move clients to the new hosts. A passing auth `/health` does not prove browser sign-in: the web or admin host serving the bundle must also be configured below, because its origin reaches the API CORS and auth redirect allowlists only then ([`auth-gateway.ts`](../infra/aws/lib/gateways/auth-gateway.ts)).

### Optional second MCP host

Variables: `CDK_MCP_ALTERNATE_DOMAIN_NAME` and `CDK_MCP_ALTERNATE_CERTIFICATE_ARN`, issued in the stack region. Both hosts authorize against `auth.<domain>`, but tokens are bound to the host the client used, so a client moved to the second host authorizes once more ([`hosts.ts`](../apps/backend/src/mcp/hosts.ts)).

1. Request and validate the certificate, set both variables, and deploy. The stack emits `McpAlternateCustomDomainTarget`.
2. Create the CNAME in its own zone and confirm by hand that `GET https://<extra-host>/health` answers `200`.
3. Set `CDK_MCP_ALTERNATE_HOST_LIVE` to `true` and deploy again; the host joins the liveness heartbeat, its alarm and the post-deploy MCP smoke. The stack and the smoke job in [`aws-web-release.yml`](../.github/workflows/aws-web-release.yml) read the switch the same way, so they turn on and off together.

To stop policing the host without removing it, clear `CDK_MCP_ALTERNATE_HOST_LIVE` and deploy; issued tokens are untouched.

### Optional second web and admin hosts

Variables: `CDK_WEB_ADDITIONAL_DOMAIN_NAME` with `CDK_WEB_ADDITIONAL_CERTIFICATE_ARN_US_EAST_1`, and `CDK_ADMIN_ADDITIONAL_DOMAIN_NAME` with `CDK_ADMIN_ADDITIONAL_CERTIFICATE_ARN_US_EAST_1`. The certificate replaces the distribution's current one, so it must be a us-east-1 certificate covering both the `<domain>` host and the extra host ([why](../infra/aws/lib/cloudfront-additional-host.ts)).

1. Request and validate that certificate, set the pair, and deploy. The distribution keeps its ID and `*.cloudfront.net` name.
2. Create the extra host's record in its own zone, pointing at that `*.cloudfront.net` name, and confirm the app answers on it.
3. The served bundle keeps the API and auth hosts it was built with; moving them is a separate change.
4. Once the extra host is confirmed, retire `app.<domain>` below in a separate deploy.

### Retiring the primary web host

`CDK_WEB_PRIMARY_HOST_RETIRED=true` makes `app.<domain>` answer a permanent redirect to the same path and query on `CDK_WEB_ADDITIONAL_DOMAIN_NAME`, and moves the links the backend generates (invites, catalog install links) to that host ([`web.ts`](../infra/aws/lib/web.ts)). Share links are not among them: the web app builds its own from its build configuration and the mobile apps compile theirs in, so they keep reaching the retired host through the redirect until the clients change.

- Set or unset the variable before the release run is queued: a run already queued deploys the old value and still goes green.
- Rolling back is unsetting it and running a full AWS/Web release; a browser that already saw the redirect follows it for up to five more minutes.
- `api.<domain>`, `auth.<domain>` and `mcp.<domain>` are never redirected: shipped mobile clients keep calling them, and a redirect on an API host loses the method and body in some HTTP clients.

## GitHub variables after bootstrap

After the first setup, GitHub repository variables are the deploy-time source of truth and root `.env` is not. [`setup-github.sh`](../scripts/setup/setup-github.sh) only creates missing variables and secrets, so change a deployed value (for example `CDK_ADMIN_EMAILS`) in GitHub and redeploy, and disable an optional feature by deleting its variable. Later secret updates:

```bash
bash scripts/setup/setup-resend-secret.sh --region eu-central-1
bash scripts/setup/setup-ai-secrets.sh --region eu-central-1
bash scripts/setup/setup-auth-secrets.sh --region eu-central-1
bash scripts/setup/setup-github.sh
```

Run only the secret scripts you need; `setup-github.sh` then fills in any missing ARNs.

## Optional review account auth

Follow the canonical [reviewer account procedure](connector-submission-operations.md#reviewer-demo-account)
to add synthetic review accounts, preserve concurrent review access, deploy
through CI/CD, verify access, and clean up afterward.

## Global metrics snapshot

The daily snapshot job always runs, and CI seeds the snapshot after every platform deploy; only `GET /v1/global/snapshot` visibility is optional. Only the exact string `true` in `CDK_GLOBAL_METRICS_VISIBLE` exposes it; `GLOBAL_METRICS_VISIBLE=true` in root `.env` bootstraps that variable through `setup-github.sh`. Feature contract and counting caveats: [docs/global-metrics.md](./global-metrics.md).

## CI/CD

`AWS/Web Release` runs on push to `main` and assembles its CDK context from the GitHub variables inside the job. For the order of its jobs, the component selection and what each smoke covers, read [release gates](./release-gates.md) and [`aws-web-release.yml`](../.github/workflows/aws-web-release.yml); manual `workflow_dispatch` runs deploy every component.

After pushing to `main`, watch `AWS/Web Release` until it finishes green or fails clearly after deploy. The pipeline is fix-forward only: a failed post-deploy smoke leaves the release in place and marks the run failed, and the next push must still be allowed to deploy. There is no automated production admin login smoke; use the [admin manual smoke checklist](./admin-app.md#manual-smoke-checklist).

Live smoke references: web `apps/web/e2e/live-smoke.spec.ts`, iOS `apps/ios/Flashcards/FlashcardsUITests/LiveSmoke*Tests.swift`, Android `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/livesmoke/LiveSmokeTest.kt`.

The monthly AI allowance is resolved in backend code, not configured per environment ([Premium Entitlements](./premium-entitlements.md), "Limits resolve on the backend").
