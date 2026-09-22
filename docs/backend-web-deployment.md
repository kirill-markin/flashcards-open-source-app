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

This starts:

1. `postgres` on port `5432`
2. `migrate` via `scripts/deploy/migrate.sh`
3. `auth` on port `8081`
4. `backend` on port `8080`
5. `web` on port `3000`
6. `admin` on port `3001`

By default `AUTH_MODE=none`, so backend accepts local requests as `userId=local`. Set `AUTH_MODE=cognito` and fill the Cognito values in `.env` to test the real OTP flow locally. Keep `PUBLIC_APP_BASE_URL=http://localhost:3000`; authenticated local startup requires that explicit web-app origin for catalog install links and public catalog CORS.

Set `GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP=400000` in local `.env` if you want guest AI enabled locally. When this variable is missing or empty, backend defaults it to `0`, so guest AI fails closed with the existing limit-reached response.

Stop local services with:

```bash
make db-down
```

## Local browser smoke with auth

The full local web smoke is intentionally separate from the deployed post-release smoke.

Use it only against the local stack:

1. keep root `.env` in `AUTH_MODE=cognito`
2. set `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `COGNITO_REGION`, `SESSION_ENCRYPTION_KEY`, and `PUBLIC_APP_BASE_URL=http://localhost:3000`
3. set `DEMO_EMAIL_DOSTIP` and `DEMO_PASSWORD_DOSTIP` for the local review account
4. start `make db-up`
5. start `make auth-dev`
6. start `make backend-dev`
7. run `npm run test:e2e:local --prefix apps/web`

`test:e2e:local` talks only to:

- local web on `http://localhost:3000`
- local backend on `http://localhost:8080`
- local auth on `http://localhost:8081`

Playwright builds and serves the local web preview automatically, but it does not start backend or auth for you. The preflight step fails immediately if local auth or backend is missing or if the local smoke points at any deployed origin.

This split is deliberate:

- local smoke validates the current branch without relying on production auth redirect allowlists
- CI/CD post-deploy smoke exercises the merge commit's web client against the deployed backend and auth, on the production host name and production auth redirect allowlists; it does not load the deployed web assets. [docs/release-gates.md](./release-gates.md) is the canonical description of what each gate covers.

## Non-CDK/self-hosted backend runtime

Set `PUBLIC_APP_BASE_URL` to the public origin of the web app, for example
`https://app.example.com`. It is required unless the backend runs with the
explicit local-only `AUTH_MODE=none` and `ALLOW_INSECURE_LOCAL_AUTH=true`
policy. The value must be one exact HTTP(S) origin without credentials, path,
query, fragment, or wildcard. CDK deployments inject
`https://app.<baseDomain>` automatically.

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

Keep the operator config in root `.env`. The important deploy-time values are:

- `AWS_REGION`
- `DOMAIN_NAME`
- `ALERT_EMAIL`
- `GITHUB_REPO`
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ZONE_ID`
- `RESEND_API_KEY`
- `RESEND_ADMIN_API_KEY`
- backend Sentry: `SENTRY_DSN` or `SENTRY_DSN_SECRET_ARN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`, `SENTRY_TRACES_SAMPLE_RATE`, `SENTRY_ORG`, `SENTRY_BACKEND_PROJECT`, and `SENTRY_AUTH_TOKEN`
- optional web Sentry: `VITE_SENTRY_DSN`, `VITE_SENTRY_TRACES_SAMPLE_RATE`, and `SENTRY_WEB_PROJECT`; web source map uploads reuse `SENTRY_ORG` and `SENTRY_AUTH_TOKEN`
- optional `OPENAI_API_KEY`
- optional `DEMO_EMAIL_DOSTIP`
- optional `DEMO_PASSWORD_DOSTIP`

Then run:

```bash
bash scripts/deploy/first-deploy.sh \
  --region eu-central-1 \
  --domain flashcards-open-source-app.com \
  --alert-email alerts@example.com
```

The first deploy flow:

- stores required runtime secrets in AWS Secrets Manager
- stores optional AI and review account auth secrets in AWS Secrets Manager when configured
- requests ACM certificates for API, auth, web, and apex redirect when needed
- requests the ACM certificate for `admin.<domain>` when needed
- assembles `infra/aws/cdk.context.local.json` as the local CDK input
- bootstraps and deploys CDK
- uploads web and admin assets
- configures Cloudflare DNS when requested
- populates missing deploy config in GitHub Actions variables without overwriting existing values

Public domains after deploy:

- `https://<domain>`
- `https://app.<domain>`
- `https://admin.<domain>`
- `https://api.<domain>/v1`
- `https://auth.<domain>`
- `https://mcp.<domain>/mcp`
- optionally one extra host each for the web and admin apps, see [Optional second web and admin hosts](#optional-second-web-and-admin-hosts)

If the apex domain already points to an existing site, bootstrap leaves it untouched and manages only `app.<domain>`, `admin.<domain>`, `api.<domain>`, `auth.<domain>`, and `mcp.<domain>`.

For the admin app, the supported browser entrypoints are `http://localhost:3001` and `https://admin.<domain>`. Treat `admin.<domain>` as the only supported deployed browser entrypoint.
For the first admin-domain rollout, treat `bash scripts/cloudflare/setup-admin-domain.sh --domain <domain>`, `bash scripts/setup/setup-github.sh`, a deploy, and then `bash scripts/cloudflare/setup-dns.sh --stack-name <stack-name> --domain <domain>` as one complete setup sequence. If the GitHub variables were created after a workflow had already started, run another deploy or rerun the workflow after the variables exist.

The MCP host on `mcp.<domain>` follows the same per-subdomain rollout: `bash scripts/cloudflare/setup-mcp-domain.sh --domain <domain> --region <region>` requests the ACM certificate, then `bash scripts/setup/setup-github.sh`, a deploy, and `bash scripts/cloudflare/setup-dns.sh --stack-name <stack-name> --domain <domain>` to create the `mcp.<domain>` CNAME from the `McpCustomDomainTarget` output.

### Optional second API and auth host

The REST API and the auth API can each answer on one extra hostname outside `<domain>`, on the same stage as the primary host. Both are off by default, neither replaces `api.<domain>` or `auth.<domain>`, and each needs both of its repository variables before anything changes:

- `CDK_API_ALTERNATE_DOMAIN_NAME` and `CDK_API_ALTERNATE_CERTIFICATE_ARN`: the extra API host, for example `api.nibomo.com`, and an ACM certificate for it issued and validated in the stack region.
- `CDK_AUTH_ALTERNATE_DOMAIN_NAME` and `CDK_AUTH_ALTERNATE_CERTIFICATE_ARN`: the same for the extra auth host.
- `CDK_API_ALTERNATE_HOST_LIVE` and `CDK_AUTH_ALTERNATE_HOST_LIVE`: set to `true` only once the host's DNS record exists, exactly like `CDK_MCP_ALTERNATE_HOST_LIVE` below. Until then the host is created but not probed.

The extra API host serves `v1` and `robots.txt` exactly like `api.<domain>`. Naming a host the stack already serves — its own primary host, another pair's primary host, or another alternate — fails at synth with `AlternateHostConflictError` instead of failing the deploy halfway with a duplicate-domain error (`infra/aws/lib/alternate-host.ts`).

Once a host is created, its certificate gets its own expiry alarm; once it is declared live, it joins the external liveness heartbeat and gains its own heartbeat alarm.

Never move `CDK_DOMAIN_NAME` to add a host. Every host name derives from it, so changing it makes CloudFormation create the new custom domains and delete `api.<domain>` and `auth.<domain>`, which every already shipped mobile build has compiled in.

`CDK_COOKIE_DOMAIN` is separate from all of this, and it is not a switch. A browser cookie carries one explicit `Domain`, and RFC 6265 section 5.3.6 makes a browser discard a `Set-Cookie` naming a domain the request host is not under, so while two registrable domains serve browsers at once no single value is correct for both. `COOKIE_DOMAIN` is therefore the comma-separated set of candidate domains the backend and the auth service both receive — always `<domain>`, plus `CDK_COOKIE_DOMAIN` when it is set — and every request resolves its own domain from its `Host`: the most specific candidate the host equals or sits under. A host under none of the candidates fails the request instead of being handed a cookie the browser would drop. Both services resolve it the same way from the same value ([`apps/backend/src/shared/cookieDomain.ts`](../apps/backend/src/shared/cookieDomain.ts), mirrored in [`apps/auth/src/server/cookieDomain.ts`](../apps/auth/src/server/cookieDomain.ts)), so the session cookies and the analytics visitor cookie cannot land on different domains for one browser. With `CDK_COOKIE_DOMAIN` unset the set is `<domain>` alone, which is byte-for-byte the behaviour before a second domain existed. Setting it adds a domain and removes none, so it never invalidates a cookie already working, but its timing still matters and it matters in one direction: a host under none of the candidates fails every browser request that touches a cookie, so `CDK_COOKIE_DOMAIN` has to be set no later than the deploy that creates an alternate host outside `<domain>`. Synth enforces that. A resolved alternate API or auth host, or a second web or admin host, under none of the candidates fails with `CookieDomainCoverageError` naming the host ([`infra/aws/lib/cookie-domains.ts`](../infra/aws/lib/cookie-domains.ts)), instead of deploying a stack that answers `500` on sign-in after Cognito has already authenticated the person and on `GET /v1/analytics/visitor` at page load. A host whose pair is half-configured creates nothing and is not checked. Visitor cookies do not cross domains, so a browser first seen on the new domain is simply a new visitor.

`<domain>` is never dropped from that set, and not only for the length of a cutover. `auth.<domain>` is the pinned OAuth authorization server: `PUBLIC_AUTH_BASE_URL` is built from `CDK_DOMAIN_NAME` ([`infra/aws/lib/gateways/auth-gateway.ts`](../infra/aws/lib/gateways/auth-gateway.ts)), and the MCP protected-resource metadata that every client fetches names it ([`apps/backend/src/mcp/hosts.ts`](../apps/backend/src/mcp/hosts.ts)), so every MCP client and every connector-directory entry issued so far authorizes there. Sign-in on that host is cookie-based, so its cookies have to keep working indefinitely; a configuration under which they stop being stored loops all of those clients through authorization forever.

With none of these variables set the deploy is byte-for-byte what it is today. `scripts/setup/setup-github.sh` does not create them, because these hosts cannot be derived from `<domain>`; set them manually. Both the certificates and the DNS records are manual: `scripts/cloudflare/setup-dns.sh` only manages records under `<domain>`.

#### Go-live order

Creating a host and pointing DNS at it are separate deploys for the same reason as the second MCP host: the CNAME can only be created from a stack output that does not exist until the custom domain has been deployed.

1. Request and validate the ACM certificates for the extra hosts in the stack region, set the domain and certificate variables above, set `CDK_COOKIE_DOMAIN` to the domain those hosts sit under unless they are already under `<domain>`, and deploy. Synth fails on the missing cookie domain before anything is created, so this is one change, not two. The stack creates the second custom domains, maps the same stages onto them, and emits the `ApiAlternateCustomDomainTarget` and `AuthAlternateCustomDomainTarget` outputs. Nothing probes the hosts yet.
2. Create each CNAME in its own DNS zone, pointing at the matching output, then confirm by hand that `GET https://<extra-api-host>/v1/` and `GET https://<extra-auth-host>/health` answer.
3. Set `CDK_API_ALTERNATE_HOST_LIVE` and `CDK_AUTH_ALTERNATE_HOST_LIVE` to `true` and deploy again. Only now do the hosts join the external liveness heartbeat and gain their heartbeat alarms.
4. Move clients to the new hosts. `CDK_COOKIE_DOMAIN` already covers them from step 1 and needs no change here: it adds a cookie domain rather than moving one.

A passing `GET https://<extra-auth-host>/health` is not evidence the auth host is usable from a browser. Sessions are cookie-based (`apps/auth/src/server/browserSession.ts`), so the extra host has to sit under one of the `COOKIE_DOMAIN` candidates above; synth refuses the stack otherwise, and were one to reach a browser anyway a real login fails loudly on the first cookie it sets rather than answering every request and silently dropping the session. The same holds for an extra host serving the web or admin bundle: its origin joins the API's CORS allowlists from the same resolved CloudFront host the distribution serves (`CDK_WEB_ADDITIONAL_DOMAIN_NAME` and `CDK_ADMIN_ADDITIONAL_DOMAIN_NAME` with their certificates, resolved in `infra/aws/lib/cloudfront-additional-host.ts`), so until that pair is complete that host serves assets and nothing else — every API preflight fails. The same resolved host also has to reach `ALLOWED_REDIRECT_URIS` (`infra/aws/lib/gateways/auth-gateway.ts`), which is the auth service's only browser allowlist: it gates both the login and logout `redirect_uri` targets and the auth API's CORS, so a bundle whose origin is missing there answers `400 Invalid redirect_uri` on sign-in and `403` on every auth call, whatever the API allows. Origins and clients still move together in step 4; the cookie domain is already in place by then and does not move with them.

For a local context file, `API_ALTERNATE_DOMAIN_NAME`, `AUTH_ALTERNATE_DOMAIN_NAME`, their optional `*_CERTIFICATE_ARN` and `*_HOST_LIVE` counterparts and `CDK_COOKIE_DOMAIN` in root `.env` feed the same CDK context values through `scripts/generate/generate-cdk-context.sh`.

### Optional second MCP host

The same MCP API can answer on one extra hostname outside `<domain>`, for example a rebranded domain. It is off by default, it never replaces `mcp.<domain>`, and both repository variables are required before anything changes:

- `CDK_MCP_ALTERNATE_DOMAIN_NAME`: the extra host, for example `mcp.nibomo.com`.
- `CDK_MCP_ALTERNATE_CERTIFICATE_ARN`: an ACM certificate for that host, issued and validated in the stack region.

Both hosts serve the same MCP API and authorize against the same server, `auth.<domain>`, but OAuth identifiers are per-host: the protected-resource metadata and the `WWW-Authenticate` challenge name the host the client actually used, and an access token is accepted only on the host whose resource identifier it carries (`apps/backend/src/mcp/hosts.ts`, `apps/auth/src/server/publicUrls.ts`). Tokens already issued for `mcp.<domain>` keep working there; a user who moves a client to the second host authorizes once more. Once the host is configured its certificate gets its own expiry alarm.

With either variable unset the deploy is byte-for-byte what it is today. `scripts/setup/setup-github.sh` does not create these variables, because the host cannot be derived from `<domain>`; set them manually. Both the certificate and the DNS record are manual: `scripts/cloudflare/setup-dns.sh` only manages records under `<domain>`.

#### Go-live order

The three steps are separate deploys on purpose. The alternate host's CNAME can only be created from a stack output that does not exist until the custom domain has been deployed, so the deploy that creates the host must not be the deploy that starts policing it.

1. Request and validate the ACM certificate for the extra host in the stack region, set `CDK_MCP_ALTERNATE_DOMAIN_NAME` and `CDK_MCP_ALTERNATE_CERTIFICATE_ARN`, and deploy. The stack creates the second custom domain, maps the same stage onto it, and emits the `McpAlternateCustomDomainTarget` output. Nothing probes the host yet.
2. Create the CNAME for the extra host in its own DNS zone, pointing at that output, and confirm by hand that `GET https://<extra-host>/health` answers `200`.
3. Set `CDK_MCP_ALTERNATE_HOST_LIVE` to `true` and deploy again. Only now does the host join the external liveness heartbeat, gain its heartbeat alarm, and get checked by the post-deploy MCP smoke.

One rule decides whether the host is policed, and all three variables take part in it: `CDK_MCP_ALTERNATE_DOMAIN_NAME` and `CDK_MCP_ALTERNATE_CERTIFICATE_ARN` both carry a value, and `CDK_MCP_ALTERNATE_HOST_LIVE` reads `true` ignoring surrounding whitespace and letter case. Any other live value, and clearing either of the other two, leaves the host unpoliced. The stack applies that rule in `infra/aws/lib/mcp-alternate-host.ts` and the MCP smoke job in `.github/workflows/aws-web-release.yml` applies the same one, so the heartbeat, its alarm and the smoke are on together or off together, and the smoke never probes a host the stack did not create.

To stop policing the host without removing it, set `CDK_MCP_ALTERNATE_HOST_LIVE` back to an empty value and deploy; the custom domain, the Lambda environments and the issued tokens are untouched, because the switch never reaches them.

For a local context file, `MCP_ALTERNATE_DOMAIN_NAME`, the optional `MCP_ALTERNATE_CERTIFICATE_ARN` and `MCP_ALTERNATE_HOST_LIVE` in root `.env` feed the same CDK context values through `scripts/generate/generate-cdk-context.sh`.

### Optional second web and admin hosts

The same CloudFront distributions can each answer on one extra hostname outside `<domain>`, for example a rebranded domain. Both are off by default, neither replaces `app.<domain>` or `admin.<domain>`, and each host needs both of its repository variables before anything changes:

- `CDK_WEB_ADDITIONAL_DOMAIN_NAME` and `CDK_WEB_ADDITIONAL_CERTIFICATE_ARN_US_EAST_1` for the web app.
- `CDK_ADMIN_ADDITIONAL_DOMAIN_NAME` and `CDK_ADMIN_ADDITIONAL_CERTIFICATE_ARN_US_EAST_1` for the admin app.

A CloudFront distribution accepts many alternate domain names but exactly one viewer certificate, and that certificate must cover all of them. The certificate above is therefore not an addition: it replaces `CDK_WEB_CERTIFICATE_ARN_US_EAST_1`, or the admin one, on the distribution, so it must be a us-east-1 certificate that lists both the `<domain>` host and the extra host. Request and validate it before setting the variables. `infra/aws/lib/cloudfront-additional-host.ts` applies that rule.

With either variable of a pair unset the deploy is byte-for-byte what it is today. `scripts/setup/setup-github.sh` does not create these variables, because the host cannot be derived from `<domain>`; set them manually. The DNS record is manual too: `scripts/cloudflare/setup-dns.sh` only manages records under `<domain>`.

For a local context file, `WEB_ADDITIONAL_DOMAIN_NAME`, `WEB_ADDITIONAL_CERTIFICATE_ARN`, `WEB_PRIMARY_HOST_RETIRED`, `ADMIN_ADDITIONAL_DOMAIN_NAME` and `ADMIN_ADDITIONAL_CERTIFICATE_ARN` in root `.env` feed the same CDK context values through `scripts/generate/generate-cdk-context.sh`. Both certificate ARNs must be set explicitly there, because a multi-SAN certificate cannot be discovered by the extra host's name.

#### Go-live order

1. Request and validate the us-east-1 certificate covering both the existing host and the extra host, set that pair of variables, and deploy. Aliases and the viewer certificate change in place, so the distribution keeps its ID, its `*.cloudfront.net` name, and its existing alias while it starts accepting the extra host.
2. Create the extra host's DNS record in its own zone, pointing at that distribution's `*.cloudfront.net` name, and confirm the app answers on it.
3. Nothing here retires the original host, and the served bundle keeps the API and auth hosts it was built with. Both are separate changes.
4. Retire `app.<domain>` with `CDK_WEB_PRIMARY_HOST_RETIRED` below, once the extra host is confirmed. That is a separate deploy on purpose.

### Retiring the primary web host

`CDK_WEB_PRIMARY_HOST_RETIRED=true` makes `app.<domain>` stop serving the bundle: a CloudFront Function on the web distribution answers `308 Permanent Redirect` to the same path and query on `CDK_WEB_ADDITIONAL_DOMAIN_NAME`, and `PUBLIC_APP_BASE_URL` moves to that host so the links the backend generates — invites and the published catalog's install links — name it too. Share links are not among them: the web app builds its own from its build configuration, and the iOS and Android apps compile theirs in, so those keep reaching the retired host through the redirect until the clients change. Unset, or any value other than `true` (compared case-insensitively), changes nothing, so the code ships dark and a later deploy switches it on. Set without an additional web host, synth fails rather than deploying a redirect with no destination.

The redirect keeps path and query because links already sent out are the point of it; a redirect to the bare origin would break every invite and catalog-install link in existence. It is permanent rather than temporary because the move is confirmed before the switch is flipped, and `308` — unlike `301` — also preserves the request method and body. It stays reversible because the response carries `cache-control: public, max-age=300`, but that bounds only how long a browser remembers the redirect, not how fast a rollback lands. Rolling back is unsetting the variable and running a full AWS/Web release: the stack deploy and CloudFront propagation come first, and a browser that already saw the redirect keeps following it for up to five minutes after that.

GitHub `vars` bind when a workflow run is created, not when its job starts, so set or unset `CDK_WEB_PRIMARY_HOST_RETIRED` before the run is queued, in both directions. A run already queued deploys the old value and still goes green.

Both hosts are aliases of one distribution, and one alias cannot move to a second distribution without a window where it answers nothing, so the distribution that serves both redirects one of them. The function therefore runs on every viewer request of the live app and is one `Host` comparison before it hands the request on. A response a viewer-request function returns is never cached, so the redirect cannot reach the host that is still served.

`api.<domain>`, `auth.<domain>` and `mcp.<domain>` are never redirected. Shipped mobile clients keep calling them, and a redirect on an API host loses the method and body in some HTTP clients.

## Later secret updates

```bash
bash scripts/setup/setup-resend-secret.sh --region eu-central-1
bash scripts/setup/setup-ai-secrets.sh --region eu-central-1
bash scripts/setup/setup-auth-secrets.sh --region eu-central-1
bash scripts/setup/setup-github.sh
```

Run only the secret setup scripts you actually need. `scripts/setup/setup-github.sh` rediscovers the current AWS ARNs and fills in any missing matching GitHub variables afterward, leaving existing values untouched.
This bootstrap-only rule also applies to `CDK_ADMIN_EMAILS`: after the first setup, change that GitHub variable manually when you need to change the deployed bootstrap admin list.

## Optional review account auth

`DEMO_EMAIL_DOSTIP` enables insecure instant sign-in only for listed review account emails in the `example.com` domain. `DEMO_PASSWORD_DOSTIP` stores the shared review account password. Keep both values as explicit deploy config and store the shared password in AWS Secrets Manager for deployed environments.

For MCP directory review, use `mcp-review@example.com` as the single synthetic review/demo account.

If review account access is enabled, create the matching `@example.com` Cognito user manually and keep its email and shared password aligned with the deployed allowlist and review account password secret. The intended setup flow is:

1. keep `DEMO_EMAIL_DOSTIP=mcp-review@example.com` and `DEMO_PASSWORD_DOSTIP` in the local root `.env`
2. run `bash scripts/setup/setup-auth-secrets.sh --region <aws-region>`
3. run `bash scripts/setup/setup-github.sh`

We intentionally keep Cognito user creation manual instead of adding an automated provisioning script for these insecure review-only accounts.

## Global metrics snapshot

The daily global metrics snapshot pipeline always exists for this feature. The optional part is consumer visibility.

- There is one consumer endpoint: `GET /v1/global/snapshot`.
- The operator-facing root `.env` variable is `GLOBAL_METRICS_VISIBLE`.
- The deploy-time GitHub Actions variable is `CDK_GLOBAL_METRICS_VISIBLE`.
- Only the exact raw string `true` enables visibility. Any other value keeps the endpoint hidden.
- The daily snapshot job still runs and CI still seeds the snapshot once after deploy even when the endpoint is hidden.
- When visibility is off, clients do not see global stats through the endpoint.

For self-hosted deploys:

1. set `GLOBAL_METRICS_VISIBLE=true` in root `.env` if you want `GET /v1/global/snapshot` exposed
2. run `bash scripts/setup/setup-github.sh`
3. deploy through the normal AWS/Web release flow

Bootstrap behavior is sharp here:

- `bash scripts/setup/setup-github.sh` uses `set_variable_if_missing`, so it creates `CDK_GLOBAL_METRICS_VISIBLE` only if that GitHub variable is missing.
- If `CDK_GLOBAL_METRICS_VISIBLE` already exists, rerunning `bash scripts/setup/setup-github.sh` preserves the existing GitHub value and does not update it from local `.env`.
- After bootstrap, `CDK_GLOBAL_METRICS_VISIBLE` in GitHub is the deploy-time source of truth.
- To enable or disable visibility later, edit `CDK_GLOBAL_METRICS_VISIBLE` in GitHub and redeploy, or delete it first and then rerun `bash scripts/setup/setup-github.sh`.

When visibility is enabled, websites and future mobile-app endpoint consumers can fetch the snapshot. `apps/web`, `apps/ios`, and `apps/android` do not render those metrics yet.

Feature contract, series semantics, and counting caveats:

- [docs/global-metrics.md](./global-metrics.md)

## CI/CD

GitHub Actions uses one dedicated `AWS/Web Release` workflow on push to `main`. The repository stores:

- GitHub variables for all non-secret deploy config, including certificate ARNs and secret ARNs
- `CDK_ADMIN_EMAILS` as the GitHub-managed deploy input for bootstrap admin grants
- `SENTRY_BACKEND_PROJECT` for backend source map uploads
- `SENTRY_WEB_PROJECT` for web source map uploads when `VITE_SENTRY_DSN` is set
- GitHub secrets for `AWS_DEPLOY_ROLE_ARN` and `SENTRY_AUTH_TOKEN`

The release workflow assembles its own `cdk.context.local.json` inside the job from GitHub deploy config.
Root `.env` is not the live CI source of truth after bootstrap. If `CDK_ADMIN_EMAILS` must change for deployed environments, edit it manually in GitHub before the next release.
The same rule applies to `CDK_GLOBAL_METRICS_VISIBLE`: after bootstrap, change the GitHub variable directly when you want to flip endpoint visibility in deployed environments.
The same split applies to Sentry projects: backend source map uploads use `SENTRY_BACKEND_PROJECT`, and web source map uploads use `SENTRY_WEB_PROJECT`.

For AWS-backed changes, the main-branch order is:

1. select the `platform`, `web`, and `admin` components that changed since their last successful release ([component selection](./release-gates.md#component-selection))
2. run the selected components' pre-deploy build/test checks inside `AWS/Web Release`, including the auth route tests when auth changed
3. deploy the platform through CDK when selected
4. publish `apps/web` and `apps/admin` assets when selected
5. run the deployed API health check when the platform deployed, and the public custom-domain checks, including the hosted web and admin roots, on every run that deploys a component
6. run the native Playwright live smoke in `apps/web/e2e/live-smoke.spec.ts` when web or the platform deployed
7. run the external agent API and MCP smokes when the platform deployed
8. record each component's released SHA and finish green only if the selected post-deploy checks pass
9. finish red if a post-deploy smoke fails, without rolling production back

Manual `workflow_dispatch` runs deploy every component after the same embedded pre-deploy checks.

This repository does not try to prove backend and web correctness with exhaustive test coverage before deploy. The highest-confidence automated signals are the real Playwright web smoke, which drives the merge commit's web client against the deployed backend and auth, and the real agent API smoke, which calls the deployed API directly; see [docs/release-gates.md](./release-gates.md) for the exact scope of each. Any additional non-smoke tests should stay targeted to important module boundaries or contracts.

Cross-client live smoke references:

- Web: `apps/web/e2e/live-smoke.spec.ts`
- iOS: `apps/ios/Flashcards/FlashcardsUITests/LiveSmoke*Tests.swift`
- Android: `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/livesmoke/LiveSmokeTest.kt`

After pushing to `main`, watch `AWS/Web Release` until the release either finishes green or fails clearly after deploy. This pipeline is intentionally fix-forward only: a failed post-deploy smoke leaves the deployed AWS/Web release in place, marks that run failed, and the next push must still be allowed to deploy.

The workflow does not perform an automated production admin login smoke in v1. Use the manual checklist in [docs/admin-app.md](./admin-app.md) after deploy.

Guest AI quota is configured separately:

- local dev uses `GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP` from root `.env`
- GitHub Actions stores `CDK_GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP` as a repo variable
- CDK injects it into both backend Lambdas as `GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP`

If the GitHub variable is unset, the deployed backend receives `0` and guest AI stays disabled fail-closed.
