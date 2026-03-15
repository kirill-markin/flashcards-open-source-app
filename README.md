# Flashcards Open Source App

![iOS app screenshots](docs/images/ios-app-screenshots.jpeg)

Open-source offline-first flashcards app.

## v1 Architecture

- Cloudflare -> API Gateway -> Lambda backend -> Postgres
- app.<domain> -> CloudFront -> S3 web app
- auth.<domain> -> API Gateway -> Lambda auth service -> Cognito
- <domain> -> redirect to app.<domain> when the apex is free during bootstrap
- Email OTP auth via Cognito (passwordless) — auth is a separate public service, backend verifies JWT
- No background worker for scheduling in v1
- Card scheduling is compute-on-write in API (on review submit)
- Card queue is filter-on-read (`due_at <= now()`)

## Card scheduling

- Review scheduling uses FSRS-6 with pinned default weights
- The full scheduler is implemented in backend and iOS and must stay behaviorally identical
- The web app mirrors the scheduler data contract and review flow, but does not contain a third FSRS implementation
- Cards appear in review when they are due: `due_at <= now()`
- Detailed scheduling rules live in [`docs/fsrs-scheduling-logic.md`](docs/fsrs-scheduling-logic.md)

## Clients

- Web app in `apps/web` for cards, decks, review, and AI chat
- iOS app in `apps/ios` with local SQLite, offline-first review flow, and FSRS parity with backend
- Android app later

The discovery response tells agents to ask for the user's email first, and the same email OTP flow covers both signup and login.

## Setup Docs

- [iOS local setup](docs/ios-local-setup.md)
- [Backend and web deployment](docs/backend-web-deployment.md)
