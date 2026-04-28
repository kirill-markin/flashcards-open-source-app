# Web Localization Guide

Use this document every time you add a new in-app language to the web client.

This guide is about the web app itself.
The auth UI is a separate app, so login-language coordination is a follow-up concern, not the primary source of truth for web translations.

## Goal

Adding a new web language must cover all of these behaviors together:

- the locale is declared as an exact supported tag in one source-of-truth locale list
- the translation catalog stays complete and type-safe
- automatic browser/device locale detection still resolves to the intended supported locale
- the browser-local language override still works and persists correctly
- `document.documentElement.lang` and `document.documentElement.dir` stay aligned with the resolved locale
- RTL presentation stays correct where layout or text alignment depends on direction
- support copy, runtime-error paths, chat UI messages, and review speech do not stay half-English by accident
- smoke checks stay deterministic regardless of the machine browser locale

The misses are usually not the obvious screens. They are the support layers, runtime errors, browser-local preference handling, speech fallback, RTL-sensitive styles, and smoke helpers.

## Current Web Localization Layout

The current web i18n system is centered on these files:

- [apps/web/src/i18n/types.ts](../apps/web/src/i18n/types.ts)
  Source of truth for `supportedLocales`, `Locale`, and `LocalePreference`.

- [apps/web/src/i18n/locales.ts](../apps/web/src/i18n/locales.ts)
  Exact-tag normalization, browser-language matching, legacy preference migration, and locale direction.

- [apps/web/src/i18n/catalog.ts](../apps/web/src/i18n/catalog.ts)
  Typed translation catalogs. `enCatalog` defines the shape, `TranslationKey` is derived from it, and `translationCatalogs` must include every supported locale.

- [apps/web/src/i18n/runtime.ts](../apps/web/src/i18n/runtime.ts)
  Browser language detection, locale matching, localStorage persistence, translation lookup, and `Intl` formatting helpers.

- [apps/web/src/i18n/context.tsx](../apps/web/src/i18n/context.tsx)
  `I18nProvider`, `useI18n()`, and the `document.documentElement.lang` / `dir` updates.

- [apps/web/src/main.tsx](../apps/web/src/main.tsx)
  Provider bootstrap.

- [apps/web/src/App.tsx](../apps/web/src/App.tsx)
  App-shell loading, fallback, auth, and session-state copy that must not be skipped during a localization audit.

- [apps/web/e2e/live-smoke/fixture.ts](../apps/web/e2e/live-smoke/fixture.ts)
  Browser-locale pinning for deterministic smoke assertions.

## Source Of Truth Checklist

When adding a new web locale, inspect all of these places:

1. [apps/web/src/i18n/types.ts](../apps/web/src/i18n/types.ts)
2. [apps/web/src/i18n/locales.ts](../apps/web/src/i18n/locales.ts)
3. [apps/web/src/i18n/catalog.ts](../apps/web/src/i18n/catalog.ts)
4. [apps/web/src/i18n/runtime.ts](../apps/web/src/i18n/runtime.ts)
5. [apps/web/src/i18n/context.tsx](../apps/web/src/i18n/context.tsx)
6. [apps/web/src/main.tsx](../apps/web/src/main.tsx)
7. [apps/web/src/App.tsx](../apps/web/src/App.tsx)
8. [apps/web/src/appData/provider.tsx](../apps/web/src/appData/provider.tsx)
9. [apps/web/src/appData/useWorkspaceSession.ts](../apps/web/src/appData/useWorkspaceSession.ts)
10. [apps/web/src/api.ts](../apps/web/src/api.ts)
11. [apps/web/src/access/browserAccess.ts](../apps/web/src/access/browserAccess.ts)
12. [apps/web/src/chat/sessionController/context.tsx](../apps/web/src/chat/sessionController/context.tsx)
13. [apps/web/src/chat/useChatHistory.ts](../apps/web/src/chat/useChatHistory.ts)
14. [apps/web/src/chat/chatMessageContent.tsx](../apps/web/src/chat/chatMessageContent.tsx)
15. [apps/web/src/screens/review/reviewSpeech.ts](../apps/web/src/screens/review/reviewSpeech.ts)
16. [apps/web/src/screens/review/useReviewCardEditor.ts](../apps/web/src/screens/review/useReviewCardEditor.ts)
17. [apps/web/src/screens/settings/ThisDeviceSettingsScreen.tsx](../apps/web/src/screens/settings/ThisDeviceSettingsScreen.tsx)
18. [apps/web/src/screens/settings/access/AccessPermissionDetailScreen.tsx](../apps/web/src/screens/settings/access/AccessPermissionDetailScreen.tsx)
19. [apps/web/src/i18n/runtime.test.ts](../apps/web/src/i18n/runtime.test.ts)
20. [apps/web/src/api.test.ts](../apps/web/src/api.test.ts)
21. [apps/web/e2e/live-smoke/](../apps/web/e2e/live-smoke/)

If any of these are skipped, the app can compile and still ship with partially untranslated behavior.

## Add A New Language

Use this checklist in order.

### 1. Choose the exact locale tag that the current web architecture supports

The web locale model now supports exact locale tags in [apps/web/src/i18n/types.ts](../apps/web/src/i18n/types.ts), for example:

- `en`
- `ar`
- `zh-Hans`
- `es-MX`
- `es-ES`

Important:

- browser inputs can be broader or different exact tags such as `es-AR`, `es-MX`, `zh-CN`, or `en-GB`
- [apps/web/src/i18n/locales.ts](../apps/web/src/i18n/locales.ts) is responsible for mapping those browser tags to the supported locale list
- choose the exact tag the product actually wants to expose in the app, not a placeholder base language if region or script differences matter
- if you add a locale with RTL directionality, update its direction in `locales.ts` in the same change

### 2. Add the locale to the source-of-truth locale list

Update [apps/web/src/i18n/types.ts](../apps/web/src/i18n/types.ts):

- add the new locale to `supportedLocales`
- let `Locale` expand from that list automatically
- keep `autoLocalePreference` unchanged unless product behavior is deliberately changing

Then update [apps/web/src/i18n/locales.ts](../apps/web/src/i18n/locales.ts):

- add the locale direction to `localeDirections`
- update browser-tag matching rules in `resolveSupportedLocale(...)` when the new locale needs exact-tag routing
- add or update legacy preference migration only when existing stored values must move to the new exact locale

These two files together drive runtime validation, browser auto-resolution, and the browser-local language override.

### 3. Add a complete translation catalog entry

Update [apps/web/src/i18n/catalog.ts](../apps/web/src/i18n/catalog.ts):

- create the new `<locale>Catalog`
- type it as `TranslationCatalog`
- add it to `translationCatalogs`
- add the locale name under `locale.names`
- translate every existing key, including nested keys and plural labels

Do not add only the top-level navigation and visible screens.
This catalog also owns support copy, loading states, confirmation text, permission guidance, chat copy, and error labels.

Why this matters:

- `TranslationKey` is derived from `enCatalog`
- `translationCatalogs` is typed as `Record<Locale, TranslationCatalog>`
- [apps/web/src/i18n/runtime.ts](../apps/web/src/i18n/runtime.ts) throws runtime errors for missing or non-leaf keys when `t(...)` resolves them

### 4. Verify runtime locale detection and browser-local persistence

Review [apps/web/src/i18n/runtime.ts](../apps/web/src/i18n/runtime.ts) after adding the locale:

- `resolveSupportedLocale(...)` in `locales.ts` should resolve browser tags like `fr-CA` or `es-AR` to the intended supported locale
- `resolveBrowserLocaleFromSnapshot(...)` should return the new locale when the browser advertises it
- `resolveLocaleState(...)` should still honor an explicit stored preference before browser auto-detection
- `persistLocalePreference(...)` should keep storing the explicit locale value and clear storage in `auto` mode

Current browser-local preference storage key:

- `flashcards-web-locale-preference`

If an old stored locale must migrate to a new exact tag, cover that explicitly in `migrateLegacyLocalePreference(...)` and in [apps/web/src/i18n/runtime.test.ts](../apps/web/src/i18n/runtime.test.ts).

### 5. Keep provider wiring and document language behavior intact

Check these files even if you do not need to change them:

- [apps/web/src/i18n/context.tsx](../apps/web/src/i18n/context.tsx)
- [apps/web/src/main.tsx](../apps/web/src/main.tsx)
- [apps/web/src/appData/provider.tsx](../apps/web/src/appData/provider.tsx)

The new locale should still flow through:

- `I18nProvider`
- `useI18n()`
- `document.documentElement.lang = resolvedLocaleState.locale`
- `document.documentElement.dir = resolvedLocaleState.direction`
- `Intl.DateTimeFormat`, `Intl.NumberFormat`, and `Intl.PluralRules` calls that already consume `locale`
- any provider-owned translation handoff into lower app-data hooks such as `useWorkspaceSession(...)`

### 6. Update the browser-local language override screen

Review [apps/web/src/screens/settings/ThisDeviceSettingsScreen.tsx](../apps/web/src/screens/settings/ThisDeviceSettingsScreen.tsx) carefully.

This is an easy place to miss required work because it does more than render translated labels:

- it imports `supportedLocales`
- it parses the stored override selection
- it renders the language picker options
- it displays both the current app language and the saved preference
- it derives locale-name translation keys from the exact `Locale` union, so new locale names must exist in every catalog

If you add a locale and forget this file, the app can still build while the device-language UI shows the wrong label or falls back incorrectly.

### 7. Audit support layers and runtime-error paths, not just obvious screens

These files are required audit points for a new locale:

- [apps/web/src/App.tsx](../apps/web/src/App.tsx)
  Route-loading fallbacks, account-deletion flow copy, session-restoring copy, sign-in CTA text.

- [apps/web/src/appData/useWorkspaceSession.ts](../apps/web/src/appData/useWorkspaceSession.ts)
  Workspace/session runtime errors, action-locked messages, account-deleted copy, and provider-fed translations that can be missed because they do not live in screen components.

- [apps/web/src/access/browserAccess.ts](../apps/web/src/access/browserAccess.ts)
  Browser media permission errors and secure-context failures used by chat and access flows.

- [apps/web/src/chat/sessionController/context.tsx](../apps/web/src/chat/sessionController/context.tsx)
  Chat-specific UI-message bundle and post-sync error messaging.

- [apps/web/src/chat/useChatHistory.ts](../apps/web/src/chat/useChatHistory.ts)
  Optimistic assistant status text and any other user-visible placeholder content that can survive into the rendered transcript.

- [apps/web/src/chat/chatMessageContent.tsx](../apps/web/src/chat/chatMessageContent.tsx)
  Tool labels, copy buttons, attachment labels, reasoning/tool-call status text, clipboard failure alerts.

- [apps/web/src/screens/review/useReviewCardEditor.ts](../apps/web/src/screens/review/useReviewCardEditor.ts)
  Delete-confirmation dialog and editor-specific error copy.

- [apps/web/src/screens/settings/access/AccessPermissionDetailScreen.tsx](../apps/web/src/screens/settings/access/AccessPermissionDetailScreen.tsx)
  Permission-state labels, guidance text, mapped browser media errors, and secure-context/access failures.

The goal is not just to translate the happy path.
It is to make sure loading, retry, denied-permission, interrupted-run, and dialog flows do not stay English.

### 8. Review speech support if the locale should sound correct when spoken

Review [apps/web/src/screens/review/reviewSpeech.ts](../apps/web/src/screens/review/reviewSpeech.ts).

Adding a UI locale does not automatically make speech output feel correct. The current web behavior should follow this rule:

- use the resolved app locale as the fallback speech locale
- if content clearly looks like another language, prefer that detected language
- if detection and app locale share the same primary language, keep the exact app locale tag so speech stays aligned with the app locale model

If the locale matters for text-to-speech:

- add or adjust detection heuristics
- verify the fallback uses the resolved app locale, not a raw browser default
- verify voice matching still selects a reasonable browser voice
- verify markdown normalization still sounds natural for that language

If speech behavior is intentionally unchanged, call that out in the PR so it is explicit.

### 9. Coordinate auth locale hints only if login should support the same locale

The web app builds a login locale hint in [apps/web/src/api.ts](../apps/web/src/api.ts):

- `AuthUiLocale`
- `normalizeAuthUiLocale(...)`
- `getPreferredAuthUiLocale()`
- `buildLoginUrl(...)`

Important:

- auth is a separate app
- web can support a new locale even if auth still falls back to English or to a smaller supported auth-locale set
- when the web locale list changes, confirm whether `AuthUiLocale`, `normalizeAuthUiLocale(...)`, and `getPreferredAuthUiLocale()` should preserve the new exact tag, map it to another auth-supported tag, or intentionally fall back
- do not modify `apps/auth` as part of a normal web-locale change unless the product explicitly wants auth localized too

If auth should also support the new locale, coordinate a separate auth change and update [apps/web/src/api.test.ts](../apps/web/src/api.test.ts) in the same branch.

### 10. Do not localize user data or technical identifiers blindly

Usually keep these values as-is:

- workspace names created by users
- card front/back text created by users
- tag names created by users
- email addresses
- installation IDs, request IDs, session IDs, and UUIDs
- domains, URLs, and route paths
- raw tool input/output payloads such as SQL or JSON shown for diagnostics
- browser-native or server-provided error payloads that the client does not own

Localize the labels around them, not the values themselves.

### 11. Search for hardcoded user-facing strings before finishing

Do not rely on memory.
Run targeted searches in `apps/web/src` and inspect the results before you consider the locale complete.

Useful starting points:

```sh
rg -n "useI18n\\(" apps/web/src
rg -n "window\\.alert|window\\.confirm|setErrorMessage\\(|throw new Error\\(" apps/web/src
rg -n "locale|language|navigator\\.language|navigator\\.languages|localStorage" apps/web/src
```

The first command finds most normal translated UI entrypoints.
The second and third commands catch easy-to-miss support paths, browser integration points, and manual dialogs.

## Verification Checklist

Run this checklist every time you add a new web locale.

### Lightweight automated checks

From `apps/web`:

- `npm run build`
- `npx vitest run src/i18n/runtime.test.ts src/api.test.ts`

Why these matter:

- [apps/web/src/i18n/runtime.test.ts](../apps/web/src/i18n/runtime.test.ts) verifies browser-locale matching, explicit locale preference persistence, and translation resolution behavior
- [apps/web/src/api.test.ts](../apps/web/src/api.test.ts) verifies auth locale-hint normalization and login URL propagation

If the locale addition changes expected supported-language behavior, update those tests instead of leaving stale assumptions behind.

### Manual browser validation

Validate the new locale in a real browser session:

1. Set the browser preferred language to the new locale and leave the app in `Automatic`.
2. Load the app fresh and confirm the UI resolves to the new locale.
3. Open `Settings -> This Device` and confirm:
   - the app language label is correct
   - the language preference label is correct
   - the picker shows the new locale name
4. Switch to an explicit override for the new locale and reload.
5. Confirm the override persists through the `flashcards-web-locale-preference` storage key.
6. Switch back to `Automatic` and confirm the explicit storage entry is removed.
7. Verify `document.documentElement.lang` matches the resolved locale.
8. Verify `document.documentElement.dir` matches the resolved direction.
9. Verify at least one date, time, number, and pluralized count in the UI.
10. For RTL locales, inspect at least one filter menu, one table/list surface, and one markdown-rich review card for direction-sensitive layout issues.
11. Exercise at least one denied-permission or transient-error path, not only normal navigation.
12. Trigger review speech once and confirm the chosen voice/language is reasonable for the current locale and sample content.

### Smoke-test expectations

Inspect [apps/web/e2e/live-smoke/](../apps/web/e2e/live-smoke/) whenever a locale change touches visible labels, selectors, or locale-sensitive helpers.

Current state:

- many smoke flows use stable selectors, routes, `data-testid`, or user-created text and should not need changes just because a locale was added
- however, [apps/web/e2e/live-smoke/observations/ai.ts](../apps/web/e2e/live-smoke/observations/ai.ts) currently reads English UI text such as `Request`, `Response`, `Done`, and `SQL`
- [apps/web/e2e/live-smoke/fixture.ts](../apps/web/e2e/live-smoke/fixture.ts) should pin the browser locale to `en-US` unless the smoke suite is intentionally made locale-aware

That means:

- keep smoke deterministic in English unless there is a deliberate decision to make smoke locale-aware
- do not let the runner machine's browser locale silently change expectations
- if you introduce a non-English smoke context, update the AI observation helpers instead of assuming they are locale-independent
- if you rename visible labels or remove stable selectors during the same change, update the affected smoke flows in `apps/web/e2e/live-smoke/flows/`

## Definition Of Done

Do not consider a new web locale complete until all of these are true:

- the locale is in `supportedLocales`
- exact locale matching and direction are configured in `locales.ts`
- `translationCatalogs` includes a complete new catalog
- the device/browser-local language override works
- `document.documentElement.lang` and `dir` stay correct
- RTL-sensitive presentation was audited where applicable
- support and error layers were audited explicitly
- auth locale-hint behavior was either updated intentionally or left as an explicit English fallback
- review speech fallback was verified against the resolved app locale
- lightweight automated checks passed
- at least one real browser validation pass confirmed auto mode, explicit override mode, and one non-happy-path flow
