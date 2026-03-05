# flashcards-open-source-app

Open-source offline-first flashcards app.

## Status

This repository is under active development and not production-ready yet.

## v1 Architecture

- Cloudflare -> API Gateway -> Lambda backend -> Postgres
- Email OTP auth via Cognito (passwordless) — auth Lambda at `/auth/*`, backend verifies JWT
- No background worker for scheduling in v1
- Card scheduling is compute-on-write in API (on review submit)
- Card queue is filter-on-read (`due_at <= now()`)

## Planned clients

- iOS app in Swift (first)
- Android app later
