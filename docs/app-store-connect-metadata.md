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
both capture scripts and Swift catalogs described in
[iOS marketing screenshots](../apps/ios/docs/marketing-screenshots.md#files-involved).

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

## English (U.S.)

### Name

Nibomo: AI Flashcards

### Subtitle

Turn notes into study cards

### Description

Create AI flashcards from notes, then review them with spaced repetition for exams, languages, and serious daily study.

Nibomo was previously called Flashcards Open Source App.

Use it for:
- exam prep and coursework
- language learning and vocabulary building
- medical, technical, and other high-memorization study
- AI-assisted card improvement and study planning
- fast daily review with decks, tags, and spaced repetition

Create cards in seconds, organize your study system with decks and tags, and review on a focused schedule that helps you retain more with less busywork.

AI is part of the study flow. Use it to sharpen card wording, unpack difficult topics, and decide what to study next without leaving your flashcards.

For learners who care about transparency, the app is open source, and the full stack can be self-hosted. Support, privacy policy, and terms are available inside the app.

All code for the app, backend, and infrastructure is open and available on GitHub:
https://github.com/kirill-markin/flashcards-open-source-app

### Keywords

open,source,spaced,repetition,vocab,language,exam,prep,medical,memorize,fsrs,decks,tags

### What's New

- Nibomo's interface now supports 49 languages.
- Sign-in pages are now available in the same languages.

## Arabic

### Name

Nibomo: بطاقات ذكاء اصطناعي

### Subtitle

من ملاحظاتك إلى كروت مذاكرة

### Description

حوّل ملاحظاتك إلى بطاقات مراجعة بالذكاء الاصطناعي، ثم راجعها بالتكرار المتباعد للاختبارات واللغات والدراسة الجادة اليومية.

كان اسم Nibomo سابقا بطاقات تعليم مفتوحة المصدر.

استخدمه من أجل:
- التحضير للاختبارات والدراسة الجامعية
- تعلم اللغات وبناء المفردات
- دراسة الطب والمواد التقنية وغيرها من المواد التي تحتاج إلى حفظ مكثف
- تحسين البطاقات والتخطيط للدراسة بمساعدة الذكاء الاصطناعي
- مراجعة يومية سريعة باستخدام المجموعات والوسوم والتكرار المتباعد

أنشئ البطاقات وعدلها بسرعة، ونظّم دراستك عبر المجموعات والوسوم، وراجع وفق جدول مركّز يساعدك على التذكر أكثر وتضييع وقت أقل.

الذكاء الاصطناعي حاضر داخل تجربة المذاكرة نفسها. استخدمه لاستكشاف المادة، وصقل محتوى البطاقات، وفهم النقاط الصعبة، وترتيب ما ستذاكره لاحقا من داخل بطاقاتك.

للمتعلمين الذين يهتمون بالشفافية، التطبيق مفتوح المصدر، ويمكن استضافة البنية الكاملة ذاتيا. الدعم وسياسة الخصوصية والشروط متاحة داخل التطبيق.

جميع شيفرات التطبيق والخلفية والبنية التحتية متاحة بشكل مفتوح على GitHub:
https://github.com/kirill-markin/flashcards-open-source-app

### Keywords

مفتوح,المصدر,تكرار,متباعد,مفردات,لغات,اختبارات,طب,حفظ

### What's New

- أصبحت واجهة Nibomo تدعم 49 لغة.
- تتوفر صفحات تسجيل الدخول الآن باللغات نفسها.

## Chinese (Simplified)

### Name

Nibomo: AI 闪卡

### Subtitle

把笔记变成学习卡片

### Description

用 AI 把笔记生成闪卡，再用间隔重复复习，适合备考、语言学习和认真坚持的日常学习。

Nibomo 以前叫开源闪卡。

适合用来：
- 备考和课程复习
- 语言学习和词汇积累
- 医学、技术等需要大量记忆的学习内容
- 用 AI 优化卡片并规划学习节奏
- 通过牌组、标签和间隔重复进行高效日常复习

你可以快速创建和编辑卡片，用牌组和标签搭建自己的学习系统，再按清晰的复习节奏记住更多内容、减少无效重复。

AI 已经融入整个学习流程。你可以直接围绕卡片梳理知识、改写内容、拆解难点，并安排下一步学习。

如果你重视透明度，这也是一个开源项目，整套应用、后端和基础设施都可自托管。支持、隐私政策和条款可在应用内查看。

应用、后端和基础设施的全部代码都已在 GitHub 开放：
https://github.com/kirill-markin/flashcards-open-source-app

### Keywords

开源,间隔,重复,词汇,语言,考试,备考,医学,卡组,标签,记忆,复习

### What's New

- Nibomo 界面现已支持 49 种语言。
- 登录页面也支持这些语言。

## French

### Name

Nibomo : Flashcards IA

### Subtitle

Notes en fiches de révision

### Description

Créez des fiches de révision avec l'IA à partir de vos notes, puis révisez-les en répétition espacée pour vos examens, vos langues et votre travail quotidien.

Nibomo s'appelait avant Flashcards open source.

À utiliser pour :
- préparer vos examens, du brevet au bac et aux études supérieures
- apprendre une langue et enrichir votre vocabulaire
- réviser la médecine, les matières techniques et tout ce qui demande beaucoup de mémorisation
- améliorer vos cartes et planifier vos révisions avec l'IA
- réviser vite chaque jour avec des paquets, des étiquettes et la répétition espacée

Créez et modifiez vos cartes en quelques secondes, organisez vos révisions avec des paquets et des étiquettes, et suivez un planning clair qui vous fait retenir plus en perdant moins de temps.

L'IA fait partie de la révision elle-même. Servez-vous-en pour explorer un sujet, reformuler vos cartes, démêler les points difficiles et décider quoi réviser ensuite, sans quitter vos fiches.

Pour les personnes qui tiennent à la transparence, l'application reste open source et toute la pile technique peut être hébergée par vos soins. L'assistance, la politique de confidentialité et les conditions d'utilisation sont disponibles dans l'application.

Tout le code de l'application, du backend et de l'infrastructure est ouvert et disponible sur GitHub :
https://github.com/kirill-markin/flashcards-open-source-app

### Keywords

open,source,cartes,mémo,répétition,espacée,bac,brevet,médecine,vocabulaire,anglais,étudiant,quiz

### What's New

- L'interface de Nibomo est désormais disponible en 49 langues.
- Les pages de connexion sont aussi disponibles dans ces langues.

## German

### Name

Nibomo: KI-Karteikarten

### Subtitle

Notizen zu Lernkarten

### Description

Erstelle aus Notizen KI-Karten und lerne sie mit Spaced Repetition für Prüfungen, Sprachen und ernsthaftes tägliches Lernen.

Nibomo hieß früher Open-Source-Karteikarten.

Nutze sie für:
- Prüfungsvorbereitung und Studium
- Sprachenlernen und Vokabeltraining
- Medizinische, technische und andere lernintensive Inhalte
- KI-gestützte Verbesserung deiner Karten und Studienplanung
- Schnelle tägliche Wiederholung mit Stapeln, Tags und Spaced Repetition

Erstelle und bearbeite Karten schnell, organisiere dein Lernsystem mit Stapeln und Tags und wiederhole nach einem klaren Plan, damit mehr hängen bleibt und weniger Leerlauf entsteht.

KI gehört zum Lernfluss. Nutze sie, um Inhalte zu durchdringen, Formulierungen auf Karten zu verbessern, schwierige Themen zu entwirren und direkt aus deinen Karteikarten die nächsten Lernschritte festzulegen.

Für Lernende, denen Transparenz wichtig ist, bleibt die App Open Source, und der komplette technische Stack kann selbst gehostet werden. Support, Datenschutzrichtlinie und Nutzungsbedingungen sind in der App verfügbar.

Der gesamte Code für App, Backend und Infrastruktur ist offen auf GitHub verfügbar:
https://github.com/kirill-markin/flashcards-open-source-app

### Keywords

open,source,lernen,spaced,repetition,vokabeln,sprachen,prüfungen,medizin,merken,decks,tags

### What's New

- Die Oberfläche von Nibomo unterstützt jetzt 49 Sprachen.
- Die Anmeldeseiten sind jetzt ebenfalls in diesen Sprachen verfügbar.

## Hindi

### Name

Nibomo: AI फ्लैशकार्ड

### Subtitle

नोट्स से स्टडी कार्ड बनाएं

### Description

AI से नोट्स को फ्लैशकार्ड में बदलें, फिर परीक्षा, भाषा सीखने और गंभीर रोज़ाना पढ़ाई के लिए स्पेस्ड रिपिटीशन से रिव्यू करें।

Nibomo को पहले ओपन सोर्स फ्लैशकार्ड कहा जाता था।

इसे इन कामों के लिए इस्तेमाल करें:
- परीक्षा की तैयारी और कोर्सवर्क
- भाषा सीखना और शब्दावली बढ़ाना
- मेडिकल, तकनीकी और दूसरी ऐसी पढ़ाई जिनमें बहुत याद रखना पड़ता है
- AI की मदद से कार्ड बेहतर बनाना और पढ़ाई की योजना करना
- डेक, टैग और स्पेस्ड रिपिटीशन के साथ तेज़ रोज़ाना रिव्यू

कार्ड जल्दी बनाएं और एडिट करें, डेक और टैग से अपनी पढ़ाई व्यवस्थित करें, और साफ रिव्यू शेड्यूल के साथ ज़्यादा याद रखें और कम समय बर्बाद करें।

AI पढ़ाई की प्रक्रिया का हिस्सा है। अपने फ्लैशकार्ड्स के भीतर ही सामग्री समझें, कार्ड बेहतर करें, मुश्किल विषय साफ करें, और आगे क्या पढ़ना है यह तय करें।

जो विद्यार्थी पारदर्शिता चाहते हैं, उनके लिए यह ऐप ओपन सोर्स है, और पूरा तकनीकी स्टैक स्वयं होस्ट किया जा सकता है। सपोर्ट, प्राइवेसी पॉलिसी और टर्म्स ऐप के अंदर उपलब्ध हैं।

ऐप, बैकएंड और इन्फ्रास्ट्रक्चर का पूरा कोड GitHub पर खुला उपलब्ध है:
https://github.com/kirill-markin/flashcards-open-source-app

### Keywords

ओपन,सोर्स,परीक्षा,spaced,repetition,vocab,medical,fsrs,decks,tags

### What's New

- Nibomo का इंटरफ़ेस अब 49 भाषाओं में उपलब्ध है।
- साइन-इन पेज भी अब इन्हीं भाषाओं में उपलब्ध हैं।

## Japanese

### Name

Nibomo: AI暗記カード

### Subtitle

ノートから学習カードを作成

### Description

AIでノートを暗記カードにし、試験対策、語学、本気の毎日の学習を間隔反復で復習できます。

Nibomo は以前「オープンソース暗記カード」という名前でした。

こんな用途に向いています:
- 試験対策や授業の復習
- 語学学習と語彙強化
- 医学、技術分野など大量の記憶が必要な学習
- AI を使ったカード改善と学習計画
- デッキ、タグ、間隔反復による毎日の効率的な復習

カードをすばやく作成・編集し、デッキやタグで学習内容を整理し、明確な復習スケジュールでより多くを無駄なく定着させられます。

AI は学習フローの中にあります。カードを離れずに内容を深掘りし、表現を整え、難しいテーマを整理し、次に何を学ぶかを決められます。

透明性を重視する学習者のために、このアプリはオープンソースで、アプリ、バックエンド、インフラを含むスタック全体をセルフホストすることもできます。サポート、プライバシーポリシー、利用規約はアプリ内で確認できます。

アプリ、バックエンド、インフラのすべてのコードは GitHub で公開されています:
https://github.com/kirill-markin/flashcards-open-source-app

### Keywords

オープンソース,勉強,間隔,反復,単語,語学,試験,医学,記憶,デッキ,タグ

### What's New

- Nibomo の画面表示が49言語に対応しました。
- ログインページも同じ言語に対応しました。

## Portuguese (Brazil)

### Name

Nibomo: Flashcards com IA

### Subtitle

Notas viram cartões de estudo

### Description

Transforme suas notas em flashcards com IA e revise com repetição espaçada para provas, idiomas e estudo diário sério.

O Nibomo se chamava antes Flashcards de código aberto.

Use para:
- estudar para o ENEM, vestibulares, concursos e a faculdade
- aprender idiomas e ampliar o vocabulário
- revisar medicina, matérias técnicas e tudo o que exige muita memorização
- melhorar seus cartões e planejar o estudo com ajuda da IA
- revisar rápido todo dia com baralhos, etiquetas e repetição espaçada

Crie e edite cartões em segundos, organize seu estudo com baralhos e etiquetas, e revise num cronograma claro que faz você reter mais e perder menos tempo com tarefas repetitivas.

A IA faz parte do estudo em si. Use para explorar o conteúdo, melhorar o texto dos cartões, destrinchar os pontos difíceis e decidir o que estudar depois, sem sair dos seus flashcards.

Para quem se importa com transparência, o app é de código aberto e toda a stack pode ser hospedada por você. Suporte, política de privacidade e termos estão dentro do app.

Todo o código do app, do backend e da infraestrutura está aberto e disponível no GitHub:
https://github.com/kirill-markin/flashcards-open-source-app

### Keywords

open,source,fichas,repetição,espaçada,enem,vestibular,concurso,oab,medicina,memorização,inglês

### What's New

- A interface do Nibomo agora está disponível em 49 idiomas.
- As páginas de login também estão disponíveis nesses idiomas.

## Russian

### Name

Nibomo: ИИ-флешкарты

### Subtitle

Из заметок — учебные карточки

### Description

Создавайте ИИ-флешкарты из заметок, а затем повторяйте их интервально для экзаменов, языков и ежедневной учебы.

Раньше Nibomo назывался «Флешкарты с открытым кодом».

Подходит для:
- подготовки к экзаменам и учебным курсам
- изучения языков и расширения словарного запаса
- медицины, технических дисциплин и других направлений, где нужно много запоминать
- улучшения карточек и планирования учебы с помощью ИИ
- быстрой ежедневной практики с колодами, тегами и интервальными повторениями

Быстро создавайте и редактируйте карточки, выстраивайте свою систему обучения с помощью колод и тегов и запоминайте больше без лишней рутины по понятному расписанию повторений.

ИИ встроен в сам процесс обучения. Используйте его, чтобы разбирать материал, улучшать формулировки карточек, прояснять сложные темы и понимать, что учить дальше, не выходя из своих флешкарт.

Для тех, кому важна прозрачность, приложение имеет открытый исходный код, и весь стек можно развернуть самостоятельно. Поддержка, политика конфиденциальности и условия доступны внутри приложения.

Весь код приложения, бэкенда и инфраструктуры открыт и доступен на GitHub:
https://github.com/kirill-markin/flashcards-open-source-app

### Keywords

открытый,код,повторение,языки,экзамены,медицина,fsrs

### What's New

- Интерфейс Nibomo теперь доступен на 49 языках.
- Страницы входа теперь поддерживают те же языки.

## Spanish (Mexico)

### Name

Nibomo: Flashcards con IA

### Subtitle

Convierte notas en tarjetas

### Description

Convierte notas en flashcards con IA y repásalas con repetición espaciada para exámenes, idiomas y estudio diario serio.

Nibomo se llamaba antes Flashcards de código abierto.

Úsala para:
- preparar exámenes y materias
- aprender idiomas y ampliar vocabulario
- estudiar medicina, temas técnicos y otros contenidos que exigen mucha memorización
- mejorar tus tarjetas y planear tu estudio con ayuda de IA
- hacer repasos diarios rápidos con mazos, etiquetas y repetición espaciada

Crea y edita tarjetas rápido, organiza tu sistema de estudio con mazos y etiquetas, y repasa con un calendario claro para retener más y perder menos tiempo en trabajo repetitivo.

La IA forma parte del flujo de estudio. Úsala para explorar tu material, pulir el contenido de tus tarjetas, aclarar temas difíciles y decidir qué estudiar después sin salir de tus tarjetas.

Para estudiantes que valoran la transparencia, la app es de código abierto y todo el stack puede alojarse por tu cuenta. El soporte, la política de privacidad y los términos están disponibles dentro de la app.

Todo el código de la app, el backend y la infraestructura está abierto y disponible en GitHub:
https://github.com/kirill-markin/flashcards-open-source-app

### Keywords

open,source,estudio,repetición,espaciada,vocabulario,idiomas,exámenes,medicina,mazos,etiquetas

### What's New

- La interfaz de Nibomo ahora está disponible en 49 idiomas.
- Las páginas de inicio de sesión también están disponibles en esos idiomas.

## Spanish (Spain)

### Name

Nibomo: Flashcards con IA

### Subtitle

Convierte notas en tarjetas

### Description

Convierte notas en flashcards con IA y repásalas con repetición espaciada para exámenes, idiomas y estudio diario serio.

Nibomo se llamaba antes Flashcards de código abierto.

Úsala para:
- preparar exámenes y asignaturas
- aprender idiomas y mejorar vocabulario
- estudiar medicina, temas técnicos y otros contenidos que exigen mucha memorización
- mejorar tus tarjetas y planificar el estudio con ayuda de IA
- hacer repasos diarios rápidos con mazos, etiquetas y repetición espaciada

Crea y edita tarjetas rápidamente, organiza tu sistema de estudio con mazos y etiquetas, y repasa con un calendario claro para retener más y perder menos tiempo en tareas repetitivas.

La IA forma parte del flujo de estudio. Úsala para explorar tu material, pulir el contenido de tus tarjetas, aclarar temas difíciles y decidir qué estudiar después sin salir de tus tarjetas.

Para estudiantes que valoran la transparencia, la app es de código abierto y todo el stack puede alojarse por tu cuenta. El soporte, la política de privacidad y los términos están disponibles dentro de la app.

Todo el código de la app, el backend y la infraestructura está abierto y disponible en GitHub:
https://github.com/kirill-markin/flashcards-open-source-app

### Keywords

open,source,estudio,repetición,espaciada,vocabulario,idiomas,exámenes,medicina,mazos,etiquetas

### What's New

- La interfaz de Nibomo ya está disponible en 49 idiomas.
- Las páginas de inicio de sesión también están disponibles en esos idiomas.

## Bangla

App Store locale: `bn-BD`

### Name

Nibomo: AI ফ্ল্যাশকার্ড

### Subtitle

নোট থেকে পড়ার কার্ড

### Description

AI দিয়ে নোট থেকে ফ্ল্যাশকার্ড তৈরি করুন। পরীক্ষা, ভাষা শেখা ও নিয়মিত পড়াশোনার জন্য বিরতি দিয়ে বারবার কার্ডগুলো ঝালিয়ে নিন।

Nibomo-এর আগের নাম ছিল Flashcards Open Source App।

যেসব কাজে ব্যবহার করতে পারেন:
- পরীক্ষার প্রস্তুতি ও কোর্সের পড়াশোনা
- ভাষা শেখা ও শব্দভান্ডার বাড়ানো
- চিকিৎসা, প্রযুক্তি ও অনেক কিছু মনে রাখতে হয় এমন বিষয়ের পড়াশোনা
- AI-এর সাহায্যে কার্ডের মান উন্নত করা ও পড়ার পরিকল্পনা
- ডেক, ট্যাগ ও বিরতি দিয়ে পুনরাবৃত্তির মাধ্যমে প্রতিদিন দ্রুত ঝালিয়ে নেওয়া

কয়েক সেকেন্ডে কার্ড তৈরি করুন, ডেক ও ট্যাগ দিয়ে পড়ার বিষয় গুছিয়ে রাখুন এবং নির্দিষ্ট সময়সূচিতে ঝালিয়ে নিন। এতে অপ্রয়োজনীয় কাজ কমিয়ে আরও বেশি মনে রাখতে পারবেন।

পড়াশোনার মধ্যেই AI ব্যবহার করুন। কার্ড ছেড়ে বের না হয়েই লেখার ভাষা স্পষ্ট করুন, কঠিন বিষয় বুঝুন এবং এরপর কী পড়বেন তা ঠিক করুন।

স্বচ্ছতা যাঁদের কাছে গুরুত্বপূর্ণ, তাঁদের জন্য অ্যাপটি ওপেন সোর্স। পুরো ব্যবস্থাটি নিজের সার্ভারেও চালানো যায়। সহায়তা, গোপনীয়তা নীতি ও শর্তাবলি অ্যাপের ভেতরেই পাওয়া যায়।

অ্যাপ, ব্যাকএন্ড ও অবকাঠামোর সব কোড GitHub-এ উন্মুক্ত:
https://github.com/kirill-markin/flashcards-open-source-app

### Keywords

পড়াশোনা,পরীক্ষা,ভাষা,শব্দ

### What's New

- Nibomo-এর ইন্টারফেস এখন 49টি ভাষায় ব্যবহার করা যায়।
- সাইন-ইন পৃষ্ঠাগুলোও এখন একই ভাষাগুলোতে ব্যবহার করা যায়।

## Catalan

App Store locale: `ca`

### Name

Nibomo: Targetes amb IA

### Subtitle

De notes a fitxes d'estudi

### Description

Crea targetes d'estudi amb IA a partir dels teus apunts i repassa-les amb repetició espaiada per preparar exàmens, aprendre idiomes i estudiar cada dia.

Nibomo abans es deia Flashcards Open Source App.

Fes-lo servir per:
- preparar exàmens i estudiar les assignatures
- aprendre idiomes i ampliar el vocabulari
- estudiar medicina, matèries tècniques i altres continguts que cal memoritzar
- millorar les targetes i planificar l'estudi amb ajuda de la IA
- fer repassos diaris ràpids amb baralles, etiquetes i repetició espaiada

Crea targetes en segons, organitza l'estudi amb baralles i etiquetes i segueix un calendari de repàs que t'ajudi a retenir més amb menys feina repetitiva.

La IA forma part de l'estudi. Fes-la servir per afinar el text de les targetes, entendre temes difícils i decidir què estudiar després sense sortir de les teves fitxes.

Si valores la transparència, l'aplicació és de codi obert i pots allotjar tot el sistema pel teu compte. L'ajuda, la política de privadesa i les condicions estan disponibles dins de l'aplicació.

Tot el codi de l'aplicació, del backend i de la infraestructura és obert i està disponible a GitHub:
https://github.com/kirill-markin/flashcards-open-source-app

### Keywords

memòria,repetició,espaiada,vocabulari,idiomes,exàmens,medicina,baralles,etiquetes,codi,obert

### What's New

- La interfície de Nibomo ja està disponible en 49 idiomes.
- Les pàgines d'inici de sessió també estan disponibles en aquests idiomes.

## Czech

App Store locale: `cs`

### Name

Nibomo: AI kartičky

### Subtitle

Z poznámek studijní kartičky

### Description

Vytvářejte z poznámek kartičky pomocí AI a opakujte si je v rozložených intervalech při přípravě na zkoušky, učení jazyků i každodenním studiu.

Nibomo se dříve jmenovalo Flashcards Open Source App.

Využijte ho pro:
- přípravu na zkoušky a studium do školy
- učení jazyků a rozšiřování slovní zásoby
- studium medicíny, technických oborů a dalších témat náročných na paměť
- vylepšování kartiček a plánování studia s pomocí AI
- rychlé každodenní opakování s balíčky, štítky a rozloženým opakováním

Vytvořte kartičky během několika sekund, uspořádejte studium pomocí balíčků a štítků a opakujte podle plánu, který vám pomůže zapamatovat si více s menším množstvím rutinní práce.

AI je součástí studia. Zpřesněte formulace na kartičkách, pochopte obtížná témata a rozhodněte se, co studovat dál, přímo u svých kartiček.

Aplikace má otevřený zdrojový kód pro všechny, kterým záleží na transparentnosti. Celý systém můžete provozovat na vlastním serveru. Podporu, zásady ochrany soukromí a podmínky najdete v aplikaci.

Veškerý kód aplikace, backendu i infrastruktury je otevřený a dostupný na GitHubu:
https://github.com/kirill-markin/flashcards-open-source-app

### Keywords

učení,opakování,slovíčka,jazyky,zkoušky,medicína,paměť,balíčky,štítky,fsrs

### What's New

- Rozhraní Nibomo je nyní dostupné ve 49 jazycích.
- Přihlašovací stránky jsou nyní dostupné ve stejných jazycích.

## Danish

App Store locale: `da`

### Name

Nibomo: AI-læringskort

### Subtitle

Lav noter om til læringskort

### Description

Lav læringskort fra dine noter med AI, og gennemgå dem med repetition med mellemrum til eksamener, sprogindlæring og daglige studier.

Nibomo hed tidligere Flashcards Open Source App.

Brug appen til:
- eksamensforberedelse og skolearbejde
- sprogindlæring og et større ordforråd
- medicin, tekniske fag og andet stof, der kræver meget udenadslære
- at forbedre kort og planlægge studier med AI
- hurtig daglig repetition med kortsæt, tags og gentagelser med mellemrum

Lav kort på få sekunder, organisér dine studier med kortsæt og tags, og følg en plan for repetition, der hjælper dig med at huske mere med mindre rutinearbejde.

AI indgår i selve studieforløbet. Brug den til at præcisere kortenes tekst, forstå svære emner og vælge, hvad du skal studere som det næste, direkte i dine læringskort.

Appen er open source for dig, der værdsætter gennemsigtighed, og du kan hoste hele systemet selv. Hjælp, privatlivspolitik og vilkår findes i appen.

Al kode til appen, backend og infrastrukturen er åben og tilgængelig på GitHub:
https://github.com/kirill-markin/flashcards-open-source-app

### Keywords

repetition,ordforråd,sprog,eksamen,medicin,hukommelse,kortsæt,tags,open,source,fsrs

### What's New

- Nibomos brugerflade er nu tilgængelig på 49 sprog.
- Loginsiderne er nu også tilgængelige på de samme sprog.

## Greek

App Store locale: `el`

### Name

Nibomo: Κάρτες με AI

### Subtitle

Από σημειώσεις σε κάρτες

### Description

Δημιουργήστε κάρτες μελέτης από σημειώσεις με AI και επαναλάβετε την ύλη σε τακτά διαστήματα για εξετάσεις, γλώσσες και καθημερινή μελέτη.

Το Nibomo ονομαζόταν παλαιότερα Flashcards Open Source App.

Χρησιμοποιήστε το για:
- προετοιμασία για εξετάσεις και μελέτη μαθημάτων
- εκμάθηση γλωσσών και εμπλουτισμό λεξιλογίου
- ιατρικά, τεχνικά και άλλα θέματα που απαιτούν πολλή απομνημόνευση
- βελτίωση καρτών και προγραμματισμό μελέτης με AI
- γρήγορη καθημερινή επανάληψη με τράπουλες, ετικέτες και επαναλήψεις σε διαστήματα

Δημιουργήστε κάρτες σε δευτερόλεπτα, οργανώστε τη μελέτη σας με τράπουλες και ετικέτες και ακολουθήστε ένα πρόγραμμα επανάληψης που σας βοηθά να θυμάστε περισσότερα με λιγότερη περιττή δουλειά.

Το AI είναι μέρος της μελέτης. Χρησιμοποιήστε το για να βελτιώσετε τη διατύπωση των καρτών, να κατανοήσετε δύσκολα θέματα και να αποφασίσετε τι θα μελετήσετε στη συνέχεια, μέσα από τις κάρτες σας.

Για όσους εκτιμούν τη διαφάνεια, η εφαρμογή έχει ανοιχτό κώδικα και ολόκληρο το σύστημα μπορεί να φιλοξενηθεί σε δικό σας διακομιστή. Η υποστήριξη, η πολιτική απορρήτου και οι όροι βρίσκονται στην εφαρμογή.

Όλος ο κώδικας της εφαρμογής, του backend και της υποδομής είναι ανοιχτός και διαθέσιμος στο GitHub:
https://github.com/kirill-markin/flashcards-open-source-app

### Keywords

επανάληψη,λεξιλόγιο,γλώσσες,εξετάσεις,μνήμη,μελέτη

### What's New

- Το περιβάλλον του Nibomo είναι πλέον διαθέσιμο σε 49 γλώσσες.
- Οι σελίδες σύνδεσης είναι πλέον διαθέσιμες στις ίδιες γλώσσες.

## Finnish

App Store locale: `fi`

### Name

Nibomo: Tekoälymuistikortit

### Subtitle

Muistiinpanoista korteiksi

### Description

Luo muistiinpanoista muistikortteja tekoälyllä ja kertaa niitä aikavälikertauksella kokeita, kielten oppimista ja päivittäistä opiskelua varten.

Nibomon aiempi nimi oli Flashcards Open Source App.

Käytä sitä:
- kokeisiin valmistautumiseen ja kurssiopiskeluun
- kielten oppimiseen ja sanavaraston laajentamiseen
- lääketieteen, tekniikan ja muiden paljon muistamista vaativien aiheiden opiskeluun
- korttien parantamiseen ja opiskelun suunnitteluun tekoälyn avulla
- nopeaan päivittäiseen kertaukseen pakkojen, tunnisteiden ja aikavälikertauksen avulla

Luo kortteja sekunneissa, järjestä opiskelusi pakoilla ja tunnisteilla ja kertaa selkeän aikataulun mukaan. Näin muistat enemmän ja käytät vähemmän aikaa rutiinityöhön.

Tekoäly on osa opiskelua. Tarkenna korttien sanamuotoja, selvitä vaikeita aiheita ja päätä, mitä opiskelet seuraavaksi, suoraan muistikorttiesi äärellä.

Sovellus on avointa lähdekoodia läpinäkyvyyttä arvostaville, ja voit ylläpitää koko järjestelmää itse. Tuki, tietosuojakäytäntö ja käyttöehdot löytyvät sovelluksesta.

Sovelluksen, taustapalvelun ja infrastruktuurin koko lähdekoodi on avoimesti saatavilla GitHubissa:
https://github.com/kirill-markin/flashcards-open-source-app

### Keywords

kertaus,sanasto,kielet,koe,opiskelu,lääketiede,muisti,pakat,tunnisteet,avoin,lähdekoodi

### What's New

- Nibomon käyttöliittymä on nyt saatavilla 49 kielellä.
- Myös kirjautumissivut ovat nyt saatavilla samoilla kielillä.

## Gujarati

App Store locale: `gu-IN`

### Name

Nibomo: AI ફ્લૅશકાર્ડ

### Subtitle

નોંધમાંથી અભ્યાસ કાર્ડ

### Description

AI વડે નોંધમાંથી ફ્લૅશકાર્ડ બનાવો. પરીક્ષા, ભાષા શીખવા અને રોજના અભ્યાસ માટે સમયાંતરે તેનું પુનરાવર્તન કરો.

Nibomoનું અગાઉનું નામ Flashcards Open Source App હતું.

આ કામો માટે વાપરો:
- પરીક્ષાની તૈયારી અને અભ્યાસક્રમનું કામ
- ભાષા શીખવી અને શબ્દભંડોળ વધારવું
- તબીબી, તકનીકી અને ઘણું યાદ રાખવું પડે એવા વિષયોનો અભ્યાસ
- AIની મદદથી કાર્ડ સુધારવા અને અભ્યાસનું આયોજન
- કાર્ડના સેટ, ટૅગ અને સમયાંતરે પુનરાવર્તન સાથે રોજ ઝડપથી અભ્યાસ

સેકન્ડોમાં કાર્ડ બનાવો, સેટ અને ટૅગ વડે અભ્યાસ ગોઠવો અને નક્કી કરેલા સમયે પુનરાવર્તન કરો. આથી બિનજરૂરી કામ ઓછું કરીને વધુ યાદ રાખવામાં મદદ મળે છે.

AI અભ્યાસનો જ એક ભાગ છે. કાર્ડમાં રહીને જ લખાણ વધુ સ્પષ્ટ કરો, અઘરા વિષયો સમજો અને આગળ શું ભણવું તે નક્કી કરો.

પારદર્શિતાને મહત્વ આપતા લોકો માટે આ ઍપ ઓપન સોર્સ છે. આખી સિસ્ટમ પોતાના સર્વર પર પણ ચલાવી શકાય છે. મદદ, ગોપનીયતા નીતિ અને શરતો ઍપમાં ઉપલબ્ધ છે.

ઍપ, બૅકએન્ડ અને માળખાનો બધો કોડ GitHub પર ખુલ્લો ઉપલબ્ધ છે:
https://github.com/kirill-markin/flashcards-open-source-app

### Keywords

અભ્યાસ,પરીક્ષા,ભાષા,યાદ

### What's New

- Nibomoનું ઇન્ટરફેસ હવે 49 ભાષાઓમાં ઉપલબ્ધ છે.
- સાઇન-ઇન પૃષ્ઠો પણ હવે એ જ ભાષાઓમાં ઉપલબ્ધ છે.

## Hebrew

App Store locale: `he`

### Name

Nibomo: כרטיסיות עם AI

### Subtitle

מהערות לכרטיסיות לימוד

### Description

צרו כרטיסיות לימוד מההערות שלכם בעזרת AI וחזרו עליהן במרווחים כדי להתכונן למבחנים, ללמוד שפות ולתרגל מדי יום.

השם הקודם של Nibomo היה Flashcards Open Source App.

השתמשו באפליקציה עבור:
- הכנה למבחנים ולימודים בקורסים
- לימוד שפות והרחבת אוצר המילים
- לימודי רפואה, תחומים טכניים ונושאים אחרים שדורשים שינון רב
- שיפור הכרטיסיות ותכנון הלמידה בעזרת AI
- חזרה יומית מהירה עם חפיסות, תגיות וחזרה במרווחים

צרו כרטיסיות בשניות, ארגנו את הלמידה עם חפיסות ותגיות ופעלו לפי לוח חזרות ממוקד שיעזור לכם לזכור יותר עם פחות עבודה שגרתית.

ה-AI הוא חלק מתהליך הלמידה. היעזרו בו כדי לחדד ניסוחים בכרטיסיות, להבין נושאים קשים ולהחליט מה ללמוד בהמשך, ישירות מתוך הכרטיסיות.

למי ששקיפות חשובה להם, האפליקציה היא בקוד פתוח וניתן לארח את המערכת כולה באופן עצמאי. התמיכה, מדיניות הפרטיות ותנאי השימוש זמינים בתוך האפליקציה.

כל הקוד של האפליקציה, צד השרת והתשתית פתוח וזמין ב-GitHub:
https://github.com/kirill-markin/flashcards-open-source-app

### Keywords

שינון,חזרה,שפות,מבחנים,רפואה,זיכרון,חפיסות,תגיות,לימוד

### What's New

- הממשק של Nibomo זמין עכשיו ב-49 שפות.
- גם דפי הכניסה זמינים עכשיו באותן שפות.

## Croatian

App Store locale: `hr`

### Name

Nibomo: Kartice uz AI

### Subtitle

Od bilježaka do kartica

### Description

Izradite kartice za učenje iz bilježaka uz pomoć AI-ja i ponavljajte ih u razmacima za ispite, učenje jezika i svakodnevni rad.

Nibomo se prije zvao Flashcards Open Source App.

Koristite ga za:
- pripremu ispita i učenje gradiva
- učenje jezika i proširivanje vokabulara
- medicinu, tehničke predmete i druge teme koje traže puno pamćenja
- poboljšavanje kartica i planiranje učenja uz AI
- brzo svakodnevno ponavljanje uz špilove, oznake i ponavljanje u razmacima

Izradite kartice u nekoliko sekundi, organizirajte učenje pomoću špilova i oznaka te ponavljajte prema rasporedu koji vam pomaže zapamtiti više uz manje rutinskog rada.

AI je dio učenja. Koristite ga za jasnije formulacije na karticama, razumijevanje teških tema i odabir onoga što ćete učiti sljedeće, izravno iz svojih kartica.

Za one kojima je važna transparentnost, aplikacija ima otvoreni izvorni kod, a cijeli sustav možete pokrenuti na vlastitom poslužitelju. Podrška, pravila privatnosti i uvjeti dostupni su u aplikaciji.

Sav kod aplikacije, pozadinskog sustava i infrastrukture otvoren je i dostupan na GitHubu:
https://github.com/kirill-markin/flashcards-open-source-app

### Keywords

učenje,ponavljanje,vokabular,jezici,ispiti,medicina,pamćenje,špilovi,oznake,fsrs

### What's New

- Sučelje aplikacije Nibomo sada je dostupno na 49 jezika.
- Stranice za prijavu sada su dostupne na istim jezicima.

## Hungarian

App Store locale: `hu`

### Name

Nibomo: AI-tanulókártyák

### Subtitle

Jegyzetekből tanulókártyák

### Description

Készíts tanulókártyákat a jegyzeteidből AI segítségével, majd ismételd át őket időközönként a vizsgákhoz, nyelvtanuláshoz és a mindennapi tanuláshoz.

A Nibomo korábbi neve Flashcards Open Source App volt.

Használd:
- vizsgafelkészüléshez és a tananyag elsajátításához
- nyelvtanuláshoz és szókincsbővítéshez
- orvosi, műszaki és más, sok memorizálást igénylő tárgyakhoz
- a kártyák javításához és a tanulás megtervezéséhez AI segítségével
- gyors napi ismétléshez paklikkal, címkékkel és időközönkénti ismétléssel

Készíts kártyákat másodpercek alatt, rendszerezd a tanulást paklikkal és címkékkel, és kövess olyan ismétlési ütemtervet, amely segít többet megjegyezni kevesebb fölösleges munkával.

Az AI a tanulás része. Pontosítsd a kártyák szövegét, értsd meg a nehéz témákat, és döntsd el, mit tanulj legközelebb, közvetlenül a kártyáid mellett.

Ha fontos számodra az átláthatóság, az alkalmazás nyílt forráskódú, és a teljes rendszert saját szerveren is futtathatod. A támogatás, az adatvédelmi tájékoztató és a feltételek az alkalmazáson belül elérhetők.

Az alkalmazás, a háttérrendszer és az infrastruktúra teljes kódja nyíltan elérhető a GitHubon:
https://github.com/kirill-markin/flashcards-open-source-app

### Keywords

ismétlés,szókincs,nyelv,vizsga,orvosi,memória,pakli,címke,nyílt,forráskód,fsrs

### What's New

- A Nibomo felülete mostantól 49 nyelven érhető el.
- A bejelentkezési oldalak is elérhetők ezeken a nyelveken.

## Indonesian

App Store locale: `id`

### Name

Nibomo: Kartu Belajar AI

### Subtitle

Catatan jadi kartu belajar

### Description

Buat kartu belajar dari catatan dengan AI, lalu ulas dengan pengulangan berjarak untuk persiapan ujian, belajar bahasa, dan belajar rutin setiap hari.

Nibomo sebelumnya bernama Flashcards Open Source App.

Gunakan untuk:
- persiapan ujian dan materi pelajaran
- belajar bahasa dan menambah kosakata
- mempelajari kedokteran, bidang teknis, dan materi lain yang perlu banyak diingat
- memperbaiki kartu dan merencanakan belajar dengan bantuan AI
- mengulas cepat setiap hari dengan dek, tag, dan pengulangan berjarak

Buat kartu dalam hitungan detik, atur materi belajar dengan dek dan tag, lalu ikuti jadwal ulasan yang membantu Anda mengingat lebih banyak dengan lebih sedikit pekerjaan berulang.

AI menjadi bagian dari proses belajar. Gunakan untuk memperjelas teks kartu, memahami topik sulit, dan menentukan materi berikutnya tanpa meninggalkan kartu belajar.

Bagi yang menghargai transparansi, aplikasi ini bersumber terbuka dan seluruh sistemnya dapat dihosting sendiri. Bantuan, kebijakan privasi, dan ketentuan tersedia di dalam aplikasi.

Semua kode aplikasi, backend, dan infrastruktur terbuka dan tersedia di GitHub:
https://github.com/kirill-markin/flashcards-open-source-app

### Keywords

pengulangan,berjarak,kosakata,bahasa,ujian,kedokteran,ingatan,dek,tag,sumber,terbuka,fsrs

### What's New

- Antarmuka Nibomo kini tersedia dalam 49 bahasa.
- Halaman masuk kini juga tersedia dalam bahasa-bahasa tersebut.

## Italian

App Store locale: `it`

### Name

Nibomo: Flashcard con IA

### Subtitle

Dagli appunti alle schede

### Description

Crea flashcard dai tuoi appunti con l'IA e ripassale con la ripetizione dilazionata per preparare esami, imparare lingue e studiare ogni giorno.

Nibomo prima si chiamava Flashcards Open Source App.

Usala per:
- preparare esami e studiare le materie dei tuoi corsi
- imparare lingue e ampliare il vocabolario
- studiare medicina, materie tecniche e altri argomenti che richiedono molta memoria
- migliorare le schede e pianificare lo studio con l'IA
- ripassare velocemente ogni giorno con mazzi, etichette e ripetizione dilazionata

Crea schede in pochi secondi, organizza lo studio con mazzi ed etichette e segui un programma di ripasso che ti aiuti a ricordare di più con meno lavoro ripetitivo.

L'IA fa parte dello studio. Usala per rendere più chiaro il testo delle schede, capire argomenti difficili e decidere cosa studiare dopo, direttamente dalle tue flashcard.

Per chi tiene alla trasparenza, l'app è open source e l'intero sistema può essere ospitato su un proprio server. Assistenza, informativa sulla privacy e condizioni sono disponibili nell'app.

Tutto il codice dell'app, del backend e dell'infrastruttura è aperto e disponibile su GitHub:
https://github.com/kirill-markin/flashcards-open-source-app

### Keywords

ripetizione,dilazionata,vocabolario,lingue,esami,medicina,memoria,mazzi,etichette,open,source

### What's New

- L'interfaccia di Nibomo è ora disponibile in 49 lingue.
- Anche le pagine di accesso sono disponibili nelle stesse lingue.

## Kannada

App Store locale: `kn-IN`

### Name

Nibomo: AI ಕಲಿಕಾ ಕಾರ್ಡ್

### Subtitle

ಟಿಪ್ಪಣಿಗಳಿಂದ ಕಲಿಕಾ ಕಾರ್ಡ್

### Description

AI ಬಳಸಿ ಟಿಪ್ಪಣಿಗಳಿಂದ ಕಲಿಕಾ ಕಾರ್ಡ್‌ಗಳನ್ನು ರಚಿಸಿ. ಪರೀಕ್ಷೆ, ಭಾಷಾ ಕಲಿಕೆ ಮತ್ತು ದಿನನಿತ್ಯದ ಓದಿಗಾಗಿ ಅವುಗಳನ್ನು ನಿಗದಿತ ಅಂತರದಲ್ಲಿ ಪುನರಾವರ್ತಿಸಿ.

Nibomoದ ಹಿಂದಿನ ಹೆಸರು Flashcards Open Source App.

ಈ ಕೆಲಸಗಳಿಗೆ ಬಳಸಿ:
- ಪರೀಕ್ಷಾ ಸಿದ್ಧತೆ ಮತ್ತು ಪಠ್ಯಕ್ರಮದ ಅಧ್ಯಯನ
- ಭಾಷೆ ಕಲಿಯುವುದು ಮತ್ತು ಶಬ್ದಸಂಪತ್ತು ಹೆಚ್ಚಿಸಿಕೊಳ್ಳುವುದು
- ವೈದ್ಯಕೀಯ, ತಾಂತ್ರಿಕ ಮತ್ತು ಹೆಚ್ಚು ನೆನಪಿಟ್ಟುಕೊಳ್ಳಬೇಕಾದ ವಿಷಯಗಳ ಅಧ್ಯಯನ
- AI ನೆರವಿನಿಂದ ಕಾರ್ಡ್‌ಗಳನ್ನು ಸುಧಾರಿಸುವುದು ಮತ್ತು ಓದಿನ ಯೋಜನೆ ಮಾಡುವುದು
- ಕಾರ್ಡ್ ಗುಚ್ಛಗಳು, ಟ್ಯಾಗ್‌ಗಳು ಮತ್ತು ಅಂತರವಿಟ್ಟು ಪುನರಾವರ್ತಿಸುವ ವಿಧಾನದ ಮೂಲಕ ದಿನವೂ ಬೇಗನೆ ಓದಿದ್ದನ್ನು ನೆನಪಿಸಿಕೊಳ್ಳುವುದು

ಕೆಲವೇ ಸೆಕೆಂಡುಗಳಲ್ಲಿ ಕಾರ್ಡ್‌ಗಳನ್ನು ರಚಿಸಿ, ಗುಚ್ಛಗಳು ಮತ್ತು ಟ್ಯಾಗ್‌ಗಳಿಂದ ಓದನ್ನು ವ್ಯವಸ್ಥಿತಗೊಳಿಸಿ. ಅನಗತ್ಯ ಕೆಲಸವನ್ನು ಕಡಿಮೆ ಮಾಡಿ ಹೆಚ್ಚು ನೆನಪಿಟ್ಟುಕೊಳ್ಳಲು ನೆರವಾಗುವ ವೇಳಾಪಟ್ಟಿಯಂತೆ ಪುನರಾವರ್ತಿಸಿ.

AI ಕಲಿಕೆಯ ಭಾಗವಾಗಿದೆ. ಕಾರ್ಡ್‌ಗಳಲ್ಲೇ ಇದ್ದುಕೊಂಡು ಅವುಗಳ ಬರಹವನ್ನು ಸ್ಪಷ್ಟಗೊಳಿಸಿ, ಕಷ್ಟದ ವಿಷಯಗಳನ್ನು ಅರ್ಥಮಾಡಿಕೊಳ್ಳಿ ಮತ್ತು ಮುಂದೆ ಏನು ಓದಬೇಕೆಂದು ನಿರ್ಧರಿಸಿ.

ಪಾರದರ್ಶಕತೆಯನ್ನು ಬಯಸುವವರಿಗಾಗಿ ಈ ಆ್ಯಪ್ ಮುಕ್ತ ಮೂಲದ್ದಾಗಿದೆ. ಇಡೀ ವ್ಯವಸ್ಥೆಯನ್ನು ನಿಮ್ಮದೇ ಸರ್ವರ್‌ನಲ್ಲಿ ನಡೆಸಬಹುದು. ನೆರವು, ಗೌಪ್ಯತಾ ನೀತಿ ಮತ್ತು ಷರತ್ತುಗಳು ಆ್ಯಪ್‌ನಲ್ಲೇ ಲಭ್ಯವಿವೆ.

ಆ್ಯಪ್, ಬ್ಯಾಕೆಂಡ್ ಮತ್ತು ಮೂಲಸೌಕರ್ಯದ ಎಲ್ಲ ಕೋಡ್ GitHubನಲ್ಲಿ ಮುಕ್ತವಾಗಿ ಲಭ್ಯವಿದೆ:
https://github.com/kirill-markin/flashcards-open-source-app

### Keywords

ಕಲಿಕೆ,ಪರೀಕ್ಷೆ,ಭಾಷೆ,ನೆನಪು

### What's New

- Nibomoದ ಇಂಟರ್ಫೇಸ್ ಈಗ 49 ಭಾಷೆಗಳಲ್ಲಿ ಲಭ್ಯವಿದೆ.
- ಸೈನ್-ಇನ್ ಪುಟಗಳು ಕೂಡ ಈಗ ಅದೇ ಭಾಷೆಗಳಲ್ಲಿ ಲಭ್ಯವಿವೆ.

## Korean

App Store locale: `ko`

### Name

Nibomo: AI 암기 카드

### Subtitle

노트를 학습 카드로 바꾸세요

### Description

AI로 노트를 암기 카드로 만들고, 간격을 두고 반복 복습하세요. 시험 준비, 언어 학습, 꾸준한 일상 공부에 활용할 수 있습니다.

Nibomo의 이전 이름은 Flashcards Open Source App입니다.

이런 용도로 사용하세요:
- 시험 준비와 수업 내용 학습
- 언어 학습과 어휘 늘리기
- 의학, 기술 등 암기할 내용이 많은 분야 공부
- AI를 활용한 카드 개선과 학습 계획
- 덱, 태그, 간격 반복을 활용한 빠른 일일 복습

몇 초 만에 카드를 만들고 덱과 태그로 학습 내용을 정리하세요. 정해진 복습 일정에 따라 불필요한 작업을 줄이고 더 많은 내용을 기억할 수 있습니다.

AI는 학습 과정에 함께합니다. 카드를 보면서 문장을 다듬고, 어려운 주제를 이해하고, 다음에 무엇을 공부할지 정해 보세요.

투명성을 중요하게 생각하는 학습자를 위해 앱은 오픈 소스로 제공되며 전체 시스템을 직접 호스팅할 수 있습니다. 지원, 개인정보 처리방침, 이용 약관은 앱에서 확인할 수 있습니다.

앱, 백엔드, 인프라의 모든 코드는 GitHub에 공개되어 있습니다:
https://github.com/kirill-markin/flashcards-open-source-app

### Keywords

간격,반복,어휘,언어,시험,의학,기억,복습,덱,태그,오픈소스

### What's New

- Nibomo의 화면이 이제 49개 언어를 지원합니다.
- 로그인 페이지도 같은 언어를 지원합니다.

## Malayalam

App Store locale: `ml-IN`

### Name

Nibomo: AI പഠന കാർഡുകൾ

### Subtitle

കുറിപ്പുകളിൽ നിന്ന് കാർഡുകൾ

### Description

AI ഉപയോഗിച്ച് കുറിപ്പുകളിൽ നിന്ന് പഠന കാർഡുകൾ തയ്യാറാക്കുക. പരീക്ഷകൾക്കും ഭാഷാപഠനത്തിനും ദിവസേനയുള്ള പഠനത്തിനുമായി ഇടവേളകളിട്ട് അവ ആവർത്തിച്ചു പഠിക്കുക.

Nibomoയുടെ പഴയ പേര് Flashcards Open Source App എന്നായിരുന്നു.

ഇവയ്ക്കായി ഉപയോഗിക്കാം:
- പരീക്ഷാ തയ്യാറെടുപ്പും പാഠ്യവിഷയങ്ങളുടെ പഠനവും
- ഭാഷകൾ പഠിക്കാനും പദസമ്പത്ത് കൂട്ടാനും
- വൈദ്യശാസ്ത്രം, സാങ്കേതിക വിഷയങ്ങൾ, കൂടുതൽ ഓർത്തിരിക്കേണ്ട മറ്റു വിഷയങ്ങൾ എന്നിവ പഠിക്കാൻ
- AIയുടെ സഹായത്തോടെ കാർഡുകൾ മെച്ചപ്പെടുത്താനും പഠനം ആസൂത്രണം ചെയ്യാനും
- കാർഡ് കൂട്ടങ്ങൾ, ടാഗുകൾ, ഇടവേളകളിലുള്ള ആവർത്തനം എന്നിവ ഉപയോഗിച്ച് ദിവസവും വേഗത്തിൽ പുനഃപഠിക്കാൻ

നിമിഷങ്ങൾക്കുള്ളിൽ കാർഡുകൾ തയ്യാറാക്കി കൂട്ടങ്ങളും ടാഗുകളും ഉപയോഗിച്ച് പഠനം ക്രമീകരിക്കുക. അനാവശ്യ ജോലികൾ കുറച്ച് കൂടുതൽ ഓർത്തിരിക്കാൻ സഹായിക്കുന്ന സമയക്രമത്തിൽ പഠിച്ചത് ആവർത്തിക്കുക.

AI പഠനത്തിന്റെ ഭാഗമാണ്. കാർഡുകളിൽ നിന്നു മാറാതെ തന്നെ വാചകങ്ങൾ വ്യക്തമാക്കാനും ബുദ്ധിമുട്ടുള്ള വിഷയങ്ങൾ മനസ്സിലാക്കാനും അടുത്തതായി എന്തു പഠിക്കണമെന്ന് തീരുമാനിക്കാനും ഇത് ഉപയോഗിക്കുക.

സുതാര്യതയ്ക്ക് പ്രാധാന്യം നൽകുന്നവർക്കായി ഈ ആപ്പ് ഓപ്പൺ സോഴ്‌സാണ്. മുഴുവൻ സംവിധാനവും സ്വന്തം സെർവറിൽ പ്രവർത്തിപ്പിക്കാം. സഹായം, സ്വകാര്യതാ നയം, നിബന്ധനകൾ എന്നിവ ആപ്പിൽ ലഭ്യമാണ്.

ആപ്പ്, ബാക്കെൻഡ്, അടിസ്ഥാന സൗകര്യങ്ങൾ എന്നിവയുടെ മുഴുവൻ കോഡും GitHubൽ തുറന്നുവെച്ചിട്ടുണ്ട്:
https://github.com/kirill-markin/flashcards-open-source-app

### Keywords

പഠനം,പരീക്ഷ,ഭാഷ,ഓർമ്മ

### What's New

- Nibomoയുടെ ഇന്റർഫേസ് ഇപ്പോൾ 49 ഭാഷകളിൽ ലഭ്യമാണ്.
- സൈൻ-ഇൻ പേജുകളും ഇപ്പോൾ ഇതേ ഭാഷകളിൽ ലഭ്യമാണ്.

## Marathi

App Store locale: `mr-IN`

### Name

Nibomo: AI फ्लॅशकार्ड

### Subtitle

नोंदींपासून अभ्यास कार्ड

### Description

AI वापरून नोंदींपासून फ्लॅशकार्ड तयार करा. परीक्षा, भाषा शिकणे आणि रोजचा अभ्यास यासाठी ठरावीक अंतराने त्यांची उजळणी करा.

Nibomoचे आधीचे नाव Flashcards Open Source App होते.

यासाठी वापरा:
- परीक्षेची तयारी आणि अभ्यासक्रमाचा अभ्यास
- भाषा शिकणे आणि शब्दसंग्रह वाढवणे
- वैद्यकीय, तांत्रिक आणि खूप गोष्टी लक्षात ठेवाव्या लागणाऱ्या विषयांचा अभ्यास
- AIच्या मदतीने कार्ड सुधारणे आणि अभ्यासाचे नियोजन
- कार्ड संच, टॅग आणि अंतर ठेवून उजळणीच्या मदतीने रोजचा जलद सराव

काही सेकंदांत कार्ड तयार करा, संच आणि टॅग वापरून अभ्यास व्यवस्थित लावा आणि ठरलेल्या वेळापत्रकानुसार उजळणी करा. यामुळे अनावश्यक काम कमी करून अधिक लक्षात ठेवण्यास मदत होते.

AI अभ्यासाचाच भाग आहे. कार्डमधील मजकूर अधिक स्पष्ट करण्यासाठी, अवघड विषय समजून घेण्यासाठी आणि पुढे काय शिकायचे ते ठरवण्यासाठी कार्डमध्येच त्याची मदत घ्या.

पारदर्शकतेला महत्त्व देणाऱ्यांसाठी हे ॲप ओपन सोर्स आहे. संपूर्ण यंत्रणा स्वतःच्या सर्व्हरवर चालवता येते. मदत, गोपनीयता धोरण आणि अटी ॲपमध्ये उपलब्ध आहेत.

ॲप, बॅकएंड आणि पायाभूत सुविधांचा सर्व कोड GitHubवर खुला उपलब्ध आहे:
https://github.com/kirill-markin/flashcards-open-source-app

### Keywords

अभ्यास,परीक्षा,भाषा,स्मरण

### What's New

- Nibomoचा इंटरफेस आता 49 भाषांमध्ये उपलब्ध आहे.
- साइन-इन पृष्ठेही आता याच भाषांमध्ये उपलब्ध आहेत.

## Norwegian

App Store locale: `no`

### Name

Nibomo: Læringskort med KI

### Subtitle

Gjør notater til læringskort

### Description

Lag læringskort fra notater med KI, og repeter dem med økende mellomrom til eksamener, språklæring og daglige studier.

Nibomo het tidligere Flashcards Open Source App.

Bruk appen til:
- eksamensforberedelser og skolearbeid
- språklæring og å utvide ordforrådet
- medisin, tekniske fag og annet som krever mye memorering
- å forbedre kort og planlegge studier med KI
- rask daglig repetisjon med kortstokker, etiketter og repetisjon med mellomrom

Lag kort på få sekunder, organiser studiene med kortstokker og etiketter, og følg en repetisjonsplan som hjelper deg å huske mer med mindre rutinearbeid.

KI er en del av læringen. Bruk den til å gjøre teksten på kortene tydeligere, forstå vanskelige emner og bestemme hva du skal lære videre, direkte fra læringskortene.

For deg som verdsetter innsyn, har appen åpen kildekode, og hele systemet kan driftes på egen server. Brukerstøtte, personvernerklæring og vilkår finnes i appen.

All kode for appen, backend og infrastrukturen er åpent tilgjengelig på GitHub:
https://github.com/kirill-markin/flashcards-open-source-app

### Keywords

repetisjon,ordforråd,språk,eksamen,medisin,hukommelse,kortstokker,etiketter,åpen,kildekode

### What's New

- Nibomos grensesnitt er nå tilgjengelig på 49 språk.
- Innloggingssidene er nå også tilgjengelige på de samme språkene.

## Dutch

App Store locale: `nl-NL`

### Name

Nibomo: AI-flashcards

### Subtitle

Van notities naar leerkaarten

### Description

Maak met AI flashcards van je notities en herhaal ze met tussenpozen voor examens, talen en je dagelijkse studie.

Nibomo heette voorheen Flashcards Open Source App.

Gebruik de app voor:
- examenvoorbereiding en studiewerk
- talen leren en je woordenschat uitbreiden
- geneeskunde, technische vakken en andere stof die je goed moet onthouden
- kaarten verbeteren en je studie plannen met AI
- snel dagelijks herhalen met kaartensets, tags en gespreide herhaling

Maak kaarten in enkele seconden, organiseer je studie met kaartensets en tags en volg een gericht herhaalschema dat je helpt meer te onthouden met minder routinewerk.

AI maakt deel uit van het leren. Gebruik het om kaartteksten aan te scherpen, moeilijke onderwerpen te begrijpen en te bepalen wat je hierna gaat leren, rechtstreeks vanuit je flashcards.

Voor wie transparantie belangrijk vindt: de app is open source en je kunt het hele systeem zelf hosten. Ondersteuning, het privacybeleid en de voorwaarden vind je in de app.

Alle code voor de app, de backend en de infrastructuur is open en beschikbaar op GitHub:
https://github.com/kirill-markin/flashcards-open-source-app

### Keywords

herhaling,woordenschat,talen,examen,geneeskunde,geheugen,kaartensets,tags,open,source,fsrs

### What's New

- De interface van Nibomo is nu beschikbaar in 49 talen.
- De inlogpagina's zijn nu ook beschikbaar in dezelfde talen.

## Punjabi

App Store locale: `pa-IN`

### Name

Nibomo: AI ਫਲੈਸ਼ਕਾਰਡ

### Subtitle

ਨੋਟਾਂ ਤੋਂ ਪੜ੍ਹਾਈ ਕਾਰਡ

### Description

AI ਨਾਲ ਨੋਟਾਂ ਤੋਂ ਫਲੈਸ਼ਕਾਰਡ ਬਣਾਓ। ਇਮਤਿਹਾਨਾਂ, ਭਾਸ਼ਾ ਸਿੱਖਣ ਅਤੇ ਰੋਜ਼ਾਨਾ ਪੜ੍ਹਾਈ ਲਈ ਵਕਫ਼ੇ ਰੱਖ ਕੇ ਇਨ੍ਹਾਂ ਨੂੰ ਦੁਹਰਾਓ।

Nibomo ਦਾ ਪਹਿਲਾਂ ਨਾਮ Flashcards Open Source App ਸੀ।

ਇਨ੍ਹਾਂ ਕੰਮਾਂ ਲਈ ਵਰਤੋ:
- ਇਮਤਿਹਾਨਾਂ ਦੀ ਤਿਆਰੀ ਅਤੇ ਕੋਰਸ ਦੀ ਪੜ੍ਹਾਈ
- ਭਾਸ਼ਾਵਾਂ ਸਿੱਖਣਾ ਅਤੇ ਸ਼ਬਦ-ਭੰਡਾਰ ਵਧਾਉਣਾ
- ਡਾਕਟਰੀ, ਤਕਨੀਕੀ ਅਤੇ ਬਹੁਤ ਕੁਝ ਯਾਦ ਰੱਖਣ ਵਾਲੇ ਵਿਸ਼ਿਆਂ ਦੀ ਪੜ੍ਹਾਈ
- AI ਦੀ ਮਦਦ ਨਾਲ ਕਾਰਡ ਸੁਧਾਰਨਾ ਅਤੇ ਪੜ੍ਹਾਈ ਦੀ ਯੋਜਨਾ ਬਣਾਉਣਾ
- ਕਾਰਡਾਂ ਦੇ ਸੈੱਟ, ਟੈਗ ਅਤੇ ਵਕਫ਼ਿਆਂ ਵਾਲੀ ਦੁਹਰਾਈ ਨਾਲ ਰੋਜ਼ਾਨਾ ਛੇਤੀ ਅਭਿਆਸ

ਕੁਝ ਸਕਿੰਟਾਂ ਵਿੱਚ ਕਾਰਡ ਬਣਾਓ, ਸੈੱਟਾਂ ਅਤੇ ਟੈਗਾਂ ਨਾਲ ਪੜ੍ਹਾਈ ਨੂੰ ਤਰਤੀਬ ਦਿਓ ਅਤੇ ਨਿਯਤ ਸਮੇਂ ਅਨੁਸਾਰ ਦੁਹਰਾਈ ਕਰੋ। ਇਸ ਨਾਲ ਬੇਲੋੜਾ ਕੰਮ ਘਟਾ ਕੇ ਹੋਰ ਯਾਦ ਰੱਖਣ ਵਿੱਚ ਮਦਦ ਮਿਲਦੀ ਹੈ।

AI ਪੜ੍ਹਾਈ ਦਾ ਹੀ ਹਿੱਸਾ ਹੈ। ਕਾਰਡਾਂ ਵਿੱਚ ਰਹਿੰਦਿਆਂ ਲਿਖਤ ਸਪਸ਼ਟ ਕਰੋ, ਔਖੇ ਵਿਸ਼ੇ ਸਮਝੋ ਅਤੇ ਅੱਗੇ ਕੀ ਪੜ੍ਹਨਾ ਹੈ, ਇਹ ਤੈਅ ਕਰੋ।

ਪਾਰਦਰਸ਼ਤਾ ਨੂੰ ਮਹੱਤਵ ਦੇਣ ਵਾਲਿਆਂ ਲਈ ਇਹ ਐਪ ਓਪਨ ਸੋਰਸ ਹੈ। ਪੂਰਾ ਸਿਸਟਮ ਆਪਣੇ ਸਰਵਰ ਉੱਤੇ ਚਲਾਇਆ ਜਾ ਸਕਦਾ ਹੈ। ਮਦਦ, ਪਰਦੇਦਾਰੀ ਨੀਤੀ ਅਤੇ ਸ਼ਰਤਾਂ ਐਪ ਵਿੱਚ ਮਿਲਦੀਆਂ ਹਨ।

ਐਪ, ਬੈਕਐਂਡ ਅਤੇ ਬੁਨਿਆਦੀ ਢਾਂਚੇ ਦਾ ਸਾਰਾ ਕੋਡ GitHub ਉੱਤੇ ਖੁੱਲ੍ਹਾ ਉਪਲਬਧ ਹੈ:
https://github.com/kirill-markin/flashcards-open-source-app

### Keywords

ਪੜ੍ਹਾਈ,ਇਮਤਿਹਾਨ,ਭਾਸ਼ਾ,ਯਾਦ

### What's New

- Nibomo ਦਾ ਇੰਟਰਫੇਸ ਹੁਣ 49 ਭਾਸ਼ਾਵਾਂ ਵਿੱਚ ਉਪਲਬਧ ਹੈ।
- ਸਾਈਨ-ਇਨ ਪੰਨੇ ਵੀ ਹੁਣ ਇਨ੍ਹਾਂ ਹੀ ਭਾਸ਼ਾਵਾਂ ਵਿੱਚ ਉਪਲਬਧ ਹਨ।

## Polish

App Store locale: `pl`

### Name

Nibomo: Fiszki z AI

### Subtitle

Zamień notatki w fiszki

### Description

Twórz fiszki z notatek za pomocą AI i powtarzaj je w odstępach czasu podczas przygotowań do egzaminów, nauki języków i codziennej nauki.

Wcześniej Nibomo nazywało się Flashcards Open Source App.

Korzystaj z aplikacji do:
- przygotowania do egzaminów i nauki materiału z zajęć
- nauki języków i poszerzania słownictwa
- nauki medycyny, przedmiotów technicznych i innych treści wymagających zapamiętywania
- ulepszania fiszek i planowania nauki z pomocą AI
- szybkich codziennych powtórek z taliami, tagami i powtarzaniem w odstępach czasu

Twórz fiszki w kilka sekund, organizuj naukę za pomocą talii i tagów oraz powtarzaj według planu, który pomaga zapamiętać więcej przy mniejszej ilości rutynowej pracy.

AI jest częścią nauki. Używaj jej do dopracowania treści fiszek, zrozumienia trudnych tematów i wyboru tego, czego uczyć się dalej, bez wychodzenia z fiszek.

Dla osób ceniących przejrzystość aplikacja ma otwarty kod źródłowy, a cały system można uruchomić na własnym serwerze. Pomoc, polityka prywatności i warunki korzystania są dostępne w aplikacji.

Cały kod aplikacji, backendu i infrastruktury jest otwarty i dostępny na GitHubie:
https://github.com/kirill-markin/flashcards-open-source-app

### Keywords

powtórki,słownictwo,języki,egzaminy,medycyna,pamięć,talie,tagi,nauka,otwarty,kod

### What's New

- Interfejs Nibomo jest teraz dostępny w 49 językach.
- Strony logowania są teraz dostępne w tych samych językach.

## Romanian

App Store locale: `ro`

### Name

Nibomo: Fișe cu AI

### Subtitle

Din notițe în fișe de studiu

### Description

Creează fișe de studiu din notițe cu AI, apoi repetă-le la intervale pentru examene, învățarea limbilor și studiul de zi cu zi.

Nibomo se numea înainte Flashcards Open Source App.

Folosește aplicația pentru:
- pregătirea examenelor și studiul materiilor de curs
- învățarea limbilor și îmbogățirea vocabularului
- medicină, domenii tehnice și alte materii care cer multă memorare
- îmbunătățirea fișelor și planificarea studiului cu AI
- recapitulări zilnice rapide cu pachete, etichete și repetiție la intervale

Creează fișe în câteva secunde, organizează studiul cu pachete și etichete și urmează un program de recapitulare care te ajută să reții mai mult cu mai puțină muncă repetitivă.

AI face parte din procesul de învățare. Folosește-o pentru a clarifica formulările de pe fișe, a înțelege subiecte dificile și a decide ce să studiezi în continuare, direct din fișele tale.

Pentru cei care apreciază transparența, aplicația are cod sursă deschis, iar întregul sistem poate fi găzduit pe propriul server. Asistența, politica de confidențialitate și condițiile sunt disponibile în aplicație.

Tot codul aplicației, al backendului și al infrastructurii este deschis și disponibil pe GitHub:
https://github.com/kirill-markin/flashcards-open-source-app

### Keywords

repetiție,vocabular,limbi,examene,medicină,memorie,pachete,etichete,cod,deschis

### What's New

- Interfața Nibomo este acum disponibilă în 49 de limbi.
- Paginile de conectare sunt acum disponibile în aceleași limbi.

## Slovak

App Store locale: `sk`

### Name

Nibomo: AI kartičky

### Subtitle

Z poznámok učebné kartičky

### Description

Vytvárajte z poznámok kartičky pomocou AI a opakujte si ich v rozložených intervaloch pri príprave na skúšky, učení jazykov aj každodennom štúdiu.

Nibomo sa predtým volalo Flashcards Open Source App.

Použite ho na:
- prípravu na skúšky a štúdium učiva
- učenie jazykov a rozširovanie slovnej zásoby
- štúdium medicíny, technických odborov a ďalších tém náročných na pamäť
- zlepšovanie kartičiek a plánovanie štúdia s AI
- rýchle každodenné opakovanie s balíčkami, štítkami a opakovaním v intervaloch

Vytvorte kartičky za pár sekúnd, usporiadajte si štúdium pomocou balíčkov a štítkov a opakujte podľa plánu, ktorý vám pomôže zapamätať si viac s menším množstvom rutinnej práce.

AI je súčasťou štúdia. Spresnite text kartičiek, pochopte náročné témy a rozhodnite sa, čo študovať ďalej, priamo pri svojich kartičkách.

Pre tých, ktorým záleží na transparentnosti, má aplikácia otvorený zdrojový kód a celý systém možno prevádzkovať na vlastnom serveri. Podporu, zásady ochrany súkromia a podmienky nájdete v aplikácii.

Všetok kód aplikácie, backendu a infraštruktúry je otvorený a dostupný na GitHube:
https://github.com/kirill-markin/flashcards-open-source-app

### Keywords

učenie,opakovanie,slovíčka,jazyky,skúšky,medicína,pamäť,balíčky,štítky,fsrs

### What's New

- Rozhranie Nibomo je teraz dostupné v 49 jazykoch.
- Prihlasovacie stránky sú teraz dostupné v rovnakých jazykoch.

## Slovenian

App Store locale: `sl-SI`

### Name

Nibomo: Učne kartice z UI

### Subtitle

Iz zapiskov v učne kartice

### Description

Z umetno inteligenco ustvarite učne kartice iz zapiskov in jih ponavljajte v časovnih razmikih za izpite, učenje jezikov in vsakodnevni študij.

Nibomo se je prej imenoval Flashcards Open Source App.

Uporabite ga za:
- pripravo na izpite in učenje snovi pri predmetih
- učenje jezikov in širjenje besedišča
- medicino, tehnične predmete in druge teme, pri katerih si morate veliko zapomniti
- izboljševanje kartic in načrtovanje učenja z umetno inteligenco
- hitro vsakodnevno ponavljanje s kompleti, oznakami in časovnimi razmiki

Ustvarite kartice v nekaj sekundah, organizirajte učenje s kompleti in oznakami ter ponavljajte po urniku, ki vam pomaga zapomniti si več z manj rutinskega dela.

Umetna inteligenca je del učenja. Z njo izboljšajte besedilo kartic, razumite zahtevne teme in izberite, kaj se boste učili naslednje, neposredno ob svojih karticah.

Za vse, ki cenijo preglednost, je aplikacija odprtokodna, celoten sistem pa lahko gostujete na lastnem strežniku. Podpora, pravilnik o zasebnosti in pogoji so na voljo v aplikaciji.

Vsa koda aplikacije, zaledja in infrastrukture je odprta in na voljo na GitHubu:
https://github.com/kirill-markin/flashcards-open-source-app

### Keywords

ponavljanje,besedišče,jeziki,izpiti,medicina,spomin,kompleti,oznake,odprta,koda,fsrs

### What's New

- Vmesnik aplikacije Nibomo je zdaj na voljo v 49 jezikih.
- Strani za prijavo so zdaj na voljo v istih jezikih.

## Swedish

App Store locale: `sv`

### Name

Nibomo: Pluggkort med AI

### Subtitle

Gör anteckningar till kort

### Description

Skapa pluggkort från anteckningar med AI och repetera dem med mellanrum inför prov, för språkinlärning och i dina dagliga studier.

Nibomo hette tidigare Flashcards Open Source App.

Använd appen för:
- provförberedelser och kursarbete
- språkinlärning och ett större ordförråd
- medicin, tekniska ämnen och annat som kräver mycket memorering
- att förbättra kort och planera studier med AI
- snabb daglig repetition med kortlekar, taggar och repetition med mellanrum

Skapa kort på några sekunder, organisera studierna med kortlekar och taggar och följ ett repetitionsschema som hjälper dig att minnas mer med mindre rutinarbete.

AI är en del av lärandet. Använd den för att förtydliga kortens text, förstå svåra ämnen och bestämma vad du ska studera härnäst, direkt från dina pluggkort.

För dig som värdesätter insyn har appen öppen källkod, och hela systemet kan köras på en egen server. Support, integritetspolicy och villkor finns i appen.

All kod för appen, backend och infrastrukturen är öppen och tillgänglig på GitHub:
https://github.com/kirill-markin/flashcards-open-source-app

### Keywords

repetition,ordförråd,språk,prov,medicin,minne,kortlekar,taggar,öppen,källkod,fsrs

### What's New

- Nibomos gränssnitt finns nu på 49 språk.
- Inloggningssidorna finns nu också på samma språk.

## Tamil

App Store locale: `ta-IN`

### Name

Nibomo: AI கற்றல் அட்டைகள்

### Subtitle

குறிப்புகளிலிருந்து அட்டைகள்

### Description

AI மூலம் குறிப்புகளிலிருந்து கற்றல் அட்டைகளை உருவாக்குங்கள். தேர்வுகள், மொழிக் கற்றல் மற்றும் அன்றாடப் படிப்புக்காக இடைவெளி விட்டு அவற்றை மீண்டும் படியுங்கள்.

Nibomo முன்பு Flashcards Open Source App என்று அழைக்கப்பட்டது.

இவற்றுக்குப் பயன்படுத்துங்கள்:
- தேர்வுத் தயாரிப்பு மற்றும் பாடப் படிப்பு
- மொழிகளைக் கற்பது மற்றும் சொல்வளத்தை வளர்ப்பது
- மருத்துவம், தொழில்நுட்பம் மற்றும் அதிகம் நினைவில் வைத்திருக்க வேண்டிய பிற பாடங்கள்
- AI உதவியுடன் அட்டைகளை மேம்படுத்துவது மற்றும் படிப்பைத் திட்டமிடுவது
- அட்டைத் தொகுப்புகள், குறிச்சொற்கள் மற்றும் இடைவெளி விட்டுப் படிக்கும் முறையுடன் தினசரி விரைவான மீள்பார்வை

சில நொடிகளில் அட்டைகளை உருவாக்கி, தொகுப்புகள் மற்றும் குறிச்சொற்களால் படிப்பை ஒழுங்குபடுத்துங்கள். தேவையற்ற வேலைகளைக் குறைத்து அதிகம் நினைவில் வைத்திருக்க உதவும் அட்டவணைப்படி மீண்டும் படியுங்கள்.

AI படிப்பின் ஒரு பகுதியாகவே உள்ளது. அட்டைகளிலிருந்தே சொற்றொடர்களைத் தெளிவாக்கவும், கடினமான தலைப்புகளைப் புரிந்துகொள்ளவும், அடுத்து என்ன படிப்பது என்று முடிவெடுக்கவும் அதைப் பயன்படுத்துங்கள்.

வெளிப்படைத்தன்மையை விரும்புவோருக்காக இந்தச் செயலி திறந்த மூலமாக உள்ளது. முழு அமைப்பையும் உங்கள் சொந்தச் சேவையகத்தில் இயக்கலாம். உதவி, தனியுரிமைக் கொள்கை மற்றும் விதிமுறைகள் செயலியில் கிடைக்கின்றன.

செயலி, பின்தளம் மற்றும் உள்கட்டமைப்பின் முழுக் குறியீடும் GitHub இல் திறந்த நிலையில் கிடைக்கிறது:
https://github.com/kirill-markin/flashcards-open-source-app

### Keywords

படிப்பு,தேர்வு,மொழி,நினைவு

### What's New

- Nibomoவின் இடைமுகம் இப்போது 49 மொழிகளில் கிடைக்கிறது.
- உள்நுழைவுப் பக்கங்களும் இப்போது அதே மொழிகளில் கிடைக்கின்றன.

## Telugu

App Store locale: `te-IN`

### Name

Nibomo: AI అభ్యాస కార్డులు

### Subtitle

నోట్స్ నుంచి అభ్యాస కార్డులు

### Description

AIతో నోట్స్ నుంచి అభ్యాస కార్డులను తయారు చేయండి. పరీక్షలు, భాషలు నేర్చుకోవడం, రోజువారీ చదువు కోసం వాటిని కొంత విరామంతో మళ్లీ చదవండి.

Nibomo పాత పేరు Flashcards Open Source App.

ఈ పనులకు వాడండి:
- పరీక్షల సన్నద్ధత మరియు కోర్సు పాఠాల అధ్యయనం
- భాషలు నేర్చుకోవడం మరియు పదసంపద పెంచుకోవడం
- వైద్య, సాంకేతిక మరియు ఎక్కువ విషయాలు గుర్తుంచుకోవాల్సిన ఇతర అధ్యయనాలు
- AI సహాయంతో కార్డులను మెరుగుపరచడం మరియు చదువుకు ప్రణాళిక వేసుకోవడం
- కార్డుల సమూహాలు, ట్యాగ్‌లు, విరామాలతో పునశ్చరణ ద్వారా రోజూ త్వరగా చదివినవి గుర్తుచేసుకోవడం

కొన్ని సెకన్లలో కార్డులు తయారు చేసి, సమూహాలు మరియు ట్యాగ్‌లతో చదువును క్రమబద్ధం చేయండి. అనవసర పనిని తగ్గించి ఎక్కువ గుర్తుంచుకోవడానికి తోడ్పడే సమయ పట్టిక ప్రకారం పునశ్చరణ చేయండి.

AI చదువులో భాగంగానే ఉంటుంది. కార్డుల్లోని వాక్యాలను స్పష్టంగా మార్చడానికి, కష్టమైన విషయాలను అర్థం చేసుకోవడానికి, తర్వాత ఏం చదవాలో నిర్ణయించడానికి కార్డుల వద్దే దీన్ని వాడండి.

పారదర్శకతను కోరుకునేవారి కోసం ఈ యాప్ ఓపెన్ సోర్స్‌గా ఉంది. మొత్తం వ్యవస్థను మీ సొంత సర్వర్‌లో నడపవచ్చు. సహాయం, గోప్యతా విధానం, నిబంధనలు యాప్‌లో అందుబాటులో ఉన్నాయి.

యాప్, బ్యాకెండ్, మౌలిక సదుపాయాల కోడ్ అంతా GitHubలో బహిరంగంగా అందుబాటులో ఉంది:
https://github.com/kirill-markin/flashcards-open-source-app

### Keywords

చదువు,పరీక్ష,భాష,జ్ఞాపకం

### What's New

- Nibomo ఇంటర్‌ఫేస్ ఇప్పుడు 49 భాషల్లో అందుబాటులో ఉంది.
- సైన్-ఇన్ పేజీలు కూడా ఇప్పుడు అవే భాషల్లో అందుబాటులో ఉన్నాయి.

## Thai

App Store locale: `th`

### Name

Nibomo: แฟลชการ์ด AI

### Subtitle

เปลี่ยนโน้ตเป็นบัตรคำ

### Description

ใช้ AI สร้างแฟลชการ์ดจากโน้ต แล้วทบทวนแบบเว้นระยะเพื่อเตรียมสอบ เรียนภาษา และเรียนรู้อย่างสม่ำเสมอทุกวัน

Nibomo เคยใช้ชื่อว่า Flashcards Open Source App

ใช้สำหรับ:
- เตรียมสอบและทบทวนเนื้อหาในบทเรียน
- เรียนภาษาและเพิ่มคลังคำศัพท์
- เรียนแพทย์ วิชาเทคนิค และเนื้อหาอื่นที่ต้องจดจำมาก
- ปรับปรุงการ์ดและวางแผนการเรียนด้วย AI
- ทบทวนรายวันอย่างรวดเร็วด้วยสำรับ แท็ก และการทบทวนแบบเว้นระยะ

สร้างการ์ดในไม่กี่วินาที จัดเนื้อหาด้วยสำรับและแท็ก แล้วทบทวนตามตารางที่ช่วยให้จำได้มากขึ้นและลดงานซ้ำที่ไม่จำเป็น

AI เป็นส่วนหนึ่งของการเรียน ใช้ปรับข้อความบนการ์ดให้ชัดเจน ทำความเข้าใจหัวข้อยาก และตัดสินใจว่าจะเรียนอะไรต่อได้จากแฟลชการ์ดของคุณ

สำหรับผู้ที่ให้ความสำคัญกับความโปร่งใส แอปนี้เป็นโอเพนซอร์สและสามารถติดตั้งทั้งระบบบนเซิร์ฟเวอร์ของคุณเองได้ ความช่วยเหลือ นโยบายความเป็นส่วนตัว และข้อกำหนดมีให้อ่านภายในแอป

โค้ดทั้งหมดของแอป แบ็กเอนด์ และโครงสร้างพื้นฐานเปิดให้เข้าถึงบน GitHub:
https://github.com/kirill-markin/flashcards-open-source-app

### Keywords

ทบทวน,ภาษา,สอบ,ศัพท์,ความจำ

### What's New

- อินเทอร์เฟซของ Nibomo รองรับ 49 ภาษาแล้ว
- หน้าเข้าสู่ระบบก็รองรับภาษาเหล่านี้แล้วเช่นกัน

## Turkish

App Store locale: `tr`

### Name

Nibomo: AI Bilgi Kartları

### Subtitle

Notlardan çalışma kartlarına

### Description

Yapay zekâyla notlarınızdan bilgi kartları oluşturun. Sınavlar, dil öğrenimi ve günlük çalışma için aralıklı tekrar yapın.

Nibomo'nun önceki adı Flashcards Open Source App'ti.

Şunlar için kullanın:
- sınav hazırlığı ve ders çalışmak
- dil öğrenmek ve kelime dağarcığını geliştirmek
- tıp, teknik konular ve çok şey ezberlemeyi gerektiren diğer alanları çalışmak
- yapay zekâ yardımıyla kartları geliştirmek ve çalışmayı planlamak
- desteler, etiketler ve aralıklı tekrarla her gün hızlıca tekrar yapmak

Saniyeler içinde kart oluşturun, desteler ve etiketlerle çalışmanızı düzenleyin. Gereksiz işleri azaltıp daha fazlasını hatırlamanıza yardımcı olan bir tekrar programı izleyin.

Yapay zekâ, çalışma sürecinin bir parçasıdır. Kartlarınızdan ayrılmadan ifadeleri netleştirmek, zor konuları anlamak ve sırada ne çalışacağınıza karar vermek için kullanın.

Şeffaflığa önem verenler için uygulama açık kaynaklıdır ve tüm sistem kendi sunucunuzda barındırılabilir. Destek, gizlilik politikası ve koşullar uygulamanın içinde bulunur.

Uygulama, arka uç ve altyapının tüm kodu açık olarak GitHub'da bulunur:
https://github.com/kirill-markin/flashcards-open-source-app

### Keywords

aralıklı,tekrar,kelime,dil,sınav,tıp,ezber,deste,etiket,açık,kaynak,fsrs

### What's New

- Nibomo'nun arayüzü artık 49 dili destekliyor.
- Giriş sayfaları da artık aynı dillerde kullanılabiliyor.

## Ukrainian

App Store locale: `uk`

### Name

Nibomo: Картки з ШІ

### Subtitle

Із нотаток у навчальні картки

### Description

Створюйте навчальні картки з нотаток за допомогою ШІ та повторюйте їх з інтервалами для підготовки до іспитів, вивчення мов і щоденного навчання.

Раніше Nibomo називався Flashcards Open Source App.

Використовуйте для:
- підготовки до іспитів і вивчення матеріалів курсу
- вивчення мов і розширення словникового запасу
- медицини, технічних дисциплін та інших тем, де потрібно багато запам'ятовувати
- покращення карток і планування навчання за допомогою ШІ
- швидкого щоденного повторення з колодами, тегами та інтервальними повтореннями

Створюйте картки за лічені секунди, упорядковуйте навчання за допомогою колод і тегів та повторюйте за розкладом, який допомагає запам'ятовувати більше з меншою кількістю рутинної роботи.

ШІ є частиною навчання. Уточнюйте формулювання на картках, розбирайте складні теми й визначайте, що вчити далі, просто у своїх картках.

Для тих, хто цінує прозорість, застосунок має відкритий код, а всю систему можна розгорнути на власному сервері. Підтримка, політика конфіденційності й умови доступні в застосунку.

Увесь код застосунку, серверної частини та інфраструктури відкритий і доступний на GitHub:
https://github.com/kirill-markin/flashcards-open-source-app

### Keywords

повторення,мови,іспити,медицина,пам'ять,колоди,теги

### What's New

- Інтерфейс Nibomo тепер доступний 49 мовами.
- Сторінки входу тепер підтримують ті самі мови.

## Urdu

App Store locale: `ur-PK`

### Name

Nibomo: AI فلیش کارڈز

### Subtitle

نوٹس سے مطالعے کے کارڈز

### Description

AI کی مدد سے نوٹس کو فلیش کارڈز میں بدلیں۔ امتحانات، زبانیں سیکھنے اور روزانہ کی پڑھائی کے لیے وقفوں سے ان کی دہرائی کریں۔

Nibomo کا سابقہ نام Flashcards Open Source App تھا۔

ان کاموں کے لیے استعمال کریں:
- امتحانات کی تیاری اور نصابی پڑھائی
- زبانیں سیکھنا اور ذخیرۂ الفاظ بڑھانا
- طب، تکنیکی مضامین اور ایسے دیگر موضوعات کا مطالعہ جن میں بہت کچھ یاد رکھنا ہوتا ہے
- AI کی مدد سے کارڈز بہتر بنانا اور پڑھائی کی منصوبہ بندی
- کارڈز کے مجموعوں، ٹیگز اور وقفوں سے دہرائی کے ذریعے روزانہ جلدی مشق

چند سیکنڈ میں کارڈز بنائیں، مجموعوں اور ٹیگز سے پڑھائی کو ترتیب دیں اور ایک طے شدہ شیڈول کے مطابق دہرائی کریں۔ اس سے غیر ضروری کام کم کرکے زیادہ یاد رکھنے میں مدد ملتی ہے۔

AI پڑھائی کا حصہ ہے۔ کارڈز کے اندر رہتے ہوئے ان کی عبارت واضح کریں، مشکل موضوعات سمجھیں اور طے کریں کہ آگے کیا پڑھنا ہے۔

شفافیت کو اہمیت دینے والوں کے لیے یہ ایپ اوپن سورس ہے، اور پورا نظام اپنے سرور پر چلایا جا سکتا ہے۔ مدد، رازداری کی پالیسی اور شرائط ایپ میں دستیاب ہیں۔

ایپ، بیک اینڈ اور بنیادی ڈھانچے کا تمام کوڈ GitHub پر کھلے طور پر دستیاب ہے:
https://github.com/kirill-markin/flashcards-open-source-app

### Keywords

پڑھائی,امتحان,زبان,یادداشت,دہرائی,طب,الفاظ

### What's New

- Nibomo کا انٹرفیس اب 49 زبانوں میں دستیاب ہے۔
- سائن اِن کے صفحات بھی اب انہی زبانوں میں دستیاب ہیں۔

## Vietnamese

App Store locale: `vi`

### Name

Nibomo: Thẻ học AI

### Subtitle

Biến ghi chú thành thẻ học

### Description

Dùng AI để tạo thẻ học từ ghi chú, rồi ôn tập ngắt quãng để chuẩn bị cho kỳ thi, học ngoại ngữ và duy trì việc học hằng ngày.

Nibomo trước đây có tên là Flashcards Open Source App.

Dùng ứng dụng để:
- ôn thi và học nội dung trên lớp
- học ngoại ngữ và mở rộng vốn từ
- học y khoa, kỹ thuật và các lĩnh vực cần ghi nhớ nhiều
- cải thiện thẻ và lên kế hoạch học với AI
- ôn nhanh mỗi ngày bằng bộ thẻ, nhãn và phương pháp lặp lại ngắt quãng

Tạo thẻ trong vài giây, sắp xếp việc học bằng bộ thẻ và nhãn, rồi ôn theo lịch để ghi nhớ nhiều hơn và bớt những công việc lặp lại không cần thiết.

AI là một phần của quá trình học. Dùng AI để diễn đạt nội dung thẻ rõ hơn, hiểu các chủ đề khó và quyết định học gì tiếp theo ngay trong các thẻ của bạn.

Với những ai coi trọng sự minh bạch, ứng dụng có mã nguồn mở và bạn có thể tự lưu trữ toàn bộ hệ thống. Hỗ trợ, chính sách quyền riêng tư và điều khoản có sẵn trong ứng dụng.

Toàn bộ mã của ứng dụng, hệ thống phía máy chủ và hạ tầng được công khai trên GitHub:
https://github.com/kirill-markin/flashcards-open-source-app

### Keywords

ôn tập,từ vựng,ngoại ngữ,thi,y khoa,trí nhớ,bộ thẻ,nhãn,mã nguồn mở

### What's New

- Giao diện Nibomo hiện hỗ trợ 49 ngôn ngữ.
- Các trang đăng nhập cũng đã hỗ trợ những ngôn ngữ này.
