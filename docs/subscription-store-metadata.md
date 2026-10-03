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
| Apple app ID | `6760538964` |
| Apple subscription group ID | `22415526` |
| Apple subscription ID | `6816418042` |
| Subscription group reference name | `Premium` |
| Subscription group display name | Localized per locale in [App Store Connect texts](#app-store-connect-texts); required before the first subscription is submitted |
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

## Canonical English App Review notes

Copy only the text inside this block into the subscription's App Review notes
(maximum 4000 characters). Keep this as the single source; the
[Apple preparation procedure](apple-subscriptions.md#prepare-app-review-materials)
owns upload and readback. These notes describe the offer, not completed testing.

```text
Premium (premium_monthly) is a monthly auto-renewable subscription. It includes 1000 in-app AI chat messages per calendar month (UTC), using our platform's AI service, and accent color customization. Sync remains free for everyone and is not a subscription benefit.

To open the purchase offer, launch the app as a guest or sign in, then open Settings > Subscription and select the Premium offer. It is also available from Settings > General > Accent Color when a free user selects a premium color. The same purchase offer appears when a free user reaches the in-app AI chat allowance. No Nibomo account sign-in is required to purchase as a guest.

The offer displays the App Store's localized monthly price for the current storefront. The base U.S. price is USD 6.99; regional prices come from Apple. A seven-day free trial is offered only when Apple reports that the customer's store account is eligible. After the eligible trial, the subscription renews monthly at the displayed price unless canceled. Customers who are ineligible see the monthly offer without a trial promise. The offer includes renewal terms, Privacy Policy, and Apple's Standard EULA.

Restore purchases is available from the offer and Settings > Subscription, including for guests. Manage subscription opens Apple's subscription management. Deleting a Nibomo account does not cancel an Apple subscription.

Some early users already have a lifetime Premium gift. These gifts are not sold as an in-app product. Gift holders retain Premium access without purchasing this subscription. A guest's gift follows the guest when an email is linked; a gift cannot be restored through Apple if the guest identity is lost.

Users may supply their own OpenAI API key as an alternative for AI use. This bypasses the platform-key chat allowance for those requests, but grants no Premium entitlement or accent color customization. The AI allowance sheet exposes this alternative; ordinary subscription and accent color offers do not present it as an alternative purchase path.
```

## Texts

Each field label carries the store limit, and each authored value its character
count. Locale headings reuse the language names and Store IDs of the app
listings: the [App Store locale mapping](app-store-connect-metadata.md) and the
[Play listing locales](google-play-store-metadata.md#which-languages-live-in-this-file).
Each locale reuses its own listing's term for AI. `Premium` stays in Latin
script unless that listing writes AI in the locale's own script.

## App Store Connect texts

The 42 store locales below are separate from the full iOS UI inventory. The
[catalog procedure](apple-subscriptions.md) loads every one, rejects missing or
unsupported locales, and checks Apple field limits before contacting Apple.
Descriptions state the Premium allowance; sync remains free.

### English (U.S.) - en-US

- Display name (max 30): `Premium` (7)
- Description (max 45): `1000 AI messages per month` (26)
- Subscription group display name (max 30): `Premium` (7)

### Arabic - ar-SA

- Display name (max 30): `بريميوم` (7)
- Description (max 45): `1000 رسالة ذكاء اصطناعي شهريًا` (30)
- Subscription group display name (max 30): `بريميوم` (7)

### Chinese (Simplified) - zh-Hans

- Display name (max 30): `Premium` (7)
- Description (max 45): `每月 1000 条 AI 消息` (15)
- Subscription group display name (max 30): `Premium` (7)

### French - fr-FR

- Display name (max 30): `Premium` (7)
- Description (max 45): `1000 messages IA par mois` (25)
- Subscription group display name (max 30): `Premium` (7)

### German - de-DE

- Display name (max 30): `Premium` (7)
- Description (max 45): `1000 KI-Nachrichten pro Monat` (29)
- Subscription group display name (max 30): `Premium` (7)

### Hindi - hi

- Display name (max 30): `Premium` (7)
- Description (max 45): `हर महीने 1000 AI संदेश` (22)
- Subscription group display name (max 30): `Premium` (7)

### Japanese - ja

- Display name (max 30): `Premium` (7)
- Description (max 45): `毎月1000件のAIメッセージ` (15)
- Subscription group display name (max 30): `Premium` (7)

### Portuguese (Brazil) - pt-BR

- Display name (max 30): `Premium` (7)
- Description (max 45): `1000 mensagens de IA por mês` (28)
- Subscription group display name (max 30): `Premium` (7)

### Russian - ru

- Display name (max 30): `Премиум` (7)
- Description (max 45): `1000 сообщений ИИ в месяц` (25)
- Subscription group display name (max 30): `Премиум` (7)

### Spanish (Mexico) - es-MX

- Display name (max 30): `Premium` (7)
- Description (max 45): `1000 mensajes de IA al mes` (26)
- Subscription group display name (max 30): `Premium` (7)

### Spanish (Spain) - es-ES

- Display name (max 30): `Premium` (7)
- Description (max 45): `1000 mensajes de IA al mes` (26)
- Subscription group display name (max 30): `Premium` (7)

### Bangla - bn-BD

- Display name (max 30): `Premium` (7)
- Description (max 45): `প্রতি মাসে 1000 AI বার্তা` (25)
- Subscription group display name (max 30): `Premium` (7)

### Catalan - ca

- Display name (max 30): `Premium` (7)
- Description (max 45): `1000 missatges d’IA al mes` (26)
- Subscription group display name (max 30): `Premium` (7)

### Czech - cs

- Display name (max 30): `Premium` (7)
- Description (max 45): `1000 zpráv s AI měsíčně` (23)
- Subscription group display name (max 30): `Premium` (7)

### Danish - da

- Display name (max 30): `Premium` (7)
- Description (max 45): `1000 AI-beskeder om måneden` (27)
- Subscription group display name (max 30): `Premium` (7)

### Greek - el

- Display name (max 30): `Premium` (7)
- Description (max 45): `1000 μηνύματα AI τον μήνα` (25)
- Subscription group display name (max 30): `Premium` (7)

### Finnish - fi

- Display name (max 30): `Premium` (7)
- Description (max 45): `1000 tekoälyviestiä kuukaudessa` (31)
- Subscription group display name (max 30): `Premium` (7)

### Gujarati - gu-IN

- Display name (max 30): `Premium` (7)
- Description (max 45): `દર મહિને 1000 AI સંદેશા` (23)
- Subscription group display name (max 30): `Premium` (7)

### Hebrew - he

- Display name (max 30): `Premium` (7)
- Description (max 45): `1000 הודעות AI בחודש` (20)
- Subscription group display name (max 30): `Premium` (7)

### Croatian - hr

- Display name (max 30): `Premium` (7)
- Description (max 45): `1000 AI poruka mjesečno` (23)
- Subscription group display name (max 30): `Premium` (7)

### Hungarian - hu

- Display name (max 30): `Premium` (7)
- Description (max 45): `Havi 1000 AI-üzenet` (19)
- Subscription group display name (max 30): `Premium` (7)

### Indonesian - id

- Display name (max 30): `Premium` (7)
- Description (max 45): `1000 pesan AI per bulan` (23)
- Subscription group display name (max 30): `Premium` (7)

### Italian - it

- Display name (max 30): `Premium` (7)
- Description (max 45): `1000 messaggi IA al mese` (24)
- Subscription group display name (max 30): `Premium` (7)

### Kannada - kn-IN

- Display name (max 30): `Premium` (7)
- Description (max 45): `ತಿಂಗಳಿಗೆ 1000 AI ಸಂದೇಶಗಳು` (25)
- Subscription group display name (max 30): `Premium` (7)

### Korean - ko

- Display name (max 30): `Premium` (7)
- Description (max 45): `매월 AI 메시지 1000개` (15)
- Subscription group display name (max 30): `Premium` (7)

### Malayalam - ml-IN

- Display name (max 30): `Premium` (7)
- Description (max 45): `മാസം 1000 AI സന്ദേശങ്ങൾ` (23)
- Subscription group display name (max 30): `Premium` (7)

### Marathi - mr-IN

- Display name (max 30): `Premium` (7)
- Description (max 45): `दर महिन्याला 1000 AI संदेश` (26)
- Subscription group display name (max 30): `Premium` (7)

### Norwegian - no

- Display name (max 30): `Premium` (7)
- Description (max 45): `1000 KI-meldinger i måneden` (27)
- Subscription group display name (max 30): `Premium` (7)

### Dutch - nl-NL

- Display name (max 30): `Premium` (7)
- Description (max 45): `1000 AI-berichten per maand` (27)
- Subscription group display name (max 30): `Premium` (7)

### Punjabi - pa-IN

- Display name (max 30): `Premium` (7)
- Description (max 45): `ਹਰ ਮਹੀਨੇ 1000 AI ਸੁਨੇਹੇ` (23)
- Subscription group display name (max 30): `Premium` (7)

### Polish - pl

- Display name (max 30): `Premium` (7)
- Description (max 45): `1000 wiadomości AI miesięcznie` (30)
- Subscription group display name (max 30): `Premium` (7)

### Romanian - ro

- Display name (max 30): `Premium` (7)
- Description (max 45): `1000 de mesaje AI pe lună` (25)
- Subscription group display name (max 30): `Premium` (7)

### Slovak - sk

- Display name (max 30): `Premium` (7)
- Description (max 45): `1000 správ s AI mesačne` (23)
- Subscription group display name (max 30): `Premium` (7)

### Slovenian - sl-SI

- Display name (max 30): `Premium` (7)
- Description (max 45): `1000 sporočil UI na mesec` (25)
- Subscription group display name (max 30): `Premium` (7)

### Swedish - sv

- Display name (max 30): `Premium` (7)
- Description (max 45): `1000 AI-meddelanden per månad` (29)
- Subscription group display name (max 30): `Premium` (7)

### Tamil - ta-IN

- Display name (max 30): `Premium` (7)
- Description (max 45): `மாதம் 1000 AI செய்திகள்` (23)
- Subscription group display name (max 30): `Premium` (7)

### Telugu - te-IN

- Display name (max 30): `Premium` (7)
- Description (max 45): `నెలకు 1000 AI సందేశాలు` (22)
- Subscription group display name (max 30): `Premium` (7)

### Thai - th

- Display name (max 30): `Premium` (7)
- Description (max 45): `ข้อความ AI 1000 ข้อความต่อเดือน` (31)
- Subscription group display name (max 30): `Premium` (7)

### Turkish - tr

- Display name (max 30): `Premium` (7)
- Description (max 45): `Ayda 1000 AI mesajı` (19)
- Subscription group display name (max 30): `Premium` (7)

### Ukrainian - uk

- Display name (max 30): `Преміум` (7)
- Description (max 45): `1000 повідомлень ШІ на місяць` (29)
- Subscription group display name (max 30): `Преміум` (7)

### Urdu - ur-PK

- Display name (max 30): `Premium` (7)
- Description (max 45): `ہر ماہ 1000 AI پیغامات` (22)
- Subscription group display name (max 30): `Premium` (7)

### Vietnamese - vi

- Display name (max 30): `Premium` (7)
- Description (max 45): `1000 tin nhắn AI mỗi tháng` (26)
- Subscription group display name (max 30): `Premium` (7)

## Google Play texts

Play shows up to four benefits. List only what the subscription adds: free
features such as sync are not subscription benefits.

### Default - English (United States) - en-US

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `1000 AI messages per month` (26)
- Description (max 80): `1000 AI messages per month.` (27)

### Arabic - ar

- Name (max 55): `بريميوم` (7)
- Benefit 1 (max 40): `1000 رسالة ذكاء اصطناعي شهريًا` (30)
- Description (max 80): `1000 رسالة ذكاء اصطناعي شهريًا.` (31)

### Chinese (Simplified) - zh-CN

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `每月1000条AI消息` (11)
- Description (max 80): `每月1000条AI消息。` (12)

### French - fr-FR

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `1000 messages IA par mois` (25)
- Description (max 80): `1000 messages IA par mois.` (26)

### German - de-DE

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `1000 KI-Nachrichten pro Monat` (29)
- Description (max 80): `1000 KI-Nachrichten pro Monat.` (30)

### Hindi - hi-IN

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `हर महीने 1000 AI संदेश` (22)
- Description (max 80): `हर महीने 1000 AI संदेश।` (23)

### Japanese - ja-JP

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `毎月1000件のAIメッセージ` (15)
- Description (max 80): `毎月1000件のAIメッセージ。` (16)

### Portuguese (Brazil) - pt-BR

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `1000 mensagens de IA por mês` (28)
- Description (max 80): `1000 mensagens de IA por mês.` (29)

### Russian - ru-RU

- Name (max 55): `Премиум` (7)
- Benefit 1 (max 40): `1000 сообщений ИИ в месяц` (25)
- Description (max 80): `1000 сообщений ИИ в месяц.` (26)

### Spanish (Latin America) - es-419

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `1000 mensajes de IA al mes` (26)
- Description (max 80): `1000 mensajes de IA al mes.` (27)

### Spanish (Spain) - es-ES

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `1000 mensajes de IA al mes` (26)
- Description (max 80): `1000 mensajes de IA al mes.` (27)

### Spanish (United States) - es-US

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `1000 mensajes de IA al mes` (26)
- Description (max 80): `1000 mensajes de IA al mes.` (27)

### Bulgarian - bg

- Name (max 55): `Премиум` (7)
- Benefit 1 (max 40): `1000 съобщения с ИИ на месец` (28)
- Description (max 80): `1000 съобщения с ИИ на месец.` (29)

### Bengali (Bangladesh) - bn-BD

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `প্রতি মাসে 1000 AI বার্তা` (25)
- Description (max 80): `প্রতি মাসে 1000 AI বার্তা।` (26)

### Catalan - ca

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `1000 missatges d’IA al mes` (26)
- Description (max 80): `1000 missatges d’IA al mes.` (27)

### Czech - cs-CZ

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `1000 zpráv s AI měsíčně` (23)
- Description (max 80): `1000 zpráv s AI měsíčně.` (24)

### Danish - da-DK

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `1000 AI-beskeder om måneden` (27)
- Description (max 80): `1000 AI-beskeder om måneden.` (28)

### Greek - el-GR

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `1000 μηνύματα AI τον μήνα` (25)
- Description (max 80): `1000 μηνύματα AI τον μήνα.` (26)

### Estonian - et

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `1000 AI-sõnumit kuus` (20)
- Description (max 80): `1000 AI-sõnumit kuus.` (21)

### Persian - fa

- Name (max 55): `پریمیوم` (7)
- Benefit 1 (max 40): `ماهانه 1000 پیام هوش مصنوعی` (27)
- Description (max 80): `ماهانه 1000 پیام هوش مصنوعی.` (28)

### Finnish - fi-FI

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `1000 tekoälyviestiä kuukaudessa` (31)
- Description (max 80): `1000 tekoälyviestiä kuukaudessa.` (32)

### Gujarati - gu

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `દર મહિને 1000 AI સંદેશા` (23)
- Description (max 80): `દર મહિને 1000 AI સંદેશા.` (24)

### Hebrew - iw-IL

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `1000 הודעות AI בחודש` (20)
- Description (max 80): `1000 הודעות AI בחודש.` (21)

### Croatian - hr

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `1000 AI poruka mjesečno` (23)
- Description (max 80): `1000 AI poruka mjesečno.` (24)

### Hungarian - hu-HU

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `Havi 1000 AI-üzenet` (19)
- Description (max 80): `Havi 1000 AI-üzenet.` (20)

### Indonesian - id

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `1000 pesan AI per bulan` (23)
- Description (max 80): `1000 pesan AI per bulan.` (24)

### Icelandic - is-IS

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `1000 skilaboð til gervigreindar á mánuði` (40)
- Description (max 80): `1000 skilaboð til gervigreindar á mánuði.` (41)

### Italian - it-IT

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `1000 messaggi IA al mese` (24)
- Description (max 80): `1000 messaggi IA al mese.` (25)

### Kannada (India) - kn-IN

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `ತಿಂಗಳಿಗೆ 1000 AI ಸಂದೇಶಗಳು` (25)
- Description (max 80): `ತಿಂಗಳಿಗೆ 1000 AI ಸಂದೇಶಗಳು.` (26)

### Korean - ko-KR

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `매월 AI 메시지 1000개` (15)
- Description (max 80): `매월 AI 메시지 1000개.` (16)

### Lithuanian - lt

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `1000 DI žinučių per mėnesį` (26)
- Description (max 80): `1000 DI žinučių per mėnesį.` (27)

### Latvian - lv

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `1000 MI ziņojumu mēnesī` (23)
- Description (max 80): `1000 MI ziņojumu mēnesī.` (24)

### Malayalam (India) - ml-IN

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `മാസം 1000 AI സന്ദേശങ്ങൾ` (23)
- Description (max 80): `മാസം 1000 AI സന്ദേശങ്ങൾ.` (24)

### Marathi (India) - mr-IN

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `दर महिन्याला 1000 AI संदेश` (26)
- Description (max 80): `दर महिन्याला 1000 AI संदेश.` (27)

### Dutch - nl-NL

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `1000 AI-berichten per maand` (27)
- Description (max 80): `1000 AI-berichten per maand.` (28)

### Norwegian - no-NO

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `1000 KI-meldinger i måneden` (27)
- Description (max 80): `1000 KI-meldinger i måneden.` (28)

### Punjabi - pa

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `ਹਰ ਮਹੀਨੇ 1000 AI ਸੁਨੇਹੇ` (23)
- Description (max 80): `ਹਰ ਮਹੀਨੇ 1000 AI ਸੁਨੇਹੇ।` (24)

### Polish - pl-PL

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `1000 wiadomości AI miesięcznie` (30)
- Description (max 80): `1000 wiadomości AI miesięcznie.` (31)

### Romanian - ro

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `1000 de mesaje AI pe lună` (25)
- Description (max 80): `1000 de mesaje AI pe lună.` (26)

### Slovak - sk

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `1000 správ s AI mesačne` (23)
- Description (max 80): `1000 správ s AI mesačne.` (24)

### Slovenian - sl

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `1000 sporočil AI na mesec` (25)
- Description (max 80): `1000 sporočil AI na mesec.` (26)

### Swedish - sv-SE

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `1000 AI-meddelanden per månad` (29)
- Description (max 80): `1000 AI-meddelanden per månad.` (30)

### Swahili - sw

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `Ujumbe 1000 wa AI kwa mwezi` (27)
- Description (max 80): `Ujumbe 1000 wa AI kwa mwezi.` (28)

### Tamil (India) - ta-IN

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `மாதம் 1000 AI செய்திகள்` (23)
- Description (max 80): `மாதம் 1000 AI செய்திகள்.` (24)

### Telugu (India) - te-IN

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `నెలకు 1000 AI సందేశాలు` (22)
- Description (max 80): `నెలకు 1000 AI సందేశాలు.` (23)

### Thai - th

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `ข้อความ AI 1000 ข้อความต่อเดือน` (31)
- Description (max 80): `ข้อความ AI 1000 ข้อความต่อเดือน` (31)

### Turkish - tr-TR

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `Ayda 1000 yapay zekâ mesajı` (27)
- Description (max 80): `Ayda 1000 yapay zekâ mesajı.` (28)

### Ukrainian - uk

- Name (max 55): `Преміум` (7)
- Benefit 1 (max 40): `1000 повідомлень ШІ на місяць` (29)
- Description (max 80): `1000 повідомлень ШІ на місяць.` (30)

### Urdu - ur

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `ہر ماہ 1000 AI پیغامات` (22)
- Description (max 80): `ہر ماہ 1000 AI پیغامات۔` (23)

### Vietnamese - vi

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `1000 tin nhắn AI mỗi tháng` (26)
- Description (max 80): `1000 tin nhắn AI mỗi tháng.` (27)

### Zulu - zu

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `Imiyalezo ye-AI engu-1000 ngenyanga` (35)
- Description (max 80): `Imiyalezo ye-AI engu-1000 ngenyanga.` (36)
