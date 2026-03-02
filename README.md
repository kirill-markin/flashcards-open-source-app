# flashcards-open-source-app

Open-source offline-first flashcards app.

## Status

This repository is under active development and not production-ready yet.

## v1 architecture

- Cloudflare -> API Gateway -> Lambda backend -> Postgres
- EventBridge -> Lambda worker -> Postgres
- iOS app in Swift first, Android later
- Offline-first sync model for mobile clients (local SQLite + server sync)

## Stack

- AWS (API Gateway, Lambda, RDS Postgres, CloudWatch)
- TypeScript for backend and worker
- Postgres as server source of truth
