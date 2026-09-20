# Nibomo

AI-powered open-source flashcards app for iOS, Android, and web.

![Nibomo screenshots](apps/ios/docs/media/marketing-materials/iphone/en-US-1-2-3-4-5-horizontal-dark-gray.png)

Nibomo (formerly Flashcards Open Source App) is an open-source AI-powered flashcards app built for serious daily study on iOS, Android, and the web. Use it to prepare for exams, learn vocabulary, memorize technical terms and facts, improve your material with AI, and review with spaced repetition. The project also includes an external agent API for terminal and AI-agent workflows.

## Available on

- [iOS](https://apps.apple.com/us/app/flashcards-open-source-app/id6760538964)
- [Android](https://play.google.com/store/apps/details?id=com.flashcardsopensourceapp.app&pcampaignid=web_share)
- [Web](https://app.flashcards-open-source-app.com/review)
- MCP server: https://mcp.nibomo.com/mcp
- Agent API: https://api.flashcards-open-source-app.com/v1/

## Card scheduling

Card scheduling uses FSRS-based spaced repetition. Detailed scheduling rules live in [docs/fsrs-scheduling-logic.md](docs/fsrs-scheduling-logic.md).

## MCP connector

The hosted MCP server is available at `https://mcp.nibomo.com/mcp` and publishes to MCP registries under `com.nibomo/flashcards`. It exposes seven tools, most of them workspace-scoped: `list_workspaces`, `sql_query`, `sql_execute`, `get_guide`, `next_review_card`, `reveal_answer`, and `submit_review`.

The dedicated review tools support one-question-at-a-time conversations and idempotent FSRS scheduling. See [conversational reviews](docs/conversational-reviews.md) for the contract shared by MCP, the in-app chat, and the Agent API, and for voice-session examples. ChatGPT Voice currently does not invoke apps/MCP; these tools do not remove that external limitation.

Interactive clients authenticate with OAuth 2.1 authorization code + PKCE and Dynamic Client Registration. Headless clients can use an `fca_` Bearer token.

The former address `https://mcp.flashcards-open-source-app.com/mcp` still serves the same server, so existing client configurations keep working.

- [MCP connector docs](https://nibomo.com/docs/mcp-connector/)
- [Agent API docs](https://nibomo.com/docs/api/)
- [Privacy](https://nibomo.com/privacy/)
- [Support](https://nibomo.com/support/)

## Docs

- [iOS app](apps/ios/README.md)
- [Android app](apps/android/README.md)
- [Web app](apps/web/README.md)
- [Architecture](docs/architecture.md)
- [Backend and web deployment](docs/backend-web-deployment.md)
- [Public site URLs (`PUBLIC_SITE_BASE_URL`)](docs/public-site-urls.md)
- [Release gates and monitoring](docs/release-gates.md)
- [Release all platforms and start the next development version](docs/release-current-version.md)
- [Platform release procedures](docs/manual-production-release.md)
- [iOS local setup](docs/ios-local-setup.md)
- [iOS CI/CD](docs/ios-ci-cd.md)
- [Android CI/CD](docs/android-ci-cd.md)
- [Agent API](https://api.flashcards-open-source-app.com/v1/)

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Author

- [Kirill Markin](https://github.com/kirill-markin)
