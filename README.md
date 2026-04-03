# Flashcards Open Source App

Open-source offline-first flashcards app for iOS, Android, and web.

![Flashcards Open Source App screenshots](docs/images/ios-app-screenshots.jpeg)

Flashcards Open Source App is an open-source Anki-like flashcards app built for fast daily study on iOS, Android, and the web. Use it to learn vocabulary, technical terms, definitions, facts, code concepts, and other material you want to remember. It is offline-first, so you can create cards, review with spaced repetition, and keep studying locally before syncing with the backend. The project also includes an external agent API for terminal and AI-agent workflows.

## Available on

- [iOS](https://apps.apple.com/us/app/flashcards-open-source-app/id6760538964)
- [Android](https://play.google.com/store/apps/details?id=com.flashcardsopensourceapp.app&pcampaignid=web_share)
- [Web](https://app.flashcards-open-source-app.com/review)
- Agent API: https://api.flashcards-open-source-app.com/v1/

## Card scheduling

Card scheduling uses FSRS-based spaced repetition. Detailed scheduling rules live in [docs/fsrs-scheduling-logic.md](docs/fsrs-scheduling-logic.md).

## Docs

- [iOS app](apps/ios/README.md)
- [Android app](apps/android/README.md)
- [Web app](apps/web/README.md)
- [Architecture](docs/architecture.md)
- [Backend and web deployment](docs/backend-web-deployment.md)
- [Release gates and monitoring](docs/release-gates.md)
- [iOS local setup](docs/ios-local-setup.md)
- [iOS CI/CD](docs/ios-ci-cd.md)
- [Android CI/CD](docs/android-ci-cd.md)
- [Agent API](https://api.flashcards-open-source-app.com/v1/)

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Author

- [Kirill Markin](https://github.com/kirill-markin)
