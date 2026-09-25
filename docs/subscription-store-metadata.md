# Subscription Store Metadata

Related app listings: [App Store Connect](app-store-connect-metadata.md) and
[Google Play](google-play-store-metadata.md). Paid-access rules:
[Premium entitlements](premium-entitlements.md).

This file owns the configuration and source texts of the Premium subscription in
App Store Connect and Google Play. These sections are repository inputs, not
evidence that the products exist in either console.

## Product configuration

The mobile subscription pages compile these IDs in and check them, so create
each product, base plan, and offer exactly as written.

### App Store Connect

| Setting | Value |
| --- | --- |
| Subscription group | `Premium` |
| Product ID | `premium_monthly` |
| Reference name | `Premium Monthly` |
| Duration | 1 month |
| Base price | USD 6.99; Apple derives the other storefront prices |
| Introductory offer | Free trial, 1 week, new subscribers |

### Google Play

| Setting | Value |
| --- | --- |
| Subscription product ID | `premium` |
| Base plan ID | `monthly` |
| Base plan type | Auto-renewing, 1 month |
| Base price | USD 6.99; Play converts it to regional prices |
| Offer ID | `free-trial-7d` |
| Offer phase | Free trial, 1 week |
| Offer eligibility | New customers |

## Texts

Each field label carries the store limit, and each authored value its character
count. Locale headings reuse the language names and Store IDs of the app
listings: the [App Store locale mapping](app-store-connect-metadata.md) and the
[Play listing locales](google-play-store-metadata.md#which-languages-live-in-this-file).
A `pending` value awaits translation of its English source; replace it with the
translated value and its character count.

## App Store Connect texts

### English (U.S.) - en-US

- Display name (max 30): `Premium` (7)
- Description (max 45): `AI chat without the monthly limit` (33)

### Arabic - ar-SA

- Display name (max 30): pending, source `Premium`
- Description (max 45): pending, source `AI chat without the monthly limit`

### Chinese (Simplified) - zh-Hans

- Display name (max 30): pending, source `Premium`
- Description (max 45): pending, source `AI chat without the monthly limit`

### French - fr-FR

- Display name (max 30): pending, source `Premium`
- Description (max 45): pending, source `AI chat without the monthly limit`

### German - de-DE

- Display name (max 30): pending, source `Premium`
- Description (max 45): pending, source `AI chat without the monthly limit`

### Hindi - hi

- Display name (max 30): pending, source `Premium`
- Description (max 45): pending, source `AI chat without the monthly limit`

### Japanese - ja

- Display name (max 30): pending, source `Premium`
- Description (max 45): pending, source `AI chat without the monthly limit`

### Portuguese (Brazil) - pt-BR

- Display name (max 30): pending, source `Premium`
- Description (max 45): pending, source `AI chat without the monthly limit`

### Russian - ru

- Display name (max 30): pending, source `Premium`
- Description (max 45): pending, source `AI chat without the monthly limit`

### Spanish (Mexico) - es-MX

- Display name (max 30): pending, source `Premium`
- Description (max 45): pending, source `AI chat without the monthly limit`

### Spanish (Spain) - es-ES

- Display name (max 30): pending, source `Premium`
- Description (max 45): pending, source `AI chat without the monthly limit`

### Bangla - bn-BD

- Display name (max 30): pending, source `Premium`
- Description (max 45): pending, source `AI chat without the monthly limit`

### Catalan - ca

- Display name (max 30): pending, source `Premium`
- Description (max 45): pending, source `AI chat without the monthly limit`

### Czech - cs

- Display name (max 30): pending, source `Premium`
- Description (max 45): pending, source `AI chat without the monthly limit`

### Danish - da

- Display name (max 30): pending, source `Premium`
- Description (max 45): pending, source `AI chat without the monthly limit`

### Greek - el

- Display name (max 30): pending, source `Premium`
- Description (max 45): pending, source `AI chat without the monthly limit`

### Finnish - fi

- Display name (max 30): pending, source `Premium`
- Description (max 45): pending, source `AI chat without the monthly limit`

### Gujarati - gu-IN

- Display name (max 30): pending, source `Premium`
- Description (max 45): pending, source `AI chat without the monthly limit`

### Hebrew - he

- Display name (max 30): pending, source `Premium`
- Description (max 45): pending, source `AI chat without the monthly limit`

### Croatian - hr

- Display name (max 30): pending, source `Premium`
- Description (max 45): pending, source `AI chat without the monthly limit`

### Hungarian - hu

- Display name (max 30): pending, source `Premium`
- Description (max 45): pending, source `AI chat without the monthly limit`

### Indonesian - id

- Display name (max 30): pending, source `Premium`
- Description (max 45): pending, source `AI chat without the monthly limit`

### Italian - it

- Display name (max 30): pending, source `Premium`
- Description (max 45): pending, source `AI chat without the monthly limit`

### Kannada - kn-IN

- Display name (max 30): pending, source `Premium`
- Description (max 45): pending, source `AI chat without the monthly limit`

### Korean - ko

- Display name (max 30): pending, source `Premium`
- Description (max 45): pending, source `AI chat without the monthly limit`

### Malayalam - ml-IN

- Display name (max 30): pending, source `Premium`
- Description (max 45): pending, source `AI chat without the monthly limit`

### Marathi - mr-IN

- Display name (max 30): pending, source `Premium`
- Description (max 45): pending, source `AI chat without the monthly limit`

### Norwegian - no

- Display name (max 30): pending, source `Premium`
- Description (max 45): pending, source `AI chat without the monthly limit`

### Dutch - nl-NL

- Display name (max 30): pending, source `Premium`
- Description (max 45): pending, source `AI chat without the monthly limit`

### Punjabi - pa-IN

- Display name (max 30): pending, source `Premium`
- Description (max 45): pending, source `AI chat without the monthly limit`

### Polish - pl

- Display name (max 30): pending, source `Premium`
- Description (max 45): pending, source `AI chat without the monthly limit`

### Romanian - ro

- Display name (max 30): pending, source `Premium`
- Description (max 45): pending, source `AI chat without the monthly limit`

### Slovak - sk

- Display name (max 30): pending, source `Premium`
- Description (max 45): pending, source `AI chat without the monthly limit`

### Slovenian - sl-SI

- Display name (max 30): pending, source `Premium`
- Description (max 45): pending, source `AI chat without the monthly limit`

### Swedish - sv

- Display name (max 30): pending, source `Premium`
- Description (max 45): pending, source `AI chat without the monthly limit`

### Tamil - ta-IN

- Display name (max 30): pending, source `Premium`
- Description (max 45): pending, source `AI chat without the monthly limit`

### Telugu - te-IN

- Display name (max 30): pending, source `Premium`
- Description (max 45): pending, source `AI chat without the monthly limit`

### Thai - th

- Display name (max 30): pending, source `Premium`
- Description (max 45): pending, source `AI chat without the monthly limit`

### Turkish - tr

- Display name (max 30): pending, source `Premium`
- Description (max 45): pending, source `AI chat without the monthly limit`

### Ukrainian - uk

- Display name (max 30): pending, source `Premium`
- Description (max 45): pending, source `AI chat without the monthly limit`

### Urdu - ur-PK

- Display name (max 30): pending, source `Premium`
- Description (max 45): pending, source `AI chat without the monthly limit`

### Vietnamese - vi

- Display name (max 30): pending, source `Premium`
- Description (max 45): pending, source `AI chat without the monthly limit`

## Google Play texts

Play shows up to four benefits. List only what the subscription adds: free
features such as sync are not subscription benefits.

### Default - English (United States) - en-US

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `AI chat without the monthly limit` (33)
- Description (max 80): `Chat with the AI without hitting the free monthly limit.` (56)

### Arabic - ar

- Name (max 55): pending, source `Premium`
- Benefit 1 (max 40): pending, source `AI chat without the monthly limit`
- Description (max 80): pending, source `Chat with the AI without hitting the free monthly limit.`

### Chinese (Simplified) - zh-CN

- Name (max 55): pending, source `Premium`
- Benefit 1 (max 40): pending, source `AI chat without the monthly limit`
- Description (max 80): pending, source `Chat with the AI without hitting the free monthly limit.`

### French - fr-FR

- Name (max 55): pending, source `Premium`
- Benefit 1 (max 40): pending, source `AI chat without the monthly limit`
- Description (max 80): pending, source `Chat with the AI without hitting the free monthly limit.`

### German - de-DE

- Name (max 55): pending, source `Premium`
- Benefit 1 (max 40): pending, source `AI chat without the monthly limit`
- Description (max 80): pending, source `Chat with the AI without hitting the free monthly limit.`

### Hindi - hi-IN

- Name (max 55): pending, source `Premium`
- Benefit 1 (max 40): pending, source `AI chat without the monthly limit`
- Description (max 80): pending, source `Chat with the AI without hitting the free monthly limit.`

### Japanese - ja-JP

- Name (max 55): pending, source `Premium`
- Benefit 1 (max 40): pending, source `AI chat without the monthly limit`
- Description (max 80): pending, source `Chat with the AI without hitting the free monthly limit.`

### Portuguese (Brazil) - pt-BR

- Name (max 55): pending, source `Premium`
- Benefit 1 (max 40): pending, source `AI chat without the monthly limit`
- Description (max 80): pending, source `Chat with the AI without hitting the free monthly limit.`

### Russian - ru-RU

- Name (max 55): pending, source `Premium`
- Benefit 1 (max 40): pending, source `AI chat without the monthly limit`
- Description (max 80): pending, source `Chat with the AI without hitting the free monthly limit.`

### Spanish (Latin America) - es-419

- Name (max 55): pending, source `Premium`
- Benefit 1 (max 40): pending, source `AI chat without the monthly limit`
- Description (max 80): pending, source `Chat with the AI without hitting the free monthly limit.`

### Spanish (Spain) - es-ES

- Name (max 55): pending, source `Premium`
- Benefit 1 (max 40): pending, source `AI chat without the monthly limit`
- Description (max 80): pending, source `Chat with the AI without hitting the free monthly limit.`

### Spanish (United States) - es-US

- Name (max 55): pending, source `Premium`
- Benefit 1 (max 40): pending, source `AI chat without the monthly limit`
- Description (max 80): pending, source `Chat with the AI without hitting the free monthly limit.`

### Bulgarian - bg

- Name (max 55): pending, source `Premium`
- Benefit 1 (max 40): pending, source `AI chat without the monthly limit`
- Description (max 80): pending, source `Chat with the AI without hitting the free monthly limit.`

### Bengali (Bangladesh) - bn-BD

- Name (max 55): pending, source `Premium`
- Benefit 1 (max 40): pending, source `AI chat without the monthly limit`
- Description (max 80): pending, source `Chat with the AI without hitting the free monthly limit.`

### Catalan - ca

- Name (max 55): pending, source `Premium`
- Benefit 1 (max 40): pending, source `AI chat without the monthly limit`
- Description (max 80): pending, source `Chat with the AI without hitting the free monthly limit.`

### Czech - cs-CZ

- Name (max 55): pending, source `Premium`
- Benefit 1 (max 40): pending, source `AI chat without the monthly limit`
- Description (max 80): pending, source `Chat with the AI without hitting the free monthly limit.`

### Danish - da-DK

- Name (max 55): pending, source `Premium`
- Benefit 1 (max 40): pending, source `AI chat without the monthly limit`
- Description (max 80): pending, source `Chat with the AI without hitting the free monthly limit.`

### Greek - el-GR

- Name (max 55): pending, source `Premium`
- Benefit 1 (max 40): pending, source `AI chat without the monthly limit`
- Description (max 80): pending, source `Chat with the AI without hitting the free monthly limit.`

### Estonian - et

- Name (max 55): pending, source `Premium`
- Benefit 1 (max 40): pending, source `AI chat without the monthly limit`
- Description (max 80): pending, source `Chat with the AI without hitting the free monthly limit.`

### Persian - fa

- Name (max 55): pending, source `Premium`
- Benefit 1 (max 40): pending, source `AI chat without the monthly limit`
- Description (max 80): pending, source `Chat with the AI without hitting the free monthly limit.`

### Finnish - fi-FI

- Name (max 55): pending, source `Premium`
- Benefit 1 (max 40): pending, source `AI chat without the monthly limit`
- Description (max 80): pending, source `Chat with the AI without hitting the free monthly limit.`

### Gujarati - gu

- Name (max 55): pending, source `Premium`
- Benefit 1 (max 40): pending, source `AI chat without the monthly limit`
- Description (max 80): pending, source `Chat with the AI without hitting the free monthly limit.`

### Hebrew - iw-IL

- Name (max 55): pending, source `Premium`
- Benefit 1 (max 40): pending, source `AI chat without the monthly limit`
- Description (max 80): pending, source `Chat with the AI without hitting the free monthly limit.`

### Croatian - hr

- Name (max 55): pending, source `Premium`
- Benefit 1 (max 40): pending, source `AI chat without the monthly limit`
- Description (max 80): pending, source `Chat with the AI without hitting the free monthly limit.`

### Hungarian - hu-HU

- Name (max 55): pending, source `Premium`
- Benefit 1 (max 40): pending, source `AI chat without the monthly limit`
- Description (max 80): pending, source `Chat with the AI without hitting the free monthly limit.`

### Indonesian - id

- Name (max 55): pending, source `Premium`
- Benefit 1 (max 40): pending, source `AI chat without the monthly limit`
- Description (max 80): pending, source `Chat with the AI without hitting the free monthly limit.`

### Icelandic - is-IS

- Name (max 55): pending, source `Premium`
- Benefit 1 (max 40): pending, source `AI chat without the monthly limit`
- Description (max 80): pending, source `Chat with the AI without hitting the free monthly limit.`

### Italian - it-IT

- Name (max 55): pending, source `Premium`
- Benefit 1 (max 40): pending, source `AI chat without the monthly limit`
- Description (max 80): pending, source `Chat with the AI without hitting the free monthly limit.`

### Kannada (India) - kn-IN

- Name (max 55): pending, source `Premium`
- Benefit 1 (max 40): pending, source `AI chat without the monthly limit`
- Description (max 80): pending, source `Chat with the AI without hitting the free monthly limit.`

### Korean - ko-KR

- Name (max 55): pending, source `Premium`
- Benefit 1 (max 40): pending, source `AI chat without the monthly limit`
- Description (max 80): pending, source `Chat with the AI without hitting the free monthly limit.`

### Lithuanian - lt

- Name (max 55): pending, source `Premium`
- Benefit 1 (max 40): pending, source `AI chat without the monthly limit`
- Description (max 80): pending, source `Chat with the AI without hitting the free monthly limit.`

### Latvian - lv

- Name (max 55): pending, source `Premium`
- Benefit 1 (max 40): pending, source `AI chat without the monthly limit`
- Description (max 80): pending, source `Chat with the AI without hitting the free monthly limit.`

### Malayalam (India) - ml-IN

- Name (max 55): pending, source `Premium`
- Benefit 1 (max 40): pending, source `AI chat without the monthly limit`
- Description (max 80): pending, source `Chat with the AI without hitting the free monthly limit.`

### Marathi (India) - mr-IN

- Name (max 55): pending, source `Premium`
- Benefit 1 (max 40): pending, source `AI chat without the monthly limit`
- Description (max 80): pending, source `Chat with the AI without hitting the free monthly limit.`

### Dutch - nl-NL

- Name (max 55): pending, source `Premium`
- Benefit 1 (max 40): pending, source `AI chat without the monthly limit`
- Description (max 80): pending, source `Chat with the AI without hitting the free monthly limit.`

### Norwegian - no-NO

- Name (max 55): pending, source `Premium`
- Benefit 1 (max 40): pending, source `AI chat without the monthly limit`
- Description (max 80): pending, source `Chat with the AI without hitting the free monthly limit.`

### Punjabi - pa

- Name (max 55): pending, source `Premium`
- Benefit 1 (max 40): pending, source `AI chat without the monthly limit`
- Description (max 80): pending, source `Chat with the AI without hitting the free monthly limit.`

### Polish - pl-PL

- Name (max 55): pending, source `Premium`
- Benefit 1 (max 40): pending, source `AI chat without the monthly limit`
- Description (max 80): pending, source `Chat with the AI without hitting the free monthly limit.`

### Romanian - ro

- Name (max 55): pending, source `Premium`
- Benefit 1 (max 40): pending, source `AI chat without the monthly limit`
- Description (max 80): pending, source `Chat with the AI without hitting the free monthly limit.`

### Slovak - sk

- Name (max 55): pending, source `Premium`
- Benefit 1 (max 40): pending, source `AI chat without the monthly limit`
- Description (max 80): pending, source `Chat with the AI without hitting the free monthly limit.`

### Slovenian - sl

- Name (max 55): pending, source `Premium`
- Benefit 1 (max 40): pending, source `AI chat without the monthly limit`
- Description (max 80): pending, source `Chat with the AI without hitting the free monthly limit.`

### Swedish - sv-SE

- Name (max 55): pending, source `Premium`
- Benefit 1 (max 40): pending, source `AI chat without the monthly limit`
- Description (max 80): pending, source `Chat with the AI without hitting the free monthly limit.`

### Swahili - sw

- Name (max 55): pending, source `Premium`
- Benefit 1 (max 40): pending, source `AI chat without the monthly limit`
- Description (max 80): pending, source `Chat with the AI without hitting the free monthly limit.`

### Tamil (India) - ta-IN

- Name (max 55): pending, source `Premium`
- Benefit 1 (max 40): pending, source `AI chat without the monthly limit`
- Description (max 80): pending, source `Chat with the AI without hitting the free monthly limit.`

### Telugu (India) - te-IN

- Name (max 55): pending, source `Premium`
- Benefit 1 (max 40): pending, source `AI chat without the monthly limit`
- Description (max 80): pending, source `Chat with the AI without hitting the free monthly limit.`

### Thai - th

- Name (max 55): pending, source `Premium`
- Benefit 1 (max 40): pending, source `AI chat without the monthly limit`
- Description (max 80): pending, source `Chat with the AI without hitting the free monthly limit.`

### Turkish - tr-TR

- Name (max 55): pending, source `Premium`
- Benefit 1 (max 40): pending, source `AI chat without the monthly limit`
- Description (max 80): pending, source `Chat with the AI without hitting the free monthly limit.`

### Ukrainian - uk

- Name (max 55): pending, source `Premium`
- Benefit 1 (max 40): pending, source `AI chat without the monthly limit`
- Description (max 80): pending, source `Chat with the AI without hitting the free monthly limit.`

### Urdu - ur

- Name (max 55): pending, source `Premium`
- Benefit 1 (max 40): pending, source `AI chat without the monthly limit`
- Description (max 80): pending, source `Chat with the AI without hitting the free monthly limit.`

### Vietnamese - vi

- Name (max 55): pending, source `Premium`
- Benefit 1 (max 40): pending, source `AI chat without the monthly limit`
- Description (max 80): pending, source `Chat with the AI without hitting the free monthly limit.`

### Zulu - zu

- Name (max 55): pending, source `Premium`
- Benefit 1 (max 40): pending, source `AI chat without the monthly limit`
- Description (max 80): pending, source `Chat with the AI without hitting the free monthly limit.`
