# App Store Connect Metadata

Custom Product Page copy and settings live in
[App Store Custom Product Pages](app-store-custom-product-pages/README.md).

Duo screenshot upload has a separate
[Asset Library procedure](app-store-connect-duo-screenshots.md).

Related competitor references: [iOS competitors](competitor-store-metadata.md#ios)

Premium subscription configuration and texts: [subscription store metadata](subscription-store-metadata.md)

This file owns the source text for 50 App Store locales and the iOS/iPadOS
upload procedure. Check App Store Connect for saved, submitted and published
states. In-app language coverage belongs to
[iOS localization](ios-localization.md#supported-app-locales).

**Locale mapping**

Use Apple's [locale shortcodes](https://developer.apple.com/documentation/appstoreconnectapi/managing-metadata-in-your-app-by-using-locale-shortcodes).
The [uploader input map](../scripts/ios/app-store-localization-inputs.mts) pairs
exact section headings, Store IDs and capture tags. Keep its capture tags
aligned with the wrappers and Swift catalogs in
[Apple marketing screenshots](../apps/ios/docs/marketing-screenshots.md#files-involved).

| Language | iOS locale | Store ID | Capture tag |
| --- | --- | --- | --- |
| English (U.S.) | `en` | `en-US` | `en-US` |
| Arabic | `ar` | `ar-SA` | `ar` |
| Bangla | `bn` | `bn-BD` | `bn` |
| Dutch | `nl` | `nl-NL` | `nl` |
| French | `fr` | `fr-FR` | `fr` |
| German | `de` | `de-DE` | `de` |
| Gujarati | `gu` | `gu-IN` | `gu` |
| Kannada | `kn` | `kn-IN` | `kn` |
| Malayalam | `ml` | `ml-IN` | `ml` |
| Marathi | `mr` | `mr-IN` | `mr` |
| Norwegian | `nb` | `no` | `nb` |
| Punjabi | `pa` | `pa-IN` | `pa` |
| Slovenian | `sl` | `sl-SI` | `sl` |
| Tamil | `ta` | `ta-IN` | `ta` |
| Telugu | `te` | `te-IN` | `te` |
| Urdu | `ur` | `ur-PK` | `ur` |
| English (Australia) | `en-AU` | `en-AU` | `en-US` |
| English (Canada) | `en-CA` | `en-CA` | `en-US` |
| English (U.K.) | `en-GB` | `en-GB` | `en-US` |
| Chinese (Traditional) | `zh-Hant` | `zh-Hant` | `zh-Hant` |
| French (Canada) | `fr-CA` | `fr-CA` | `fr` |
| Portuguese (Portugal) | `pt-PT` | `pt-PT` | `pt-PT` |
| Malay | `ms` | `ms` | `ms` |
| Odia | `or` | `or-IN` | `or` |

Other supported Store tags match their iOS and capture tags. Preserve `es-ES`
and `es-MX` separately. Apple has no listing locale for these app languages:
`bg`, `et`, `fa`, `is`, `lt`, `lv`, `sw`, `zu`; do not invent Store IDs for them.
Those eight still have captured iPhone screenshots, which stay website-only
assets that the uploader never reads.

The English regional listings and Canadian French reuse the respective
`en-US` and `fr` iPhone, iPad and Mac sets in the pinned
[media archive](media-assets.md). For `zh-Hant`, `pt-PT`, `ms` and `or`,
the table specifies the required capture tags. Verify those sets in the media
archive before uploading.

The parser reserves every level-two heading for exactly one locale and every
level-three heading inside it for a metadata field. Keep usage text before the
first locale and preserve the section/field names. Validate text independently
of the PNGs by calling `loadLocalizationTexts` from the input map. Keep names
and subtitles within 30 characters, descriptions and release notes within
4,000 characters, and new keyword lists within 100 UTF-8 bytes.
[App Information](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information/)
· [Platform Version Information](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information/)

**1.43.0 working notes**

The eight added locale sections include draft iOS/iPadOS What's New and separate
What's New (macOS) text for the language expansion. The working baselines are
iOS 1.42.0 and macOS 1.41.0. Refresh all locales against the shipped baseline
and final artifact for each platform before saving. Use the separate
[macOS release procedure](release/macos.md#macos) to verify and save Mac
version fields and native Mac screenshots.

**Upload an editable draft**

1. Gather and review the five raw PNGs for each mapped capture tag and device
   family using
   [the capture runbook](../apps/ios/docs/marketing-screenshots.md). Follow its
   opaque-PNG, dimension, display-slot, and filename requirements; composites
   are not upload inputs. Review all localized fields below. Refresh every What's
   New field for the actual target and released baseline using the canonical
   [release-note policy](release/release-notes.md#release-notes); the command
   uploads these checked-in fields, including any stale notes left there.
2. Use Node 24 and the main checkout's `.env` credentials described in
   [Xcode Cloud data access](xcode-cloud-data-access.md#required-local-secrets).
   The command resolves that checkout through Git even when run in a worktree.
   If Apple returns `FORBIDDEN.REQUIRED_AGREEMENTS_MISSING_OR_EXPIRED`, verify
   the selected account/team, key kind, key validity/access, and actual web
   agreement status before asking for legal acceptance. An agreement error
   alone does not prove an inactive agreement; replace invalid credentials
   through the user when needed.
3. Select an existing iOS version and the unique editable app-info resource
   shared across platforms.
   Each must be `PREPARE_FOR_SUBMISSION` or `DEVELOPER_REJECTED`; all other
   states are refused. Apple permits screenshot uploads in
   [Developer Rejected](https://developer.apple.com/help/app-store-connect/manage-app-information/upload-app-previews-and-screenshots).
   If the intended version is awaiting review, preserve it unless the user
   explicitly authorizes its withdrawal. After an authorized
   [withdrawal](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/remove-a-submission-from-review),
   inspect the actual version and app-info states before continuing; do not
   assume both changed. If replacing it with a newer build, rename the editable
   version to match that build only if Apple permits it, then verify the saved
   version string and use it below. Stop if the intended editable target cannot
   be established. Keep `en-US` localizations in both with valid
   privacy-policy and support URLs. New locales inherit only those technical
   URLs; existing locales retain their URLs. Align unrelated app-info and
   version locale sets if the command reports a mismatch.
4. Run from the repository root, replacing the explicit version placeholder:

   ```bash
   node scripts/ios/upload-app-store-localizations.mts \
     --version '<editable-version>' \
     --metadata docs/app-store-connect-metadata.md \
     --screenshots apps/ios/docs/media/app-store-screenshots
   ```

   This is a live write command, with no dry-run mode. It requires all locale
   text and PNGs before contacting Apple, then checks remote state and staging
   capacity before mutation. Keep the files and target draft unchanged during
   the run. It never creates, renames, withdraws, or submits a version and
   refuses submitted/published targets. Withdrawal and version changes are
   separate actions; the command does not perform them automatically.
5. Require the final `app_store_upload_verified` event and inspect the saved
   localizations and both screenshot families in App Store Connect. Continue
   through [the iOS release procedure](release/ios.md#ios) for
   the matching build and App Review. After release, verify the public binary's
   Languages list as described in [iOS localization](ios-localization.md#manual-runtime-validation).

**Recover a partial run**

Writes are incremental. Inspect the reported locale/resource before rerunning
with the same inputs. The command reuses matching `COMPLETE` images, waits for
matching `UPLOAD_COMPLETE` images, and resumes a single matching
`AWAITING_UPLOAD` reservation. Duplicate reservations or failed processing need
explicit inspection; an uncertain POST is not automatically retried.

Each targeted screenshot set needs room to stage missing replacements within
Apple's 10-image limit. The command stops if capacity is insufficient; inspect
and free slots explicitly rather than clearing a set blindly. Old owned
`<capture-tag>-[1-5]_*.png` files are removed only after that set's replacements
finish processing. Unknown filenames, other display slots, and locales remain.
The five managed images are ordered first and verified by filename, size,
checksum, and readback; metadata is read back too. A failed run can leave some locales saved
and others pending, so do not report completion from a per-locale event alone.

**Browser fallback**

If API access is blocked but the authorized App Store Connect UI is usable,
apply the same reviewed-input preflight, editable-target and version-authorization
rules above. Preserve existing localized URLs; new locales inherit the English
support and privacy-policy URLs.

- Edit both locale surfaces: the version owns Description, Keywords, and What's
  New; App Information owns Name and Subtitle.
- After each save, wait for the confirmed Saved/success state before changing
  locale. Reload and read back every field on both surfaces against this file.
- Batch screenshot uploads can finish out of order and overwrite premature
  reordering. Wait until every asset finishes processing, then arrange the five
  canonical images first in order 1–5 for each locale and both display families.
- Apply the partial-run preservation rules above to owned replacements, unknown
  filenames, other display families, and other locales. Reload or navigate away
  and back, then separately verify the actual persisted image order.
- Report UI readback and persisted-order verification as such; do not claim
  API checksum verification or an `app_store_upload_verified` event from UI work.

## English (U.S.)

### Name

Nibomo: Make AI Flashcards

### Subtitle

Spaced Repetition & Vocabulary

### Promotional Text

Turn your notes into cards, practice vocabulary, and review saved cards even when you're offline.

### Description

Turn notes and photos into flashcards, then review them with spaced repetition to remember what you study.

Make cards your way
Ask AI to draft questions and answers from your notes, a photo, or a topic. Edit the cards before studying, or write your own from scratch.

Review at the right time
Try to recall the answer, then flip the card and rate how well you remembered it. Difficult cards come back sooner. Review saved cards offline and sync your progress when you reconnect.

Build your vocabulary
Make cards for words you want to remember, or start with a deck from the Nibomo catalog. Practice English phrasal verbs in context or learn everyday Spanish words and phrases.

AI features require an internet connection.

Privacy Policy: https://nibomo.com/privacy/
Terms of Use (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

### Keywords

maker,generator,photo,offline,learn,English,Spanish,notes,active recall,custom,study,SRS,words,exams

### What's New

- Subscribe to Premium, with a seven-day free trial if eligible through Apple.
- Choose your app's accent color with Premium or lifetime access.
- Use your own OpenAI key and see your monthly AI usage.
- Improvements to deck organization and card reviews.

## Arabic

### Name

Nibomo: فلاش كارد

### Subtitle

بطاقات من ملاحظاتك وصورك

### Description

حوّل ملاحظات المحاضرات وصور صفحات الدفتر إلى بطاقات مراجعة، واستخدم التكرار المتباعد لتثبيت ما تتعلّمه.

أنشئ بطاقاتك
أضف ملاحظاتك أو صورة من درسك، أو اذكر الموضوع الذي تريد تعلّمه. يقترح الذكاء الاصطناعي أسئلة وأجوبة يمكنك تعديلها قبل المذاكرة. يمكنك أيضًا كتابة البطاقات بنفسك.

راجع في الوقت المناسب
حاول تذكّر الإجابة قبل قلب البطاقة، ثم قيّم مدى تذكّرك. تعود البطاقات الصعبة في وقت أقرب. راجع البطاقات المحفوظة دون إنترنت، وزامن تقدّمك عند عودة الاتصال.

تدرّب على المفردات
أنشئ بطاقات للكلمات التي تصادفها، أو ابدأ بمجموعة جاهزة من مكتبة Nibomo لتعلّم الأفعال المركّبة بالإنجليزية أو المفردات الإسبانية للمبتدئين.

تتطلّب ميزات الذكاء الاصطناعي اتصالًا بالإنترنت.

سياسة الخصوصية: https://nibomo.com/privacy/
شروط الخدمة (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

### Keywords

التكرار المتباعد,صانع,حفظ المفردات,دون إنترنت,إنجليزي

### What's New

- اشترك في Premium مع تجربة مجانية لمدة سبعة أيام إذا كنت مؤهلاً لدى Apple.
- اختر لون التمييز في التطبيق مع Premium أو الوصول مدى الحياة.
- استخدم مفتاح OpenAI الخاص بك واطّلع على استخدامك الشهري للذكاء الاصطناعي.
- تحسينات على تنظيم مجموعات البطاقات ومراجعتها.

## Chinese (Simplified)

### Name

Nibomo：AI 抽认卡

### Subtitle

间隔重复，背单词更有条理

### Description

把课堂笔记、照片和想学的主题做成抽认卡。用间隔重复安排复习，把更多时间留给还没记牢的内容。

从学习资料制作卡片
贴上笔记、上传一张笔记照片，或告诉 AI 你想学什么。AI 会起草问题和答案，你可以修改后再开始复习，也可以自己逐张写卡。

按记忆情况复习
先想答案，再翻卡并给自己的记忆情况打分。难记的内容会更早出现，熟悉的内容会晚一点再复习。已保存的卡片可以离线复习，重新联网后可同步进度。

整理自己的英语单词本
把阅读或课堂上遇到的生词做成单词卡，写下例句来记住用法。也可以从 Nibomo 的卡组目录开始，练习英语短语动词或西班牙语入门词汇。

AI 功能需要联网。

隐私政策: https://nibomo.com/privacy/
服务条款 (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

### Keywords

闪卡制作,英语单词本,离线复习,拍照生成,西班牙语单词卡,笔记转闪卡

### What's New

- 订阅 Premium，符合 Apple 资格要求的用户可免费试用七天。
- Premium 或终身访问用户可自定义应用强调色。
- 使用自己的 OpenAI 密钥，查看每月 AI 使用量。
- 改进卡组整理和卡片复习体验。

## French

### Name

Nibomo : Flashcards IA

### Subtitle

Répétition espacée

### Description

Transformez vos notes et vos photos en flashcards, puis révisez au bon moment avec la répétition espacée.

Créez vos cartes de révision
Collez vos notes, joignez une photo ou indiquez un sujet. Demandez à l’IA de préparer des questions et des réponses, puis adaptez-les à vos besoins. Vous pouvez aussi créer vos cartes à la main.

Retenez ce que vous étudiez
Essayez de répondre de mémoire avant de retourner la carte, puis indiquez si la réponse vous est venue facilement. Les cartes difficiles reviennent plus tôt. Même hors ligne, vous pouvez réviser les cartes déjà enregistrées. Vous retrouvez votre progression sur vos autres appareils une fois en ligne.

Travaillez votre vocabulaire
Créez des cartes pour les mots que vous voulez retenir ou choisissez un paquet dans le catalogue Nibomo. Vous y trouverez des verbes à particule en anglais et du vocabulaire espagnol pour débuter.

Les fonctions d’IA nécessitent une connexion Internet.

Politique de confidentialité: https://nibomo.com/privacy/
Conditions d’utilisation (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

### Keywords

créer,générateur,notes,photos,révision,hors ligne,cartes,vocabulaire,anglais,espagnol,mémoriser

### What's New

- Abonnez-vous à Premium avec sept jours d’essai gratuit si vous êtes éligible auprès d’Apple.
- Choisissez la couleur d’accentuation de l’app avec Premium ou un accès à vie.
- Utilisez votre propre clé OpenAI et consultez votre utilisation mensuelle de l’IA.
- Améliorations de l’organisation des paquets et de la révision des cartes.

## German

### Name

Nibomo: Karteikarten mit KI

### Subtitle

Vokabeln lernen und üben

### Description

Mach aus deinen Notizen und Fotos eigene Karteikarten. Mit verteiltem Wiederholen behältst du Lernstoff und Vokabeln länger im Kopf.

Karteikarten aus deinen Notizen
Füge eine Mitschrift oder ein Foto von einer Heftseite hinzu und lass dir von der KI Fragen und Antworten vorschlagen. Du kannst die Vorschläge überarbeiten oder deine Lernkarten selbst erstellen.

In passenden Abständen wiederholen
Versuche, dich an die Antwort zu erinnern, bevor du die Karte umdrehst. Bewerte anschließend, wie gut du sie wusstest. Beim verteilten Wiederholen (Spaced Repetition) kommen schwierige Karten früher wieder und vertraute später.

Englische und spanische Vokabeln üben
Erstelle einen Stapel mit Wörtern aus deinem Unterricht oder ergänze eigene Beispielsätze. Im Nibomo-Katalog findest du fertige Stapel, etwa zu englischen Phrasal Verbs oder Spanisch für den Einstieg.

Gespeicherte Karten kannst du offline wiederholen. Dein Fortschritt wird synchronisiert, sobald du wieder online bist. Für KI-Funktionen brauchst du Internet.

Datenschutzrichtlinie: https://nibomo.com/privacy/
Nutzungsbedingungen (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

### Keywords

Spaced Repetition,Lernkartei,Vokabeltrainer,offline,Notizen,Fotos,erstellen,Englisch,Spanisch

### What's New

- Abonniere Premium mit sieben Tagen kostenloser Probezeit, sofern du laut Apple berechtigt bist.
- Wähle mit Premium oder lebenslangem Zugang die Akzentfarbe der App.
- Nutze deinen eigenen OpenAI-Schlüssel und sieh deine monatliche KI-Nutzung ein.
- Verbesserungen bei der Stapelverwaltung und Kartenwiederholung.

## Hindi

### Name

Nibomo: AI फ्लैशकार्ड

### Subtitle

अंतराल पर दोहराएँ, शब्द सीखें

### Description

अपनी पढ़ाई के नोट्स और फ़ोटो से फ्लैशकार्ड बनाएँ। उन्हें सही अंतराल पर दोहराएँ, ताकि पढ़ा हुआ लंबे समय तक याद रहे।

अपने हिसाब से कार्ड बनाएँ
नोट्स पेस्ट करें, कॉपी के पन्ने की फ़ोटो जोड़ें या कोई विषय लिखें। AI से सवाल और जवाब का मसौदा बनवाएँ। पढ़ने से पहले मसौदे को बदलें या शुरू से अपने कार्ड खुद लिखें।

याद करके जवाब दें
कार्ड पलटने से पहले जवाब याद करने की कोशिश करें। फिर बताएँ कि वह कितनी अच्छी तरह याद था। Nibomo मुश्किल कार्ड जल्दी दोबारा दिखाता है। सहेजे हुए कार्ड ऑफ़लाइन भी दोहरा सकते हैं। फिर से इंटरनेट मिलने पर आपकी प्रगति सिंक हो जाएगी।

अंग्रेज़ी शब्दावली बढ़ाएँ
पढ़ते या बात करते समय मिले नए शब्दों और उनके उदाहरणों से कार्ड बनाएँ। शुरुआत के लिए Nibomo के कैटलॉग से अंग्रेज़ी के फ़्रेज़ल वर्ब या शुरुआती स्पैनिश शब्दावली का डेक चुनें।

AI सुविधाओं के लिए इंटरनेट ज़रूरी है।

गोपनीयता नीति: https://nibomo.com/privacy/
सेवा की शर्तें (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

### Keywords

flashcards,maker,spaced repetition,अंग्रेजी शब्दावली,notes,offline

### What's New

- Premium की सदस्यता लें। Apple के नियमों के अनुसार पात्र होने पर सात दिन का मुफ़्त ट्रायल पाएँ।
- Premium या आजीवन एक्सेस के साथ ऐप का एक्सेंट रंग चुनें।
- अपनी OpenAI कुंजी इस्तेमाल करें और हर महीने AI का उपयोग देखें।
- कार्ड समूहों को व्यवस्थित करने और कार्ड दोहराने में सुधार।

## Japanese

### Name

Nibomo: AI暗記カード

### Subtitle

ノートや写真から作成、間隔反復で復習

### Description

授業のノートや写真を暗記カードに。間隔反復で、覚えにくい内容を早めに復習できます。

自分に合った暗記カードを作る
ノートを貼り付けたり、ノートの写真を添付したり、学びたいテーマを伝えたりすると、AIが問題と答えの下書きを作ります。下書きを編集してから学習を始めることも、一枚ずつ手入力して自分だけの単語帳を作ることもできます。

覚え具合に合わせて復習
カードをめくる前に答えを思い出し、めくったらどのくらい覚えていたかを評価します。その評価に応じて次の復習日が決まり、難しいカードほど早く出てきます。保存したカードはオフラインでも復習でき、再接続すると進捗を同期できます。

英単語やスペイン語の語彙を増やす
授業や読書で出会った言葉を単語帳にまとめ、例文と一緒に覚えましょう。Nibomoのカタログから英語の句動詞や初級スペイン語のカードセットを選んで始めることもできます。

AI機能にはインターネット接続が必要です。

プライバシー ポリシー: https://nibomo.com/privacy/
利用規約 (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

### Keywords

フラッシュカード,単語帳,オフライン,英単語,スペイン語,自分で作る

### What's New

- Premiumのサブスクリプションが登場。Appleの利用条件を満たす方は7日間無料でお試しいただけます。
- Premiumまたは無期限アクセスで、アプリのアクセントカラーを選べます。
- 自分のOpenAIキーを使い、毎月のAI使用量を確認できます。
- デッキの整理とカードの復習を改善しました。

## Portuguese (Brazil)

### Name

Nibomo: Flashcards com IA

### Subtitle

Repetição espaçada

### Description

Transforme anotações e fotos em flashcards e revise com repetição espaçada. Com o Nibomo, você pode preparar cartões de estudo com IA ou escrever os seus.

Monte seus flashcards
Cole suas anotações, anexe uma foto ou indique o assunto que quer estudar. Peça à IA para rascunhar perguntas e respostas e edite os cartões antes de revisar.

Revise no momento certo
Tente lembrar a resposta antes de virar o cartão. Depois, indique se foi fácil ou difícil lembrar. Os cartões mais difíceis aparecem mais cedo. Mesmo offline, revise os cartões que você já salvou. Sincronize seu progresso quando voltar à internet.

Pratique vocabulário
Crie cartões com as palavras que quer lembrar ou escolha um baralho no catálogo do Nibomo. Há opções com verbos frasais em inglês e vocabulário básico de espanhol.

Os recursos de IA precisam de conexão com a internet.

Política de Privacidade: https://nibomo.com/privacy/
Termos de Serviço (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

### Keywords

criar,gerador,anotações,fotos,revisão,offline,cartões,vocabulário,inglês,espanhol,memorizar

### What's New

- Assine o Premium com sete dias de teste grátis, se você for elegível pela Apple.
- Escolha a cor de destaque do app com Premium ou acesso vitalício.
- Use sua própria chave OpenAI e veja seu uso mensal de IA.
- Melhorias na organização de baralhos e na revisão de cartões.

## Russian

### Name

Nibomo: Карточки с ИИ

### Subtitle

Интервальное повторение

### Description

Создавайте карточки для запоминания из конспектов и фотографий. Вставьте заметки, добавьте фото страницы или назовите тему. ИИ предложит вопросы и ответы. Их можно отредактировать, а карточки можно написать и с нуля.

Вспоминайте, прежде чем перевернуть карточку
Попробуйте ответить по памяти, затем проверьте себя и оцените, насколько хорошо вспомнили ответ. Nibomo подберёт интервал до следующего повторения. Сложные карточки вернутся раньше, знакомые — позже. Повторяйте сохранённые карточки офлайн. Прогресс синхронизируется, когда появится интернет.

Учите слова в контексте
Соберите карточки для изучения слов из книг, занятий или разговоров и добавьте свои примеры. В каталоге Nibomo есть и готовые колоды, например английские фразовые глаголы и испанские слова для начинающих.

Для функций ИИ нужно подключение к интернету.

Политика конфиденциальности: https://nibomo.com/privacy/
Условия использования (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

### Keywords

флешкарты,запоминания,конспект,фото,офлайн,слов

### What's New

- Подпишитесь на Premium с бесплатным пробным периодом на семь дней, если он доступен вам по условиям Apple.
- Выбирайте акцентный цвет приложения с Premium или пожизненным доступом.
- Используйте свой ключ OpenAI и просматривайте месячную статистику использования ИИ.
- Улучшены организация колод и повторение карточек.

## Spanish (Mexico)

### Name

Nibomo: Flashcards con IA

### Subtitle

Repetición espaciada

### Description

Usa tus apuntes y fotos para crear flashcards. Con Nibomo puedes preparar tarjetas de estudio con IA y repasar lo que vas aprendiendo.

Arma tus tarjetas
Pega tus apuntes, adjunta una foto de tu cuaderno o escribe el tema que quieras practicar. Pídele a la IA que prepare preguntas y respuestas y edítalas a tu gusto. También puedes crear tus tarjetas a mano.

Haz repasos espaciados
Trata de recordar la respuesta antes de voltear la tarjeta. Indica qué tan bien la recordaste y Nibomo te mostrará antes las tarjetas más difíciles. Repasa sin internet las tarjetas que tengas guardadas y sincroniza tu progreso al volver a conectarte.

Practica vocabulario
Haz tarjetas con las palabras que quieras recordar. También puedes empezar con un mazo del catálogo de Nibomo, como el de verbos frasales en inglés o el de vocabulario básico en español.

Las funciones de IA necesitan conexión a internet.

Política de privacidad: https://nibomo.com/privacy/
Términos del servicio (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

### Keywords

creador,generador,apuntes,fotos,repaso,sin internet,tarjetas,estudio,vocabulario,inglés,memorizar

### What's New

- Suscríbete a Premium con siete días de prueba gratis si cumples los requisitos de Apple.
- Elige el color de acento de la app con Premium o acceso de por vida.
- Usa tu propia clave de OpenAI y consulta tu uso mensual de IA.
- Mejoras en la organización de mazos y el repaso de tarjetas.

## Spanish (Spain)

### Name

Nibomo: Flashcards con IA

### Subtitle

Repetición espaciada

### Description

Convierte apuntes y fotos en flashcards. Crea tus propias fichas de estudio y repásalas con repetición espaciada.

Prepara tus fichas
Pega tus apuntes, adjunta una foto o indica el tema que quieres estudiar. La IA te ayuda a preparar preguntas y respuestas. Puedes editarlas antes de repasar o crear las fichas a mano.

Repasa lo que más te cuesta
Intenta recordar la respuesta antes de darle la vuelta a la ficha. Indica cómo te ha ido y Nibomo te mostrará antes las fichas más difíciles. Repasa sin conexión las fichas que ya hayas guardado y sincroniza tu progreso cuando vuelvas a conectarte.

Aprende vocabulario en inglés
Anota las palabras que encuentres y añade un ejemplo para recordar cómo se usan. En el catálogo de Nibomo puedes empezar con un mazo de verbos con partícula en inglés o de vocabulario básico en español.

Las funciones de IA necesitan conexión a internet.

Política de privacidad: https://nibomo.com/privacy/
Términos del servicio (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

### Keywords

crear,generador,apuntes,fotos,repaso,sin conexión,fichas,tarjetas,vocabulario,inglés,memorizar

### What's New

- Suscríbete a Premium con siete días de prueba gratuita si cumples los requisitos de Apple.
- Elige el color de acento de la app con Premium o acceso de por vida.
- Utiliza tu propia clave de OpenAI y consulta tu uso mensual de IA.
- Mejoras en la organización de mazos y el repaso de tarjetas.

## Bangla

App Store locale: `bn-BD`

### Name

Nibomo: AI ফ্ল্যাশকার্ড

### Subtitle

মনে রাখুন, শব্দ শিখুন

### Description

ক্লাসের নোট আর খাতার ছবি থেকে ফ্ল্যাশকার্ড বানান। নিয়মিত ঝালিয়ে নিলে যা পড়েছেন, তা মনে রাখা সহজ হয়।

নিজের মতো করে কার্ড বানান
একটি ছবি যোগ করুন, নোট পেস্ট করুন বা যে বিষয়টি শিখতে চান তার নাম লিখুন। AI প্রশ্ন ও উত্তরের খসড়া তৈরি করবে। পড়ার আগে খসড়া বদলে নিতে পারেন, কিংবা নিজেই কার্ড লিখতে পারেন।

বিরতি দিয়ে ঝালিয়ে নিন
কার্ড ওল্টানোর আগে উত্তরটা মনে করার চেষ্টা করুন। উত্তর দেখে কতটা মনে ছিল তা জানান। যে কার্ডগুলো কঠিন লাগে, Nibomo সেগুলো আগে দেখায়। সেভ করা কার্ড অফলাইনে পড়তে পারবেন। আবার ইন্টারনেটে যুক্ত হলে আপনার অগ্রগতি সিঙ্ক হবে।

ইংরেজি শব্দভাণ্ডার বাড়ান
বইয়ে বা কথাবার্তায় পাওয়া নতুন শব্দ দিয়ে কার্ড বানান। চাইলে Nibomo-র ক্যাটালগ থেকে ইংরেজি ফ্রেজাল ভার্ব বা প্রাথমিক স্প্যানিশ শব্দের ডেক দিয়ে শুরু করুন।

AI ব্যবহারের জন্য ইন্টারনেট সংযোগ প্রয়োজন।

গোপনীয়তা নীতি: https://nibomo.com/privacy/
পরিষেবার শর্তাবলী (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

### Keywords

spaced repetition,flashcard maker,ইংরেজি শব্দভাণ্ডার,offline,photo

### What's New

- Premium সাবস্ক্রাইব করুন। Apple-এর শর্ত অনুযায়ী যোগ্য হলে সাত দিনের ফ্রি ট্রায়াল পান।
- Premium বা আজীবন অ্যাক্সেসের সঙ্গে অ্যাপের অ্যাকসেন্ট রং বেছে নিন।
- নিজের OpenAI কী ব্যবহার করুন এবং মাসিক AI ব্যবহারের হিসাব দেখুন।
- কার্ডের ডেক সাজানো ও কার্ড রিভিউ করার অভিজ্ঞতা উন্নত হয়েছে।

## Catalan

App Store locale: `ca`

### Name

Nibomo: Flashcards amb IA

### Subtitle

Repetició espaiada

### Description

Converteix els apunts i les fotos en flashcards i repassa-les quan et toqui. Amb Nibomo pots crear targetes d’estudi amb IA o escriure-les tu.

Crea targetes a partir dels teus apunts
Enganxa uns apunts, adjunta una foto o indica el tema que vols treballar. Revisa i edita les preguntes i respostes abans d’estudiar.

Fes repàs espaiat, també sense connexió
Intenta respondre de memòria, gira la targeta i indica fins a quin punt ho recordaves. Les targetes difícils tornen a sortir abans. Pots repassar les targetes desades sense connexió i sincronitzar el progrés quan et tornis a connectar.

Practica vocabulari
Fes targetes amb paraules que vulguis recordar o comença amb un conjunt del catàleg de Nibomo. Hi trobaràs verbs amb partícula en anglès i vocabulari bàsic en castellà.

Les funcions d’IA necessiten connexió a internet.

Política de privadesa: https://nibomo.com/privacy/
Condicions del servei (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

### Keywords

crear,generador,apunts,fotos,repàs,sense connexió,targetes,estudi,vocabulari,anglès,memoritzar

### What's New

- Subscriu-te a Premium amb set dies de prova gratuïta si compleixes els requisits d’Apple.
- Tria el color d’accent de l’app amb Premium o accés de per vida.
- Fes servir la teva pròpia clau d’OpenAI i consulta el teu ús mensual de la IA.
- Millores en l’organització dels jocs de targetes i en els repassos.

## Czech

App Store locale: `cs`

### Name

Nibomo: Kartičky na učení

### Subtitle

Opakování a anglická slovíčka

### Description

Proměňte poznámky nebo fotku sešitu v kartičky na učení. Kartičky si můžete napsat sami nebo si nechat od AI navrhnout otázky a odpovědi a pak je upravit podle sebe.

Opakujte, když to potřebujete
Než kartičku otočíte, zkuste si odpověď vybavit. Podle toho, jak dobře jste si vzpomněli, Nibomo naplánuje další opakování. Na obtížnější kartičky se dostane dřív. Uložené kartičky si zopakujete i offline. Po připojení se pokrok synchronizuje.

Procvičujte slovíčka
Přidejte nová slova a vlastní příkladové věty nebo začněte s hotovým balíčkem z katalogu Nibomo. Vyzkoušejte třeba anglická frázová slovesa nebo španělská slovíčka pro začátečníky.

Funkce AI vyžadují připojení k internetu.

Zásady ochrany soukromí: https://nibomo.com/privacy/
Podmínky služby (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

### Keywords

intervalové,rozložené,offline,poznámky,fotky,tvorba,generátor,španělská,zkoušky,flashcards

### What's New

- Předplaťte si Premium se sedmidenním bezplatným vyzkoušením, pokud splňujete podmínky společnosti Apple.
- S Premium nebo doživotním přístupem si vyberte barvu zvýraznění aplikace.
- Používejte vlastní klíč OpenAI a sledujte své měsíční využití AI.
- Vylepšení uspořádání balíčků a opakování kartiček.

## Danish

App Store locale: `da`

### Name

Nibomo: AI-flashcards

### Subtitle

Øv gloser, repetér offline

### Description

Lav dine egne flashcards fra noter og fotos, og repetér med mellemrum, så du husker det, du har lært.

Lav kort af dit eget materiale
Indsæt dine noter, vedhæft et foto af en side, eller giv AI et emne. Du får forslag til spørgsmål og svar, som du kan tilpasse. Du kan også skrive hvert kort selv.

Repetér med passende mellemrum
Prøv at huske svaret, før du vender kortet. Vurdér bagefter, hvor godt du huskede det. Nibomo bruger intervalgentagelse (spaced repetition), så du ser svære kort igen før dem, du allerede kan.

Lær gloser
Lav flashkort med nye ord fra undervisningen eller en bog, og tilføj gerne eksempler. Du kan også vælge et færdigt sæt i Nibomos katalog, f.eks. engelske udsagnsord med partikler eller spanske gloser for begyndere.

Repetér gemte kort offline. Dine fremskridt bliver synkroniseret, når du er på nettet igen. AI-funktionerne kræver internetforbindelse.

Privatlivspolitik: https://nibomo.com/privacy/
Servicevilkår (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

### Keywords

spaced repetition,intervalgentagelse,flashkort,lav,noter,fotos,engelske,spanske,ordforråd

### What's New

- Abonner på Premium med syv dages gratis prøveperiode, hvis du opfylder Apples betingelser.
- Vælg appens accentfarve med Premium eller livstidsadgang.
- Brug din egen OpenAI-nøgle, og se dit månedlige AI-forbrug.
- Forbedringer af organisering af kortsæt og repetition af kort.

## Greek

App Store locale: `el`

### Name

Nibomo: AI Flashcards

### Subtitle

Από σημειώσεις και φωτογραφίες

### Description

Μετατρέψτε σημειώσεις και φωτογραφίες σε κάρτες μελέτης και θυμηθείτε για περισσότερο καιρό όσα μαθαίνετε.

Δημιουργήστε τις δικές σας κάρτες
Προσθέστε τις σημειώσεις σας, μια φωτογραφία από το τετράδιο ή ένα θέμα που θέλετε να μάθετε. Η τεχνητή νοημοσύνη προτείνει ερωτήσεις και απαντήσεις που μπορείτε να επεξεργαστείτε. Μπορείτε επίσης να γράψετε τις κάρτες σας από την αρχή.

Κάντε επανάληψη σε διαστήματα
Προσπαθήστε να θυμηθείτε την απάντηση πριν γυρίσετε την κάρτα. Δηλώστε πόσο εύκολα τη θυμηθήκατε και οι δύσκολες κάρτες θα εμφανιστούν ξανά νωρίτερα. Μελετήστε με τις αποθηκευμένες κάρτες εκτός σύνδεσης και συγχρονίστε την πρόοδό σας όταν συνδεθείτε ξανά.

Εξασκηθείτε στο λεξιλόγιο
Φτιάξτε κάρτες για τις λέξεις που θέλετε να θυμάστε ή ξεκινήστε με μια έτοιμη συλλογή από τον κατάλογο του Nibomo, όπως φραστικά ρήματα στα αγγλικά ή ισπανικό λεξιλόγιο για αρχάριους.

Οι λειτουργίες AI απαιτούν σύνδεση στο διαδίκτυο.

Πολιτική απορρήτου: https://nibomo.com/privacy/
Όροι χρήσης (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

### Keywords

κατανεμημένη επανάληψη,offline,κάρτες λεξιλογίου,αγγλικά

### What's New

- Αποκτήστε συνδρομή Premium με δωρεάν δοκιμή επτά ημερών, εφόσον πληροίτε τις προϋποθέσεις της Apple.
- Επιλέξτε το χρώμα έμφασης της εφαρμογής με Premium ή πρόσβαση εφ’ όρου ζωής.
- Χρησιμοποιήστε το δικό σας κλειδί OpenAI και δείτε τη μηνιαία χρήση AI.
- Βελτιώσεις στην οργάνωση των σετ και στην επανάληψη καρτών.

## Finnish

App Store locale: `fi`

### Name

Nibomo: Muistikortit

### Subtitle

Tee kortteja ja kertaa sanoja

### Description

Tee muistiinpanoista tai kuvista muistikortteja tekoälyn avulla. Harjoittele sanastoa ja kertaa oppimaasi sopivin väliajoin.

Tee omat muistikorttisi
Liitä luentomuistiinpanot tai kuva vihkon sivusta. Voit myös kertoa, mitä aihetta haluat harjoitella. Tekoäly ehdottaa kysymyksiä ja vastauksia, joita voit muokata. Halutessasi voit kirjoittaa kortit itse.

Kertaa sopivin välein
Yritä palauttaa vastaus mieleen, käännä sitten kortti ja arvioi, kuinka hyvin muistit. Nibomon jaksotettu kertaus tuo vaikeat kortit takaisin nopeammin ja antaa tutuille korteille pidemmän kertausvälin.

Harjoittele sanastoa
Tee sanastokortteja vastaan tulevista sanoista ja lisää omia esimerkkilauseita. Nibomon luettelosta voit valita valmiin pakan, esimerkiksi englannin fraasiverbejä tai espanjan alkeissanastoa.

Voit kerrata tallennettuja kortteja ilman verkkoyhteyttä. Edistymisesi synkronoituu, kun olet taas verkossa. Tekoälytoiminnot vaativat internetyhteyden.

Tietosuojakäytäntö: https://nibomo.com/privacy/
Käyttöehdot (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

### Keywords

jaksotettu kertaus,aikavälikertaus,sanastokortit,tekoäly,muistiinpanoista,offline,englanti,espanja

### What's New

- Tilaa Premium ja kokeile sitä maksutta seitsemän päivän ajan, jos täytät Applen kelpoisuusehdot.
- Valitse sovelluksen korostusväri Premiumilla tai elinikäisellä käyttöoikeudella.
- Käytä omaa OpenAI-avaintasi ja seuraa kuukausittaista tekoälyn käyttöäsi.
- Parannuksia korttipakkojen järjestämiseen ja korttien kertaukseen.

## Gujarati

App Store locale: `gu-IN`

### Name

Nibomo: AI ફ્લેશકાર્ડ્સ

### Subtitle

અભ્યાસ અને શબ્દભંડોળ

### Description

વર્ગની નોંધો અને ફોટામાંથી ફ્લેશકાર્ડ બનાવો. કાર્ડને સમયાંતરે ફરી જોઈને ભણેલું યાદ રાખો.

તમારી રીતે કાર્ડ બનાવો
નોંધ પેસ્ટ કરો, નોટબુકના પાનાનો ફોટો ઉમેરો કે કોઈ વિષય લખો. AI પ્રશ્નો અને જવાબોનો ડ્રાફ્ટ તૈયાર કરશે. અભ્યાસ કરતાં પહેલાં તેને સુધારો અથવા પોતાના પ્રશ્નો અને જવાબો જાતે લખો.

સમયાંતરે પુનરાવર્તન કરો
કાર્ડ પલટાવતા પહેલાં જવાબ યાદ કરવાનો પ્રયત્ન કરો. જવાબ કેટલો સારી રીતે યાદ આવ્યો તે જણાવો. અઘરા કાર્ડ વહેલા ફરી દેખાશે. સાચવેલા કાર્ડનો ઑફલાઇન અભ્યાસ કરો. ફરી ઇન્ટરનેટ સાથે જોડાશો ત્યારે તમારી પ્રગતિ સિંક થશે.

અંગ્રેજી શબ્દો શીખો
વાંચતી વખતે મળેલા નવા શબ્દો અને ઉદાહરણ વાક્યોમાંથી કાર્ડ બનાવો. શરૂઆત કરવા માટે Nibomoના કૅટલૉગમાંથી અંગ્રેજી ફ્રેઝલ વર્બ્સ કે શરૂઆતના સ્તરના સ્પેનિશ શબ્દોનો ડેક પસંદ કરો.

AI સુવિધાઓ માટે ઇન્ટરનેટ જરૂરી છે.

ગોપનીયતા નીતિ: https://nibomo.com/privacy/
સેવાની શરતો (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

### Keywords

flashcards,maker,spaced repetition,english,vocabulary,નોટ્સ,ઑફલાઇન,photo,decks

### What's New

- Premiumનું સબ્સ્ક્રિપ્શન લો. Appleની શરતો મુજબ પાત્ર હોય તો સાત દિવસની મફત ટ્રાયલ મેળવો.
- Premium અથવા આજીવન ઍક્સેસ સાથે ઍપનો ઍક્સેન્ટ રંગ પસંદ કરો.
- તમારી પોતાની OpenAI કી વાપરો અને માસિક AI વપરાશ જુઓ.
- કાર્ડના ડેક ગોઠવવામાં અને કાર્ડનું પુનરાવર્તન કરવામાં સુધારા.

## Hebrew

App Store locale: `he`

### Name

Nibomo: AI Flashcards

### Subtitle

כרטיסיות מסיכומים ותמונות

### Description

הפכו סיכומי שיעור ותמונות מהמחברת לכרטיסיות לימוד, וחזרו עליהן במרווחים כדי לזכור את מה שלמדתם.

יצירת כרטיסיות מחומר הלימוד
הוסיפו סיכום, צרפו תמונה או כתבו איזה נושא תרצו ללמוד. הבינה המלאכותית תציע שאלות ותשובות שתוכלו לערוך לפני הלימוד. אפשר גם לכתוב כל כרטיסייה בעצמכם.

חזרה מרווחת
נסו לענות מהזיכרון לפני שתהפכו את הכרטיסייה. דרגו עד כמה זכרתם, וכרטיסיות קשות יחזרו מוקדם יותר. אפשר לחזור על כרטיסיות שמורות גם ללא אינטרנט ולסנכרן את ההתקדמות כשתתחברו מחדש.

תרגול אוצר מילים
הכינו כרטיסיות למילים חדשות או התחילו מחפיסה מוכנה בקטלוג של Nibomo, למשל פעלים צירופיים באנגלית או אוצר מילים בספרדית למתחילים.

תכונות הבינה המלאכותית דורשות חיבור לאינטרנט.

מדיניות פרטיות: https://nibomo.com/privacy/
תנאי השירות (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

### Keywords

חזרה מרווחת,אוצר מילים,אנגלית,ללא אינטרנט,שינון,יצירה

### What's New

- הצטרפו למינוי Premium עם שבעה ימי ניסיון בחינם, בכפוף לזכאות לפי תנאי Apple.
- בחרו את צבע ההדגשה של האפליקציה עם Premium או גישה לכל החיים.
- השתמשו במפתח OpenAI משלכם וצפו בשימוש החודשי שלכם ב-AI.
- שיפורים בארגון חפיסות ובחזרה על כרטיסיות.

## Croatian

App Store locale: `hr`

### Name

Nibomo: Kartice za učenje

### Subtitle

Razmaknuto ponavljanje

### Description

Pretvorite svoje bilješke i fotografije u kartice za učenje. Unesite temu ili dodajte fotografiju bilježnice pa prepustite AI-ju da predloži pitanja i odgovore. Prijedloge možete urediti ili sami napisati svaku karticu.

Prisjetite se odgovora prije nego što okrenete karticu. Zatim ocijenite koliko ste ga dobro zapamtili. Nibomo primjenjuje razmaknuto ponavljanje pa se teže kartice vraćaju ranije. Spremljene kartice možete ponavljati bez interneta, a napredak se sinkronizira kad se ponovno povežete.

Vježbajte vokabular uz kartice s riječima i primjerima iz vlastitog gradiva. U katalogu Nibomo možete pronaći i gotove špilove, primjerice engleske frazne glagole ili španjolske riječi za početnike.

Za značajke koje koriste AI potrebna je internetska veza.

Pravila privatnosti: https://nibomo.com/privacy/
Uvjeti pružanja usluge (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

### Keywords

izrada,bilješke,fotografije,offline,engleski vokabular,španjolske riječi,pamćenje,flashcards

### What's New

- Pretplatite se na Premium uz sedam dana besplatnog probnog razdoblja ako ispunjavate Appleove uvjete.
- Odaberite boju naglaska aplikacije uz Premium ili doživotni pristup.
- Koristite vlastiti OpenAI ključ i pratite mjesečnu upotrebu AI-ja.
- Poboljšanja organizacije špilova i ponavljanja kartica.

## Hungarian

App Store locale: `hu`

### Name

Nibomo: AI-tanulókártya

### Subtitle

Időközönkénti ismétlés

### Description

Készíts tanulókártyákat a jegyzeteidből és a fotóidból. Az időközönkénti ismétlés segít, hogy később is emlékezz a tanultakra.

Készíts saját kártyákat
Adj hozzá egy jegyzetet vagy egy fotót a füzetedről, esetleg írj be egy témát. Az AI kérdéseket és válaszokat javasol. Ezeket tanulás előtt átszerkesztheted, vagy az elejétől magad is megírhatod a kártyáidat.

Ismételj akkor, amikor szükséged van rá
A kártya megfordítása előtt próbáld felidézni a választ, majd jelöld, mennyire ment könnyen. A nehezebb kártyák hamarabb visszatérnek. A mentett kártyákat offline is átismételheted, az eredményeidet pedig újracsatlakozás után szinkronizálhatod.

Bővítsd a szókincsed
Készíts szókártyákat az új szavakhoz, vagy válassz kész paklit a Nibomo katalógusából. Gyakorolhatsz például angol igekötős igéket szövegkörnyezetben vagy kezdő spanyol szókincset.

Az AI-funkciókhoz internetkapcsolat szükséges.

Adatvédelmi szabályzat: https://nibomo.com/privacy/
Felhasználási feltételek (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

### Keywords

jegyzetből,fotóból,offline,angol szókártyák,spanyol szókincs,készítő,felidézés,szavak

### What's New

- Fizess elő a Premiumra hétnapos ingyenes próbaidőszakkal, ha megfelelsz az Apple jogosultsági feltételeinek.
- Válaszd ki az alkalmazás kiemelőszínét Premiummal vagy élethosszig tartó hozzáféréssel.
- Használd a saját OpenAI-kulcsodat, és tekintsd meg a havi AI-használatodat.
- Fejlesztések a paklik rendszerezésében és a kártyák ismétlésében.

## Indonesian

App Store locale: `id`

### Name

Nibomo: Flashcard AI

### Subtitle

Pengulangan Berjarak

### Description

Ubah catatan dan foto menjadi flashcard. Gunakan pengulangan berjarak untuk mengingat materi yang sudah kamu pelajari.

Buat flashcard dari materi belajarmu
Minta AI membuat pertanyaan dan jawaban dari catatan kuliah, foto halaman buku, atau topik yang kamu pilih. Periksa dan edit hasilnya sebelum belajar. Kamu juga bisa menulis kartumu sendiri.

Ulangi materi sesuai daya ingatmu
Coba ingat jawabannya sebelum membalik kartu. Beri nilai sesuai seberapa baik kamu mengingatnya. Kartu yang sulit akan muncul kembali lebih cepat. Kamu bisa mengulang kartu yang sudah disimpan tanpa internet dan menyinkronkan progres saat kembali online.

Latih kosakata bahasa Inggris atau Spanyol
Buat kartu untuk kata baru dan tambahkan contoh kalimatmu sendiri. Kamu juga bisa mulai dari dek di katalog Nibomo, seperti phrasal verbs bahasa Inggris atau kosakata bahasa Spanyol untuk pemula.

Fitur AI memerlukan koneksi internet.

Kebijakan Privasi: https://nibomo.com/privacy/
Ketentuan Layanan (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

### Keywords

pembuat kartu flash,buat,catatan,foto,offline,kosakata,bahasa Inggris,Spanyol,hafalan,luring

### What's New

- Berlangganan Premium dengan uji coba gratis tujuh hari jika memenuhi syarat Apple.
- Pilih warna aksen aplikasi dengan Premium atau akses seumur hidup.
- Gunakan kunci OpenAI sendiri dan lihat penggunaan AI bulanan Anda.
- Peningkatan pengaturan dek dan pengulangan kartu.

## Italian

App Store locale: `it`

### Name

Nibomo: Flashcards con IA

### Subtitle

Ripetizione spaziata

### Description

Trasforma appunti e foto in flashcard e ripassa con la ripetizione spaziata. Con Nibomo puoi creare le tue schede e rivederle quando serve.

Crea flashcard dai tuoi appunti
Incolla gli appunti, allega una foto o indica un argomento. Chiedi all’IA di preparare domande e risposte, poi modifica le schede come preferisci. Puoi anche scriverle da zero.

Ricorda quello che studi
Prova a rispondere prima di girare la scheda. Indica quanto bene ricordavi la risposta e Nibomo ti riproporrà prima le schede più difficili. Puoi ripassare offline le schede già salvate e sincronizzare i progressi quando torni online.

Impara nuovi vocaboli
Crea schede con le parole che vuoi ricordare. Puoi anche partire da un mazzo del catalogo Nibomo, per esempio uno sui verbi frasali inglesi o sul vocabolario spagnolo di base.

Le funzioni di IA richiedono una connessione a Internet.

Informativa sulla privacy: https://nibomo.com/privacy/
Termini di servizio (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

### Keywords

creare,generatore,appunti,foto,ripasso,dilazionata,offline,schede,vocabolario,vocaboli,inglese

### What's New

- Abbonati a Premium con sette giorni di prova gratuita se soddisfi i requisiti di Apple.
- Scegli il colore di risalto dell’app con Premium o accesso a vita.
- Usa la tua chiave OpenAI e consulta il tuo utilizzo mensile dell’IA.
- Miglioramenti all’organizzazione dei mazzi e al ripasso delle carte.

## Kannada

App Store locale: `kn-IN`

### Name

Nibomo: AI Flashcards

### Subtitle

ಅಂತರವಿಟ್ಟು ಪುನರಾವರ್ತನೆ

### Description

AI ಬಳಸಿ ಟಿಪ್ಪಣಿಗಳು ಮತ್ತು ಫೋಟೋಗಳಿಂದ ಫ್ಲ್ಯಾಶ್‌ಕಾರ್ಡ್‌ಗಳನ್ನು ರಚಿಸಿ. ಅಂತರವಿಟ್ಟು ಪುನರಾವರ್ತಿಸುವ ಮೂಲಕ ಕಲಿತದ್ದನ್ನು ನೆನಪಿಟ್ಟುಕೊಳ್ಳಿ.

ನಿಮ್ಮದೇ ಫ್ಲ್ಯಾಶ್‌ಕಾರ್ಡ್‌ಗಳನ್ನು ರಚಿಸಿ
ಒಂದು ಟಿಪ್ಪಣಿ, ಫೋಟೋ ಅಥವಾ ವಿಷಯ ಕೊಟ್ಟು ಪ್ರಶ್ನೆ ಮತ್ತು ಉತ್ತರಗಳನ್ನು ಸಿದ್ಧಪಡಿಸಲು AIಗೆ ಕೇಳಿ. ಓದಲು ಶುರು ಮಾಡುವ ಮೊದಲು ಅವುಗಳನ್ನು ತಿದ್ದಿಕೊಳ್ಳಿ. ಬೇಕಿದ್ದರೆ ಪ್ರತಿ ಕಾರ್ಡ್‌ನ ಪ್ರಶ್ನೆ ಮತ್ತು ಉತ್ತರವನ್ನು ನೀವೇ ಬರೆಯಬಹುದು.

ಸರಿಯಾದ ಸಮಯದಲ್ಲಿ ಮರುಅಭ್ಯಾಸ ಮಾಡಿ
ಕಾರ್ಡ್ ತಿರುಗಿಸುವ ಮೊದಲು ಉತ್ತರವನ್ನು ನೆನಪಿಸಿಕೊಳ್ಳಿ. ಎಷ್ಟು ಚೆನ್ನಾಗಿ ನೆನಪಿತ್ತು ಎಂದು ದಾಖಲಿಸಿ. ಕಷ್ಟವಾದ ಕಾರ್ಡ್‌ಗಳು ಬೇಗ ಮತ್ತೆ ಬರುತ್ತವೆ. ಉಳಿಸಿದ ಕಾರ್ಡ್‌ಗಳನ್ನು ಆಫ್‌ಲೈನ್‌ನಲ್ಲೂ ಓದಬಹುದು. ಒಂದೇ ಖಾತೆಯಲ್ಲಿ ಸೈನ್ ಇನ್ ಮಾಡಿದ್ದರೆ, ಮತ್ತೆ ಇಂಟರ್ನೆಟ್‌ಗೆ ಸಂಪರ್ಕಿಸಿದಾಗ ನಿಮ್ಮ ಪ್ರಗತಿ ಸಾಧನಗಳ ನಡುವೆ ಸಿಂಕ್ ಆಗುತ್ತದೆ.

ಇಂಗ್ಲಿಷ್ ಪದಗಳ ಅಭ್ಯಾಸ
ಹೊಸ ಪದಗಳಿಗೆ ಕಾರ್ಡ್‌ಗಳನ್ನು ಮಾಡಿ, ಉದಾಹರಣೆ ವಾಕ್ಯಗಳನ್ನು ಸೇರಿಸಿ. Nibomo ಸಂಗ್ರಹದಲ್ಲಿರುವ ಇಂಗ್ಲಿಷ್ ಫ್ರೇಸಲ್ ವರ್ಬ್‌ಗಳು ಅಥವಾ ಆರಂಭಿಕ ಸ್ಪ್ಯಾನಿಷ್ ಪದಗಳ ಕಾರ್ಡ್‌ಗಳೊಂದಿಗೆ ಕೂಡ ಪ್ರಾರಂಭಿಸಬಹುದು.

AI ವೈಶಿಷ್ಟ್ಯಗಳಿಗೆ ಇಂಟರ್ನೆಟ್ ಸಂಪರ್ಕ ಬೇಕು.

ಗೌಪ್ಯತಾ ನೀತಿ: https://nibomo.com/privacy/
ಸೇವಾ ನಿಯಮಗಳು (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

### Keywords

spaced,repetition,maker,notes,photo,offline,ಇಂಗ್ಲಿಷ್ ಪದಗಳ ಅಭ್ಯಾಸ

### What's New

- Premium ಚಂದಾದಾರಿಕೆ ಪಡೆಯಿರಿ. Apple ನಿಯಮಗಳ ಪ್ರಕಾರ ಅರ್ಹರಾಗಿದ್ದರೆ ಏಳು ದಿನಗಳ ಉಚಿತ ಪ್ರಯೋಗ ಲಭ್ಯ.
- Premium ಅಥವಾ ಆಜೀವ ಪ್ರವೇಶದೊಂದಿಗೆ ಆ್ಯಪ್‌ನ ಹೈಲೈಟ್ ಬಣ್ಣವನ್ನು ಆಯ್ಕೆಮಾಡಿ.
- ನಿಮ್ಮ ಸ್ವಂತ OpenAI ಕೀ ಬಳಸಿ ಮತ್ತು ಮಾಸಿಕ AI ಬಳಕೆಯನ್ನು ನೋಡಿ.
- ಕಾರ್ಡ್ ಡೆಕ್‌ಗಳ ವ್ಯವಸ್ಥೆ ಮತ್ತು ಕಾರ್ಡ್‌ಗಳ ಪುನರಾವರ್ತನೆಯಲ್ಲಿ ಸುಧಾರಣೆಗಳು.

## Korean

App Store locale: `ko`

### Name

Nibomo: AI 암기카드

### Subtitle

사진으로 만들고 간격 반복으로 복습

### Description

수업 노트와 사진을 암기카드로 만들고, 간격 반복으로 까다로운 내용을 다시 떠올려 보세요.

내 학습 자료로 카드 만들기
노트를 붙여 넣거나 사진을 첨부하고, AI에게 어떤 내용을 공부할지 알려 주세요. AI가 만든 질문과 답의 초안을 고쳐서 쓰거나, 처음부터 한 장씩 직접 작성할 수 있어요.

기억하는 정도에 맞춰 복습하기
카드를 뒤집기 전에 답을 떠올리고, 얼마나 잘 기억했는지 표시하세요. 어려운 카드는 더 빨리, 익숙한 카드는 더 나중에 다시 나와요. 저장한 카드는 오프라인에서 복습할 수 있고, 인터넷에 다시 연결하면 학습 진도를 동기화할 수 있어요.

나만의 영단어장 만들기
수업이나 책에서 만난 단어에 예문을 더해 카드로 만들어 보세요. Nibomo 카탈로그에 있는 영어 구동사 카드 모음이나 스페인어 입문 어휘 카드로 시작해도 좋아요.

AI 기능을 사용하려면 인터넷 연결이 필요해요.

개인정보 처리방침: https://nibomo.com/privacy/
서비스 이용약관 (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

### Keywords

플래시카드,단어장,오프라인,영단어 암기,스페인어,영어 단어 외우기

### What's New

- Premium 구독이 추가되었습니다. Apple의 자격 요건을 충족하면 7일 무료 체험을 이용할 수 있습니다.
- Premium 또는 평생 이용 권한으로 앱의 강조 색상을 선택하세요.
- 개인 OpenAI 키를 사용하고 월별 AI 사용량을 확인하세요.
- 덱 정리와 카드 복습 기능을 개선했습니다.

## Malayalam

App Store locale: `ml-IN`

### Name

Nibomo: AI Flashcards

### Subtitle

ഇടവിട്ട ആവർത്തനം

### Description

കുറിപ്പുകളും ഫോട്ടോകളും AI ഉപയോഗിച്ച് ഫ്ലാഷ് കാർഡുകളാക്കൂ. പഠിച്ചത് ഓർമിക്കാൻ ഇടവിട്ട് ആവർത്തിക്കൂ.

സ്വന്തം ഫ്ലാഷ് കാർഡുകൾ ഉണ്ടാക്കൂ
കുറിപ്പോ ഫോട്ടോയോ പഠിക്കാനുള്ള ഒരു വിഷയമോ നൽകി ചോദ്യങ്ങളും ഉത്തരങ്ങളും തയ്യാറാക്കാൻ AIയോട് ആവശ്യപ്പെടൂ. പഠിക്കുന്നതിന് മുമ്പ് അവ തിരുത്താം. ഓരോ കാർഡും സ്വന്തമായി എഴുതാനും കഴിയും.

ഓർമയനുസരിച്ച് ആവർത്തിക്കൂ
കാർഡ് മറിക്കുന്നതിന് മുമ്പ് ഉത്തരം ഓർത്തെടുക്കൂ. ഉത്തരം എത്ര നന്നായി ഓർമ വന്നു എന്ന് രേഖപ്പെടുത്തൂ. പ്രയാസമുള്ള കാർഡുകൾ നേരത്തേ വീണ്ടും വരും. സേവ് ചെയ്ത കാർഡുകൾ ഓഫ്‌ലൈനിലും പഠിക്കാം. ഒരേ അക്കൗണ്ടിൽ സൈൻ ഇൻ ചെയ്ത ഉപകരണങ്ങൾക്കിടയിൽ ഇന്റർനെറ്റ് വീണ്ടും ലഭിക്കുമ്പോൾ പഠന പുരോഗതി സിങ്ക് ചെയ്യും.

പുതിയ വാക്കുകൾ പഠിക്കൂ
ഓർമിക്കേണ്ട വാക്കുകൾക്ക് കാർഡുകൾ ഉണ്ടാക്കൂ. വാക്കുകൾ എങ്ങനെ ഉപയോഗിക്കണമെന്ന് ഓർക്കാൻ സ്വന്തം ഉദാഹരണ വാക്യങ്ങൾ ചേർക്കൂ. Nibomo ശേഖരത്തിലെ ഇംഗ്ലീഷ് ഫ്രേസൽ വെർബുകളോ തുടക്കക്കാർക്കുള്ള സ്പാനിഷ് വാക്കുകളോ ഉപയോഗിച്ചും തുടങ്ങാം.

AI ഫീച്ചറുകൾക്ക് ഇന്റർനെറ്റ് ആവശ്യമാണ്.

സ്വകാര്യതാ നയം: https://nibomo.com/privacy/
സേവന നിബന്ധനകൾ (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

### Keywords

spaced,repetition,maker,notes,photo,offline,ഇംഗ്ലീഷ് വാക്കുകൾ

### What's New

- Premium സബ്‌സ്‌ക്രൈബ് ചെയ്യൂ. Apple-ന്റെ നിബന്ധനകൾ പ്രകാരം യോഗ്യതയുണ്ടെങ്കിൽ ഏഴ് ദിവസത്തെ സൗജന്യ ട്രയൽ ലഭിക്കും.
- Premium അല്ലെങ്കിൽ ആജീവനാന്ത ആക്‌സസ് ഉപയോഗിച്ച് ആപ്പിന്റെ ആക്‌സന്റ് നിറം തിരഞ്ഞെടുക്കൂ.
- സ്വന്തം OpenAI കീ ഉപയോഗിക്കൂ, പ്രതിമാസ AI ഉപയോഗം കാണൂ.
- കാർഡ് ഡെക്കുകൾ ക്രമീകരിക്കുന്നതിലും കാർഡുകൾ ആവർത്തിച്ച് പഠിക്കുന്നതിലും മെച്ചപ്പെടുത്തലുകൾ.

## Marathi

App Store locale: `mr-IN`

### Name

Nibomo: AI फ्लॅशकार्ड

### Subtitle

उजळणी व शब्दसंग्रह

### Description

वर्गातल्या नोट्स आणि वहीच्या फोटोंपासून फ्लॅशकार्ड तयार करा. वेळोवेळी उजळणी करून अभ्यासातलं लक्षात ठेवा.

आपल्या पद्धतीने कार्ड तयार करा
नोट्स पेस्ट करा, एखादा फोटो जोडा किंवा शिकायचा विषय लिहा. AI प्रश्न आणि उत्तरांचा मसुदा तयार करेल. अभ्यासापूर्वी तो बदलता येतो. हवं तर प्रश्न आणि उत्तर स्वतःही लिहा.

योग्य वेळी उजळणी करा
कार्ड उलटण्यापूर्वी उत्तर आठवण्याचा प्रयत्न करा. उत्तर पाहिल्यावर ते किती चांगलं आठवलं ते नोंदवा. अवघड कार्ड Nibomo लवकर पुन्हा दाखवतं. जतन केलेली कार्डे ऑफलाइनही पाहता येतात. इंटरनेटशी पुन्हा जोडल्यानंतर तुमची प्रगती सिंक होते.

इंग्रजी शब्दांचा सराव करा
वाचताना सापडलेले नवे शब्द आणि त्यांची उदाहरणे वापरून कार्ड तयार करा. Nibomoच्या कॅटलॉगमधल्या इंग्रजी फ्रेझल व्हर्ब्सच्या किंवा प्राथमिक स्पॅनिश शब्दांच्या डेकनेही सुरुवात करता येते.

AI सुविधांसाठी इंटरनेट आवश्यक आहे.

गोपनीयता धोरण: https://nibomo.com/privacy/
सेवेच्या अटी (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

### Keywords

flashcards,maker,spaced repetition,इंग्रजी शब्द,नोट्स,offline,photo

### What's New

- Premium चे सदस्यत्व घ्या. Apple च्या अटींनुसार पात्र असल्यास सात दिवसांची मोफत चाचणी मिळवा.
- Premium किंवा आजीवन प्रवेशासह ॲपचा ॲक्सेंट रंग निवडा.
- तुमची स्वतःची OpenAI की वापरा आणि मासिक AI वापर पाहा.
- कार्डांचे संच व्यवस्थित करणे आणि कार्डांची उजळणी करणे यांत सुधारणा.

## Norwegian

App Store locale: `no`

### Name

Nibomo: Læringskort med KI

### Subtitle

Repeter og lær gloser offline

### Description

Gjør notater og bilder om til læringskort. Bruk spredt repetisjon til å huske det du lærer, og øv på lagrede kort uten nett.

Lag dine egne puggekort
Lim inn notater, legg ved et bilde av en side, eller beskriv et tema. KI kan foreslå spørsmål og svar. Du kan redigere forslagene eller skrive kortene selv.

Repeter med passe mellomrom
Prøv å svare før du snur kortet. Vurder så hvor godt du husket svaret. Med spredt repetisjon (spaced repetition) kommer vanskelige kort tilbake tidligere, mens du kan vente lenger med dem du kan godt.

Øv på gloser
Lag kort med ord fra undervisningen, en bok eller en samtale. Legg gjerne til en setning som viser hvordan ordet brukes. I Nibomo-katalogen finner du også ferdige kortsett, for eksempel engelske partikkelverb eller spanske gloser for nybegynnere.

Åpne lagrede kort når du er offline. Fremgangen din synkroniseres når du er på nett igjen. KI-funksjoner krever nettilkobling.

Personvernerklæring: https://nibomo.com/privacy/
Tjenestevilkår (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

### Keywords

spredt repetisjon,spaced repetition,flashcards,puggekort,notater,bilder,ordforråd,spanske,engelske

### What's New

- Abonner på Premium med sju dagers gratis prøveperiode hvis du oppfyller Apples vilkår.
- Velg appens aksentfarge med Premium eller livstidstilgang.
- Bruk din egen OpenAI-nøkkel og se den månedlige KI-bruken din.
- Forbedringer i organisering av kortstokker og repetisjon av kort.

## Dutch

App Store locale: `nl-NL`

### Name

Nibomo: AI-flashcards

### Subtitle

Woordjes leren en herhalen

### Description

Maak flashcards van je aantekeningen en foto’s. Met gespreide herhaling oefen je de stof en woordjes die je wilt onthouden.

Maak flitskaarten van je eigen lesstof
Plak je aantekeningen, voeg een foto van een bladzijde toe of beschrijf een onderwerp. AI stelt vragen en antwoorden voor die je kunt aanpassen. Je kunt je kaarten ook één voor één zelf maken.

Herhaal met passende tussenpozen
Probeer het antwoord te bedenken voordat je de kaart omdraait. Geef daarna aan hoe goed je het antwoord wist. Nibomo gebruikt gespreide herhaling (spaced repetition). Lastige kaarten krijg je sneller terug, bekende kaarten pas later.

Oefen je woordenschat
Maak kaartjes met woorden uit de les, een boek of een gesprek. Voeg een voorbeeldzin toe om te oefenen hoe je het woord gebruikt. In de Nibomo-catalogus staan ook kant-en-klare sets, bijvoorbeeld met Engelse phrasal verbs of Spaanse woordjes voor beginners.

Open opgeslagen kaarten offline. Je voortgang wordt gesynchroniseerd zodra je weer online bent. Voor AI-functies heb je internet nodig.

Privacybeleid: https://nibomo.com/privacy/
Servicevoorwaarden (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

### Keywords

spaced repetition,gespreide herhaling,flitskaarten,maken,aantekeningen,notities,foto,offline,Spaans

### What's New

- Neem een Premium-abonnement met zeven dagen gratis proefperiode als je volgens Apple in aanmerking komt.
- Kies de accentkleur van de app met Premium of levenslange toegang.
- Gebruik je eigen OpenAI-sleutel en bekijk je maandelijkse AI-gebruik.
- Verbeteringen in het ordenen van kaartensets en het herhalen van kaarten.

## Punjabi

App Store locale: `pa-IN`

### Name

Nibomo: AI ਫਲੈਸ਼ ਕਾਰਡ

### Subtitle

ਵਕਫ਼ਿਆਂ ਨਾਲ ਦੁਹਰਾਈ

### Description

ਨੋਟਾਂ ਤੇ ਫੋਟੋਆਂ ਤੋਂ ਫਲੈਸ਼ ਕਾਰਡ ਬਣਾਓ। ਵਕਫ਼ਿਆਂ ਨਾਲ ਦੁਹਰਾਈ ਕਰ ਕੇ ਪੜ੍ਹਿਆ ਹੋਇਆ ਯਾਦ ਰੱਖੋ।

ਆਪਣੇ ਢੰਗ ਨਾਲ ਕਾਰਡ ਬਣਾਓ
ਨੋਟ ਪੇਸਟ ਕਰੋ, ਕਾਪੀ ਦੇ ਸਫ਼ੇ ਦੀ ਫੋਟੋ ਜੋੜੋ ਜਾਂ ਕੋਈ ਵਿਸ਼ਾ ਲਿਖੋ। AI ਤੋਂ ਸਵਾਲਾਂ ਤੇ ਜਵਾਬਾਂ ਦਾ ਖਰੜਾ ਬਣਵਾਓ। ਪੜ੍ਹਨ ਤੋਂ ਪਹਿਲਾਂ ਖਰੜੇ ਨੂੰ ਸੋਧੋ ਜਾਂ ਆਪਣੇ ਸਵਾਲ ਤੇ ਜਵਾਬ ਆਪ ਲਿਖੋ।

ਸਹੀ ਵੇਲੇ ਦੁਹਰਾਈ ਕਰੋ
ਕਾਰਡ ਪਲਟਣ ਤੋਂ ਪਹਿਲਾਂ ਜਵਾਬ ਯਾਦ ਕਰਨ ਦੀ ਕੋਸ਼ਿਸ਼ ਕਰੋ। ਫਿਰ ਦੱਸੋ ਕਿ ਉਹ ਕਿੰਨੀ ਚੰਗੀ ਤਰ੍ਹਾਂ ਯਾਦ ਸੀ। Nibomo ਔਖੇ ਕਾਰਡ ਛੇਤੀ ਮੁੜ ਦਿਖਾਉਂਦਾ ਹੈ। ਸੇਵ ਕੀਤੇ ਕਾਰਡ ਆਫਲਾਈਨ ਵੀ ਦੁਹਰਾ ਸਕਦੇ ਹੋ। ਦੁਬਾਰਾ ਇੰਟਰਨੈੱਟ ਮਿਲਣ ’ਤੇ ਤਰੱਕੀ ਸਿੰਕ ਹੋ ਜਾਂਦੀ ਹੈ।

ਅੰਗਰੇਜ਼ੀ ਦੇ ਨਵੇਂ ਸ਼ਬਦ ਸਿੱਖੋ
ਪੜ੍ਹਦਿਆਂ ਜਾਂ ਗੱਲਬਾਤ ਦੌਰਾਨ ਮਿਲੇ ਨਵੇਂ ਸ਼ਬਦਾਂ ਲਈ ਕਾਰਡ ਬਣਾਓ। Nibomo ਦੇ ਕੈਟਾਲਾਗ ਤੋਂ ਅੰਗਰੇਜ਼ੀ ਦੇ ਫ੍ਰੇਜ਼ਲ ਵਰਬਾਂ ਜਾਂ ਮੁੱਢਲੀ ਸਪੇਨੀ ਸ਼ਬਦਾਵਲੀ ਦੇ ਡੈੱਕ ਨਾਲ ਵੀ ਸ਼ੁਰੂ ਕਰ ਸਕਦੇ ਹੋ।

AI ਸਹੂਲਤਾਂ ਲਈ ਇੰਟਰਨੈੱਟ ਚਾਹੀਦਾ ਹੈ।

ਪਰਦੇਦਾਰੀ ਨੀਤੀ: https://nibomo.com/privacy/
ਸੇਵਾ ਦੀਆਂ ਸ਼ਰਤਾਂ (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

### Keywords

flashcards,maker,spaced repetition,ਅੰਗਰੇਜ਼ੀ ਸ਼ਬਦ ਸਿੱਖੋ,offline,SRS

### What's New

- Premium ਦੀ ਸਬਸਕ੍ਰਿਪਸ਼ਨ ਲਓ। Apple ਦੀਆਂ ਸ਼ਰਤਾਂ ਮੁਤਾਬਕ ਯੋਗ ਹੋਣ 'ਤੇ ਸੱਤ ਦਿਨਾਂ ਦੀ ਮੁਫ਼ਤ ਅਜ਼ਮਾਇਸ਼ ਮਿਲੇਗੀ।
- Premium ਜਾਂ ਉਮਰ ਭਰ ਦੀ ਪਹੁੰਚ ਨਾਲ ਐਪ ਦਾ ਐਕਸੈਂਟ ਰੰਗ ਚੁਣੋ।
- ਆਪਣੀ OpenAI ਕੁੰਜੀ ਵਰਤੋ ਅਤੇ ਮਹੀਨਾਵਾਰ AI ਵਰਤੋਂ ਦੇਖੋ।
- ਕਾਰਡਾਂ ਦੇ ਡੈੱਕ ਸਜਾਉਣ ਅਤੇ ਕਾਰਡ ਦੁਹਰਾਉਣ ਵਿੱਚ ਸੁਧਾਰ।

## Polish

App Store locale: `pl`

### Name

Nibomo: Twórz fiszki z AI

### Subtitle

Powtórki interwałowe i słówka

### Description

Zamień notatki lub zdjęcie zeszytu w fiszki do nauki. Wklej fragment materiału, dodaj zdjęcie albo podaj temat. AI przygotuje propozycje pytań i odpowiedzi, które możesz poprawić. Możesz też tworzyć fiszki od podstaw.

Powtarzaj w odpowiednim momencie
Spróbuj przypomnieć sobie odpowiedź przed odwróceniem fiszki, a potem oceń, jak dobrze ją pamiętasz. Nibomo dobierze termin kolejnej powtórki. Trudniejsze pytania wrócą wcześniej. Zapisane fiszki są dostępne offline, a postępy synchronizują się po odzyskaniu połączenia.

Ucz się słówek w kontekście
Twórz fiszki z własnymi przykładami lub sięgnij po gotową talię z katalogu Nibomo. Zacznij od angielskich czasowników frazowych albo podstawowych słów i zwrotów po hiszpańsku.

Funkcje AI wymagają połączenia z internetem.

Polityka prywatności: https://nibomo.com/privacy/
Warunki korzystania (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

### Keywords

notatki,zdjęcia,offline,angielskie,hiszpańskie,generator,egzaminy,nauka,flashcards,tworzenie

### What's New

- Subskrybuj Premium z siedmiodniowym bezpłatnym okresem próbnym, jeśli spełniasz warunki Apple.
- Wybierz kolor akcentu aplikacji z Premium lub dostępem dożywotnim.
- Używaj własnego klucza OpenAI i sprawdzaj miesięczne wykorzystanie AI.
- Ulepszenia organizacji talii i powtórek fiszek.

## Romanian

App Store locale: `ro`

### Name

Nibomo: Flashcards cu AI

### Subtitle

Repetiție spațiată

### Description

Transformă notițele și pozele în flashcarduri și recapitulează cu repetiție spațiată. Cu Nibomo poți pregăti fișe de memorare cu AI sau le poți scrie singur.

Creează fișe de studiu
Lipește notițele, atașează o poză sau spune ce subiect vrei să înveți. AI îți propune întrebări și răspunsuri pe care le poți modifica înainte de studiu.

Recapitulează ce îți este greu să reții
Încearcă să răspunzi din memorie, apoi întoarce fișa și indică cât de bine ți-ai amintit. Fișele mai dificile revin mai devreme. Poți recapitula fișele salvate fără internet, iar progresul se sincronizează când te reconectezi.

Exersează vocabularul
Fă fișe cu cuvinte pe care vrei să le reții sau începe cu un set din catalogul Nibomo. Poți alege, de exemplu, verbe frazale în engleză sau vocabular de bază în spaniolă.

Funcțiile AI necesită o conexiune la internet.

Politica de confidențialitate: https://nibomo.com/privacy/
Condiții de utilizare (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

### Keywords

creare,generator,notițe,poze,recapitulare,offline,fișe,vocabular,engleză,spaniolă,memorare

### What's New

- Abonează-te la Premium cu șapte zile de probă gratuită dacă îndeplinești condițiile Apple.
- Alege culoarea de accent a aplicației cu Premium sau acces pe viață.
- Folosește propria cheie OpenAI și vezi utilizarea lunară a AI.
- Îmbunătățiri pentru organizarea pachetelor și recapitularea cardurilor.

## Slovak

App Store locale: `sk`

### Name

Nibomo: Učebné kartičky

### Subtitle

Opakovanie a anglické slovíčka

### Description

Vytvorte si učebné kartičky z poznámok alebo fotky zošita. Pridajte učivo či tému a nechajte AI navrhnúť otázky a odpovede. Návrhy si môžete upraviť alebo si kartičky napísať od začiatku sami.

Opakujte s odstupom
Skúste si vybaviť odpoveď skôr, než kartičku otočíte. Potom ohodnoťte, ako dobre ste si spomenuli. Nibomo podľa toho naplánuje ďalšie opakovanie. Ťažšie kartičky sa vrátia skôr. Uložené kartičky si zopakujete aj offline. Po pripojení sa pokrok zosynchronizuje.

Učte sa slovíčka v kontexte
Pridajte vlastné slovíčka a príkladové vety alebo začnite s hotovým balíčkom z katalógu Nibomo, napríklad s anglickými frázovými slovesami či základnou španielskou slovnou zásobou.

Funkcie AI vyžadujú pripojenie na internet.

Zásady ochrany súkromia: https://nibomo.com/privacy/
Podmienky používania (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

### Keywords

rozložené,intervaloch,offline,poznámky,fotky,generátor,tvorba,španielčina,skúšky,flashcards

### What's New

- Predplaťte si Premium so sedemdňovou bezplatnou skúšobnou dobou, ak spĺňate podmienky spoločnosti Apple.
- S Premium alebo doživotným prístupom si vyberte farbu zvýraznenia aplikácie.
- Používajte vlastný kľúč OpenAI a sledujte mesačné využitie AI.
- Vylepšenia organizácie balíčkov a opakovania kartičiek.

## Slovenian

App Store locale: `sl-SI`

### Name

Nibomo: Flashcards z UI

### Subtitle

Ponavljanje in besedišče

### Description

Iz zapiskov in fotografij ustvarite učne kartice. Prilepite besedilo, dodajte fotografijo strani iz zvezka ali napišite temo. Umetna inteligenca predlaga vprašanja in odgovore, ki jih lahko uredite. Kartice lahko sestavite tudi sami.

Ponavljajte v presledkih
Preden obrnete kartico, se poskusite spomniti odgovora. Nato ocenite, kako dobro ste si ga zapomnili. Nibomo na podlagi ocene določi čas naslednje ponovitve. Težje kartice se prikažejo prej. Shranjene kartice ponavljajte brez povezave, napredek pa se sinhronizira, ko ste spet na spletu.

Vadite nove besede
Sestavite zbirko besed in dodajte lastne primere. V katalogu Nibomo lahko izberete tudi pripravljeno zbirko, na primer angleške frazne glagole ali osnovno špansko besedišče.

Funkcije umetne inteligence potrebujejo internetno povezavo.

Pravilnik o zasebnosti: https://nibomo.com/privacy/
Pogoji uporabe (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

### Keywords

učne kartice,presledki,angleške besede,špansko,brez povezave,zapiski,fotografije,generator

### What's New

- Naročite se na Premium s sedemdnevnim brezplačnim preizkusom, če izpolnjujete Applove pogoje.
- Izberite poudarjeno barvo aplikacije s Premium ali doživljenjskim dostopom.
- Uporabite svoj ključ OpenAI in spremljajte mesečno uporabo umetne inteligence.
- Izboljšave urejanja kompletov in ponavljanja kartic.

## Swedish

App Store locale: `sv`

### Name

Nibomo: Flashcards med AI

### Subtitle

Plugga glosor och repetera

### Description

Gör egna flashcards av anteckningar eller foton. Öva glosor och repetera det du lärt dig med lagom långa mellanrum.

Skapa flashkort av det du pluggar
Klistra in dina anteckningar, bifoga ett foto av en sida eller beskriv ett ämne. AI föreslår frågor och svar som du kan ändra. Du kan också skriva korten själv.

Repetera med lagom mellanrum
Försök komma på svaret innan du vänder kortet. Bedöm sedan hur bra du mindes det. Med intervallrepetition (spaced repetition) dyker svåra kort upp tidigare, medan kort du kan får vänta längre.

Plugga glosor med egna exempel
Gör kort av ord du stöter på under lektionen, i en bok eller i ett samtal. Lägg gärna till en exempelmening. I Nibomos katalog finns färdiga kortuppsättningar, till exempel engelska partikelverb och spanska glosor för nybörjare.

Repetera sparade kort offline. Dina framsteg synkroniseras när du är uppkopplad igen. AI-funktionerna kräver internetanslutning.

Integritetspolicy: https://nibomo.com/privacy/
Användarvillkor (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

### Keywords

spaced repetition,intervallrepetition,flashkort,skapa,anteckningar,foton,offline,engelska,spanska

### What's New

- Prenumerera på Premium med sju dagars gratis provperiod om du uppfyller Apples villkor.
- Välj appens accentfärg med Premium eller livstidsåtkomst.
- Använd din egen OpenAI-nyckel och se din månatliga AI-användning.
- Förbättringar av kortlekarnas organisering och kortrepetition.

## Tamil

App Store locale: `ta-IN`

### Name

Nibomo: AI Flashcards

### Subtitle

இடைவெளி மீள்பயிற்சி

### Description

AI உதவியுடன் குறிப்புகளையும் புகைப்படங்களையும் ஃபிளாஷ் கார்டுகளாக மாற்றுங்கள். இடைவெளி மீள்பயிற்சியுடன் படித்ததை நினைவில் வையுங்கள்.

உங்கள் அட்டைகளை உருவாக்குங்கள்
குறிப்பு, புகைப்படம் அல்லது பாடத் தலைப்பைக் கொடுத்து, கேள்விகளையும் பதில்களையும் தயாரிக்க AIயிடம் கேளுங்கள். படிப்பதற்கு முன் அவற்றைத் திருத்தலாம். ஒவ்வொரு அட்டையையும் நீங்களே எழுதலாம்.

சரியான நேரத்தில் மீண்டும் பயிற்சி செய்யுங்கள்
அட்டையைத் திருப்பும் முன் பதிலை நினைவுகூர முயலுங்கள். எந்த அளவுக்கு நினைவில் இருந்தது என்று பதிவு செய்யுங்கள். கடினமான அட்டைகள் விரைவில் மீண்டும் வரும். சேமித்த அட்டைகளை இணையமின்றிப் படிக்கலாம். ஒரே கணக்கில் உள்நுழைந்த சாதனங்களுக்கு இடையே, மீண்டும் இணையத்தில் இணைந்ததும் உங்கள் முன்னேற்றம் ஒத்திசையும்.

புதிய சொற்களைக் கற்றுக்கொள்ளுங்கள்
நினைவில் வைக்க விரும்பும் சொற்களுக்கு அட்டைகளை உருவாக்கி, உங்கள் சொந்த எடுத்துக்காட்டு வாக்கியங்களைச் சேருங்கள். Nibomo தொகுப்பிலுள்ள ஆங்கிலச் சொற்றொடர் வினைச்சொற்கள் அல்லது தொடக்கநிலை ஸ்பானியச் சொற்களுடனும் ஆரம்பிக்கலாம்.

AI அம்சங்களுக்கு இணைய இணைப்பு தேவை.

தனியுரிமைக் கொள்கை: https://nibomo.com/privacy/
சேவை விதிமுறைகள் (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

### Keywords

spaced,repetition,maker,notes,photo,offline,ஆங்கில வார்த்தைகள்

### What's New

- Premium சந்தாவைப் பெறுங்கள். Apple விதிகளின்படி தகுதியிருந்தால் ஏழு நாள் இலவச சோதனையைப் பெறலாம்.
- Premium அல்லது வாழ்நாள் அணுகலுடன் செயலியின் சிறப்பம்ச நிறத்தைத் தேர்ந்தெடுங்கள்.
- உங்கள் சொந்த OpenAI விசையைப் பயன்படுத்தி, மாதாந்திர AI பயன்பாட்டைப் பாருங்கள்.
- அட்டைத் தொகுப்புகளை ஒழுங்கமைப்பதிலும் அட்டைகளை மீள்பார்வை செய்வதிலும் மேம்பாடுகள்.

## Telugu

App Store locale: `te-IN`

### Name

Nibomo: AI Flashcards

### Subtitle

విరామాలతో పునశ్చరణ

### Description

AIతో నోట్స్, ఫోటోల నుంచి ఫ్లాష్‌కార్డ్‌లు తయారు చేయండి. విరామాలతో పునశ్చరణ చేస్తూ చదివినది గుర్తుంచుకోండి.

మీకు కావాల్సిన కార్డులు తయారు చేసుకోండి
గమనిక, ఫోటో లేదా చదవాల్సిన అంశం ఇచ్చి ప్రశ్నలు, సమాధానాలు సిద్ధం చేయమని AIని అడగండి. చదివే ముందు వాటిని సవరించుకోవచ్చు. కార్డులను మీరే రాసుకోవచ్చు.

సరైన సమయంలో మళ్లీ సాధన చేయండి
కార్డును తిప్పే ముందు సమాధానం గుర్తు తెచ్చుకోండి. ఎంత బాగా గుర్తొచ్చిందో నమోదు చేయండి. కష్టమైన కార్డులు త్వరగా మళ్లీ వస్తాయి. సేవ్ చేసిన కార్డులను ఆఫ్‌లైన్‌లో చదవచ్చు. ఒకే ఖాతాలో సైన్ ఇన్ చేసిన పరికరాలు మళ్లీ ఇంటర్నెట్‌కు కనెక్ట్ అయినప్పుడు మీ ప్రగతి సింక్ అవుతుంది.

కొత్త పదాలు నేర్చుకోండి
గుర్తుంచుకోవాలనుకున్న పదాలతో కార్డులు తయారు చేసి మీ సొంత ఉదాహరణ వాక్యాలను జోడించండి. Nibomo కేటలాగ్‌లోని ఆంగ్ల ఫ్రేజల్ వెర్బ్స్ లేదా ప్రారంభ స్థాయి స్పానిష్ పదాలతోనూ మొదలుపెట్టవచ్చు.

AI ఫీచర్లకు ఇంటర్నెట్ అవసరం.

గోప్యతా విధానం: https://nibomo.com/privacy/
సేవా నిబంధనలు (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

### Keywords

spaced,repetition,maker,notes,photo,offline,పదజాలం,ఆంగ్ల పదాలు

### What's New

- Premium సభ్యత్వం పొందండి. Apple నిబంధనల ప్రకారం అర్హులైతే ఏడు రోజుల ఉచిత ట్రయల్ లభిస్తుంది.
- Premium లేదా జీవితకాల యాక్సెస్‌తో యాప్‌లో హైలైట్ రంగును ఎంచుకోండి.
- మీ సొంత OpenAI కీని ఉపయోగించి, నెలవారీ AI వినియోగాన్ని చూడండి.
- కార్డ్ డెక్‌లను క్రమబద్ధీకరించడంలో, కార్డ్‌లను పునశ్చరణ చేయడంలో మెరుగుదలలు.

## Thai

App Store locale: `th`

### Name

Nibomo: แฟลชการ์ด AI

### Subtitle

สร้างจากรูป ทบทวนแบบเว้นระยะ

### Description

เปลี่ยนโน้ตและรูปถ่ายเป็นแฟลชการ์ด แล้วทบทวนแบบเว้นระยะเพื่อให้มีเวลาฝึกเรื่องที่ยังจำไม่แม่น

สร้างแฟลชการ์ดจากสิ่งที่เรียน
วางโน้ตจากชั้นเรียน แนบรูปหน้าสมุด หรือบอกหัวข้อที่อยากเรียน ให้ AI ช่วยร่างคำถามและคำตอบ แล้วแก้ไขก่อนเริ่มทบทวน คุณจะเขียนการ์ดเองทีละใบก็ได้

ทบทวนตามระดับที่จำได้
ลองนึกคำตอบก่อนพลิกการ์ด แล้วประเมินว่าจำได้ดีแค่ไหน การ์ดที่ยากจะกลับมาให้ทบทวนเร็วขึ้น เปิดการ์ดที่บันทึกไว้ทบทวนแบบออฟไลน์ได้ และซิงค์ความคืบหน้าเมื่อเชื่อมต่ออินเทอร์เน็ตอีกครั้ง

ฝึกคำศัพท์ด้วยบัตรคำ
นำคำที่เจอในห้องเรียนหรือในหนังสือมาทำบัตรคำศัพท์ แล้วเพิ่มประโยคตัวอย่างเพื่อจำวิธีใช้ หรือเริ่มจากชุดการ์ดในคลังของ Nibomo เช่น กริยาวลีภาษาอังกฤษหรือคำศัพท์ภาษาสเปนสำหรับผู้เริ่มต้น

ฟีเจอร์ AI ต้องเชื่อมต่ออินเทอร์เน็ต

นโยบายความเป็นส่วนตัว: https://nibomo.com/privacy/
ข้อกำหนดการใช้บริการ (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

### Keywords

บัตรคำศัพท์,ออฟไลน์,ท่องศัพท์,โน้ต

### What's New

- สมัคร Premium พร้อมทดลองใช้ฟรีเจ็ดวัน หากมีสิทธิ์ตามเงื่อนไขของ Apple
- เลือกสีเน้นของแอปได้เมื่อมี Premium หรือสิทธิ์ใช้งานตลอดชีพ
- ใช้คีย์ OpenAI ของคุณเองและดูการใช้งาน AI รายเดือน
- ปรับปรุงการจัดระเบียบสำรับและการทบทวนการ์ด

## Turkish

App Store locale: `tr`

### Name

Nibomo: Bilgi Kartları

### Subtitle

Çevrimdışı aralıklı tekrar

### Description

Notlarını ve fotoğraflarını bilgi kartlarına dönüştür. Aralıklı tekrarla öğrendiklerini daha uzun süre hatırla.

Kendi kartlarını oluştur
Ders notlarını ekle, defterinden bir fotoğraf yükle ya da çalışmak istediğin konuyu yaz. Yapay zekânın önerdiği soru ve cevapları düzenleyebilir veya kartlarını baştan kendin yazabilirsin.

Zor kartlara daha sık dön
Kartı çevirmeden önce cevabı hatırlamaya çalış. Ne kadar iyi hatırladığını işaretle. Zorlandığın kartlar daha erken karşına çıkar. Kayıtlı kartları çevrimdışı çalışabilir, yeniden bağlandığında ilerlemeni eşitleyebilirsin.

Kelime dağarcığını geliştir
Karşına çıkan yeni kelimeler için kart hazırla veya Nibomo kataloğundan hazır bir deste seç. Örneğin İngilizce öbek fiilleri bağlam içinde çalışabilir ya da temel İspanyolca kelimeleri öğrenebilirsin.

Yapay zekâ özellikleri internet bağlantısı gerektirir.

Gizlilik Politikası: https://nibomo.com/privacy/
Hizmet Koşulları (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

### Keywords

oluşturma,yapay zekâ,notlardan,fotoğraftan,ingilizce,kelime,ezberleme,flashcards,ispanyolca

### What's New

- Apple’ın uygunluk koşullarını karşılıyorsanız yedi günlük ücretsiz denemeyle Premium’a abone olun.
- Premium veya ömür boyu erişim ile uygulamanın vurgu rengini seçin.
- Kendi OpenAI anahtarınızı kullanın ve aylık AI kullanımınızı görün.
- Deste düzenleme ve kart tekrarı iyileştirmeleri.

## Ukrainian

App Store locale: `uk`

### Name

Nibomo: Створюйте флешкартки

### Subtitle

Інтервальне повторення

### Description

Перетворюйте конспекти й фото на флешкартки. Додайте уривок із нотаток, фото сторінки зошита або тему. ШІ запропонує запитання та відповіді, які можна відредагувати. Ви також можете створити картки самостійно.

Пригадуйте відповідь перед тим, як перегорнути картку. Потім перевірте себе й оцініть, наскільки добре пам’ятаєте матеріал. Nibomo визначить, коли повторити картку. Складніші картки з’являться раніше. Збережені картки можна повторювати офлайн. Після підключення до інтернету прогрес синхронізується.

Вивчайте слова в контексті. Додавайте власні слова й приклади або почніть із готової колоди з каталогу Nibomo. Наприклад, потренуйте англійські фразові дієслова чи базову іспанську лексику.

Для функцій ШІ потрібне підключення до інтернету.

Політика приватності: https://nibomo.com/privacy/
Умови користування (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

### Keywords

картки,конспект,фото,офлайн,вивчення слів,англійські

### What's New

- Оформте підписку Premium із безкоштовним пробним періодом на сім днів, якщо ви відповідаєте умовам Apple.
- Обирайте акцентний колір застосунку з Premium або довічним доступом.
- Використовуйте власний ключ OpenAI та переглядайте місячну статистику використання ШІ.
- Покращено впорядкування колод і повторення карток.

## Urdu

App Store locale: `ur-PK`

### Name

Nibomo: AI فلیش کارڈز

### Subtitle

وقفوں سے دہرائیں، الفاظ سیکھیں

### Description

کلاس کے نوٹس اور نوٹ بک کی تصاویر سے فلیش کارڈز بنائیں۔ وقفوں سے دہرائی کریں تاکہ پڑھا ہوا یاد رہے۔

اپنے طریقے سے کارڈز بنائیں
نوٹس پیسٹ کریں، تصویر لگائیں یا کوئی موضوع لکھیں۔ AI سوالات اور جوابات کا مسودہ تیار کرتا ہے۔ پڑھنے سے پہلے مسودے میں تبدیلی کریں یا اپنے سوال اور جواب خود لکھیں۔

صحیح وقت پر دہرائیں
کارڈ پلٹنے سے پہلے جواب یاد کرنے کی کوشش کریں۔ پھر بتائیں کہ جواب کتنی اچھی طرح یاد تھا۔ Nibomo مشکل کارڈز جلد دوبارہ دکھاتا ہے۔ محفوظ کارڈز آف لائن بھی دہرائیں۔ دوبارہ انٹرنیٹ سے جڑنے پر آپ کی پیش رفت سنک ہو جاتی ہے۔

انگریزی الفاظ سیکھیں
کتاب یا گفتگو میں ملنے والے نئے الفاظ سے کارڈز بنائیں۔ Nibomo کے کیٹلاگ میں انگریزی فریزل وربز اور ابتدائی ہسپانوی الفاظ کے تیار ڈیک بھی ہیں۔

AI کی سہولتوں کے لیے انٹرنیٹ کنکشن ضروری ہے۔

رازداری کی پالیسی: https://nibomo.com/privacy/
سروس کی شرائط (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

### Keywords

flashcards,maker,spaced repetition,english vocabulary,اسپیسڈ ریپیٹیشن,offline,notes

### What's New

- Premium کی سبسکرپشن لیں۔ Apple کی شرائط کے مطابق اہل ہونے پر سات دن کی مفت آزمائش حاصل کریں۔
- Premium یا تاحیات رسائی کے ساتھ ایپ کا نمایاں رنگ منتخب کریں۔
- اپنی OpenAI کلید استعمال کریں اور ماہانہ AI استعمال دیکھیں۔
- کارڈز کے ڈیک ترتیب دینے اور کارڈز دہرانے میں بہتری۔

## Vietnamese

App Store locale: `vi`

### Name

Nibomo: Flashcard AI

### Subtitle

Lặp lại ngắt quãng, học từ mới

### Description

Biến ghi chú và ảnh thành flashcard. Ôn theo phương pháp lặp lại ngắt quãng để dành thêm thời gian cho phần bạn chưa nhớ chắc.

Tạo flashcard từ tài liệu của bạn
Dán ghi chú, đính kèm ảnh chụp một trang vở hoặc mô tả chủ đề bạn muốn học. Nhờ AI soạn câu hỏi và câu trả lời, rồi sửa nội dung trước khi ôn. Bạn cũng có thể tự viết từng thẻ.

Ôn đúng lúc
Thử nhớ câu trả lời trước khi lật thẻ, rồi đánh giá xem bạn nhớ được đến đâu. Thẻ khó sẽ xuất hiện lại sớm hơn. Bạn có thể ôn thẻ đã lưu khi ngoại tuyến và đồng bộ tiến độ khi có mạng trở lại.

Ghi nhớ từ vựng qua ví dụ
Tạo thẻ cho từ mới bạn gặp khi đọc sách hay đi học, rồi thêm câu ví dụ để nhớ cách dùng. Bạn cũng có thể bắt đầu với một bộ thẻ trong danh mục Nibomo, chẳng hạn bộ cụm động từ tiếng Anh hoặc từ vựng tiếng Tây Ban Nha cho người mới.

Tính năng AI cần có kết nối internet.

Chính sách quyền riêng tư: https://nibomo.com/privacy/
Điều khoản dịch vụ (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

### Keywords

ảnh chụp,ghi chú,ngoại tuyến,tiếng Anh,tiếng Nhật,thẻ ghi nhớ,Tây Ban Nha

### What's New

- Đăng ký Premium với bảy ngày dùng thử miễn phí nếu bạn đáp ứng điều kiện của Apple.
- Chọn màu nhấn của ứng dụng với Premium hoặc quyền truy cập trọn đời.
- Dùng khóa OpenAI riêng và xem mức sử dụng AI hằng tháng.
- Cải thiện việc sắp xếp bộ thẻ và ôn tập thẻ.

## English (Australia)

App Store locale: `en-AU`

### Name

Nibomo: AI Flashcards

### Subtitle

Spaced Repetition & Vocabulary

### Description

Make flashcards from lecture notes, a photo or a topic, then use spaced repetition to keep what you’ve learnt fresh.

Make your own study cards
Ask AI to turn a page of notes or a photo into questions and answers. Edit the draft to focus on the points you need for revision, or write your cards from scratch.

Review what needs more practice
Try to recall the answer before you flip a card, then rate how well you remembered it. Cards you find difficult come back sooner. You can review saved flashcards offline and sync your progress when you reconnect.

Build your vocabulary
Add words from class or your reading to your own deck. Practise with an example sentence, or start with a catalogue deck for beginner Spanish vocabulary or English phrasal verbs.

AI features need an internet connection.

Privacy Policy: https://nibomo.com/privacy/
Terms of Use (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

### Keywords

maker,generator,notes,photo,offline,memorise,Spanish,English,builder,active recall,study cards

### What's New

- Use Nibomo on iPhone and iPad in Traditional Chinese, Australian English, Canadian English, British English, Canadian French, European Portuguese, Malay and Odia.

### What's New (macOS)

- Use Nibomo on Mac in Traditional Chinese, Australian English, Canadian English, British English, Canadian French, European Portuguese, Malay and Odia.

## English (Canada)

App Store locale: `en-CA`

### Name

Nibomo: Make AI Flashcards

### Subtitle

Spaced Repetition & Vocabulary

### Description

Make flashcards from class notes and photos, then review them with spaced repetition. Build a deck for a course or make your own French vocabulary flashcards.

Create cards you can edit
Paste your notes, add a photo, or give AI a topic. Edit the questions and answers before you study, or write cards yourself from scratch.

Study a little at a time
Try to answer from memory before flipping the card. Rate how well you remembered it and Nibomo will schedule the next review. Difficult cards come back sooner. Review saved cards offline and sync your progress when you reconnect.

Keep useful words in reach
Make cards for French or English words you hear in class or in conversation. Add your own example sentences. You can also try a deck from the Nibomo catalogue, such as beginner Spanish vocabulary.

AI features need an internet connection.

Privacy Policy: https://nibomo.com/privacy/
Terms of Use (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

### Keywords

maker,generator,notes,photo,offline,French,Spanish,English,learn,active recall,study cards,memorize

### What's New

- Use Nibomo on iPhone and iPad in Traditional Chinese, Australian English, Canadian English, British English, Canadian French, European Portuguese, Malay and Odia.

### What's New (macOS)

- Use Nibomo on Mac in Traditional Chinese, Australian English, Canadian English, British English, Canadian French, European Portuguese, Malay and Odia.

## English (U.K.)

App Store locale: `en-GB`

### Name

Nibomo: AI Revision Flashcards

### Subtitle

Spaced Repetition & Vocabulary

### Description

Turn lesson notes and photos into flashcards, then use spaced repetition to remember what you revise.

Make your own revision cards
Ask AI to draft questions and answers from your notes, a photo or a topic. Edit each card to focus on what you need to learn, or make your own cards from scratch.

Revise at the right intervals
Try to answer from memory, flip the card and rate how well you remembered it. Nibomo brings harder cards back sooner. Review saved flashcards offline and sync your progress when you reconnect.

Practise vocabulary in context
Make flashcards for words you want to memorise and include your own example sentences. Pick a deck from the Nibomo catalogue to practise Spanish vocabulary or English phrasal verbs.

AI features need an internet connection.

Privacy Policy: https://nibomo.com/privacy/
Terms of Use (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

### Keywords

maker,card,notes,photo,offline,memorise,Spanish,English,learn,active recall,exams,study

### What's New

- Use Nibomo on iPhone and iPad in Traditional Chinese, Australian English, Canadian English, British English, Canadian French, European Portuguese, Malay and Odia.

### What's New (macOS)

- Use Nibomo on Mac in Traditional Chinese, Australian English, Canadian English, British English, Canadian French, European Portuguese, Malay and Odia.

## Chinese (Traditional)

App Store locale: `zh-Hant`

### Name

Nibomo：AI 閃卡

### Subtitle

用照片製卡，間隔重複

### Description

把筆記和照片做成閃卡，再用間隔重複安排複習，把時間留給還沒記熟的內容。

把學習資料變成問答
貼上課堂筆記、附上一張照片，或說明你想學的主題。請 AI 起草問題和答案，確認內容後再開始複習。你也可以自己逐張寫卡片。

跟著自己的記憶節奏複習
先試著回答，再翻卡並評估自己記得多少。難記的卡片會早一點再出現，已經熟悉的內容可以晚一點再看。沒網路時也能複習已儲存的卡片，重新連線後可同步進度。

用單字卡累積詞彙
把讀到的英文生字做成卡片，加入例句來記住用法。也可以從 Nibomo 的卡組目錄開始，練習常用英文片語動詞或西班牙文入門詞彙。

AI 功能需要網路連線。

隱私權政策: https://nibomo.com/privacy/
使用條款 (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

### Keywords

背單字,英文生字卡,離線複習,抽認卡,單字卡製作,筆記轉卡片,西班牙文

### What's New

- iPhone 和 iPad 版 Nibomo 新增繁體中文、澳洲英語、加拿大英語、英國英語、加拿大法語、歐洲葡萄牙語、馬來語和奧里亞語。

### What's New (macOS)

- Mac 版 Nibomo 新增繁體中文、澳洲英語、加拿大英語、英國英語、加拿大法語、歐洲葡萄牙語、馬來語和奧里亞語。

## French (Canada)

App Store locale: `fr-CA`

### Name

Nibomo : Flashcards IA

### Subtitle

Révisez hors ligne

### Description

Transformez vos notes de cours et vos photos en flashcards avec Nibomo. Préparez votre matériel d’étude et revoyez-le grâce à la répétition espacée.

Créez vos cartes
Collez vos notes, joignez une photo ou indiquez un sujet. L’IA prépare des questions et des réponses que vous pouvez modifier. Vous pouvez aussi rédiger vos cartes à la main.

Révisez à votre rythme
Essayez de trouver la réponse avant de retourner la carte. Indiquez ensuite si vous vous en souveniez. Nibomo vous présente les cartes difficiles plus tôt. Les cartes enregistrées sont accessibles hors ligne et vos révisions se synchronisent à votre retour en ligne.

Mémorisez du vocabulaire
Créez des cartes pour les mots que vous voulez retenir ou essayez un ensemble du catalogue Nibomo, comme les verbes à particule en anglais ou le vocabulaire espagnol de base.

Les fonctions d’IA nécessitent une connexion Internet.

Politique de confidentialité : https://nibomo.com/privacy/
Conditions d’utilisation (EULA) : https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

### Keywords

répétition espacée,générateur,créer,notes,photos,cartes-éclair,vocabulaire,anglais,espagnol

### What's New

- Nibomo sur iPhone et iPad est maintenant offert en chinois traditionnel, en anglais d’Australie, du Canada et du Royaume-Uni, en français canadien, en portugais du Portugal, en malais et en odia.

### What's New (macOS)

- Nibomo sur Mac est maintenant offert en chinois traditionnel, en anglais d’Australie, du Canada et du Royaume-Uni, en français canadien, en portugais du Portugal, en malais et en odia.

## Portuguese (Portugal)

App Store locale: `pt-PT`

### Name

Nibomo: Flashcards com IA

### Subtitle

Repetição espaçada

### Description

Transforme os seus apontamentos e fotografias em flashcards. Reveja os seus cartões com repetição espaçada e concentre-se no que ainda precisa de consolidar.

Crie cartões de estudo
Cole os apontamentos, anexe uma fotografia ou indique um tema. Peça à IA que prepare perguntas e respostas. Pode editar os cartões antes de os estudar ou escrever os seus de raiz.

Reveja ao seu ritmo
Tente recordar a resposta antes de virar o cartão. Indique se foi fácil ou difícil recordá-la. Os cartões mais difíceis voltam a aparecer mais cedo. Reveja offline os cartões já guardados e sincronize o seu progresso quando voltar a ter ligação.

Pratique vocabulário
Crie cartões para as palavras que quer recordar ou escolha um baralho no catálogo do Nibomo. Encontrará, por exemplo, verbos frásicos em inglês e vocabulário básico de espanhol.

As funcionalidades de IA precisam de ligação à Internet.

Política de Privacidade: https://nibomo.com/privacy/
Termos de Utilização (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

### Keywords

criar,gerador,apontamentos,fotos,revisão,offline,cartões,vocabulário,inglês,espanhol,estudo

### What's New

- O Nibomo para iPhone e iPad está agora disponível em chinês tradicional, inglês da Austrália, do Canadá e do Reino Unido, francês do Canadá, português de Portugal, malaio e odia.

### What's New (macOS)

- O Nibomo para Mac está agora disponível em chinês tradicional, inglês da Austrália, do Canadá e do Reino Unido, francês do Canadá, português de Portugal, malaio e odia.

## Malay

App Store locale: `ms`

### Name

Nibomo: Flashcard AI

### Subtitle

Pengulangan Berjarak

### Description

Tukar nota dan gambar kepada kad imbas dengan AI. Ingat apa yang anda pelajari dengan pengulangan berjarak.

Cipta kad imbas daripada bahan anda
Minta AI merangka soalan dan jawapan daripada nota, gambar halaman buku, atau topik pilihan anda. Semak dan sunting draf sebelum belajar. Anda juga boleh menulis kad sendiri.

Ulang kaji pada masa yang sesuai
Cuba ingat jawapannya sebelum membalikkan kad. Nilai sejauh mana anda mengingati jawapan itu. Kad yang sukar akan muncul semula lebih awal. Di luar talian, anda masih boleh mengulang kaji kad yang telah disimpan. Apabila kembali dalam talian, log masuk dengan akaun yang sama untuk menyegerakkan kemajuan anda.

Tambah kosa kata
Cipta kad untuk perkataan baharu dan tambah contoh ayat sendiri. Anda juga boleh bermula dengan set kad daripada katalog Nibomo, seperti kata kerja frasa bahasa Inggeris atau kosa kata bahasa Sepanyol untuk pemula.

Ciri AI memerlukan sambungan internet.

Dasar Privasi: https://nibomo.com/privacy/
Terma Penggunaan (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

### Keywords

kad imbas,cipta,buat,nota,gambar,luar talian,kosa kata,bahasa Inggeris,Sepanyol,hafal,offline

### What's New

- Nibomo untuk iPhone dan iPad kini menyokong bahasa Cina Tradisional, bahasa Inggeris (Australia, Kanada dan UK), bahasa Perancis (Kanada), bahasa Portugis (Portugal), bahasa Melayu dan bahasa Odia.

### What's New (macOS)

- Nibomo untuk Mac kini menyokong bahasa Cina Tradisional, bahasa Inggeris (Australia, Kanada dan UK), bahasa Perancis (Kanada), bahasa Portugis (Portugal), bahasa Melayu dan bahasa Odia.

## Odia

App Store locale: `or-IN`

### Name

Nibomo: AI ଫ୍ଲାସ୍କାର୍ଡ

### Subtitle

ପୁଣି ପଢ଼ନ୍ତୁ, ଶବ୍ଦ ଶିଖନ୍ତୁ

### Description

କ୍ଲାସ୍‌ର ନୋଟ୍ ଓ ଖାତାର ଫଟୋରୁ ଫ୍ଲାସ୍କାର୍ଡ ତିଆରି କରନ୍ତୁ। ମଝିରେ ବ୍ୟବଧାନ ରଖି ପୁଣି ପଢ଼ିଲେ, ଯାହା ଶିଖିଛନ୍ତି ତାହା ମନେ ରଖିବା ସହଜ ହୁଏ।

ନିଜ ଢଙ୍ଗରେ କାର୍ଡ ତିଆରି କରନ୍ତୁ
ନୋଟ୍ ପେଷ୍ଟ କରନ୍ତୁ, ଫଟୋ ଯୋଡ଼ନ୍ତୁ କିମ୍ବା ଶିଖିବାକୁ ଚାହୁଁଥିବା ବିଷୟଟି ଲେଖନ୍ତୁ। AI ପ୍ରଶ୍ନ ଓ ଉତ୍ତରର ଖସଡ଼ା ତିଆରି କରିବ। ପଢ଼ିବା ପୂର୍ବରୁ ତାହା ବଦଳାନ୍ତୁ କିମ୍ବା ନିଜେ ପ୍ରଶ୍ନ ଓ ଉତ୍ତର ଲେଖନ୍ତୁ।

ଠିକ୍ ସମୟରେ ପୁଣି ଅଭ୍ୟାସ କରନ୍ତୁ
କାର୍ଡ ଓଲଟାଇବା ପୂର୍ବରୁ ଉତ୍ତରଟି ମନେ ପକାନ୍ତୁ। ତା’ପରେ କେତେ ଭଲ ଭାବେ ମନେ ଥିଲା ଜଣାନ୍ତୁ। କଠିନ କାର୍ଡଗୁଡ଼ିକୁ Nibomo ଶୀଘ୍ର ପୁଣି ଦେଖାଏ। ସେଭ୍ କରିଥିବା କାର୍ଡ ଇଣ୍ଟରନେଟ୍ ନଥିଲେ ମଧ୍ୟ ପଢ଼ିପାରିବେ। ଇଣ୍ଟରନେଟ୍ ସଂଯୋଗ ଫେରିଲେ ଆପଣଙ୍କ ପ୍ରଗତି ସିଙ୍କ୍ ହେବ।

ନୂଆ ଇଂରାଜୀ ଶବ୍ଦ ଶିଖନ୍ତୁ
ବହିରେ କିମ୍ବା କଥାବାର୍ତ୍ତାରେ ପାଇଥିବା ନୂଆ ଶବ୍ଦ ପାଇଁ କାର୍ଡ ବନାନ୍ତୁ। ଶବ୍ଦଟି କିପରି ବ୍ୟବହାର ହୁଏ ମନେ ରଖିବାକୁ ଏକ ଉଦାହରଣ ବାକ୍ୟ ଯୋଡ଼ନ୍ତୁ। ଚାହିଁଲେ Nibomoର କ୍ୟାଟାଲଗ୍‌ରୁ ଇଂରାଜୀ ଫ୍ରେଜାଲ୍ ଭର୍ବ କିମ୍ବା ପ୍ରାରମ୍ଭିକ ସ୍ପାନିଶ୍ ଶବ୍ଦର ଡେକ୍ ନେଇ ଆରମ୍ଭ କରନ୍ତୁ।

AI ସୁବିଧା ପାଇଁ ଇଣ୍ଟରନେଟ୍ ସଂଯୋଗ ଦରକାର।

ଗୋପନୀୟତା ନୀତି: https://nibomo.com/privacy/
ବ୍ୟବହାର ସର୍ତ୍ତାବଳୀ (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

### Keywords

flashcards,maker,spaced repetition,odia english,ଫଟୋ,ଅଫଲାଇନ୍,ନୋଟ୍,vocab

### What's New

- iPhone ଓ iPad ପାଇଁ Nibomo ଏବେ ପାରମ୍ପରିକ ଚୀନୀ, ଅଷ୍ଟ୍ରେଲିଆ, କାନାଡା ଓ ବ୍ରିଟେନର ଇଂରାଜୀ, କାନାଡାର ଫରାସୀ, ପର୍ତ୍ତୁଗାଲର ପର୍ତ୍ତୁଗୀଜ୍, ମାଲୟ ଓ ଓଡ଼ିଆ ଭାଷାରେ ଉପଲବ୍ଧ।

### What's New (macOS)

- Mac ପାଇଁ Nibomo ଏବେ ପାରମ୍ପରିକ ଚୀନୀ, ଅଷ୍ଟ୍ରେଲିଆ, କାନାଡା ଓ ବ୍ରିଟେନର ଇଂରାଜୀ, କାନାଡାର ଫରାସୀ, ପର୍ତ୍ତୁଗାଲର ପର୍ତ୍ତୁଗୀଜ୍, ମାଲୟ ଓ ଓଡ଼ିଆ ଭାଷାରେ ଉପଲବ୍ଧ।
