# Admin App

`apps/admin` is the browser admin SPA. What it covers, who may use it, the reporting data path and how to read its numbers are in [docs/admin-app.md](../../docs/admin-app.md).

## Structure

- [`routing.ts`](src/routing.ts) owns the routes; [`App.tsx`](src/App.tsx) owns the session, the shared filter selection and its URL, and the report loading.
- `src/reports/<report>/` holds each report's SQL, usually `query.ts`, beside its section.
- `src/filters/` is the shared filter bar: [`analyticsFilters.ts`](src/filters/analyticsFilters.ts) declares the fields each area offers, and [`filterSql.ts`](src/filters/filterSql.ts) their SQL.
- `src/users/` and `src/events/` are the inspection pages over the server-paged table in `src/table/`; `src/charts/` holds the chart primitives.

## Local development

Install dependencies:

```bash
npm install --prefix apps/admin
```

Start the local stack in separate terminals:

```bash
make db-up
make auth-dev
make backend-dev
make admin-dev
```

Local defaults:

- admin app: `http://localhost:3001`
- web app: `http://localhost:3000`
- backend: `http://localhost:8080/v1`
- auth: `http://localhost:8081`

The local backend and auth allowlists must include both `http://localhost:3000` and `http://localhost:3001`. With `AUTH_MODE=none` and `ALLOW_INSECURE_LOCAL_AUTH=true`, the backend accepts loopback admin requests without login; that shortcut never works on a deployed domain.

### Local admin on production data (read-only)

```bash
make local-admin
```

[The script](../../scripts/local/admin-prod-readonly.sh) needs no login and no root `.env`, only the `flashcards-open-source-app` AWS profile and the `session-manager-plugin`. It resolves a fresh access bundle, opens the [SSM tunnel](../../docs/analytics-db-access.md#operator-path-ssm-port-forwarding) on `127.0.0.1:15432`, and starts the backend with `AUTH_MODE=none` plus this app on `http://localhost:3001`.

- Safety: every backend database connection uses the `reporting_readonly` role; the password is never stored or printed; the backend and this app listen on `127.0.0.1` only, because the auth bypass trusts the client-supplied `Host` header; Ctrl-C stops both servers and terminates the SSM session.
- Limits: anything that writes fails; the role's [connection limit](../../docs/analytics-db-access.md#database-role-reporting_readonly) is shared with production admin and operator tunnels; it shares port `8080` with `make local-app`, so run one at a time; CloudFront rewrites and the minified production build are not covered.

## Hosting contract

The SPA is supported only on `http://localhost:3001` and `https://admin.<domain>`: [`config.ts`](src/config.ts) derives the backend and auth hosts from the browser hostname and fails fast on any other non-local one. Do not host it on a raw CloudFront or other non-admin hostname, even with injected Vite variables, because the auth redirect allowlists and backend origin checks are aligned to those two entrypoints only. Deep links depend on the CloudFront SPA rewrite in [infra/aws/lib/admin.ts](../../infra/aws/lib/admin.ts).
