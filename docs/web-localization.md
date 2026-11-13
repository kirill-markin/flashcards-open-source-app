# Web Localization Guide

Use this document every time you add a new in-app language to the web client.

The web app ships the same locale tags as the iOS app, including separate `es-ES` and `es-MX`.
The auth UI is a separate app; it must already support a tag before the web app sends it as a login hint.
For the full cross-client rollout order and the locale tag each surface expects, see [docs/add-language.md](add-language.md).

The web localization lives in [apps/web/src/i18n/](../apps/web/src/i18n/); `supportedLocales` in [types.ts](../apps/web/src/i18n/types.ts) is the source of truth, and [en.ts](../apps/web/src/i18n/catalogs/en.ts) defines the catalog shape every locale must match.

## Add A New Language

### 1. Register the tag

Use the iOS app tag for the language ([Locale tags per surface](add-language.md#locale-tags-per-surface)). Then:

1. Add it to `supportedLocales` in [types.ts](../apps/web/src/i18n/types.ts).
2. For a dedicated translation, create `catalogs/<tag>.ts` checked against `TranslationCatalog` and add its lazy loader to `translationCatalogLoaders` in [catalog.ts](../apps/web/src/i18n/catalog.ts). For a regional variant that reuses app copy, register its base locale in `regionalCatalogs` and supply any regional Stripe copy.
3. Register its direction in `localeDirections` and check how browser tags and entry hints resolve in [locales.ts](../apps/web/src/i18n/locales.ts). A new base language needs an entry in `primaryLanguageLocaleFallbacks`.
4. Add its CLDR week start to `localeFirstDayFallbacks` in [weekContext.ts](../apps/web/src/i18n/weekContext.ts).
5. Add its native name, English name, and common search aliases to `localeDisplayNames` in [localeDisplayNames.ts](../apps/web/src/i18n/localeDisplayNames.ts). Settings summaries use authored catalog names where available, then use `Intl.DisplayNames` for other names. Every dedicated catalog supplies the authored name keys in `en.ts` and can override other names.

The required [web localization parity check](../scripts/checks/pr/check-web-localization-parity.mjs) verifies dedicated catalog modules and loaders, regional base catalogs, directions, names, and week-start registration. Verify locale resolution and the actual week-start values separately.

If the marketing website adds routes for the same locale, update the Home, catalog, and MCP link mapping in [publicSiteUrl.ts](../apps/web/src/publicSiteUrl.ts). Deploy the website routes before deploying the app links.

### 2. Translate the catalog

Translate every key, including nested keys, plural objects, support copy, loading states, confirmations, permission guidance, chat copy, and error labels. Keep `{{token}}` placeholders verbatim.

- Terminology follows the shipped iOS strings in [ReviewCards.xcstrings](../apps/ios/Flashcards/Flashcards/ReviewCards.xcstrings) and [Foundation.xcstrings](../apps/ios/Flashcards/Flashcards/Resources/Localization/Foundation.xcstrings).
- The four rating labels in `reviewScreen.ratings` are copied byte for byte from iOS, and the same words are reused wherever prose names a rating.
- Fill plural objects as `PluralCountLabels` or `PluralMessages` in [types.ts](../apps/web/src/i18n/types.ts) state; a `PluralMessages` object lists all six CLDR categories, so fill each one for the language as a whole phrase that places `{{count}}` itself.
- Do not localize user data or technical values: workspace, card, and tag text; email addresses; IDs; URLs and route paths; raw SQL or JSON shown for diagnostics; error payloads the client does not own. Localize the labels around them.

### 3. Audit direction-sensitive and support layers

For an RTL locale, inspect layout and text alignment where it depends on direction: at least one filter menu, one table or list surface, and one markdown-rich review card.

The usual misses are outside the obvious screens:

- [App.tsx](../apps/web/src/App.tsx): route-loading fallbacks, session-restoring and account-deletion copy
- [useWorkspaceSession.ts](../apps/web/src/appData/session/useWorkspaceSession.ts): workspace and session runtime errors fed from the provider
- [browserAccess.ts](../apps/web/src/access/browserAccess.ts) and [AccessPermissionDetailScreen.tsx](../apps/web/src/screens/settings/access/AccessPermissionDetailScreen.tsx): media-permission and secure-context errors
- [sessionController/context.tsx](../apps/web/src/chat/sessionController/context.tsx), [useChatHistory.ts](../apps/web/src/chat/history/useChatHistory.ts), and [chatMessageContent.tsx](../apps/web/src/chat/history/chatMessageContent.tsx): chat messages, optimistic status text, tool labels, clipboard alerts
- [useReviewCardEditor.ts](../apps/web/src/screens/review/components/card/useReviewCardEditor.ts): delete confirmation and editor errors
- [reviewSpeech.ts](../apps/web/src/screens/review/speech/reviewSpeech.ts): if the locale needs speech-language detection heuristics, add them, otherwise say in the PR that speech is unchanged

Search for hardcoded strings instead of relying on memory:

```sh
rg -n "window\\.alert|window\\.confirm|setErrorMessage\\(|throw new Error\\(" apps/web/src
rg -n "navigator\\.language|localStorage" apps/web/src
```

## Verification

CI type-checks the catalogs in `Build web app`.

Validate the locale in a real browser:

1. Set the browser preferred language to the new locale, leave the app on `Automatic`, and load it fresh.
2. Open `Settings -> Language`, confirm the picker shows the locale name, then pick it explicitly and reload.
3. Confirm the explicit choice persists under `LOCALE_PREFERENCE_STORAGE_KEY` from [runtime.ts](../apps/web/src/i18n/runtime.ts), and that returning to `Automatic` removes it.
4. Confirm `document.documentElement.lang` and `dir` match the resolved locale.
5. Check at least one date, number, and pluralized count, one denied-permission or error path, and one review speech playback.

Live smoke stays English: [config.ts](../apps/web/e2e/live-smoke/config.ts) pins `liveSmokeBrowserLocale`, and some flows assert English labels, for example the Settings group headings in [settings-ia.ts](../apps/web/e2e/live-smoke/flows/settings-ia.ts). Update those flows if you rename visible labels.
