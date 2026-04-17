# Admin App

`apps/admin` is the browser admin SPA for `https://admin.<domain>`.

Supported browser entrypoints:

- `http://localhost:3001`
- `https://admin.<domain>`

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
- backend: `http://localhost:8080/v1`
- auth: `http://localhost:8081`

The local backend and auth allowlists must include both `http://localhost:3000` and `http://localhost:3001`.

## Auth flow

- The app calls `GET /v1/admin/session` on load.
- `401` first attempts the existing `auth.<domain>/api/refresh-session` silent recovery flow, then redirects to login only if recovery fails.
- `403` renders the admin access denied state.
- `200` loads dashboard data through `POST /v1/admin/reports/query`.

The admin app uses the existing Cognito browser session cookies. It does not introduce a separate login system.

## Hosting contract

The admin SPA is supported only on the two entrypoints above. The frontend derives backend and auth hosts from the active browser hostname and fails fast on any other non-local hostname.

Do not host the browser entry on a raw CloudFront or other non-admin hostname, even if you can inject Vite environment variables during the build. Auth redirect allowlists and backend origin checks are intentionally aligned to `localhost` and `admin.<domain>` only.

## Current scope

v1 includes one dashboard page only:

- `review-events-by-date`

The dashboard shows four review charts:

- daily unique users
- stacked review events by user
- daily active users by platform
- daily review events by platform

Its SQL lives in the admin frontend as a chart-owned query and runs through the generic admin reporting endpoint.
