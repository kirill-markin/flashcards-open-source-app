# App Store Connect Metadata

Related competitor references: [iOS competitors](competitor-store-metadata.md#ios)

This file owns the source text and upload procedure for 42 App Store locales
(41 languages, including both Spanish regions). These sections are repository
inputs, not evidence of live publication. In-app language coverage belongs to
[iOS localization](ios-localization.md#supported-app-locales).

**Locale mapping**

Apple's language selector was checked on 2026-09-20. Its label is not always the
locale ID: Bangla uses `bn-BD`, Norwegian uses `no`, and Slovenian uses `sl-SI`.
The [uploader input map](../scripts/ios/app-store-localization-inputs.mts) pairs
all 42 exact section headings, Store IDs, and capture tags. Keep it aligned with
the 42 Store tags of both capture scripts and Swift catalogs described in
[iOS marketing screenshots](../apps/ios/docs/marketing-screenshots.md#files-involved);
capture tags without a Store ID never enter this map.

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

Other supported Store tags match their iOS and capture tags. Preserve `es-ES`
and `es-MX` separately. Apple has no listing locale for these app languages:
`bg`, `et`, `fa`, `is`, `lt`, `lv`, `sw`, `zu`; do not invent Store IDs for them.
Those eight still have captured iPhone screenshots, which stay website-only
assets that the uploader never reads.
The parser reserves every level-two heading for exactly one locale and every
level-three heading inside it for a metadata field. Keep usage text before the
first locale and preserve the section/field names.

**Upload an editable draft**

1. Generate and review all 420 raw PNGs using
   [the capture runbook](../apps/ios/docs/marketing-screenshots.md). Follow its
   opaque-PNG, dimension, display-slot, and filename requirements; composites
   are not upload inputs. Review all localized fields below. Refresh every What's
   New field for the actual target and released baseline using the canonical
   [release-note policy](release-current-version.md#release-notes); the command
   uploads these checked-in fields, including any stale notes left there.
2. Use Node 24 and the main checkout's `.env` credentials described in
   [Xcode Cloud data access](xcode-cloud-data-access.md#required-local-secrets).
   The command resolves that checkout through Git even when run in a worktree.
   If Apple returns `FORBIDDEN.REQUIRED_AGREEMENTS_MISSING_OR_EXPIRED`, verify
   the selected account/team, key kind, key validity/access, and actual web
   agreement status before asking for legal acceptance. An agreement error
   alone does not prove an inactive agreement; replace invalid credentials
   through the user when needed.
3. Select an existing iOS version and the unique editable app-info resource.
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
   through [the iOS release procedure](manual-production-release.md#ios) for
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

Nibomo: AI Flashcards

### Subtitle

Study for exams, build vocab

### Description

Turn notes and photos into AI flashcards for exam prep and vocabulary practice. Review at intervals that adapt to your answers, so you can focus on what needs more practice.

- Ask AI to explain a difficult topic or improve a card's wording.
- Group cards into decks and add tags to find the material you need.
- Review saved cards offline, wherever you have a few minutes.
- See your review activity and study streaks to keep track of your routine.

AI features need an internet connection.

### Keywords

notes,photo,spaced,repetition,language,memorize,revision,learning,practice,decks,tags

### What's New

- Share the app using new nibomo.com links.
- Keep access to your cards as a guest when the app moves to our new domain.

## Arabic

### Name

Nibomo: بطاقات ذكاء اصطناعي

### Subtitle

استعد للاختبارات وتعلم الكلمات

### Description

حوّل ملاحظاتك وصورك إلى بطاقات مراجعة بالذكاء الاصطناعي للتحضير للاختبارات وتعلّم المفردات. راجعها على فترات تتكيّف مع إجاباتك، لتركّز على ما يحتاج إلى مزيد من التدريب.

- اطلب من الذكاء الاصطناعي شرح موضوع صعب أو تحسين صياغة بطاقة.
- نظّم البطاقات في مجموعات وأضف وسومًا للعثور على ما تريد دراسته.
- راجع البطاقات المحفوظة دون إنترنت عندما تتاح لك بضع دقائق.
- تابع نشاط المراجعة وأيام الدراسة المتتالية للحفاظ على عادتك.

تحتاج ميزات الذكاء الاصطناعي إلى اتصال بالإنترنت.

### Keywords

ملاحظات,صور,مراجعة,تكرار,متباعد,مفردات,لغات,حفظ,دراسة

### What's New

- شارك التطبيق باستخدام روابط nibomo.com الجديدة.
- احتفظ بإمكانية الوصول إلى بطاقاتك كضيف عند انتقال التطبيق إلى نطاقنا الجديد.

## Chinese (Simplified)

### Name

Nibomo: AI 闪卡

### Subtitle

备考、背单词，从笔记开始

### Description

用 AI 将笔记和照片转成闪卡，用于备考和词汇练习。复习间隔会根据你的回答调整，帮你把时间用在还需巩固的内容上。

- 让 AI 解释难点，或把卡片上的问题写得更清楚。
- 用卡组和标签整理内容，方便找到要学的材料。
- 离线复习已保存的卡片，利用零散时间学习。
- 查看复习记录和连续学习天数，了解自己的学习节奏。

AI 功能需要联网。

### Keywords

照片,复习,间隔重复,词汇,语言,记忆,学习,练习,卡组,标签

### What's New

- 使用新的 nibomo.com 链接分享应用。
- 应用迁移到新域名后，您仍可在访客模式下访问自己的卡片。

## French

### Name

Nibomo : Flashcards IA

### Subtitle

Examens et vocabulaire

### Description

Transformez vos notes et photos en fiches de révision avec l'IA pour préparer vos examens et apprendre du vocabulaire. Les intervalles de révision s'adaptent à vos réponses pour vous aider à travailler ce qui reste à retenir.

- Demandez à l'IA d'expliquer un sujet difficile ou de reformuler une fiche.
- Organisez vos fiches en paquets et ajoutez des étiquettes pour les retrouver.
- Révisez vos fiches enregistrées hors ligne dès que vous avez quelques minutes.
- Consultez votre activité de révision et vos séries de jours d'étude.

Les fonctions d'IA nécessitent une connexion Internet.

### Keywords

notes,photo,répétition,espacée,examen,langue,mémoire,apprentissage,cartes,paquets

### What's New

- Partagez l’app avec les nouveaux liens nibomo.com.
- Conservez l’accès à vos fiches en tant qu’invité lorsque l’app passe à notre nouveau domaine.

## German

### Name

Nibomo: KI-Karteikarten

### Subtitle

Für Prüfungen und Vokabeln

### Description

Erstelle mit KI Lernkarten aus Notizen und Fotos für Prüfungen und zum Vokabellernen. Die Wiederholungsabstände passen sich deinen Antworten an, damit du gezielt übst, was noch nicht sitzt.

- Lass dir von der KI schwierige Themen erklären oder Kartentexte verbessern.
- Ordne Karten in Stapeln und nutze Tags, um deinen Lernstoff wiederzufinden.
- Wiederhole gespeicherte Karten offline, wenn du ein paar Minuten Zeit hast.
- Behalte deine Wiederholungen und Lerntage in Folge im Blick.

Für KI-Funktionen brauchst du eine Internetverbindung.

### Keywords

Notizen,Fotos,Wiederholung,Lernen,Gedächtnis,Sprachen,Üben,Karten,Stapel,Tags

### What's New

- Teile die App über die neuen nibomo.com-Links.
- Beim Wechsel der App auf unsere neue Domain behältst du als Gast Zugriff auf deine Karten.

## Hindi

### Name

Nibomo: AI फ्लैशकार्ड

### Subtitle

परीक्षा की तैयारी, नए शब्द

### Description

AI से नोट्स और फ़ोटो को फ़्लैशकार्ड में बदलें, परीक्षा की तैयारी करें और नए शब्द सीखें। आपके जवाबों के अनुसार दोहराई का अंतराल बदलता है, ताकि जिन बातों में अभ्यास चाहिए उन पर ध्यान दे सकें।

- मुश्किल विषय समझने या कार्ड की भाषा सुधारने के लिए AI से पूछें।
- कार्ड को समूहों में रखें और टैग लगाकर ज़रूरी सामग्री ढूँढें।
- कुछ मिनट मिलें तो सहेजे गए कार्ड की ऑफ़लाइन दोहराई करें।
- अपनी दोहराई और लगातार पढ़ाई वाले दिन देखें।

AI सुविधाओं के लिए इंटरनेट कनेक्शन चाहिए।

### Keywords

नोट्स,फोटो,दोहराई,भाषा,याददाश्त,पढ़ाई,अभ्यास

### What's New

- नए nibomo.com लिंक से ऐप शेयर करें।
- ऐप के हमारे नए डोमेन पर जाने के बाद भी अतिथि के रूप में अपने कार्ड इस्तेमाल कर सकेंगे।

## Japanese

### Name

Nibomo: AI暗記カード

### Subtitle

試験対策も単語学習も

### Description

ノートや写真からAIでフラッシュカードを作り、試験対策や単語学習に活用できます。回答に応じて復習の間隔が調整されるので、まだ覚えていない内容を重点的に練習できます。

- 難しい内容の解説や、カードの文章の改善をAIに頼めます。
- カードをデッキとタグで整理し、学びたい内容を見つけられます。
- 保存済みのカードはオフラインでも復習でき、すきま時間を使えます。
- 復習の記録や連続学習日数で、日々の取り組みを確認できます。

AI機能にはインターネット接続が必要です。

### Keywords

ノート,写真,復習,間隔反復,語彙,語学,暗記,勉強,練習,デッキ,タグ

### What's New

- 新しい nibomo.com リンクでアプリを共有できます。
- アプリが新しいドメインに移行しても、ゲストとして使っているカードに引き続きアクセスできます。

## Portuguese (Brazil)

### Name

Nibomo: Flashcards com IA

### Subtitle

Prepare-se e aprenda palavras

### Description

Transforme anotações e fotos em flashcards com IA para se preparar para provas e aprender vocabulário. Os intervalos de revisão se ajustam às suas respostas para você praticar o que ainda precisa fixar.

- Peça à IA uma explicação sobre um assunto difícil ou uma redação mais clara para um cartão.
- Organize cartões em baralhos e use etiquetas para encontrar o que quer estudar.
- Revise cartões salvos offline quando tiver alguns minutos livres.
- Acompanhe suas revisões e sua sequência de dias de estudo.

Os recursos de IA precisam de conexão com a internet.

### Keywords

notas,fotos,revisão,repetição,espaçada,prova,idioma,vocabulário,memória,estudo,baralhos

### What's New

- Compartilhe o app com os novos links nibomo.com.
- Mantenha o acesso aos seus cartões como convidado quando o app passar para o nosso novo domínio.

## Russian

### Name

Nibomo: ИИ-флешкарты

### Subtitle

Экзамены и новые слова

### Description

Превращайте заметки и фото в учебные карточки с ИИ для подготовки к экзаменам и изучения слов. Интервалы повторения подстраиваются под ваши ответы, чтобы вы уделяли больше внимания тому, что ещё нужно закрепить.

- Просите ИИ объяснить сложную тему или уточнить формулировку карточки.
- Собирайте карточки в колоды и добавляйте теги, чтобы находить нужный материал.
- Повторяйте сохранённые карточки без интернета, когда есть свободная минута.
- Следите за повторениями и сериями дней учёбы.

Для функций ИИ нужен интернет.

### Keywords

заметки,фото,повторение,интервалы,слова,языки,память,учёба,практика,колоды,теги

### What's New

- Делитесь приложением по новым ссылкам nibomo.com.
- Сохраните гостевой доступ к своим карточкам при переходе приложения на наш новый домен.

## Spanish (Mexico)

### Name

Nibomo: Flashcards con IA

### Subtitle

Prepárate y aprende palabras

### Description

Convierte tus apuntes y fotos en tarjetas de estudio con IA para preparar exámenes y aprender vocabulario. Los intervalos de repaso se ajustan a tus respuestas para que practiques lo que aún necesitas reforzar.

- Pídele a la IA que explique un tema difícil o mejore la redacción de una tarjeta.
- Organiza tus tarjetas en mazos y agrega etiquetas para encontrar lo que quieres estudiar.
- Repasa tarjetas guardadas sin conexión cuando tengas unos minutos libres.
- Consulta tus repasos y tus rachas de días de estudio.

Las funciones de IA necesitan conexión a internet.

### Keywords

apuntes,fotos,repaso,repetición,espaciada,examen,idioma,vocabulario,memoria,estudio,mazos

### What's New

- Comparte la app con los nuevos enlaces de nibomo.com.
- Conserva el acceso a tus tarjetas como invitado cuando la app pase a nuestro nuevo dominio.

## Spanish (Spain)

### Name

Nibomo: Flashcards con IA

### Subtitle

Prepara exámenes, aprende más

### Description

Convierte tus apuntes y fotos en tarjetas de estudio con IA para preparar exámenes y aprender vocabulario. Los intervalos de repaso se ajustan a tus respuestas para que practiques lo que aún necesitas afianzar.

- Pide a la IA que explique un tema difícil o mejore la redacción de una tarjeta.
- Organiza tus tarjetas en mazos y añade etiquetas para encontrar lo que quieres estudiar.
- Repasa tarjetas guardadas sin conexión cuando tengas unos minutos libres.
- Consulta tus repasos y tus rachas de días de estudio.

Las funciones de IA necesitan conexión a internet.

### Keywords

apuntes,fotos,repaso,repetición,espaciada,idioma,vocabulario,memoria,estudio,práctica,mazos

### What's New

- Comparte la app con los nuevos enlaces de nibomo.com.
- Conserva el acceso a tus tarjetas como invitado cuando la app pase a nuestro nuevo dominio.

## Bangla

App Store locale: `bn-BD`

### Name

Nibomo: AI ফ্ল্যাশকার্ড

### Subtitle

পরীক্ষার প্রস্তুতি, নতুন শব্দ

### Description

AI দিয়ে নোট ও ছবি থেকে ফ্ল্যাশকার্ড বানিয়ে পরীক্ষার প্রস্তুতি নিন ও নতুন শব্দ শিখুন। আপনার উত্তর অনুযায়ী রিভিশনের বিরতি বদলায়, যাতে আরও অনুশীলন দরকার এমন বিষয়গুলোয় মন দিতে পারেন।

- কঠিন বিষয় বুঝতে বা কার্ডের ভাষা আরও স্পষ্ট করতে AI-কে বলুন।
- কার্ডগুলো সেটে সাজান ও ট্যাগ দিয়ে দরকারি পড়ার বিষয় খুঁজুন।
- কয়েক মিনিট সময় পেলেই সেভ করা কার্ড অফলাইনে রিভিশন দিন।
- আপনার রিভিশন ও টানা কত দিন পড়েছেন তা দেখুন।

AI সুবিধার জন্য ইন্টারনেট সংযোগ দরকার।

### Keywords

নোট,ছবি,রিভিশন,ভাষা,স্মৃতি,পড়াশোনা,অনুশীলন

### What's New

- নতুন nibomo.com লিংক দিয়ে অ্যাপ শেয়ার করুন।
- অ্যাপ আমাদের নতুন ডোমেইনে চলে গেলেও অতিথি হিসেবে আপনার কার্ডগুলো ব্যবহার করতে পারবেন।

## Catalan

App Store locale: `ca`

### Name

Nibomo: Targetes amb IA

### Subtitle

Per a exàmens i vocabulari

### Description

Converteix els apunts i les fotos en targetes d'estudi amb IA per preparar exàmens i aprendre vocabulari. Els intervals de repàs s'adapten a les teves respostes perquè practiquis allò que encara et costa recordar.

- Demana a la IA que expliqui un tema difícil o millori el text d'una targeta.
- Organitza les targetes en grups i afegeix etiquetes per trobar el que vols estudiar.
- Repassa les targetes desades sense connexió quan tinguis uns minuts lliures.
- Consulta els repassos i les ratxes de dies d'estudi.

Les funcions d'IA necessiten connexió a internet.

### Keywords

apunts,fotos,repàs,repetició,espaiada,idioma,vocabulari,memòria,estudi,pràctica

### What's New

- Comparteix l’aplicació amb els nous enllaços de nibomo.com.
- Conserva l’accés a les teves targetes com a convidat quan l’aplicació passi al nostre nou domini.

## Czech

App Store locale: `cs`

### Name

Nibomo: AI kartičky

### Subtitle

Příprava na zkoušky i slovíčka

### Description

Proměňte poznámky a fotky v kartičky s pomocí AI pro přípravu na zkoušky i učení slovíček. Intervaly opakování se přizpůsobují vašim odpovědím, abyste procvičovali hlavně to, co si ještě potřebujete zapamatovat.

- Požádejte AI o vysvětlení obtížného tématu nebo úpravu textu kartičky.
- Uspořádejte kartičky do balíčků a přidejte štítky pro snadné hledání.
- Opakujte si uložené kartičky offline, kdykoli máte pár minut.
- Sledujte svá opakování a počet dnů, kdy se učíte bez přestávky.

Funkce AI vyžadují připojení k internetu.

### Keywords

poznámky,fotky,opakování,jazyky,paměť,učení,procvičování,balíčky,štítky

### What's New

- Sdílejte aplikaci pomocí nových odkazů na nibomo.com.
- Při přechodu aplikace na naši novou doménu si zachováte přístup ke svým kartičkám jako host.

## Danish

App Store locale: `da`

### Name

Nibomo: AI-læringskort

### Subtitle

Læs til eksamen, lær nye ord

### Description

Lav noter og fotos om til flashcards med AI, når du læser til eksamen eller lærer nye ord. Intervallerne mellem repetitionerne tilpasses dine svar, så du kan øve det, du endnu ikke husker.

- Bed AI om at forklare et svært emne eller gøre teksten på et kort tydeligere.
- Saml kort i bunker, og brug tags til at finde det stof, du vil øve.
- Repetér gemte kort offline, når du har et par minutter.
- Følg dine repetitioner og se, hvor mange dage i træk du har læst.

AI-funktioner kræver internetforbindelse.

### Keywords

noter,fotos,repetition,sprog,hukommelse,læring,øvelse,kort,bunker,tags

### What's New

- Del appen med de nye nibomo.com-links.
- Behold adgangen til dine kort som gæst, når appen flytter til vores nye domæne.

## Greek

App Store locale: `el`

### Name

Nibomo: Κάρτες με AI

### Subtitle

Για εξετάσεις και νέες λέξεις

### Description

Μετατρέψτε σημειώσεις και φωτογραφίες σε κάρτες μελέτης με AI για εξετάσεις και εξάσκηση στο λεξιλόγιο. Τα διαστήματα επανάληψης προσαρμόζονται στις απαντήσεις σας, ώστε να εστιάζετε σε όσα χρειάζονται περισσότερη εξάσκηση.

- Ζητήστε από το AI να εξηγήσει ένα δύσκολο θέμα ή να βελτιώσει το κείμενο μιας κάρτας.
- Οργανώστε τις κάρτες σε συλλογές και προσθέστε ετικέτες για να βρίσκετε την ύλη σας.
- Κάντε επανάληψη με αποθηκευμένες κάρτες χωρίς σύνδεση, όταν έχετε λίγα λεπτά.
- Δείτε τις επαναλήψεις σας και τις συνεχόμενες ημέρες μελέτης.

Οι λειτουργίες AI απαιτούν σύνδεση στο διαδίκτυο.

### Keywords

σημειώσεις,φωτογραφίες,επανάληψη,λεξιλόγιο,γλώσσες,μνήμη,μελέτη,εξάσκηση

### What's New

- Μοιραστείτε την εφαρμογή με τους νέους συνδέσμους nibomo.com.
- Διατηρείτε την πρόσβαση στις κάρτες σας ως επισκέπτης όταν η εφαρμογή μεταφερθεί στο νέο μας domain.

## Finnish

App Store locale: `fi`

### Name

Nibomo: Tekoälymuistikortit

### Subtitle

Kertaa kokeisiin, opi sanoja

### Description

Tee muistiinpanoista ja kuvista muistikortteja tekoälyn avulla kokeisiin ja sanojen opiskeluun. Kertausvälit mukautuvat vastauksiisi, jotta voit keskittyä asioihin, jotka vaativat vielä harjoittelua.

- Pyydä tekoälyä selittämään vaikea aihe tai selkeyttämään kortin tekstiä.
- Järjestä kortit pakkoihin ja lisää tunnisteita, jotta löydät etsimäsi.
- Kertaa tallennettuja kortteja ilman verkkoyhteyttä, kun sinulla on hetki aikaa.
- Seuraa kertauksiasi ja peräkkäisiä opiskelupäiviäsi.

Tekoälytoiminnot vaativat internetyhteyden.

### Keywords

muistiinpanot,kuvat,kertaus,kielet,sanasto,muisti,opiskelu,harjoittelu,pakat,tunnisteet

### What's New

- Jaa sovellus uusilla nibomo.com-linkeillä.
- Säilytät pääsyn kortteihisi vierailijana, kun sovellus siirtyy uudelle verkkotunnuksellemme.

## Gujarati

App Store locale: `gu-IN`

### Name

Nibomo: AI ફ્લૅશકાર્ડ

### Subtitle

પરીક્ષાની તૈયારી, નવા શબ્દો

### Description

AIથી નોંધો અને ફોટામાંથી ફ્લેશકાર્ડ બનાવો, પરીક્ષાની તૈયારી કરો અને નવા શબ્દો શીખો. તમારા જવાબો પ્રમાણે પુનરાવર્તન વચ્ચેનો સમય બદલાય છે, જેથી વધુ અભ્યાસની જરૂર હોય તે બાબતો પર ધ્યાન આપી શકો.

- અઘરો વિષય સમજાવવા અથવા કાર્ડનું લખાણ સ્પષ્ટ કરવા AIને કહો.
- કાર્ડને જૂથોમાં ગોઠવો અને જરૂરી સામગ્રી શોધવા ટૅગ ઉમેરો.
- થોડી મિનિટ મળે ત્યારે સાચવેલા કાર્ડનો ઑફલાઇન અભ્યાસ કરો.
- તમારું પુનરાવર્તન અને સતત અભ્યાસ કરેલા દિવસો જુઓ.

AI સુવિધાઓ માટે ઇન્ટરનેટ કનેક્શન જરૂરી છે.

### Keywords

નોંધ,ફોટો,પુનરાવર્તન,ભાષા,યાદશક્તિ,અભ્યાસ

### What's New

- નવી nibomo.com લિંક્સથી ઍપ શેર કરો.
- ઍપ અમારા નવા ડોમેન પર જાય ત્યારે પણ મહેમાન તરીકે તમારા કાર્ડનો ઉપયોગ કરી શકશો.

## Hebrew

App Store locale: `he`

### Name

Nibomo: כרטיסיות עם AI

### Subtitle

הכנה למבחנים ואוצר מילים

### Description

הפכו הערות ותמונות לכרטיסיות לימוד בעזרת AI כדי להתכונן למבחנים ולתרגל אוצר מילים. המרווחים בין החזרות מותאמים לתשובות שלכם, כדי שתוכלו להתמקד במה שעדיין דורש תרגול.

- בקשו מה-AI להסביר נושא קשה או לשפר את הניסוח בכרטיסייה.
- סדרו כרטיסיות בחפיסות והוסיפו תגיות כדי למצוא את חומר הלימוד הרצוי.
- חזרו על כרטיסיות שמורות גם ללא אינטרנט, כשיש לכם כמה דקות.
- עקבו אחר החזרות שלכם ואחר רצף ימי הלימוד.

תכונות ה-AI דורשות חיבור לאינטרנט.

### Keywords

הערות,תמונות,חזרה,מרווחת,שפות,זיכרון,למידה,תרגול,תגיות

### What's New

- שתפו את האפליקציה עם הקישורים החדשים של nibomo.com.
- הגישה שלכם לכרטיסיות כאורחים נשמרת כשהאפליקציה עוברת לדומיין החדש שלנו.

## Croatian

App Store locale: `hr`

### Name

Nibomo: Kartice uz AI

### Subtitle

Za ispite i nove riječi

### Description

Pretvorite bilješke i fotografije u kartice za učenje uz AI, za pripremu ispita i vježbanje vokabulara. Razmaci između ponavljanja prilagođavaju se vašim odgovorima kako biste vježbali ono što još trebate utvrditi.

- Zatražite od AI-ja objašnjenje teške teme ili jasniji tekst kartice.
- Organizirajte kartice u špilove i dodajte oznake za lakše pronalaženje gradiva.
- Ponavljajte spremljene kartice bez interneta kad imate nekoliko minuta.
- Pratite svoja ponavljanja i nizove uzastopnih dana učenja.

Za AI značajke potrebna je internetska veza.

### Keywords

bilješke,fotografije,ponavljanje,jezici,pamćenje,učenje,vježba,špilovi,oznake

### What's New

- Podijelite aplikaciju putem novih poveznica nibomo.com.
- Zadržite pristup svojim karticama kao gost kada aplikacija prijeđe na našu novu domenu.

## Hungarian

App Store locale: `hu`

### Name

Nibomo: AI-tanulókártyák

### Subtitle

Vizsgafelkészülés, szótanulás

### Description

Készíts tanulókártyákat jegyzetekből és fotókból az AI segítségével vizsgákhoz és szótanuláshoz. Az ismétlések közötti idő a válaszaidhoz igazodik, így arra fordíthatsz több figyelmet, amit még gyakorolnod kell.

- Kérd az AI-t, hogy magyarázzon el egy nehéz témát vagy pontosítsa egy kártya szövegét.
- Rendezd a kártyákat paklikba, és adj hozzá címkéket az anyagok kereséséhez.
- Ismételd át a mentett kártyákat offline, amikor van pár szabad perced.
- Kövesd az ismétléseidet és az egymást követő tanulási napjaidat.

Az AI-funkciókhoz internetkapcsolat szükséges.

### Keywords

jegyzet,fotó,ismétlés,nyelv,memória,tanulás,gyakorlás,pakli,címke

### What's New

- Oszd meg az alkalmazást az új nibomo.com-hivatkozásokkal.
- Vendégként is megmarad a hozzáférésed a kártyáidhoz, amikor az alkalmazás az új domainünkre költözik.

## Indonesian

App Store locale: `id`

### Name

Nibomo: Kartu Belajar AI

### Subtitle

Siap ujian, tambah kosakata

### Description

Ubah catatan dan foto menjadi flashcard dengan AI untuk persiapan ujian dan latihan kosakata. Jeda pengulangan menyesuaikan jawabanmu agar kamu bisa fokus pada materi yang masih perlu dilatih.

- Minta AI menjelaskan topik sulit atau memperjelas teks pada kartu.
- Susun kartu dalam dek dan tambahkan tag agar materi mudah ditemukan.
- Ulangi kartu tersimpan secara offline saat ada beberapa menit luang.
- Pantau aktivitas pengulangan dan jumlah hari belajarmu berturut-turut.

Fitur AI memerlukan koneksi internet.

### Keywords

catatan,foto,pengulangan,berjarak,bahasa,ingatan,belajar,latihan,dek,tag

### What's New

- Bagikan aplikasi dengan tautan nibomo.com yang baru.
- Akses kartu Anda sebagai tamu tetap terjaga saat aplikasi beralih ke domain baru kami.

## Italian

App Store locale: `it`

### Name

Nibomo: Flashcard con IA

### Subtitle

Prepara esami, impara parole

### Description

Trasforma appunti e foto in flashcard con l'IA per preparare gli esami e imparare vocaboli. Gli intervalli di ripasso si adattano alle tue risposte, così puoi esercitarti su ciò che devi ancora consolidare.

- Chiedi all'IA di spiegare un argomento difficile o migliorare il testo di una carta.
- Organizza le carte in mazzi e aggiungi etichette per trovare il materiale che cerchi.
- Ripassa le carte salvate anche offline, quando hai qualche minuto libero.
- Segui i tuoi ripassi e le serie di giorni di studio.

Le funzioni di IA richiedono una connessione a Internet.

### Keywords

appunti,foto,ripasso,ripetizione,spaziata,lingue,vocabolario,memoria,studio,mazzi

### What's New

- Condividi l’app con i nuovi link di nibomo.com.
- Mantieni l’accesso alle tue schede come ospite quando l’app passa al nostro nuovo dominio.

## Kannada

App Store locale: `kn-IN`

### Name

Nibomo: AI ಕಲಿಕಾ ಕಾರ್ಡ್

### Subtitle

ಪರೀಕ್ಷೆ ತಯಾರಿ, ಹೊಸ ಪದಗಳು

### Description

AI ಬಳಸಿ ಟಿಪ್ಪಣಿಗಳು ಮತ್ತು ಫೋಟೋಗಳಿಂದ ಫ್ಲ್ಯಾಶ್‌ಕಾರ್ಡ್‌ಗಳನ್ನು ರಚಿಸಿ, ಪರೀಕ್ಷೆಗೆ ತಯಾರಾಗಿ ಮತ್ತು ಹೊಸ ಪದಗಳನ್ನು ಕಲಿಯಿರಿ. ನಿಮ್ಮ ಉತ್ತರಗಳಿಗೆ ತಕ್ಕಂತೆ ಪುನರಾವರ್ತನೆಯ ನಡುವಿನ ಅಂತರ ಬದಲಾಗುತ್ತದೆ, ಇದರಿಂದ ಇನ್ನಷ್ಟು ಅಭ್ಯಾಸ ಬೇಕಿರುವ ವಿಷಯಗಳ ಮೇಲೆ ಗಮನಹರಿಸಬಹುದು.

- ಕಷ್ಟದ ವಿಷಯವನ್ನು ವಿವರಿಸಲು ಅಥವಾ ಕಾರ್ಡ್‌ನ ಬರಹವನ್ನು ಸ್ಪಷ್ಟಗೊಳಿಸಲು AIಗೆ ಕೇಳಿ.
- ಕಾರ್ಡ್‌ಗಳನ್ನು ಗುಂಪುಗಳಲ್ಲಿ ಜೋಡಿಸಿ, ಬೇಕಾದ ವಿಷಯವನ್ನು ಹುಡುಕಲು ಟ್ಯಾಗ್‌ಗಳನ್ನು ಸೇರಿಸಿ.
- ಕೆಲವು ನಿಮಿಷ ಸಿಕ್ಕಾಗ ಉಳಿಸಿದ ಕಾರ್ಡ್‌ಗಳನ್ನು ಆಫ್‌ಲೈನ್‌ನಲ್ಲಿ ಅಭ್ಯಾಸ ಮಾಡಿ.
- ನಿಮ್ಮ ಪುನರಾವರ್ತನೆ ಮತ್ತು ಸತತವಾಗಿ ಓದಿದ ದಿನಗಳನ್ನು ನೋಡಿ.

AI ಸೌಲಭ್ಯಗಳಿಗೆ ಇಂಟರ್ನೆಟ್ ಸಂಪರ್ಕ ಬೇಕು.

### Keywords

ಟಿಪ್ಪಣಿ,ಫೋಟೋ,ಪುನರಾವರ್ತನೆ,ಭಾಷೆ,ನೆನಪು,ಅಭ್ಯಾಸ

### What's New

- ಹೊಸ nibomo.com ಲಿಂಕ್‌ಗಳ ಮೂಲಕ ಆ್ಯಪ್ ಹಂಚಿಕೊಳ್ಳಿ.
- ಆ್ಯಪ್ ನಮ್ಮ ಹೊಸ ಡೊಮೇನ್‌ಗೆ ಬದಲಾದಾಗಲೂ ಅತಿಥಿಯಾಗಿ ನಿಮ್ಮ ಕಾರ್ಡ್‌ಗಳನ್ನು ಬಳಸಬಹುದು.

## Korean

App Store locale: `ko`

### Name

Nibomo: AI 암기 카드

### Subtitle

시험 준비부터 어휘 학습까지

### Description

노트와 사진을 AI 플래시카드로 만들어 시험을 준비하고 어휘를 익혀 보세요. 답변에 따라 복습 간격이 조정되어 아직 익숙하지 않은 내용에 집중할 수 있어요.

- 어려운 주제를 설명하거나 카드의 문장을 다듬어 달라고 AI에 요청하세요.
- 카드를 덱으로 묶고 태그를 붙여 필요한 학습 자료를 찾으세요.
- 잠깐 시간이 나면 저장한 카드를 오프라인으로 복습하세요.
- 복습 기록과 연속 학습 일수를 확인하며 학습 습관을 살펴보세요.

AI 기능을 사용하려면 인터넷 연결이 필요해요.

### Keywords

노트,사진,복습,간격반복,단어,언어,암기,공부,연습,덱,태그

### What's New

- 새로운 nibomo.com 링크로 앱을 공유하세요.
- 앱이 새 도메인으로 이전해도 게스트로 사용하던 카드에 계속 접근할 수 있어요.

## Malayalam

App Store locale: `ml-IN`

### Name

Nibomo: AI പഠന കാർഡുകൾ

### Subtitle

പരീക്ഷാ പഠനം, പുതിയ വാക്കുകൾ

### Description

കുറിപ്പുകളും ഫോട്ടോകളും AI ഉപയോഗിച്ച് ഫ്ലാഷ്‌കാർഡുകളാക്കി പരീക്ഷയ്ക്ക് തയ്യാറെടുക്കാനും പുതിയ വാക്കുകൾ പഠിക്കാനും ഉപയോഗിക്കൂ. നിങ്ങളുടെ ഉത്തരങ്ങൾക്കനുസരിച്ച് ആവർത്തനത്തിന്റെ ഇടവേള മാറുന്നതിനാൽ കൂടുതൽ പരിശീലനം വേണ്ട കാര്യങ്ങളിൽ ശ്രദ്ധിക്കാം.

- ബുദ്ധിമുട്ടുള്ള വിഷയം വിശദീകരിക്കാനോ കാർഡിലെ വാചകം വ്യക്തമാക്കാനോ AIയോട് ചോദിക്കൂ.
- കാർഡുകൾ കൂട്ടങ്ങളായി ക്രമീകരിച്ച്, വേണ്ടവ കണ്ടെത്താൻ ടാഗുകൾ ചേർക്കൂ.
- ഏതാനും മിനിറ്റ് കിട്ടുമ്പോൾ സേവ് ചെയ്ത കാർഡുകൾ ഓഫ്‌ലൈനിൽ പഠിക്കൂ.
- ആവർത്തനങ്ങളും തുടർച്ചയായി പഠിച്ച ദിവസങ്ങളും നോക്കി പഠനശീലം വിലയിരുത്തൂ.

AI സൗകര്യങ്ങൾക്ക് ഇന്റർനെറ്റ് കണക്ഷൻ ആവശ്യമാണ്.

### Keywords

കുറിപ്പ്,ഫോട്ടോ,ആവർത്തനം,ഭാഷ,ഓർമ,പഠനം,പരിശീലനം

### What's New

- പുതിയ nibomo.com ലിങ്കുകൾ ഉപയോഗിച്ച് ആപ്പ് പങ്കിടൂ.
- ആപ്പ് ഞങ്ങളുടെ പുതിയ ഡൊമെയ്‌നിലേക്ക് മാറുമ്പോഴും അതിഥിയായി നിങ്ങളുടെ കാർഡുകൾ ഉപയോഗിക്കാം.

## Marathi

App Store locale: `mr-IN`

### Name

Nibomo: AI फ्लॅशकार्ड

### Subtitle

परीक्षेची तयारी, नवीन शब्द

### Description

AI वापरून नोंदी आणि फोटोंपासून फ्लॅशकार्ड बनवा, परीक्षेची तयारी करा आणि नवीन शब्द शिका. तुमच्या उत्तरांनुसार उजळणीतील अंतर बदलते, त्यामुळे आणखी सराव हवा असलेल्या गोष्टींवर लक्ष देता येते.

- अवघडा विषय समजावून सांगायला किंवा कार्डवरील मजकूर स्पष्ट करायला AIला सांगा.
- कार्डांचे संच बनवा आणि हवे ते साहित्य शोधण्यासाठी टॅग लावा.
- काही मिनिटे मिळाली की सेव्ह केलेल्या कार्डांची ऑफलाइन उजळणी करा.
- तुमची उजळणी आणि सलग अभ्यास केलेले दिवस पाहा.

AI सुविधांसाठी इंटरनेट कनेक्शन आवश्यक आहे.

### Keywords

नोंदी,फोटो,उजळणी,भाषा,स्मरणशक्ती,अभ्यास,सराव

### What's New

- नवीन nibomo.com लिंक्स वापरून ॲप शेअर करा.
- ॲप आमच्या नवीन डोमेनवर गेले तरी अतिथी म्हणून तुमची कार्डे वापरता येतील.

## Norwegian

App Store locale: `no`

### Name

Nibomo: Læringskort med KI

### Subtitle

Øv til eksamen, lær nye ord

### Description

Gjør notater og bilder om til læringskort med KI for eksamensøving og ordforråd. Tiden mellom repetisjonene tilpasses svarene dine, slik at du kan øve på det du ennå ikke husker.

- Be KI forklare et vanskelig tema eller gjøre teksten på et kort tydeligere.
- Samle kort i kortstokker og legg til etiketter for å finne lærestoffet.
- Repeter lagrede kort uten nett når du har noen minutter til overs.
- Følg repetisjonene dine og se hvor mange dager på rad du har øvd.

KI-funksjoner krever internettilkobling.

### Keywords

notater,bilder,repetisjon,språk,ordforråd,hukommelse,læring,øving,kortstokker,etiketter

### What's New

- Del appen med de nye nibomo.com-lenkene.
- Behold tilgangen til kortene dine som gjest når appen flyttes til det nye domenet vårt.

## Dutch

App Store locale: `nl-NL`

### Name

Nibomo: AI-flashcards

### Subtitle

Voor toetsen en woordenschat

### Description

Maak met AI flashcards van notities en foto's om voor toetsen te leren en je woordenschat te oefenen. De tijd tussen herhalingen past zich aan je antwoorden aan, zodat je oefent wat je nog niet goed kent.

- Vraag AI om een lastig onderwerp uit te leggen of een kaart duidelijker te formuleren.
- Orden kaarten in stapels en voeg tags toe om je leerstof terug te vinden.
- Herhaal opgeslagen kaarten offline als je een paar minuten over hebt.
- Bekijk je herhalingen en het aantal dagen dat je achter elkaar hebt geleerd.

Voor AI-functies heb je een internetverbinding nodig.

### Keywords

notities,fotos,herhaling,talen,woordenschat,geheugen,leren,oefenen,stapels,tags

### What's New

- Deel de app via de nieuwe nibomo.com-links.
- Je behoudt als gast toegang tot je kaarten wanneer de app naar ons nieuwe domein verhuist.

## Punjabi

App Store locale: `pa-IN`

### Name

Nibomo: AI ਫਲੈਸ਼ਕਾਰਡ

### Subtitle

ਪ੍ਰੀਖਿਆ ਦੀ ਤਿਆਰੀ, ਨਵੇਂ ਸ਼ਬਦ

### Description

AI ਨਾਲ ਨੋਟਸ ਅਤੇ ਫੋਟੋਆਂ ਤੋਂ ਫਲੈਸ਼ਕਾਰਡ ਬਣਾਓ, ਪ੍ਰੀਖਿਆ ਦੀ ਤਿਆਰੀ ਕਰੋ ਅਤੇ ਨਵੇਂ ਸ਼ਬਦ ਸਿੱਖੋ। ਤੁਹਾਡੇ ਜਵਾਬਾਂ ਅਨੁਸਾਰ ਦੁਹਰਾਈ ਵਿਚਲਾ ਵਕਫ਼ਾ ਬਦਲਦਾ ਹੈ, ਤਾਂ ਜੋ ਤੁਸੀਂ ਉਨ੍ਹਾਂ ਗੱਲਾਂ 'ਤੇ ਧਿਆਨ ਦੇ ਸਕੋ ਜਿਨ੍ਹਾਂ ਲਈ ਹੋਰ ਅਭਿਆਸ ਚਾਹੀਦਾ ਹੈ।

- ਔਖਾ ਵਿਸ਼ਾ ਸਮਝਾਉਣ ਜਾਂ ਕਾਰਡ ਦੀ ਲਿਖਤ ਸਪਸ਼ਟ ਕਰਨ ਲਈ AI ਨੂੰ ਕਹੋ।
- ਕਾਰਡਾਂ ਨੂੰ ਸਮੂਹਾਂ ਵਿੱਚ ਰੱਖੋ ਅਤੇ ਲੋੜੀਂਦੀ ਸਮੱਗਰੀ ਲੱਭਣ ਲਈ ਟੈਗ ਲਾਓ।
- ਕੁਝ ਮਿੰਟ ਮਿਲਣ 'ਤੇ ਸੇਵ ਕੀਤੇ ਕਾਰਡਾਂ ਦੀ ਆਫ਼ਲਾਈਨ ਦੁਹਰਾਈ ਕਰੋ।
- ਆਪਣੀ ਦੁਹਰਾਈ ਅਤੇ ਲਗਾਤਾਰ ਪੜ੍ਹਾਈ ਕੀਤੇ ਦਿਨ ਦੇਖੋ।

AI ਸਹੂਲਤਾਂ ਲਈ ਇੰਟਰਨੈੱਟ ਕਨੈਕਸ਼ਨ ਚਾਹੀਦਾ ਹੈ।

### Keywords

ਨੋਟਸ,ਫੋਟੋ,ਦੁਹਰਾਈ,ਭਾਸ਼ਾ,ਯਾਦਦਾਸ਼ਤ,ਪੜ੍ਹਾਈ,ਅਭਿਆਸ

### What's New

- ਨਵੇਂ nibomo.com ਲਿੰਕਾਂ ਰਾਹੀਂ ਐਪ ਸਾਂਝੀ ਕਰੋ।
- ਐਪ ਸਾਡੇ ਨਵੇਂ ਡੋਮੇਨ ’ਤੇ ਜਾਣ ਤੋਂ ਬਾਅਦ ਵੀ ਮਹਿਮਾਨ ਵਜੋਂ ਆਪਣੇ ਕਾਰਡ ਵਰਤ ਸਕੋਗੇ।

## Polish

App Store locale: `pl`

### Name

Nibomo: Fiszki z AI

### Subtitle

Na egzaminy i nowe słówka

### Description

Zamień notatki i zdjęcia w fiszki z pomocą AI, by przygotować się do egzaminów i uczyć słówek. Odstępy między powtórkami dopasowują się do Twoich odpowiedzi, aby pomóc Ci ćwiczyć to, co wymaga utrwalenia.

- Poproś AI o wyjaśnienie trudnego tematu lub poprawienie treści fiszki.
- Grupuj fiszki w talie i dodawaj tagi, żeby znaleźć potrzebny materiał.
- Powtarzaj zapisane fiszki offline, gdy masz kilka wolnych minut.
- Śledź swoje powtórki i serie kolejnych dni nauki.

Funkcje AI wymagają połączenia z internetem.

### Keywords

notatki,zdjęcia,powtórki,języki,pamięć,nauka,ćwiczenia,talie,tagi

### What's New

- Udostępniaj aplikację za pomocą nowych linków nibomo.com.
- Zachowasz dostęp do swoich fiszek jako gość, gdy aplikacja przejdzie na naszą nową domenę.

## Romanian

App Store locale: `ro`

### Name

Nibomo: Fișe cu AI

### Subtitle

Pentru examene și cuvinte noi

### Description

Transformă notițele și fotografiile în fișe de studiu cu AI pentru pregătirea examenelor și exersarea vocabularului. Intervalele de recapitulare se adaptează răspunsurilor tale, ca să te concentrezi pe ce mai ai de fixat.

- Cere-i AI-ului să explice un subiect dificil sau să îmbunătățească textul unei fișe.
- Organizează fișele în seturi și adaugă etichete ca să găsești materialul dorit.
- Recapitulează fișele salvate fără internet când ai câteva minute libere.
- Urmărește recapitulările și seriile de zile consecutive de studiu.

Funcțiile AI necesită conexiune la internet.

### Keywords

notițe,fotografii,recapitulare,repetiție,spațiată,limbi,vocabular,memorie,studiu,exersare

### What's New

- Distribuie aplicația prin noile linkuri nibomo.com.
- Îți păstrezi accesul la carduri ca vizitator când aplicația trece pe noul nostru domeniu.

## Slovak

App Store locale: `sk`

### Name

Nibomo: AI kartičky

### Subtitle

Príprava na skúšky aj slovíčka

### Description

Premeňte poznámky a fotky na kartičky pomocou AI na prípravu na skúšky aj učenie slovíčok. Intervaly opakovania sa prispôsobujú vašim odpovediam, aby ste si precvičovali to, čo si ešte potrebujete zapamätať.

- Požiadajte AI o vysvetlenie náročnej témy alebo zlepšenie textu kartičky.
- Usporiadajte kartičky do balíčkov a pridajte štítky na jednoduchšie hľadanie učiva.
- Opakujte si uložené kartičky offline, keď máte pár voľných minút.
- Sledujte svoje opakovania a počet dní, keď sa učíte bez prestávky.

Funkcie AI vyžadujú pripojenie na internet.

### Keywords

poznámky,fotky,opakovanie,jazyky,pamäť,učenie,precvičovanie,balíčky,štítky

### What's New

- Zdieľajte aplikáciu pomocou nových odkazov na nibomo.com.
- Pri prechode aplikácie na našu novú doménu si zachováte prístup k svojim kartičkám ako hosť.

## Slovenian

App Store locale: `sl-SI`

### Name

Nibomo: Učne kartice z UI

### Subtitle

Za izpite in nove besede

### Description

Z AI spremenite zapiske in fotografije v učne kartice za pripravo na izpite in učenje besedišča. Razmiki med ponovitvami se prilagajajo vašim odgovorom, da lahko vadite predvsem tisto, kar še utrjujete.

- Prosite AI za razlago težke teme ali jasnejše besedilo kartice.
- Uredite kartice v zbirke in dodajte oznake za lažje iskanje učnega gradiva.
- Ponavljajte shranjene kartice brez povezave, ko imate nekaj prostih minut.
- Spremljajte ponovitve in zaporedne dni učenja.

Funkcije AI potrebujejo internetno povezavo.

### Keywords

zapiski,fotografije,ponavljanje,jeziki,besedišče,spomin,učenje,vaja,zbirke,oznake

### What's New

- Delite aplikacijo z novimi povezavami nibomo.com.
- Ko aplikacija preide na našo novo domeno, kot gost ohranite dostop do svojih kartic.

## Swedish

App Store locale: `sv`

### Name

Nibomo: Pluggkort med AI

### Subtitle

Plugga till prov, lär dig ord

### Description

Gör anteckningar och foton till flashcards med AI inför prov och för att öva ord. Tiden mellan repetitionerna anpassas efter dina svar, så att du kan öva på det du inte kan än.

- Be AI förklara ett svårt ämne eller göra texten på ett kort tydligare.
- Samla kort i kortlekar och lägg till taggar för att hitta det du vill öva.
- Repetera sparade kort offline när du har några minuter över.
- Följ dina repetitioner och se hur många dagar i rad du har pluggat.

AI-funktioner kräver internetanslutning.

### Keywords

anteckningar,foton,repetition,språk,ordförråd,minne,lärande,övning,kortlekar,taggar

### What's New

- Dela appen med de nya nibomo.com-länkarna.
- Behåll åtkomsten till dina kort som gäst när appen flyttar till vår nya domän.

## Tamil

App Store locale: `ta-IN`

### Name

Nibomo: AI கற்றல் அட்டைகள்

### Subtitle

தேர்வுத் தயாரிப்பு, சொற்கள்

### Description

குறிப்புகளையும் புகைப்படங்களையும் AI மூலம் கற்றல் அட்டைகளாக மாற்றித் தேர்வுக்குத் தயாராகுங்கள், புதிய சொற்களைக் கற்றுக்கொள்ளுங்கள். உங்கள் பதில்களுக்கு ஏற்ப மீள்பார்வை இடைவெளி மாறுவதால், மேலும் பயிற்சி தேவைப்படும் பகுதிகளில் கவனம் செலுத்தலாம்.

- கடினமான தலைப்பை விளக்கவோ அட்டையின் வாசகத்தைத் தெளிவாக்கவோ AIயிடம் கேளுங்கள்.
- அட்டைகளைத் தொகுப்புகளாக ஒழுங்குபடுத்தி, தேவையானவற்றைக் கண்டறியக் குறிச்சொற்களைச் சேருங்கள்.
- சில நிமிடங்கள் கிடைக்கும்போது சேமித்த அட்டைகளை இணையமின்றி மீள்பார்வையிடுங்கள்.
- உங்கள் மீள்பார்வைகளையும் தொடர்ந்து படித்த நாட்களையும் பாருங்கள்.

AI வசதிகளுக்கு இணைய இணைப்பு தேவை.

### Keywords

குறிப்பு,படம்,மீள்பார்வை,மொழி,நினைவு,படிப்பு,பயிற்சி

### What's New

- புதிய nibomo.com இணைப்புகளுடன் செயலியைப் பகிருங்கள்.
- செயலி எங்களின் புதிய டொமைனுக்கு மாறும்போதும் விருந்தினராக உங்கள் அட்டைகளைத் தொடர்ந்து அணுகலாம்.

## Telugu

App Store locale: `te-IN`

### Name

Nibomo: AI అభ్యాస కార్డులు

### Subtitle

పరీక్షలకు సిద్ధం, కొత్త పదాలు

### Description

AIతో నోట్స్, ఫోటోల నుంచి అభ్యాస కార్డులు తయారు చేసి, పరీక్షలకు సిద్ధమవండి, కొత్త పదాలు నేర్చుకోండి. మీ జవాబులను బట్టి పునశ్చరణ మధ్య విరామం మారుతుంది, కాబట్టి ఇంకా అభ్యాసం అవసరమైన విషయాలపై దృష్టి పెట్టవచ్చు.

- కష్టమైన విషయం వివరించమని లేదా కార్డులోని వాక్యాలను స్పష్టంగా మార్చమని AIని అడగండి.
- కార్డులను సమూహాలుగా అమర్చి, కావలసిన విషయాలు కనుగొనడానికి ట్యాగ్‌లు జోడించండి.
- కొన్ని నిమిషాలు దొరికినప్పుడు సేవ్ చేసిన కార్డులను ఆఫ్‌లైన్‌లో పునశ్చరణ చేయండి.
- మీ పునశ్చరణలను, వరుసగా చదివిన రోజులను చూడండి.

AI సౌకర్యాలకు ఇంటర్నెట్ కనెక్షన్ అవసరం.

### Keywords

నోట్స్,ఫోటో,పునశ్చరణ,భాష,జ్ఞాపకం,చదువు,అభ్యాసం

### What's New

- కొత్త nibomo.com లింక్‌లతో యాప్‌ను షేర్ చేయండి.
- యాప్ మా కొత్త డొమైన్‌కు మారినప్పటికీ అతిథిగా మీ కార్డ్‌లను ఉపయోగించవచ్చు.

## Thai

App Store locale: `th`

### Name

Nibomo: แฟลชการ์ด AI

### Subtitle

เตรียมสอบและเรียนรู้คำศัพท์

### Description

เปลี่ยนโน้ตและภาพถ่ายเป็นแฟลชการ์ดด้วย AI เพื่อเตรียมสอบและฝึกคำศัพท์ ช่วงเวลาทบทวนจะปรับตามคำตอบของคุณ เพื่อให้คุณฝึกเนื้อหาที่ยังจำไม่แม่นได้มากขึ้น

- ขอให้ AI อธิบายหัวข้อยากหรือปรับข้อความบนการ์ดให้ชัดเจน
- จัดการ์ดเป็นสำรับและเพิ่มแท็กเพื่อค้นหาเนื้อหาที่ต้องการเรียน
- ทบทวนการ์ดที่บันทึกไว้ออฟไลน์เมื่อมีเวลาว่างไม่กี่นาที
- ดูประวัติการทบทวนและจำนวนวันที่เรียนต่อเนื่องเพื่อติดตามนิสัยการเรียน

ฟีเจอร์ AI ต้องเชื่อมต่ออินเทอร์เน็ต

### Keywords

โน้ต,ภาพถ่าย,ทบทวน,เว้นระยะ,ภาษา,ความจำ,เรียน,ฝึก

### What's New

- แชร์แอปด้วยลิงก์ nibomo.com ใหม่
- ยังเข้าถึงบัตรคำในฐานะผู้เยี่ยมชมได้เมื่อแอปย้ายไปใช้โดเมนใหม่ของเรา

## Turkish

App Store locale: `tr`

### Name

Nibomo: AI Bilgi Kartları

### Subtitle

Sınava hazırlan, kelime öğren

### Description

Notları ve fotoğrafları yapay zekâyla bilgi kartlarına dönüştürerek sınavlara hazırlan ve kelime çalış. Tekrar aralıkları yanıtlarına göre ayarlanır; böylece henüz öğrenemediğin konulara odaklanabilirsin.

- Yapay zekâdan zor bir konuyu açıklamasını veya kartın metnini netleştirmesini iste.
- Kartları destelere ayır ve çalışmak istediğin içeriği bulmak için etiket ekle.
- Birkaç boş dakikanda kayıtlı kartları çevrimdışı tekrar et.
- Tekrarlarını ve arka arkaya çalıştığın günleri takip et.

Yapay zekâ özellikleri internet bağlantısı gerektirir.

### Keywords

not,fotoğraf,aralıklı,tekrar,dil,hafıza,çalışma,alıştırma,deste,etiket

### What's New

- Uygulamayı yeni nibomo.com bağlantılarıyla paylaşın.
- Uygulama yeni alan adımıza geçtiğinde misafir olarak kartlarınıza erişiminiz korunur.

## Ukrainian

App Store locale: `uk`

### Name

Nibomo: Картки з ШІ

### Subtitle

До іспитів і нових слів

### Description

Перетворюйте нотатки й фото на навчальні картки з ШІ для підготовки до іспитів і вивчення слів. Інтервали повторення підлаштовуються під ваші відповіді, щоб ви більше практикували те, що ще потрібно закріпити.

- Просіть ШІ пояснити складну тему або уточнити формулювання картки.
- Збирайте картки в колоди й додавайте теги, щоб знаходити потрібний матеріал.
- Повторюйте збережені картки без інтернету, коли маєте кілька вільних хвилин.
- Стежте за повтореннями й серіями днів навчання.

Для функцій ШІ потрібен інтернет.

### Keywords

нотатки,фото,повторення,інтервали,мови,пам'ять,навчання,практика,колоди,теги

### What's New

- Діліться застосунком за новими посиланнями nibomo.com.
- Збережіть гостьовий доступ до своїх карток, коли застосунок перейде на наш новий домен.

## Urdu

App Store locale: `ur-PK`

### Name

Nibomo: AI فلیش کارڈز

### Subtitle

امتحان کی تیاری، نئے الفاظ

### Description

AI سے نوٹس اور تصاویر کو فلیش کارڈز میں بدلیں، امتحانات کی تیاری کریں اور نئے الفاظ سیکھیں۔ دہرائی کا وقفہ آپ کے جوابوں کے مطابق بدلتا ہے تاکہ آپ ان باتوں پر توجہ دے سکیں جن کی مزید مشق چاہیے۔

- مشکل موضوع سمجھانے یا کارڈ کی عبارت واضح کرنے کے لیے AI سے کہیں۔
- کارڈز کو مجموعوں میں ترتیب دیں اور مطلوبہ مواد تلاش کرنے کے لیے ٹیگز لگائیں۔
- چند منٹ ملیں تو محفوظ کارڈز کی آف لائن دہرائی کریں۔
- اپنی دہرائی اور مسلسل پڑھائی والے دن دیکھیں۔

AI کی سہولتوں کے لیے انٹرنیٹ کنکشن ضروری ہے۔

### Keywords

نوٹس,تصویر,دہرائی,زبان,یادداشت,پڑھائی,مشق

### What's New

- نئے nibomo.com لنکس کے ذریعے ایپ شیئر کریں۔
- ایپ ہمارے نئے ڈومین پر منتقل ہونے کے بعد بھی بطور مہمان اپنے کارڈز تک رسائی برقرار رکھیں۔

## Vietnamese

App Store locale: `vi`

### Name

Nibomo: Thẻ học AI

### Subtitle

Ôn thi, học thêm từ vựng

### Description

Biến ghi chú và ảnh thành thẻ học bằng AI để ôn thi và luyện từ vựng. Khoảng cách giữa các lần ôn thay đổi theo câu trả lời, giúp bạn tập trung vào những phần còn cần luyện thêm.

- Nhờ AI giải thích chủ đề khó hoặc viết lại nội dung thẻ cho rõ hơn.
- Sắp xếp thẻ thành bộ và thêm nhãn để tìm nội dung cần học.
- Ôn thẻ đã lưu khi không có mạng, bất cứ lúc nào bạn có vài phút rảnh.
- Theo dõi các lần ôn và chuỗi ngày học liên tiếp của bạn.

Các tính năng AI cần kết nối internet.

### Keywords

ghi chú,ảnh,ôn tập,ngắt quãng,ngoại ngữ,trí nhớ,học tập,luyện tập,bộ thẻ,nhãn

### What's New

- Chia sẻ ứng dụng bằng các liên kết nibomo.com mới.
- Bạn vẫn có thể truy cập thẻ ở chế độ khách khi ứng dụng chuyển sang tên miền mới của chúng tôi.
