# Add a Language

Every surface a new product language touches, in delivery order. Each step names
the decision and links to the guide that owns it. Nothing here repeats those
guides.

Coverage is deliberately different across surfaces. Auth and iOS support 50
locales across 49 languages, with separate `es-ES` and `es-MX`. iOS bundle
coverage is owned by [iOS localization](ios-localization.md#supported-app-locales).
Web and backend name pools each carry 11 locale tags; Android advertises 49
languages, and the marketing website carries 10 locales. The App Store source
covers 42 locales (41 languages). Repository resources, generated screenshots,
editable Store drafts, and the released binary are separate delivery states.
Do not widen web, Android, website, or name-pool coverage without an explicit
scope decision.

Read the current locale sets from each surface's source below and its linked
guide. The sets can differ intentionally; reconcile each requested rollout
against them instead of assuming a shared count. Listing-only Android work uses
the [Play listing localization runbook](../apps/android/docs/play-store-localization-runbook.md)
without changing shipping app languages.

## The locale lists are hand-maintained and mostly not type-checked

Widening a locale union breaks every `Record<…>` keyed by it, so those maps are
safe. Plain arrays are not, and neither is a list that mirrors another
repository. Search the affected repositories instead of trusting any checklist,
including this one:

```bash
rg -n 'Record<[A-Za-z]*Locale' apps          # this repository
rg -n 'Record<AppLocale' src next.config.ts # when website changes are in scope
```

Independent locale inventories include:

- [apps/web/src/i18n/types.ts](../apps/web/src/i18n/types.ts) — `supportedLocales`
- [apps/auth/src/routes/browser/loginPageLocale.ts](../apps/auth/src/routes/browser/loginPageLocale.ts) — `SUPPORTED_LOGIN_PAGE_LOCALES`
- [apps/backend/src/community/anonymousDisplayNames.ts](../apps/backend/src/community/anonymousDisplayNames.ts) — `supportedAnonymousDisplayNameLocales`
- [apps/android/app/src/main/res/xml/locales_config.xml](../apps/android/app/src/main/res/xml/locales_config.xml)
- iOS registration and `REQUIRED_LOCALES`, owned by [iOS localization](ios-localization.md#source-of-truth)
- Store metadata and screenshot mappings, owned by [App Store metadata](app-store-connect-metadata.md)

Two more backend lists are hand-maintained and nothing fails when they drift:
`catalogAudienceLocales` in [apps/backend/src/catalog/types.ts](../apps/backend/src/catalog/types.ts),
which must be changed together with the website's `src/lib/localeConfig.ts`, and
`INITIAL_CHAT_COMPOSER_SUGGESTION_TEXTS_BY_LOCALE` in
[apps/backend/src/chat/composerSuggestions.ts](../apps/backend/src/chat/composerSuggestions.ts).

## Order

| # | Surface | Decide | Guide |
| --- | --- | --- | --- |
| 1 | Web app | the exact tag the product exposes, and its week-first-day fallback | [docs/web-localization.md](web-localization.md) |
| 2 | Auth app | sign-in, OAuth consent, locale resolution, and text direction | [Auth and backend dependencies](#auth-and-backend-dependencies) |
| 3 | Backend | composer-suggestion aliases and the deliberate English name-pool fallback | [Auth and backend dependencies](#auth-and-backend-dependencies) |
| 4 | Demo onboarding card | the four strings in every locale of each affected client | [docs/demo-card.md](demo-card.md) |
| 5 | iOS | bundle localization, `kMDItemKeywords`, and the Settings language row | [docs/ios-localization.md](ios-localization.md) |
| 6 | Android | one line in `locales_config.xml`, then enable the language in Play App strings | [apps/android/docs/add-language-checklist.md](../apps/android/docs/add-language-checklist.md) |
| 7 | Store listings | supported Store locale, authored copy, localized assets, and publication from an editable version | [docs/app-store-connect-metadata.md](app-store-connect-metadata.md), [Play listing localization runbook](../apps/android/docs/play-store-localization-runbook.md) |
| 8 | Screenshots and composites | capture per locale, then build the derived materials | [apps/ios/docs/marketing-screenshots.md](../apps/ios/docs/marketing-screenshots.md), [apps/android/docs/marketing-screenshot-runbook.md](../apps/android/docs/marketing-screenshot-runbook.md) |
| 9 | Marketing website | the generic tag, its content tree, and the home-page composite | `flashcards-open-source-app-website`, `src/lib/localeConfig.ts` |

Step 4 lands with each affected client. Deploy auth and backend locale handling
before a client ships that locale. Capture screenshots only after its complete
resources and fixtures land. Android screenshot-only overlays do not require
a new shipping app language. Website images depend on captures only when a
website update is in scope.

## Auth and backend dependencies

Auth has a separate locale inventory from the full web app. Update all three:

- [loginPageLocale.ts](../apps/auth/src/routes/browser/loginPageLocale.ts):
  supported locales, language fallback/alias resolution, and direction. `ar`,
  `he`, `fa`, and `ur` use RTL; Norwegian `no` resolves to `nb`.
- [templates/login.ts](../apps/auth/src/templates/login.ts): the complete login
  dictionary, including errors and OTP states.
- [authorizePageLocale.ts](../apps/auth/src/routes/oauth/authorizePageLocale.ts):
  the complete OAuth consent dictionary.

Keep deliberately unsupported-language fixtures in the existing
[login tests](../apps/auth/src/routes/browser/loginPage.test.ts) unsupported when
expanding coverage. Verify sign-in and consent in the new locale, including RTL.

Check [composerSuggestions.ts](../apps/backend/src/chat/composerSuggestions.ts)
for initial suggestion copy and accepted aliases; it resolves iOS/auth `nb` to
its `no` category. Preserve regional Spanish handling. The
[anonymous display-name pools](../apps/backend/src/community/anonymousDisplayNames.ts)
intentionally fall back to English for languages without curated native pools;
adding an app language does not authorize machine-translated pools.

## Locale tags per surface

These shared-language examples show why tags differ by surface. For the complete
iOS-to-Store map, use [App Store metadata](app-store-connect-metadata.md). Pick
the right spelling in each column rather than reusing one.

| Language | Web, auth, iOS | Backend pools | Android app | Play listing | iOS screenshots | Website |
| --- | --- | --- | --- | --- | --- | --- |
| English | `en` | `en` | `en` | `en-US` | `en-US` (alias `en`) | `en` |
| French | `fr` | `fr` | `fr` | `fr-FR` | `fr` (alias `fr-FR`) | `fr` |
| Portuguese (Brazil) | `pt-BR` | `pt` | `pt` | `pt-BR` | `pt-BR` (alias `pt`) | `pt` |
| Spanish (Spain) | `es-ES` | `es-ES` | `es` | `es-ES` | `es-ES` | `es` |
| Spanish (Mexico) | `es-MX` | `es-MX` | `es` | `es-419` | `es-MX` (alias `es-419`) | — |
| Chinese (Simplified) | `zh-Hans` | `zh-Hans` | `zh-CN` | `zh-CN` | `zh-Hans` (alias `zh-CN`) | `zh` |
| Arabic | `ar` | `ar` | `ar` | `ar` | `ar` | `ar` |
| German | `de` | `de` | `de` | `de-DE` | `de` (alias `de-DE`) | `de` |
| Hindi | `hi` | `hi` | `hi` | `hi-IN` | `hi` (alias `hi-IN`) | `hi` |
| Japanese | `ja` | `ja` | `ja` | `ja-JP` | `ja` (alias `ja-JP`) | `ja` |
| Russian | `ru` | `ru` | `ru` | `ru-RU` | `ru` (alias `ru-RU`) | `ru` |

Notes that are easy to get wrong:

- The website has no `es-MX`. Its single `es` is served by the `es-ES` app
  composite, so an `es-MX` capture is never a website asset.
- Backend name pools spell Brazilian Portuguese `pt`, not `pt-BR`; `es-MX` and
  `es-ES` both resolve to one shared Spanish pool file.
- Play carries an `es-US` listing with no matching product locale.
- The website's `public/home/app-screens-showcase-<website-tag>.png` files come
  from the composites produced by `scripts/ios/build-ios-marketing-materials.sh`,
  copied into the website repository and renamed from the app tag to the website
  tag. Each live file is frozen at the build run that produced it, so it need not
  match this repository's current composite byte for byte.

## Store delivery

- Enable the language for translation in Google Play Console App strings. The
  repository owns only the base English strings and the advertised locale list;
  the translated Android copy never enters this repository.
- Upload App Store metadata and both screenshot families using the procedure in
  [App Store metadata](app-store-connect-metadata.md). That command updates an
  editable draft; App Review submission remains a separate
  [iOS release step](manual-production-release.md#ios).

## Screenshot and website freshness

Use [iOS marketing screenshots](../apps/ios/docs/marketing-screenshots.md) for the
capture inventory and both device families. Fixture availability does not prove
that the PNGs were regenerated: inspect the actual output for the intended
source revision, locale, and screen before upload. Updating iOS screenshots does
not refresh Android screenshots or the website's copied composites; handle those
only within their own approved scope and linked platform runbooks.

## Identify stale marketing screenshots

Inspect the committed PNGs against the structural markers below. Android has
current French and Brazilian Portuguese sets plus the 39 additional locales in
the [JSON loader map](../apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/marketing/screenshots/MarketingScreenshotLocaleLoader.kt);
do not classify every other language as April-era content.

The remaining legacy Android sets to check are `en`, `ar`, `de-DE`, `es-ES`,
`es-419`, `es-US`, `hi-IN`, `ja-JP`, `ru-RU`, and `zh-CN`. The committed English
prefix is `en`; capturing `en-US` creates a second set instead of replacing it.
The corresponding legacy iOS sets are `en-US`, `ar`, `de`, `es-ES`, `es-MX`,
`hi`, `ja`, `ru`, and `zh-Hans`. Android's `es-US` has no iOS counterpart, so a
regeneration pass driven by the iOS list alone misses it.

Tell the two generations apart by the structure of the progress screen, the only
marker that holds on both platforms and in every locale:

- Stale: the streak card carries no freeze indicator, and the "Reviews" bar
  chart sits directly under it. There is no leaderboard.
- Current: the streak card carries a freeze indicator, and a grade leaderboard
  with a friend-invite call to action sits directly under it. The "Reviews"
  chart still exists, but it moved below the leaderboard and off the first
  screen, so a capture that ends at the leaderboard is not missing it. The
  always-rendered half differs by platform — on iOS it is the freeze indicator,
  and the leaderboard needs a loaded snapshot; on Android it is the leaderboard
  section, and the freeze indicator needs a loaded summary — so decide on that
  half and treat the other one as optional.

Do not use the streak number or the chart's date range to date a capture. The
streak number is a per-platform fixture value — the current iOS captures read
12, while the current Android captures read 8, which is also the stale iOS
number — and the chart's date range follows the locale's week start, so
Sunday-first locales never show the Monday-first range.

[scripts/android/pull-marketing-screenshot.sh](../scripts/android/pull-marketing-screenshot.sh)
rejects a stale, empty, truncated, or non-PNG pull. Still open the PNG: the
guards prove a fresh file arrived, not that it shows the right thing.
