# Add a Language

Every surface a new product language touches, in delivery order. Each step names
the decision and links to the guide that owns it.

A new app language lands on every product surface: auth, iOS, the web app,
Android, and the marketing website. Auth, iOS, and the web app use the same
tags, with separate `es-ES` and `es-MX`; Android and the website use one
generic tag per language. Repository resources, generated screenshots, editable
Store drafts, and the released binary are separate delivery states. The backend's
[anonymous display-name pools](../apps/backend/src/community/anonymousDisplayNames.ts)
stay narrower; do not widen them without an explicit scope decision.

The website deliberately translates less than the app, and this is permanent,
not a backlog: interface, home, features, pricing, and catalog chrome are
translated, while docs, legal pages, and blog articles fall back to English
unless a translated file exists. Public deck content is never translated. Every
site locale has catalog pages and appears in catalog filters; its catalog can
be empty until decks exist. The website derives each locale's translated routes
from its content files in `src/data/contentRegistry.ts`.

The surfaces' locale sets can differ intentionally; reconcile each requested
rollout against each surface's source instead of assuming a shared count.
Listing-only Android work uses the
[Play listing localization runbook](../apps/android/docs/play-store-localization-runbook.md)
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

- [apps/web/src/i18n/types.ts](../apps/web/src/i18n/types.ts) — `supportedLocales`,
  whose registration is checked by the [web parity check](web-localization.md#1-register-the-tag)
- [apps/auth/src/routes/browser/loginPageLocale.ts](../apps/auth/src/routes/browser/loginPageLocale.ts) — `SUPPORTED_LOGIN_PAGE_LOCALES`
- [apps/backend/src/community/anonymousDisplayNames.ts](../apps/backend/src/community/anonymousDisplayNames.ts) — `supportedAnonymousDisplayNameLocales`
- [apps/android/app/src/main/res/xml/locales_config.xml](../apps/android/app/src/main/res/xml/locales_config.xml)
- iOS registration and `REQUIRED_LOCALES`, owned by [iOS localization](ios-localization.md#add-a-new-language)
- Store metadata and screenshot mappings, owned by [App Store metadata](app-store-connect-metadata.md)

Nothing fails when these two backend lists drift:
`catalogAudienceLocales` in [apps/backend/src/catalog/types.ts](../apps/backend/src/catalog/types.ts)
and `INITIAL_CHAT_COMPOSER_SUGGESTION_TEXTS_BY_LOCALE` in
[apps/backend/src/chat/composerSuggestions.ts](../apps/backend/src/chat/composerSuggestions.ts).

## Order

| # | Surface | Decide | Guide |
| --- | --- | --- | --- |
| 1 | Web app | the catalog under the iOS tag, its registration, and its week-first-day fallback | [docs/web-localization.md](web-localization.md) |
| 2 | Auth app | sign-in, OAuth consent, locale resolution, and text direction | [Auth and backend dependencies](#auth-and-backend-dependencies) |
| 3 | Backend | composer-suggestion aliases and the deliberate English name-pool fallback | [Auth and backend dependencies](#auth-and-backend-dependencies) |
| 4 | Demo onboarding card | the four strings in every locale of each affected client | [docs/demo-card.md](demo-card.md) |
| 5 | iOS | bundle localization, `kMDItemKeywords`, and the Settings language row | [docs/ios-localization.md](ios-localization.md) |
| 6 | Android | one line in `locales_config.xml`, then enable the language in Play App strings | [apps/android/docs/add-language-checklist.md](../apps/android/docs/add-language-checklist.md) |
| 7 | Store listings | supported Store locale, authored copy, localized assets, and publication from an editable version | [docs/app-store-connect-metadata.md](app-store-connect-metadata.md), [docs/subscription-store-metadata.md](subscription-store-metadata.md), [Play listing localization runbook](../apps/android/docs/play-store-localization-runbook.md), [OpenAI directory metadata](openai-plugin-metadata.md) |
| 8 | Screenshots and composites | capture per locale, then build the derived materials | [apps/ios/docs/marketing-screenshots.md](../apps/ios/docs/marketing-screenshots.md), [apps/android/docs/marketing-screenshot-runbook.md](../apps/android/docs/marketing-screenshot-runbook.md) |
| 9 | Marketing website | the generic tag, its translated interface and marketing pages, `catalogAudienceLocales`, and the home-page composite | `flashcards-open-source-app-website`, `src/lib/localeConfig.ts` |

Step 4 lands with each affected client. Deploy auth and backend locale handling
before a client ships that locale. Capture screenshots only after its complete
resources and fixtures land. Android screenshot-only overlays do not require
a new shipping app language. Website images depend on captures only when a
website update is in scope.

The App Store metadata upload updates an editable draft; App Review submission
remains a separate [iOS release step](release/ios.md#ios). Fixture availability
does not prove that screenshot PNGs were regenerated: inspect the actual output
for the intended source revision, locale, and screen before upload. Updating iOS
screenshots does not refresh Android screenshots or the website's copied
composites; handle those only within their own approved scope and runbooks.

## Auth and backend dependencies

Auth has a separate locale inventory from the full web app. Update all three:

- [loginPageLocale.ts](../apps/auth/src/routes/browser/loginPageLocale.ts):
  supported locales, language fallback/alias resolution, and direction.
- [templates/login.ts](../apps/auth/src/templates/login.ts): the complete login
  dictionary, including errors and OTP states.
- [authorizePageLocale.ts](../apps/auth/src/routes/oauth/authorizePageLocale.ts):
  the complete OAuth consent dictionary.

Keep deliberately unsupported-language fixtures in the existing
[login tests](../apps/auth/src/routes/browser/loginPage.test.ts) unsupported when
expanding coverage. Verify sign-in and consent in the new locale, including RTL.

Add initial suggestion copy and accepted aliases to
[composerSuggestions.ts](../apps/backend/src/chat/composerSuggestions.ts),
preserving regional Spanish handling. Adding an app language does not authorize
machine-translated [display-name pools](../apps/backend/src/community/anonymousDisplayNames.ts).

## Locale tags per surface

These shared-language examples show why tags differ by surface. For the complete
iOS-to-Store map, use [App Store metadata](app-store-connect-metadata.md). Pick
the right spelling in each column rather than reusing one.

| Language | Web, auth, iOS | Android app | Play listing | iOS screenshots | Website |
| --- | --- | --- | --- | --- | --- |
| English | `en` | `en` | `en-US` | `en-US` (alias `en`) | `en` |
| French | `fr` | `fr` | `fr-FR` | `fr` (alias `fr-FR`) | `fr` |
| Portuguese (Brazil) | `pt-BR` | `pt` | `pt-BR` | `pt-BR` (alias `pt`) | `pt` |
| Spanish (Spain) | `es-ES` | `es` | `es-ES` | `es-ES` | `es` |
| Spanish (Mexico) | `es-MX` | `es` | `es-419` | `es-MX` (alias `es-419`) | — |
| Chinese (Simplified) | `zh-Hans` | `zh-CN` | `zh-CN` | `zh-Hans` (alias `zh-CN`) | `zh` |
| Arabic | `ar` | `ar` | `ar` | `ar` | `ar` |
| German | `de` | `de` | `de-DE` | `de` (alias `de-DE`) | `de` |
| Hindi | `hi` | `hi` | `hi-IN` | `hi` (alias `hi-IN`) | `hi` |
| Japanese | `ja` | `ja` | `ja-JP` | `ja` (alias `ja-JP`) | `ja` |
| Russian | `ru` | `ru` | `ru-RU` | `ru` (alias `ru-RU`) | `ru` |
| Norwegian | `nb` | `no` | `no-NO` | `nb` (alias `no`) | `nb` |

Notes that are easy to get wrong:

- The website has no `es-MX`. Its single `es` is served by the `es-ES` app
  composite, so an `es-MX` capture is never a website asset.
- Play carries an `es-US` listing with no matching product locale.
- The website's `public/home/app-screens-showcase-<website-tag>.png` files come
  from the composites produced by `scripts/ios/build-ios-marketing-materials.sh`,
  copied into the website repository and renamed from the app tag to the website
  tag. Each live file is frozen at the build run that produced it, so it need not
  match this repository's current composite byte for byte.

## Identify stale marketing screenshots

Download the pinned PNGs using [Media assets](media-assets.md), then inspect
them against the structural markers below. Android has
current French and Brazilian Portuguese sets plus the locales in the
[JSON loader map](../apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/marketing/screenshots/MarketingScreenshotLocaleLoader.kt);
do not classify every other language as April-era content.

The remaining legacy Android sets to check are `en`, `ar`, `de-DE`, `es-ES`,
`es-419`, `es-US`, `hi-IN`, `ja-JP`, `ru-RU`, and `zh-CN`. The archived English
prefix is `en`; capturing `en-US` creates a second set instead of replacing it.
Android's `es-US` has no iOS counterpart, so a
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

Do not use the streak number or the chart's date range to date a capture: the
streak number is a per-platform fixture value, and the chart's date range
follows the locale's week start.

[scripts/android/pull-marketing-screenshot.sh](../scripts/android/pull-marketing-screenshot.sh)
rejects a stale, empty, truncated, or non-PNG pull. Still open the PNG: the
guards prove a fresh file arrived, not that it shows the right thing.
