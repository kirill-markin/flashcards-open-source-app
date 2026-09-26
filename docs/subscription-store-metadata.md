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
| Apple subscription group ID | Pending post-merge creation and readback |
| Apple subscription ID | Pending post-merge creation and readback |
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
- Benefit 1 (max 40): `AI chat without the monthly limit` (33)
- Description (max 80): `Chat with the AI without hitting the free monthly limit.` (56)

### Arabic - ar

- Name (max 55): `بريميوم` (7)
- Benefit 1 (max 40): `دردشة الذكاء الاصطناعي دون الحد الشهري` (38)
- Description (max 80): `تحدّث مع الذكاء الاصطناعي دون الوصول إلى الحد الشهري المجاني.` (61)

### Chinese (Simplified) - zh-CN

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `AI 聊天，不受每月额度限制` (14)
- Description (max 80): `与 AI 聊天，不受每月免费额度限制。` (19)

### French - fr-FR

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `Chat IA sans la limite mensuelle` (32)
- Description (max 80): `Discutez avec l’IA sans atteindre la limite mensuelle gratuite.` (63)

### German - de-DE

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `KI-Chat ohne das Monatslimit` (28)
- Description (max 80): `Chatte mit der KI, ohne an das kostenlose Monatslimit zu stoßen.` (64)

### Hindi - hi-IN

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `मासिक सीमा के बिना AI चैट` (25)
- Description (max 80): `मुफ़्त मासिक सीमा तक पहुँचे बिना AI से चैट करें।` (48)

### Japanese - ja-JP

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `月間上限を気にせずAIチャット` (15)
- Description (max 80): `無料プランの月間上限を気にせず、AIとチャットできます。` (28)

### Portuguese (Brazil) - pt-BR

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `Chat com IA sem o limite mensal` (31)
- Description (max 80): `Converse com a IA sem esbarrar no limite mensal gratuito.` (57)

### Russian - ru-RU

- Name (max 55): `Премиум` (7)
- Benefit 1 (max 40): `ИИ-чат без месячного лимита` (27)
- Description (max 80): `Общайтесь с ИИ, не упираясь в бесплатный месячный лимит.` (56)

### Spanish (Latin America) - es-419

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `Chat con IA sin el límite mensual` (33)
- Description (max 80): `Chatea con la IA sin llegar al límite mensual gratuito.` (55)

### Spanish (Spain) - es-ES

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `Chat con IA sin el límite mensual` (33)
- Description (max 80): `Chatea con la IA sin llegar al límite mensual gratuito.` (55)

### Spanish (United States) - es-US

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `Chat con IA sin el límite mensual` (33)
- Description (max 80): `Chatea con la IA sin llegar al límite mensual gratuito.` (55)

### Bulgarian - bg

- Name (max 55): `Премиум` (7)
- Benefit 1 (max 40): `ИИ чат без месечния лимит` (25)
- Description (max 80): `Разговаряйте с ИИ, без да стигате безплатния месечен лимит.` (59)

### Bengali (Bangladesh) - bn-BD

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `মাসিক সীমা ছাড়াই AI চ্যাট` (26)
- Description (max 80): `বিনামূল্যের মাসিক সীমায় না আটকে AI-এর সঙ্গে চ্যাট করুন।` (56)

### Catalan - ca

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `Xat d’IA sense el límit mensual` (31)
- Description (max 80): `Xateja amb la IA sense arribar al límit mensual gratuït.` (56)

### Czech - cs-CZ

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `Chat s AI bez měsíčního limitu` (30)
- Description (max 80): `Chatujte s AI, aniž byste narazili na bezplatný měsíční limit.` (62)

### Danish - da-DK

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `AI-chat uden den månedlige grænse` (33)
- Description (max 80): `Chat med AI uden at ramme den gratis månedlige grænse.` (54)

### Greek - el-GR

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `Συνομιλία με AI χωρίς το μηνιαίο όριο` (37)
- Description (max 80): `Συνομιλήστε με το AI χωρίς να φτάνετε το δωρεάν μηνιαίο όριο.` (61)

### Estonian - et

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `AI-vestlus ilma kuulimiidita` (28)
- Description (max 80): `Vestle AI-ga, ilma et jõuaksid tasuta kuulimiidini.` (51)

### Persian - fa

- Name (max 55): `پریمیوم` (7)
- Benefit 1 (max 40): `گفت‌وگو با هوش مصنوعی بدون سقف ماهانه` (37)
- Description (max 80): `بدون رسیدن به سهمیه ماهانه رایگان با هوش مصنوعی گفت‌وگو کنید.` (61)

### Finnish - fi-FI

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `Tekoälykeskustelu ilman kuukausirajaa` (37)
- Description (max 80): `Keskustele tekoälyn kanssa ilman, että ilmainen kuukausiraja tulee vastaan.` (75)

### Gujarati - gu

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `માસિક મર્યાદા વિના AI ચૅટ` (25)
- Description (max 80): `મફત માસિક મર્યાદા સુધી પહોંચ્યા વિના AI સાથે ચૅટ કરો.` (53)

### Hebrew - iw-IL

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `צ'אט AI בלי המגבלה החודשית` (26)
- Description (max 80): `שוחחו עם ה-AI בלי להגיע למגבלה החודשית החינמית.` (47)

### Croatian - hr

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `AI razgovor bez mjesečnog ograničenja` (37)
- Description (max 80): `Razgovaraj s AI-jem bez dosezanja besplatnog mjesečnog ograničenja.` (67)

### Hungarian - hu-HU

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `AI-csevegés a havi korlát nélkül` (32)
- Description (max 80): `Csevegj az AI-jal anélkül, hogy elérnéd az ingyenes havi korlátot.` (66)

### Indonesian - id

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `Obrolan AI tanpa terbentur batas bulanan` (40)
- Description (max 80): `Ngobrol dengan AI tanpa terbentur batas bulanan gratis.` (55)

### Icelandic - is-IS

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `Spjall við gervigreind án mánaðarhámarks` (40)
- Description (max 80): `Spjallaðu við gervigreindina án þess að ná ókeypis mánaðarhámarkinu.` (68)

### Italian - it-IT

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `Chat con IA senza il limite mensile` (35)
- Description (max 80): `Chatta con l’IA senza raggiungere il limite mensile gratuito.` (61)

### Kannada (India) - kn-IN

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `ಮಾಸಿಕ ಮಿತಿ ಇಲ್ಲದೆ AI ಚಾಟ್` (25)
- Description (max 80): `ಉಚಿತ ಮಾಸಿಕ ಮಿತಿಯನ್ನು ತಲುಪದೆ AI ಜೊತೆ ಚಾಟ್ ಮಾಡಿ.` (46)

### Korean - ko-KR

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `월간 한도 걱정 없는 AI 채팅` (17)
- Description (max 80): `무료 월간 한도에 걸리지 않고 AI와 채팅하세요.` (27)

### Lithuanian - lt

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `DI pokalbiai be mėnesio limito` (30)
- Description (max 80): `Kalbėkitės su DI nepasiekdami nemokamo mėnesio limito.` (54)

### Latvian - lv

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `MI saruna bez mēneša ierobežojuma` (33)
- Description (max 80): `Sarunājies ar MI, nesasniedzot bezmaksas mēneša ierobežojumu.` (61)

### Malayalam (India) - ml-IN

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `പ്രതിമാസ പരിധി ഇല്ലാതെ AI ചാറ്റ്` (32)
- Description (max 80): `സൗജന്യ പ്രതിമാസ പരിധിയിൽ എത്താതെ AIയുമായി ചാറ്റ് ചെയ്യൂ.` (56)

### Marathi (India) - mr-IN

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `मासिक मर्यादेशिवाय AI चॅट` (25)
- Description (max 80): `मोफत मासिक मर्यादेपर्यंत न पोहोचता AIशी चॅट करा.` (48)

### Dutch - nl-NL

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `AI-chat zonder de maandlimiet` (29)
- Description (max 80): `Chat met AI zonder tegen de gratis maandlimiet aan te lopen.` (60)

### Norwegian - no-NO

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `KI-chat uten månedsgrensen` (26)
- Description (max 80): `Chat med KI uten å nå den gratis månedsgrensen.` (47)

### Punjabi - pa

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `ਮਹੀਨਾਵਾਰ ਸੀਮਾ ਤੋਂ ਬਿਨਾਂ AI ਚੈਟ` (30)
- Description (max 80): `ਮੁਫ਼ਤ ਮਹੀਨਾਵਾਰ ਸੀਮਾ ਤੱਕ ਪਹੁੰਚੇ ਬਿਨਾਂ AI ਨਾਲ ਚੈਟ ਕਰੋ।` (52)

### Polish - pl-PL

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `Czat z AI bez miesięcznego limitu` (33)
- Description (max 80): `Rozmawiaj z AI, nie trafiając na darmowy limit miesięczny.` (58)

### Romanian - ro

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `Chat AI fără limita lunară` (26)
- Description (max 80): `Discută cu AI-ul fără să atingi limita lunară gratuită.` (55)

### Slovak - sk

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `AI chat bez mesačného limitu` (28)
- Description (max 80): `Chatujte s AI bez toho, aby ste narazili na bezplatný mesačný limit.` (68)

### Slovenian - sl

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `Klepet z AI brez mesečne omejitve` (33)
- Description (max 80): `Klepetaj z AI brez doseganja brezplačne mesečne omejitve.` (57)

### Swedish - sv-SE

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `AI-chatt utan månadsgränsen` (27)
- Description (max 80): `Chatta med AI utan att nå den kostnadsfria månadsgränsen.` (57)

### Swahili - sw

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `Gumzo la AI bila kufika kikomo cha mwezi` (40)
- Description (max 80): `Piga gumzo na AI bila kufikia kikomo cha bure cha kila mwezi.` (61)

### Tamil (India) - ta-IN

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `மாதாந்திர வரம்பின்றி AI அரட்டை` (30)
- Description (max 80): `இலவச மாதாந்திர வரம்பை எட்டாமல் AI உடன் அரட்டையடியுங்கள்.` (56)

### Telugu (India) - te-IN

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `నెలవారీ పరిమితి లేకుండా AI చాట్` (31)
- Description (max 80): `ఉచిత నెలవారీ పరిమితిని చేరకుండా AIతో చాట్ చేయండి.` (49)

### Thai - th

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `แชท AI โดยไม่ติดขีดจำกัดรายเดือน` (32)
- Description (max 80): `แชทกับ AI ได้โดยไม่ติดขีดจำกัดรายเดือนของแพ็กเกจฟรี` (51)

### Turkish - tr-TR

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `Aylık limit olmadan yapay zekâ sohbeti` (38)
- Description (max 80): `Ücretsiz aylık limite takılmadan yapay zekâyla sohbet edin.` (59)

### Ukrainian - uk

- Name (max 55): `Преміум` (7)
- Benefit 1 (max 40): `Чат із ШІ без місячного ліміту` (30)
- Description (max 80): `Спілкуйтеся з ШІ, не впираючись у безкоштовний місячний ліміт.` (62)

### Urdu - ur

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `ماہانہ حد کے بغیر AI چیٹ` (24)
- Description (max 80): `مفت ماہانہ حد تک پہنچے بغیر AI سے چیٹ کریں۔` (43)

### Vietnamese - vi

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `Trò chuyện AI không lo hạn mức tháng` (36)
- Description (max 80): `Trò chuyện với AI mà không lo chạm hạn mức miễn phí hằng tháng.` (63)

### Zulu - zu

- Name (max 55): `Premium` (7)
- Benefit 1 (max 40): `Xoxa ne-AI ungafikeli umkhawulo wenyanga` (40)
- Description (max 80): `Xoxa ne-AI ngaphandle kokufinyelela umkhawulo wamahhala wenyanga.` (65)
