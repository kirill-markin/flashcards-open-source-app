# Web Localization Guide

Use this document every time you add a new in-app language to the web client.

The web app ships the same locale tags as the iOS app, including separate `es-ES` and `es-MX`.
The auth UI is a separate app; it must already support a tag before the web app sends it as a login hint.
For the full cross-client rollout order and the locale tag each surface expects, see [docs/add-language.md](add-language.md).

The web localization lives in [apps/web/src/i18n/](../apps/web/src/i18n/); `supportedLocales` in [types.ts](../apps/web/src/i18n/types.ts) is the source of truth, and [en.ts](../apps/web/src/i18n/catalogs/en.ts) defines the catalog shape every locale must match.

## Add A New Language

### 1. Register the tag

Use the iOS app tag for the language ([Locale tags per surface](add-language.md#locale-tags-per-surface)). Then:

1. add it to `supportedLocales` in [types.ts](../apps/web/src/i18n/types.ts)
2. create `catalogs/<tag>.ts` exporting one `<name>Catalog` object checked against `TranslationCatalog`, like the existing modules
3. add its loader to `translationCatalogLoaders` in [catalog.ts](../apps/web/src/i18n/catalog.ts) in the shipped form `async () => (await import("./catalogs/<tag>")).<name>Catalog`
4. add its direction to `localeDirections` in [locales.ts](../apps/web/src/i18n/locales.ts)
5. add its primary language subtag to `primaryLanguageLocaleFallbacks` in the same file, so regional browser tags such as `fr-CA` resolve to it
6. add it to `localeFirstDayFallbacks` in [weekContext.ts](../apps/web/src/i18n/weekContext.ts) with the first day of week its CLDR data defines, not the value of a neighboring row
7. add `locale.names.<tag>` to every catalog, including the new one
8. add its native name, English name (the `en.ts` `locale.names.<tag>` value), and common alternative names people type to `localeDisplayNames` in [localeDisplayNames.ts](../apps/web/src/i18n/localeDisplayNames.ts)

[scripts/checks/pr/check-web-localization-parity.mjs](../scripts/checks/pr/check-web-localization-parity.mjs), in the required `Repository static checks` gate, enforces steps 2 to 4, 6, and 7, and the `localeDisplayNames` type enforces step 8. Check by hand what neither catches: step 5 (without it only the exact tag is detected from the browser), step 6's weekday value, and that the English name matches `en.ts`.

### 2. Translate the catalog

Translate every key, including nested keys, plural objects, support copy, loading states, confirmations, permission guidance, chat copy, and error labels. Keep `{{token}}` placeholders verbatim.

- Terminology follows the shipped iOS strings in [ReviewCards.xcstrings](../apps/ios/Flashcards/Flashcards/ReviewCards.xcstrings) and [Foundation.xcstrings](../apps/ios/Flashcards/Flashcards/Resources/Localization/Foundation.xcstrings).
- The four rating labels in `reviewScreen.ratings` are copied byte for byte from iOS, and the same words are reused wherever prose names a rating.
- Fill plural objects as `PluralCountLabels` in [types.ts](../apps/web/src/i18n/types.ts) states; `progressScreen.leaderboard.updatedAtDuration` selects all six CLDR categories directly, so fill each one for the language.
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
