# Google Play Store Metadata

Related competitor references: [Android competitors](competitor-store-metadata.md#android)

For locale mapping, assets, repository delivery, and Play publication, use the
[listing localization runbook](../apps/android/docs/play-store-localization-runbook.md).

## Which languages live in this file

This file holds authored Play listing copy for 51 locales, including regional Spanish listings. Each section owns its app name, short description, and full description. Play locale codes can differ from app locale codes: for example, `es-419` maps to `es-MX`, and `iw-IL` maps to `he`. The `es-US` listing has no matching product locale.

So a section here is not evidence that a shipped build carries that language. Before publishing a listing, check the client locale lists in `apps/web/src/i18n/types.ts`, `apps/android/app/src/main/res/xml/locales_config.xml`, and the iOS `knownRegions` in `apps/ios/Flashcards/Flashcards Open Source App.xcodeproj/project.pbxproj`.

Google Play may auto-translate listings for other languages. That generated copy is absent here because it has no repository source of truth. Publishing authored copy replaces auto-translated text for that locale.

## Default - English (United States) - en-US

### App Name

Nibomo: AI Flashcards

### Short Description

Turn notes and photos into flashcards and remember them with spaced repetition

### Full Description

Study with an AI-powered flashcards app built for people who actually need to remember what they learn.

Nibomo was previously called Flashcards Open Source App.

Nibomo helps you prepare for exams, learn vocabulary, memorize medical and technical material, improve cards with AI, and keep a serious daily study habit.

Use it for:
- Exam prep and coursework
- Language learning and vocabulary building
- Medical school, nursing, and other high-memorization subjects
- AI-assisted card improvement and study planning
- Fast daily review with decks, tags, and spaced repetition

What you can do:
- Review due cards with a focused spaced repetition flow
- Create and edit flashcards with front text, back text, decks, and tags
- Search and filter your library
- Build filtered decks based on tags and effort level
- Adjust scheduler settings for future reviews
- Export your current workspace to CSV
- Use AI chat to explore your cards, improve content, and plan your studying
- Attach photos and files to AI prompts, or use voice dictation on supported devices
- Sign in with email and sync your workspace across devices
- Use the official service or connect a custom server configuration

Why people use it:
- AI is part of the study workflow, not a bolt-on extra
- Fast review sessions with less clutter and less friction
- Strong organization with decks, tags, filters, and scheduling controls
- Open-source product with optional self-hosting
- Native Material 3 Android experience

This app fits students, language learners, medical learners, developers, and anyone who wants a serious flashcards app with AI, spaced repetition, and a clean daily study flow.

The project is open source, so you can inspect the stack, build on it, and host it yourself.

All code for the app, backend, and infrastructure is open and available on GitHub:
https://github.com/kirill-markin/flashcards-open-source-app

### Release notes

The app is now called Nibomo (formerly Flashcards Open Source App).

## Arabic - ar

### App Name

Nibomo: بطاقات ذكاء اصطناعي

### Short Description

حوّل ملاحظاتك وصورك إلى بطاقات وتذكرها بالتكرار المتباعد

### Full Description

ذاكر بتطبيق بطاقات مراجعة مدعوم بالذكاء الاصطناعي ومصمم لمن يحتاج فعلا إلى تذكر ما يتعلمه.

كان اسم Nibomo سابقا بطاقات تعليم مفتوحة المصدر.

Nibomo يساعدك على التحضير للاختبارات، وتعلم المفردات، وحفظ المواد الطبية والتقنية، وتحسين بطاقاتك بالذكاء الاصطناعي، وبناء عادة مذاكرة يومية جادة.

استخدمه من أجل:
- التحضير للاختبارات والدراسة الجامعية
- تعلم اللغات وبناء المفردات
- دراسة الطب والمواد التقنية وغيرها من المواد التي تحتاج إلى حفظ مكثف
- تحسين البطاقات والتخطيط للدراسة بمساعدة الذكاء الاصطناعي
- مراجعة يومية سريعة باستخدام المجموعات والوسوم والتكرار المتباعد

ما الذي يمكنك فعله:
- مراجعة البطاقات المستحقة عبر تدفق مراجعة مركز قائم على التكرار المتباعد
- إنشاء البطاقات وتعديلها بسرعة بالنص الأمامي والنص الخلفي والمجموعات والوسوم
- البحث داخل مكتبتك وتصفيتها
- إنشاء مجموعات مفلترة حسب الوسوم ومستوى الجهد
- ضبط إعدادات الجدولة للمراجعات القادمة
- تصدير مساحة العمل الحالية إلى CSV
- استخدام دردشة الذكاء الاصطناعي لاستكشاف بطاقاتك وتحسين محتواها والتخطيط للمذاكرة
- إرفاق الصور والملفات بمطالبات الذكاء الاصطناعي، أو استخدام الإملاء الصوتي على الأجهزة المدعومة
- تسجيل الدخول بالبريد الإلكتروني ومزامنة مساحة العمل بين الأجهزة
- استخدام الخدمة الرسمية أو ربط إعداد خادم مخصص

لماذا يستخدمه الناس:
- الذكاء الاصطناعي جزء من طريقة المذاكرة نفسها، وليس إضافة جانبية
- جلسات مراجعة سريعة مع فوضى أقل واحتكاك أقل
- تنظيم قوي عبر المجموعات والوسوم والفلاتر وإعدادات الجدولة
- منتج مفتوح المصدر مع إمكانية الاستضافة الذاتية
- تجربة Android أصلية مبنية على Material 3

هذا التطبيق مناسب للطلاب، ومتعلمي اللغات، وطلاب الطب، والمطورين، وكل من يريد تطبيقا جادا لبطاقات المراجعة يجمع بين الذكاء الاصطناعي والتكرار المتباعد ومذاكرة يومية واضحة.

المشروع مفتوح المصدر، بحيث يمكنك الاطلاع على كامل المكدس والبناء عليه واستضافته بنفسك.

جميع شيفرات التطبيق والخلفية والبنية التحتية متاحة بشكل مفتوح على GitHub:
https://github.com/kirill-markin/flashcards-open-source-app

### Release notes

أصبح اسم التطبيق Nibomo (كان سابقا بطاقات تعليم مفتوحة المصدر).

## Chinese (Simplified) - zh-CN

### App Name

Nibomo: AI 闪卡

### Short Description

把笔记和照片变成闪卡，并用间隔重复记住它们

### Full Description

如果你学的东西必须记住，Nibomo 就是为你准备的 AI 闪卡应用。

Nibomo 以前叫开源闪卡。

Nibomo 帮助你备考、积累词汇、记忆医学和技术内容、用 AI 改进卡片，并建立稳定而认真的日常学习习惯。

适合用来：
- 备考和课程复习
- 语言学习和词汇积累
- 医学、技术等需要大量记忆的学习内容
- 用 AI 优化卡片并规划学习节奏
- 通过牌组、标签和间隔重复进行高效日常复习

你可以做什么：
- 通过专注的间隔重复流程复习到期卡片
- 用正面文本、背面文本、牌组和标签快速创建与编辑卡片
- 搜索并筛选自己的卡片库
- 按标签和学习强度创建筛选牌组
- 调整后续复习的调度设置
- 将当前工作区导出为 CSV
- 使用 AI 聊天探索卡片、优化内容并规划学习
- 向 AI 提示附加图片和文件，或在支持的设备上使用语音输入
- 通过邮箱登录，在多台设备之间同步工作区
- 使用官方服务，或连接自定义服务器配置

为什么大家会选择它：
- AI 是学习流程的一部分，不是额外附加功能
- 复习节奏更快，界面更干净，干扰更少
- 通过牌组、标签、筛选和调度设置获得更强的组织能力
- 开源产品，可按需自托管
- 原生 Material 3 Android 体验

无论你是学生、语言学习者、医学学习者、开发者，还是任何想认真学习的人，这都是一款把 AI、间隔重复和清晰日常学习流程结合在一起的闪卡应用。

项目完全开源，你可以查看整套技术栈、继续扩展，也可以自己托管。

应用、后端和基础设施的全部代码都已在 GitHub 开放：
https://github.com/kirill-markin/flashcards-open-source-app

### Release notes

应用现已更名为 Nibomo（原名开源闪卡）。

## French - fr-FR

### App Name

Nibomo : Flashcards IA

### Short Description

Notes et photos en fiches de révision, mémorisées par répétition espacée

### Full Description

Révisez avec une application de fiches propulsée par l'IA, pensée pour celles et ceux qui doivent vraiment retenir ce qu'ils apprennent.

Nibomo s'appelait avant Flashcards open source.

Nibomo vous aide à préparer vos examens, à apprendre du vocabulaire, à mémoriser des contenus médicaux et techniques, à améliorer vos cartes avec l'IA et à tenir une vraie routine de révision quotidienne.

À utiliser pour :
- préparer vos examens, du brevet au bac et aux études supérieures
- apprendre une langue et enrichir votre vocabulaire
- réviser la médecine, les matières techniques et tout ce qui demande beaucoup de mémorisation
- améliorer vos cartes et planifier vos révisions avec l'IA
- réviser vite chaque jour avec des paquets, des étiquettes et la répétition espacée

Ce que vous pouvez faire :
- réviser les cartes du jour dans un flux de répétition espacée sans distraction
- créer et modifier vos cartes avec recto, verso, paquets et étiquettes
- chercher et filtrer dans votre bibliothèque
- construire des paquets filtrés selon les étiquettes et le niveau d'effort
- ajuster les réglages du planificateur pour les prochaines révisions
- exporter votre espace de travail actuel en CSV
- utiliser le chat IA pour explorer vos cartes, améliorer leur contenu et organiser vos révisions
- joindre des photos et des fichiers à vos requêtes IA, ou dicter à la voix sur les appareils compatibles
- vous connecter par e-mail et synchroniser votre espace de travail entre vos appareils
- utiliser le service officiel ou connecter votre propre serveur

Pourquoi on l'utilise :
- l'IA fait partie de la révision, ce n'est pas un module ajouté à côté
- des sessions rapides, avec moins de désordre et moins de friction
- une organisation solide avec paquets, étiquettes, filtres et réglages de planning
- un produit open source, avec hébergement autonome possible
- une expérience Android native en Material 3

L'application convient aux lycéens, aux étudiants, aux personnes qui apprennent une langue, aux étudiants en médecine, aux développeurs et à tous ceux qui veulent une vraie application de fiches avec IA, répétition espacée et un rythme de révision clair.

Le projet est open source, donc vous pouvez inspecter toute la pile technique, construire dessus et l'héberger vous-même.

Tout le code de l'application, du backend et de l'infrastructure est ouvert et disponible sur GitHub :
https://github.com/kirill-markin/flashcards-open-source-app

### Release notes

Nibomo est maintenant disponible en français, de l'interface au chat IA.

## German - de-DE

### App Name

Nibomo: KI-Karteikarten

### Short Description

Aus Notizen und Fotos Karteikarten machen und mit Spaced Repetition lernen

### Full Description

Lerne mit einer KI-gestützten Karteikarten-App, wenn du das Gelernte wirklich behalten willst.

Nibomo hieß früher Open-Source-Karteikarten.

Nibomo hilft dir bei der Prüfungsvorbereitung, beim Vokabellernen, beim Einprägen medizinischer und technischer Inhalte, beim Verbessern deiner Karten mit KI und beim Aufbau einer ernsthaften täglichen Lernroutine.

Nutze sie für:
- Prüfungsvorbereitung und Studium
- Sprachenlernen und Vokabeltraining
- Medizinische, technische und andere lernintensive Inhalte
- KI-gestützte Verbesserung deiner Karten und Studienplanung
- Schnelle tägliche Wiederholung mit Stapeln, Tags und Spaced Repetition

Was du damit tun kannst:
- Fällige Karten in einem fokussierten Spaced-Repetition-Ablauf wiederholen
- Karten mit Vorderseite, Rückseite, Stapeln und Tags schnell erstellen und bearbeiten
- Deine Bibliothek durchsuchen und filtern
- Gefilterte Stapel nach Tags und Lernaufwand aufbauen
- Planungseinstellungen für kommende Wiederholungen anpassen
- Deinen aktuellen Workspace als CSV exportieren
- Mit KI-Chat deine Karten erkunden, Inhalte verbessern und dein Lernen planen
- Fotos und Dateien an KI-Prompts anhängen oder auf unterstützten Geräten Spracheingabe nutzen
- Dich per E-Mail anmelden und deinen Workspace geräteübergreifend synchronisieren
- Den offiziellen Dienst nutzen oder eine eigene Serverkonfiguration verbinden

Warum Menschen sie nutzen:
- KI ist Teil des Lernablaufs und kein angeflanschtes Extra
- Schnelle Wiederholungen mit weniger Reibung und weniger Unruhe
- Starke Organisation über Stapel, Tags, Filter und Planungseinstellungen
- Open-Source-Produkt mit Möglichkeit zum Self-Hosting
- Native Material 3 Android-Erfahrung

Die App passt zu Studierenden, Sprachlernenden, Medizinerinnen und Medizinern, Entwicklerinnen und Entwicklern und allen, die eine ernsthafte Karteikarten-App mit KI, Spaced Repetition und einem klaren täglichen Lernfluss wollen.

Das Projekt ist Open Source, sodass du den gesamten Stack einsehen, erweitern und selbst hosten kannst.

Der gesamte Code für App, Backend und Infrastruktur ist offen auf GitHub verfügbar:
https://github.com/kirill-markin/flashcards-open-source-app

### Release notes

Die App heißt jetzt Nibomo (früher Open-Source-Karteikarten).

## Hindi - hi-IN

### App Name

Nibomo: AI फ्लैशकार्ड

### Short Description

नोट्स और फोटो से फ्लैशकार्ड बनाएं और स्पेस्ड रिपिटीशन से याद रखें

### Full Description

अगर आपको सच में याद रखना है कि आप क्या पढ़ रहे हैं, तो यह AI-संचालित फ्लैशकार्ड ऐप आपके लिए है।

Nibomo को पहले ओपन सोर्स फ्लैशकार्ड कहा जाता था।

Nibomo परीक्षा की तैयारी, शब्दावली सीखने, मेडिकल और तकनीकी सामग्री याद रखने, AI की मदद से कार्ड सुधारने और रोज़ की गंभीर पढ़ाई की आदत बनाने में मदद करता है।

इसे इन कामों के लिए इस्तेमाल करें:
- परीक्षा की तैयारी और कोर्सवर्क
- भाषा सीखना और शब्दावली बढ़ाना
- मेडिकल, तकनीकी और दूसरी ऐसी पढ़ाई जिनमें बहुत याद रखना पड़ता है
- AI की मदद से कार्ड बेहतर बनाना और पढ़ाई की योजना करना
- डेक, टैग और स्पेस्ड रिपिटीशन के साथ तेज़ रोज़ाना रिव्यू

आप क्या कर सकते हैं:
- फोकस्ड स्पेस्ड रिपिटीशन फ्लो के साथ due कार्ड रिव्यू करें
- फ्रंट टेक्स्ट, बैक टेक्स्ट, डेक और टैग के साथ कार्ड जल्दी बनाएं और एडिट करें
- अपनी लाइब्रेरी को खोजें और फिल्टर करें
- टैग और प्रयास-स्तर के आधार पर filtered deck बनाएं
- आगे की रिव्यू के लिए scheduler settings बदलें
- अपना current workspace CSV में export करें
- AI chat से अपने कार्ड समझें, कंटेंट बेहतर करें और पढ़ाई की योजना बनाएं
- AI prompts में फोटो और फाइल जोड़ें, या supported devices पर voice dictation का इस्तेमाल करें
- ईमेल से sign in करें और अपना workspace अलग-अलग devices पर sync करें
- official service का इस्तेमाल करें या custom server configuration जोड़ें

लोग इसे क्यों पसंद करते हैं:
- AI पढ़ाई के workflow का हिस्सा है, कोई अलग से जोड़ी गई चीज़ नहीं
- तेज़ रिव्यू, कम रुकावट और कम बेकार का clutter
- डेक, टैग, फिल्टर और scheduling controls के साथ मजबूत संगठन
- ओपन सोर्स प्रोडक्ट, जिसे self-host भी किया जा सकता है
- Native Material 3 Android अनुभव

यह ऐप छात्रों, भाषा सीखने वालों, मेडिकल learners, डेवलपर्स और उन सभी लोगों के लिए सही है जो AI, स्पेस्ड रिपिटीशन और साफ़ रोज़ाना study flow वाला गंभीर फ्लैशकार्ड ऐप चाहते हैं।

यह प्रोजेक्ट ओपन सोर्स है, इसलिए आप पूरा stack देख सकते हैं, उस पर काम कर सकते हैं और चाहें तो खुद host भी कर सकते हैं।

ऐप, बैकएंड और इन्फ्रास्ट्रक्चर का पूरा कोड GitHub पर खुला उपलब्ध है:
https://github.com/kirill-markin/flashcards-open-source-app

### Release notes

ऐप का नाम अब Nibomo है (पहले ओपन सोर्स फ्लैशकार्ड)।

## Japanese - ja-JP

### App Name

Nibomo: AI暗記カード

### Short Description

ノートや写真から暗記カードを作り、間隔反復で覚えられます

### Full Description

学んだことを本当に定着させたい人のための、AI 搭載フラッシュカードアプリです。

Nibomo は以前「オープンソース暗記カード」という名前でした。

Nibomo は、試験対策、語彙学習、医療や技術分野の暗記、AI によるカード改善、そして毎日の学習習慣づくりを支えます。

こんな用途に向いています:
- 試験対策や授業の復習
- 語学学習と語彙強化
- 医学、技術分野など大量の記憶が必要な学習
- AI を使ったカード改善と学習計画
- デッキ、タグ、間隔反復による毎日の効率的な復習

できること:
- 期日が来たカードを集中しやすい間隔反復フローで復習
- 表面テキスト、裏面テキスト、デッキ、タグ付きでカードをすばやく作成・編集
- 自分のライブラリを検索・絞り込み
- タグや学習負荷に応じたフィルターデッキを作成
- 今後の復習に向けてスケジューラ設定を調整
- 現在のワークスペースを CSV として書き出し
- AI チャットでカードを掘り下げ、内容を改善し、学習計画を立てる
- AI プロンプトに写真やファイルを添付し、対応端末では音声入力も利用可能
- メールでサインインし、ワークスペースを端末間で同期
- 公式サービスを使うことも、独自サーバー設定をつなぐことも可能

選ばれる理由:
- AI は学習フローの一部であり、後付けの機能ではない
- 復習は速く、画面はすっきり、余計な摩擦が少ない
- デッキ、タグ、フィルター、スケジュール設定でしっかり整理できる
- オープンソースで、必要ならセルフホストも可能
- Android らしい Material 3 のネイティブ体験

学生、語学学習者、医療系学習者、開発者、そして AI と間隔反復で本気の学習を続けたい人に向いたフラッシュカードアプリです。

このプロジェクトはオープンソースなので、スタック全体を確認し、拡張し、必要なら自分でホストすることもできます。

アプリ、バックエンド、インフラのすべてのコードは GitHub で公開されています:
https://github.com/kirill-markin/flashcards-open-source-app

### Release notes

アプリ名が Nibomo になりました（旧「オープンソース暗記カード」）。

## Portuguese (Brazil) - pt-BR

### App Name

Nibomo: Flashcards com IA

### Short Description

Transforme notas e fotos em flashcards e memorize com repetição espaçada

### Full Description

Estude com um app de flashcards com IA feito para quem precisa mesmo lembrar o que aprendeu.

O Nibomo se chamava antes Flashcards de código aberto.

O Nibomo ajuda você a se preparar para provas, aprender vocabulário, memorizar conteúdo médico e técnico, melhorar seus cartões com IA e manter uma rotina séria de estudo diário.

Use para:
- estudar para o ENEM, vestibulares, concursos e a faculdade
- aprender idiomas e ampliar o vocabulário
- revisar medicina, matérias técnicas e tudo o que exige muita memorização
- melhorar seus cartões e planejar o estudo com ajuda da IA
- revisar rápido todo dia com baralhos, etiquetas e repetição espaçada

O que dá para fazer:
- revisar os cartões do dia num fluxo de repetição espaçada sem distração
- criar e editar cartões com frente, verso, baralhos e etiquetas
- buscar e filtrar sua biblioteca
- montar baralhos filtrados por etiqueta e nível de esforço
- ajustar as configurações do agendador para as próximas revisões
- exportar seu workspace atual em CSV
- usar o chat com IA para explorar seus cartões, melhorar o conteúdo e planejar o estudo
- anexar fotos e arquivos aos pedidos para a IA, ou ditar por voz nos aparelhos compatíveis
- entrar com e-mail e sincronizar seu workspace entre aparelhos
- usar o serviço oficial ou conectar um servidor próprio

Por que as pessoas usam:
- a IA faz parte do jeito de estudar, não é um extra pregado do lado
- sessões de revisão rápidas, com menos bagunça e menos atrito
- organização forte com baralhos, etiquetas, filtros e controle de agendamento
- produto de código aberto, com hospedagem própria opcional
- experiência Android nativa em Material 3

O app serve para vestibulandos, concurseiros, quem aprende idiomas, estudantes de medicina, desenvolvedores e qualquer pessoa que queira um app de flashcards sério, com IA, repetição espaçada e um estudo diário limpo.

O projeto é de código aberto, então você pode inspecionar toda a stack, construir em cima e hospedar por conta própria.

Todo o código do app, do backend e da infraestrutura está aberto e disponível no GitHub:
https://github.com/kirill-markin/flashcards-open-source-app

### Release notes

O Nibomo agora está disponível em português do Brasil, da interface ao chat com IA.

## Russian - ru-RU

### App Name

Nibomo: ИИ-флешкарты

### Short Description

Превращайте заметки и фото в карточки и учите их интервальными повторениями

### Full Description

Если вам важно действительно запоминать то, что вы учите, это приложение для флешкарт с ИИ создано для вас.

Раньше Nibomo назывался «Флешкарты с открытым кодом».

Nibomo помогает готовиться к экзаменам, учить слова, запоминать медицинский и технический материал, улучшать карточки с помощью ИИ и выстраивать серьезную ежедневную учебную практику.

Подходит для:
- подготовки к экзаменам и учебным курсам
- изучения языков и расширения словарного запаса
- медицины, технических дисциплин и других направлений, где нужно много запоминать
- улучшения карточек и планирования учебы с помощью ИИ
- быстрой ежедневной практики с колодами, тегами и интервальными повторениями

Что можно делать:
- повторять карточки к сроку в сфокусированном режиме интервальных повторений
- быстро создавать и редактировать карточки с лицевой стороной, обратной стороной, колодами и тегами
- искать и фильтровать свою библиотеку
- собирать фильтрованные колоды по тегам и уровню нагрузки
- настраивать параметры расписания для будущих повторений
- экспортировать текущее рабочее пространство в CSV
- использовать ИИ-чат, чтобы разбирать карточки, улучшать их содержание и планировать учебу
- прикреплять фото и файлы к запросам для ИИ или использовать голосовой ввод на поддерживаемых устройствах
- входить по электронной почте и синхронизировать рабочее пространство между устройствами
- использовать официальный сервис или подключать собственную конфигурацию сервера

Почему выбирают это приложение:
- ИИ встроен в учебный процесс, а не добавлен для галочки
- Повторение идет быстрее, интерфейс чище, лишнего трения меньше
- Сильная организация через колоды, теги, фильтры и настройки расписания
- Открытый исходный код и возможность самостоятельного хостинга
- Нативный Android-опыт в духе Material 3

Это приложение подходит студентам, изучающим языки, учащимся медицинских направлений, разработчикам и всем, кому нужна серьезная система флешкарт с ИИ, интервальными повторениями и понятным ежедневным учебным ритмом.

Проект с открытым кодом: можно посмотреть весь стек, развивать его дальше и при желании хостить самостоятельно.

Весь код приложения, бэкенда и инфраструктуры открыт и доступен на GitHub:
https://github.com/kirill-markin/flashcards-open-source-app

### Release notes

Приложение теперь называется Nibomo (раньше «Флешкарты с открытым кодом»).

## Spanish (Latin America) - es-419

### App Name

Nibomo: Flashcards con IA

### Short Description

Convierte notas y fotos en flashcards y recuérdalas con repetición espaciada

### Full Description

Si de verdad necesitas recordar lo que estudias, esta app de flashcards con IA está hecha para ti.

Nibomo se llamaba antes Flashcards de código abierto.

Nibomo te ayuda a preparar exámenes, aprender vocabulario, memorizar contenido médico y técnico, mejorar tus tarjetas con IA y sostener un hábito de estudio diario y serio.

Úsala para:
- preparar exámenes y materias
- aprender idiomas y ampliar vocabulario
- estudiar medicina, temas técnicos y otros contenidos que exigen mucha memorización
- mejorar tus tarjetas y planear tu estudio con ayuda de IA
- hacer repasos diarios rápidos con mazos, etiquetas y repetición espaciada

Qué puedes hacer:
- repasar tarjetas pendientes con un flujo enfocado de repetición espaciada
- crear y editar tarjetas rápido con texto frontal, texto posterior, mazos y etiquetas
- buscar y filtrar tu biblioteca
- armar mazos filtrados según etiquetas y nivel de esfuerzo
- ajustar la configuración de programación para los repasos futuros
- exportar tu espacio de trabajo actual a CSV
- usar chat con IA para explorar tus tarjetas, mejorar su contenido y planear tu estudio
- adjuntar fotos y archivos a los prompts de IA, o usar dictado por voz en dispositivos compatibles
- iniciar sesión con correo y sincronizar tu espacio de trabajo entre dispositivos
- usar el servicio oficial o conectar una configuración de servidor personalizada

Por qué la gente la usa:
- la IA forma parte del flujo de estudio, no es un extra pegado al producto
- repasos más rápidos, menos fricción y menos distracciones
- organización sólida con mazos, etiquetas, filtros y controles de programación
- producto de código abierto con opción de autoalojamiento
- experiencia Android nativa con Material 3

Es una app pensada para estudiantes, personas que aprenden idiomas, estudiantes de medicina, desarrolladores y cualquiera que quiera una app de flashcards seria con IA, repetición espaciada y una rutina de estudio clara.

El proyecto es de código abierto, así que puedes revisar todo el stack, ampliarlo y alojarlo por tu cuenta.

Todo el código de la app, el backend y la infraestructura está abierto y disponible en GitHub:
https://github.com/kirill-markin/flashcards-open-source-app

### Release notes

La app ahora se llama Nibomo (antes Flashcards de código abierto).

## Spanish (Spain) - es-ES

### App Name

Nibomo: Flashcards con IA

### Short Description

Convierte notas y fotos en flashcards y recuérdalas con repetición espaciada

### Full Description

Si de verdad quieres recordar lo que estudias, esta app de flashcards con IA está hecha para ti.

Nibomo se llamaba antes Flashcards de código abierto.

Nibomo te ayuda a preparar exámenes, aprender vocabulario, memorizar contenido médico y técnico, mejorar tus tarjetas con IA y mantener una rutina diaria de estudio seria.

Úsala para:
- preparar exámenes y asignaturas
- aprender idiomas y mejorar vocabulario
- estudiar medicina, temas técnicos y otros contenidos que exigen mucha memorización
- mejorar tus tarjetas y planificar el estudio con ayuda de IA
- hacer repasos diarios rápidos con mazos, etiquetas y repetición espaciada

Qué puedes hacer:
- repasar tarjetas pendientes con un flujo centrado de repetición espaciada
- crear y editar tarjetas rápidamente con texto frontal, texto trasero, mazos y etiquetas
- buscar y filtrar tu biblioteca
- montar mazos filtrados según etiquetas y nivel de esfuerzo
- ajustar la configuración del planificador para los próximos repasos
- exportar tu espacio de trabajo actual a CSV
- usar chat con IA para explorar tus tarjetas, mejorar su contenido y planificar el estudio
- adjuntar fotos y archivos a los prompts de IA, o usar dictado por voz en dispositivos compatibles
- iniciar sesión con correo y sincronizar tu espacio de trabajo entre dispositivos
- usar el servicio oficial o conectar una configuración de servidor personalizada

Por qué la gente la usa:
- la IA forma parte del flujo de estudio, no es un añadido de última hora
- repasos más rápidos, menos fricción y menos distracciones
- organización sólida con mazos, etiquetas, filtros y controles de planificación
- producto de código abierto con posibilidad de autoalojamiento
- experiencia Android nativa con Material 3

Es una app pensada para estudiantes, personas que aprenden idiomas, estudiantes de medicina, desarrolladores y cualquiera que busque una app de flashcards seria con IA, repetición espaciada y un flujo diario de estudio claro.

El proyecto es de código abierto, así que puedes revisar todo el stack, ampliarlo y alojarlo por tu cuenta.

Todo el código de la app, el backend y la infraestructura está abierto y disponible en GitHub:
https://github.com/kirill-markin/flashcards-open-source-app

### Release notes

La app ahora se llama Nibomo (antes Flashcards de código abierto).

## Spanish (United States) - es-US

### App Name

Nibomo: Flashcards con IA

### Short Description

Convierte notas y fotos en flashcards y recuérdalas con repetición espaciada

### Full Description

Si de verdad quieres recordar lo que estudias, esta app de flashcards con IA está hecha para ti.

Nibomo se llamaba antes Flashcards de código abierto.

Nibomo te ayuda a preparar exámenes, aprender vocabulario, memorizar contenido médico y técnico, mejorar tus tarjetas con IA y mantener una rutina diaria de estudio seria.

Úsala para:
- preparar exámenes y materias
- aprender idiomas y ampliar vocabulario
- estudiar medicina, temas técnicos y otros contenidos que exigen mucha memorización
- mejorar tus tarjetas y planear tu estudio con ayuda de IA
- hacer repasos diarios rápidos con mazos, etiquetas y repetición espaciada

Qué puedes hacer:
- repasar tarjetas pendientes con un flujo enfocado de repetición espaciada
- crear y editar tarjetas rápido con texto frontal, texto posterior, mazos y etiquetas
- buscar y filtrar tu biblioteca
- armar mazos filtrados según etiquetas y nivel de esfuerzo
- ajustar la configuración de programación para los repasos futuros
- exportar tu espacio de trabajo actual a CSV
- usar chat con IA para explorar tus tarjetas, mejorar su contenido y planear tu estudio
- adjuntar fotos y archivos a los prompts de IA, o usar dictado por voz en dispositivos compatibles
- iniciar sesión con correo y sincronizar tu espacio de trabajo entre dispositivos
- usar el servicio oficial o conectar una configuración de servidor personalizada

Por qué la gente la usa:
- la IA forma parte del flujo de estudio, no es un extra pegado al producto
- repasos más rápidos, menos fricción y menos distracciones
- organización sólida con mazos, etiquetas, filtros y controles de programación
- producto de código abierto con opción de autoalojamiento
- experiencia Android nativa con Material 3

Es una app pensada para estudiantes, personas que aprenden idiomas, estudiantes de medicina, desarrolladores y cualquiera que quiera una app de flashcards seria con IA, repetición espaciada y una rutina de estudio clara.

El proyecto es de código abierto, así que puedes revisar todo el stack, ampliarlo y alojarlo por tu cuenta.

Todo el código de la app, el backend y la infraestructura está abierto y disponible en GitHub:
https://github.com/kirill-markin/flashcards-open-source-app

### Release notes

La app ahora se llama Nibomo (antes Flashcards de código abierto).

## Bulgarian - bg

### App Name

Nibomo: Флашкарти с ИИ

### Short Description

Превърнете бележки и снимки във флашкарти и учете с интервални повторения

### Full Description

Nibomo е приложение за флашкарти с изкуствен интелект за хора, които искат да запомнят наученото. Предишното му име е Flashcards Open Source App.

Подгответе се за изпити, учете думи и преговаряйте медицински и технически материал. ИИ помага да подобрите картите и да планирате ученето, а тестетата, етикетите и интервалните повторения улесняват ежедневния преговор.

Какво можете да правите:
- Преговаряте дължимите карти в режим за съсредоточено учене с интервални повторения
- Създавате и редактирате карти с текст на лицевата и обратната страна, тестета и етикети
- Търсите и филтрирате библиотеката си
- Създавате филтрирани тестета според етикетите и нивото на усилие
- Настройвате графика за бъдещи повторения
- Експортирате текущото работно пространство в CSV
- Обсъждате картите с ИИ, подобрявате съдържанието и планирате ученето
- Прикачвате снимки и файлове към заявки до ИИ или използвате гласово въвеждане на поддържани устройства
- Влизате с имейл и синхронизирате работното пространство между устройства
- Използвате официалната услуга или свързвате собствен сървър

ИИ е част от учебния процес. Преговаряте бързо, с по-малко разсейване и излишни стъпки. Тестетата, етикетите, филтрите и настройките за повторение поддържат материала подреден. Приложението предлага нативно Android изживяване с Material 3.

Nibomo е подходящо за ученици и студенти, изучаващи езици, бъдещи лекари и медицински сестри, разработчици и всеки, който иска да изгради редовен навик за учене с флашкарти и ИИ.

Проектът е с отворен код. Можете да разгледате целия стек, да го доразвивате и да го хоствате сами. Кодът на приложението, сървърната част и инфраструктурата е достъпен в GitHub:
https://github.com/kirill-markin/flashcards-open-source-app

## Bengali (Bangladesh) - bn-BD

### App Name

Nibomo: AI ফ্ল্যাশকার্ড

### Short Description

নোট ও ছবি থেকে ফ্ল্যাশকার্ড বানান, বিরতি দিয়ে অনুশীলনে মনে রাখুন

### Full Description

যা শিখছেন তা মনে রাখতে Nibomo-তে AI-এর সাহায্যে ফ্ল্যাশকার্ড দিয়ে পড়ুন। অ্যাপটির আগের নাম ছিল Flashcards Open Source App।

পরীক্ষার প্রস্তুতি নিন, নতুন শব্দ শিখুন, চিকিৎসা ও প্রযুক্তির বিষয় মনে রাখুন। AI দিয়ে কার্ডের মান বাড়ান এবং পড়ার পরিকল্পনা করুন। কার্ডের সেট, ট্যাগ এবং বিরতি দিয়ে পুনরাবৃত্তি করার পদ্ধতি প্রতিদিনের পড়া গুছিয়ে রাখতে সাহায্য করে।

যা করতে পারবেন:
- সময় হলে কার্ডগুলো মনোযোগ দিয়ে আবার পড়ুন, নির্দিষ্ট বিরতিতে পুনরাবৃত্তি করুন
- সামনে ও পেছনের লেখা, সেট ও ট্যাগসহ ফ্ল্যাশকার্ড তৈরি ও সম্পাদনা করুন
- নিজের লাইব্রেরিতে খুঁজুন ও ফিল্টার করুন
- ট্যাগ ও প্রয়োজনীয় পরিশ্রমের মাত্রা অনুযায়ী ফিল্টার করা কার্ডের সেট বানান
- পরের বার পড়ার জন্য সময়সূচির সেটিংস বদলান
- বর্তমান ওয়ার্কস্পেস CSV ফাইলে রপ্তানি করুন
- AI চ্যাটে কার্ড নিয়ে আলোচনা করুন, লেখা উন্নত করুন এবং পড়ার পরিকল্পনা করুন
- AI-কে প্রশ্ন করার সময় ছবি ও ফাইল যোগ করুন, অথবা সমর্থিত ডিভাইসে মুখে বলে লিখুন
- ইমেইল দিয়ে প্রবেশ করুন এবং একাধিক ডিভাইসে ওয়ার্কস্পেস সিঙ্ক করুন
- অফিসিয়াল সেবা ব্যবহার করুন বা নিজের সার্ভার যুক্ত করুন

AI পড়ার কাজের সঙ্গেই যুক্ত। কম জটিলতা ও কম অপ্রয়োজনীয় উপাদানের মধ্যে দ্রুত পড়া ঝালিয়ে নিন। সেট, ট্যাগ, ফিল্টার ও সময়সূচির নিয়ন্ত্রণে পড়া সাজিয়ে রাখুন। Material 3 দিয়ে তৈরি অ্যাপটি Android-এর নিজস্ব ব্যবহাররীতি মেনে চলে।

শিক্ষার্থী, ভাষাশিক্ষার্থী, চিকিৎসা ও নার্সিংয়ের শিক্ষার্থী, ডেভেলপার এবং নিয়মিত ফ্ল্যাশকার্ড দিয়ে পড়তে চান এমন সবার জন্য Nibomo।

প্রকল্পটি ওপেন সোর্স। পুরো সফটওয়্যার দেখে বুঝতে, তার ওপর নতুন কিছু তৈরি করতে এবং নিজের সার্ভারে চালাতে পারবেন। অ্যাপ, ব্যাকএন্ড ও অবকাঠামোর সব কোড GitHub-এ পাওয়া যায়:
https://github.com/kirill-markin/flashcards-open-source-app

## Catalan - ca

### App Name

Nibomo: Targetes amb IA

### Short Description

Crea targetes amb apunts i fotos i recorda-les amb repetició espaiada

### Full Description

Nibomo és una app de targetes d’estudi amb IA per a qui necessita recordar allò que aprèn. Abans es deia Flashcards Open Source App.

Prepara exàmens i assignatures, aprèn vocabulari i repassa contingut mèdic i tècnic. La IA t’ajuda a millorar les targetes i a planificar l’estudi. Els conjunts de targetes, les etiquetes i la repetició espaiada faciliten el repàs diari.

Què hi pots fer:
- Repassar les targetes pendents amb un procés de repetició espaiada que t’ajuda a concentrar-te
- Crear i editar targetes amb text a l’anvers i al revers, conjunts i etiquetes
- Cercar i filtrar la biblioteca
- Crear conjunts filtrats per etiquetes i nivell d’esforç
- Ajustar la programació dels repassos futurs
- Exportar l’espai de treball actual a CSV
- Conversar amb la IA sobre les targetes, millorar-ne el contingut i planificar l’estudi
- Adjuntar fotos i fitxers a les peticions a la IA o fer servir el dictat en dispositius compatibles
- Iniciar sessió amb el correu electrònic i sincronitzar l’espai de treball entre dispositius
- Utilitzar el servei oficial o connectar-hi un servidor propi

La IA forma part de l’estudi. Les sessions de repàs són ràpides i tenen pocs elements que distreguin. Organitza el material amb conjunts, etiquetes, filtres i controls de programació, en una experiència nativa d’Android amb Material 3.

Nibomo és per a estudiants, persones que aprenen idiomes, estudiants de medicina i infermeria, desenvolupadors i qualsevol persona que vulgui estudiar cada dia amb targetes, IA i repetició espaiada.

El projecte és de codi obert: pots examinar tota la tecnologia, ampliar-la i allotjar-la pel teu compte. Tot el codi de l’app, del servidor i de la infraestructura és a GitHub:
https://github.com/kirill-markin/flashcards-open-source-app

## Czech - cs-CZ

### App Name

Nibomo: Kartičky s AI

### Short Description

Z poznámek a fotek tvořte kartičky a učte se opakováním v rozestupech

### Full Description

Nibomo je aplikace s výukovými kartičkami a AI pro každého, kdo si chce zapamatovat, co se učí. Dříve se jmenovala Flashcards Open Source App.

Připravujte se na zkoušky, učte se slovíčka a opakujte si medicínské i technické učivo. AI pomáhá vylepšovat kartičky a plánovat učení. Balíčky, štítky a opakování v rozestupech usnadňují pravidelnou každodenní přípravu.

Co můžete dělat:
- Soustředěně opakovat kartičky, na které přišel čas
- Vytvářet a upravovat kartičky s textem na přední i zadní straně, balíčky a štítky
- Prohledávat a filtrovat knihovnu
- Sestavovat filtrované balíčky podle štítků a náročnosti
- Nastavovat plánování budoucích opakování
- Exportovat aktuální pracovní prostor do CSV
- Probírat kartičky v chatu s AI, vylepšovat obsah a plánovat učení
- Přikládat k zadáním pro AI fotky a soubory nebo na podporovaných zařízeních diktovat hlasem
- Přihlásit se e-mailem a synchronizovat pracovní prostor mezi zařízeními
- Používat oficiální službu nebo připojit vlastní server

AI je součástí učení. Opakování je rychlé, s méně rušivými prvky a zbytečnými kroky. Balíčky, štítky, filtry a nastavení rozvrhu udržují materiály přehledné. Aplikace nabízí nativní prostředí Androidu s Material 3.

Nibomo se hodí studentům, lidem učícím se jazyky, budoucím lékařům a zdravotním sestrám, vývojářům i každému, kdo chce pravidelně studovat s kartičkami, AI a opakováním v rozestupech.

Projekt má otevřený zdrojový kód. Můžete prozkoumat celý systém, rozvíjet ho a provozovat na vlastním serveru. Kód aplikace, backendu i infrastruktury je na GitHubu:
https://github.com/kirill-markin/flashcards-open-source-app

## Danish - da-DK

### App Name

Nibomo: Flashcards med AI

### Short Description

Lav noter og fotos til flashcards, og husk med repetition med mellemrum

### Full Description

Nibomo er en flashcard-app med AI til dig, der har brug for at huske det, du lærer. Appen hed tidligere Flashcards Open Source App.

Forbered dig til eksamener, lær nye ord, og øv medicinsk og teknisk stof. Brug AI til at forbedre dine kort og planlægge studierne. Kortsæt, tags og repetition med mellemrum gør det nemmere at holde fast i den daglige øvelse.

Det kan du gøre:
- Repetere de kort, der står for tur, i et fokuseret forløb med gentagelser med mellemrum
- Oprette og redigere kort med tekst på for- og bagside, kortsæt og tags
- Søge og filtrere i dit bibliotek
- Lave filtrerede kortsæt ud fra tags og indsatsniveau
- Tilpasse planlægningen af kommende repetition
- Eksportere dit nuværende arbejdsområde til CSV
- Tale med AI om dine kort, forbedre indholdet og planlægge din læring
- Vedhæfte fotos og filer til AI-beskeder eller bruge stemmediktering på understøttede enheder
- Logge ind med e-mail og synkronisere dit arbejdsområde på tværs af enheder
- Bruge den officielle tjeneste eller tilslutte din egen server

AI indgår i selve studiearbejdet. Korte repetitionsforløb med færre forstyrrelser og unødige trin gør det let at komme i gang. Hold styr på stoffet med kortsæt, tags, filtre og planlægningsindstillinger i en app bygget til Android med Material 3.

Nibomo passer til studerende, sprogkursister, medicin- og sygeplejestuderende, udviklere og alle, der vil have en fast studierutine med flashcards, AI og repetition med mellemrum.

Projektet er open source. Du kan undersøge hele systemet, bygge videre på det og selv hoste det. Al kode til appen, backend og infrastrukturen findes på GitHub:
https://github.com/kirill-markin/flashcards-open-source-app

## Greek - el-GR

### App Name

Nibomo: Κάρτες με AI

### Short Description

Μάθε με κάρτες από σημειώσεις και φωτογραφίες και επανάλαβε σε διαστήματα

### Full Description

Το Nibomo είναι μια εφαρμογή καρτών με τεχνητή νοημοσύνη για να θυμάσαι όσα μαθαίνεις. Η προηγούμενη ονομασία του ήταν Flashcards Open Source App.

Προετοιμάσου για εξετάσεις και μαθήματα, μάθε λεξιλόγιο και επανάλαβε ιατρική και τεχνική ύλη. Η AI σε βοηθά να βελτιώνεις τις κάρτες και να οργανώνεις το διάβασμα. Τα σετ καρτών, οι ετικέτες και οι επαναλήψεις σε χρονικά διαστήματα στηρίζουν την καθημερινή μελέτη.

Τι μπορείς να κάνεις:
- Να επαναλαμβάνεις τις κάρτες που είναι προγραμματισμένες για μελέτη, χωρίς περισπασμούς
- Να δημιουργείς και να επεξεργάζεσαι κάρτες με κείμενο στις δύο πλευρές, σετ και ετικέτες
- Να αναζητάς και να φιλτράρεις τη βιβλιοθήκη σου
- Να φτιάχνεις φιλτραρισμένα σετ ανά ετικέτα και επίπεδο προσπάθειας
- Να ρυθμίζεις τον προγραμματισμό των επόμενων επαναλήψεων
- Να εξάγεις τον τρέχοντα χώρο εργασίας σε CSV
- Να συζητάς τις κάρτες με την AI, να βελτιώνεις το περιεχόμενο και να σχεδιάζεις τη μελέτη
- Να επισυνάπτεις φωτογραφίες και αρχεία στα αιτήματα προς την AI ή να χρησιμοποιείς φωνητική υπαγόρευση σε συμβατές συσκευές
- Να συνδέεσαι με email και να συγχρονίζεις τον χώρο εργασίας μεταξύ συσκευών
- Να χρησιμοποιείς την επίσημη υπηρεσία ή να συνδέεις δικό σου διακομιστή

Η AI είναι μέρος της μελέτης. Οι γρήγορες επαναλήψεις έχουν λιγότερα περιττά βήματα και περισπασμούς. Σετ, ετικέτες, φίλτρα και ρυθμίσεις προγραμματισμού κρατούν την ύλη οργανωμένη. Η εφαρμογή ακολουθεί το περιβάλλον Android με Material 3.

Το Nibomo απευθύνεται σε μαθητές, φοιτητές, όσους μαθαίνουν γλώσσες, σπουδαστές ιατρικής και νοσηλευτικής, προγραμματιστές και όποιον θέλει σταθερή καθημερινή μελέτη με κάρτες και AI.

Ο κώδικας είναι ανοιχτός: μπορείς να εξετάσεις όλο το σύστημα, να το επεκτείνεις και να το φιλοξενήσεις μόνος σου. Ο κώδικας της εφαρμογής, του backend και της υποδομής βρίσκεται στο GitHub:
https://github.com/kirill-markin/flashcards-open-source-app

## Estonian - et

### App Name

Nibomo: AI õpikaardid

### Short Description

Loo märkmetest ja fotodest õpikaardid ning õpi hajutatud kordamisega

### Full Description

Nibomo on tehisintellektiga õpikaardirakendus neile, kes tahavad õpitut ka mäletada. Rakenduse varasem nimi oli Flashcards Open Source App.

Valmistu eksamiteks ja õppetööks, õpi sõnavara ning korda meditsiini- ja tehnikateemasid. AI aitab kaarte parandada ja õppimist kavandada. Kaardipakid, sildid ja hajutatud kordamine toetavad igapäevast õppimisharjumust.

Mida saad teha:
- Korrata keskendunult kaarte, mille kordamisaeg on kätte jõudnud
- Luua ja muuta kaarte esi- ja tagakülje teksti, kaardipakkide ning siltidega
- Otsida oma kogust ja seda filtreerida
- Koostada filtreeritud kaardipakke siltide ja pingutustaseme järgi
- Muuta tulevaste kordamiste ajastamise seadeid
- Eksportida praeguse tööruumi CSV-failina
- Arutada kaarte AI-vestluses, parandada sisu ja kavandada õppimist
- Lisada AI-le saadetavatele päringutele fotosid ja faile või kasutada toetatud seadmetes häälsisestust
- Logida sisse e-postiga ja sünkroonida tööruumi seadmete vahel
- Kasutada ametlikku teenust või ühendada oma serveri

AI on osa õppimisest. Kordamine käib kiiresti, vähemate segajate ja tarbetute sammudega. Kaardipakid, sildid, filtrid ja ajastamise seaded hoiavad materjali korras. Rakendus pakub Androidile omast kasutuskogemust Material 3 kujundusega.

Nibomo sobib õpilastele, üliõpilastele, keeleõppijatele, meditsiini- ja õendusüliõpilastele, arendajatele ning kõigile, kes tahavad iga päev õpikaartide, AI ja hajutatud kordamise abil õppida.

Projekt on avatud lähtekoodiga. Saad kogu süsteemi uurida, edasi arendada ja ise majutada. Rakenduse, serveri ja taristu kood on GitHubis:
https://github.com/kirill-markin/flashcards-open-source-app

## Persian - fa

### App Name

Nibomo: فلش‌کارت هوشمند

### Short Description

یادداشت و عکس را به فلش‌کارت تبدیل کنید و با مرور فاصله‌دار به خاطر بسپارید

### Full Description

Nibomo یک برنامهٔ فلش‌کارت با هوش مصنوعی است برای کسانی که می‌خواهند آموخته‌هایشان را به خاطر بسپارند. نام قبلی آن Flashcards Open Source App بود.

برای امتحان‌ها و درس‌ها آماده شوید، واژه یاد بگیرید و مطالب پزشکی و فنی را مرور کنید. هوش مصنوعی به بهبود کارت‌ها و برنامه‌ریزی مطالعه کمک می‌کند. دسته‌های کارت، برچسب‌ها و مرور فاصله‌دار، تمرین روزانه را منظم می‌کنند.

با Nibomo می‌توانید:
- کارت‌هایی را که زمان مرورشان رسیده، با تمرکز و در فاصله‌های زمانی مرور کنید
- کارت‌ها را با متن رو و پشت، دسته و برچسب بسازید و ویرایش کنید
- در مجموعهٔ خود جست‌وجو کنید و فیلتر بگذارید
- بر اساس برچسب و میزان تلاش لازم، دسته‌های فیلترشده بسازید
- تنظیمات زمان‌بندی مرورهای آینده را تغییر دهید
- فضای کاری فعلی را به صورت CSV خروجی بگیرید
- دربارهٔ کارت‌ها با هوش مصنوعی گفت‌وگو کنید، محتوا را بهبود دهید و برای مطالعه برنامه بریزید
- به درخواست‌های هوش مصنوعی عکس و فایل پیوست کنید یا در دستگاه‌های پشتیبانی‌شده از تایپ صوتی استفاده کنید
- با ایمیل وارد شوید و فضای کاری را بین دستگاه‌ها همگام کنید
- از سرویس رسمی استفاده کنید یا سرور خودتان را متصل کنید

هوش مصنوعی بخشی از روند مطالعه است. مرورها سریع‌اند و مراحل اضافی و عوامل حواس‌پرتی کمترند. دسته‌ها، برچسب‌ها، فیلترها و تنظیمات زمان‌بندی، مطالب را مرتب نگه می‌دارند. برنامه با Material 3 و هماهنگ با محیط بومی Android ساخته شده است.

Nibomo برای دانش‌آموزان، دانشجویان، زبان‌آموزان، دانشجویان پزشکی و پرستاری، توسعه‌دهندگان و هر کسی مناسب است که می‌خواهد با فلش‌کارت، هوش مصنوعی و مرور فاصله‌دار، هر روز مطالعه کند.

پروژه متن‌باز است. می‌توانید کل سیستم را بررسی کنید، توسعه دهید و روی سرور خودتان میزبانی کنید. کد برنامه، بخش سرور و زیرساخت در GitHub در دسترس است:
https://github.com/kirill-markin/flashcards-open-source-app

## Finnish - fi-FI

### App Name

Nibomo: AI-muistikortit

### Short Description

Tee muistiinpanoista ja kuvista muistikortteja ja opi hajautetulla kertaamisella

### Full Description

Nibomo on tekoälyä hyödyntävä muistikorttisovellus sinulle, joka haluat muistaa oppimasi. Sovelluksen aiempi nimi oli Flashcards Open Source App.

Valmistaudu kokeisiin ja kursseille, opi sanastoa ja kertaa lääketieteen sekä tekniikan sisältöjä. Tekoäly auttaa parantamaan kortteja ja suunnittelemaan opiskelua. Korttipakat, tunnisteet ja hajautettu kertaaminen tukevat päivittäistä opiskelurutiinia.

Mitä voit tehdä:
- Kerrata vuorossa olevat kortit keskittyneesti sopivin väliajoin
- Luoda ja muokata kortteja, joissa on etu- ja kääntöpuolen teksti, pakat ja tunnisteet
- Hakea ja suodattaa kirjastosi sisältöä
- Koota suodatettuja pakkoja tunnisteiden ja vaativuustason mukaan
- Säätää tulevien kertausten ajoitusta
- Viedä nykyisen työtilan CSV-tiedostoksi
- Keskustella korteista tekoälyn kanssa, parantaa sisältöä ja suunnitella opiskelua
- Liittää tekoälypyyntöihin kuvia ja tiedostoja tai käyttää sanelua tuetuilla laitteilla
- Kirjautua sähköpostilla ja synkronoida työtilan eri laitteille
- Käyttää virallista palvelua tai yhdistää oman palvelimen

Tekoäly on osa opiskelua. Kertaus sujuu nopeasti ilman turhia vaiheita ja häiritseviä elementtejä. Pakat, tunnisteet, suodattimet ja ajoitusasetukset pitävät materiaalin järjestyksessä. Material 3 tuo sovellukseen Androidille ominaisen käyttökokemuksen.

Nibomo sopii opiskelijoille, kieltenopiskelijoille, lääketieteen ja hoitoalan opiskelijoille, ohjelmistokehittäjille ja kaikille, jotka haluavat opiskella päivittäin muistikorttien, tekoälyn ja hajautetun kertaamisen avulla.

Projekti on avointa lähdekoodia. Voit tutkia koko järjestelmää, kehittää sitä ja ylläpitää sitä itse. Sovelluksen, taustapalvelun ja infrastruktuurin koodi on GitHubissa:
https://github.com/kirill-markin/flashcards-open-source-app

## Gujarati - gu

### App Name

Nibomo: AI ફ્લેશકાર્ડ્સ

### Short Description

નોંધો અને ફોટામાંથી ફ્લેશકાર્ડ બનાવો અને અંતરાલે પુનરાવર્તન કરીને યાદ રાખો

### Full Description

શીખેલું યાદ રાખવા માટે Nibomoમાં AIની મદદથી ફ્લેશકાર્ડ સાથે અભ્યાસ કરો. આ ઍપનું અગાઉનું નામ Flashcards Open Source App હતું.

પરીક્ષાઓ અને અભ્યાસક્રમની તૈયારી કરો, નવા શબ્દો શીખો અને તબીબી તથા તકનીકી વિષયોનું પુનરાવર્તન કરો. AIથી કાર્ડ સુધારો અને અભ્યાસનું આયોજન કરો. કાર્ડના સેટ, ટૅગ અને સમયાંતરે પુનરાવર્તન રોજ અભ્યાસ કરવાની ટેવ કેળવવામાં મદદ કરે છે.

તમે શું કરી શકો:
- જે કાર્ડનો સમય થયો હોય તેનું ધ્યાનપૂર્વક, નક્કી કરેલા અંતરાલે પુનરાવર્તન કરો
- આગળ અને પાછળના લખાણ, સેટ અને ટૅગ સાથે કાર્ડ બનાવો અને સંપાદિત કરો
- તમારી લાઇબ્રેરીમાં શોધો અને ફિલ્ટર કરો
- ટૅગ અને જરૂરી મહેનતના સ્તર મુજબ ફિલ્ટર કરેલા સેટ બનાવો
- ભવિષ્યના પુનરાવર્તન માટે સમયપત્રકની સેટિંગ્સ બદલો
- હાલની કાર્યજગ્યા CSV તરીકે નિકાસ કરો
- AI ચૅટમાં કાર્ડ વિશે ચર્ચા કરો, સામગ્રી સુધારો અને અભ્યાસનું આયોજન કરો
- AI માટેની વિનંતીઓમાં ફોટા અને ફાઇલો જોડો અથવા સમર્થિત ઉપકરણો પર બોલીને લખો
- ઇમેઇલથી સાઇન ઇન કરો અને ઉપકરણો વચ્ચે કાર્યજગ્યા સિંક કરો
- સત્તાવાર સેવા વાપરો અથવા તમારું પોતાનું સર્વર જોડો

AI અભ્યાસની પ્રક્રિયાનો જ ભાગ છે. ઓછાં વિક્ષેપો અને બિનજરૂરી પગલાં સાથે ઝડપથી પુનરાવર્તન કરો. સેટ, ટૅગ, ફિલ્ટર અને સમયપત્રકના નિયંત્રણોથી સામગ્રી ગોઠવેલી રાખો. Material 3 સાથે બનાવેલી ઍપ Androidની પોતાની ઉપયોગશૈલીને અનુસરે છે.

વિદ્યાર્થીઓ, ભાષા શીખનારાઓ, તબીબી અને નર્સિંગના વિદ્યાર્થીઓ, ડેવલપરો તથા ફ્લેશકાર્ડ અને AI સાથે રોજ અભ્યાસ કરવા ઇચ્છતા દરેક માટે Nibomo છે.

આ પ્રોજેક્ટ ઓપન સોર્સ છે. તમે આખી સિસ્ટમ જોઈ શકો, તેમાં ઉમેરો કરી શકો અને તેને તમારા સર્વર પર ચલાવી શકો. ઍપ, બૅકએન્ડ અને ઇન્ફ્રાસ્ટ્રક્ચરનો બધો કોડ GitHub પર ઉપલબ્ધ છે:
https://github.com/kirill-markin/flashcards-open-source-app

## Hebrew - iw-IL

### App Name

Nibomo: כרטיסיות עם AI

### Short Description

הפכו סיכומים ותמונות לכרטיסיות וזכרו את החומר בעזרת חזרות מרווחות

### Full Description

Nibomo היא אפליקציית כרטיסיות עם בינה מלאכותית למי שרוצים לזכור את מה שהם לומדים. שמה הקודם היה Flashcards Open Source App.

התכוננו למבחנים ולקורסים, למדו אוצר מילים וחזרו על חומר רפואי וטכני. הבינה המלאכותית עוזרת לשפר כרטיסיות ולתכנן את הלמידה. חפיסות, תגיות וחזרות מרווחות מקלות על התרגול היומי.

מה אפשר לעשות:
- לחזור בריכוז על הכרטיסיות שהגיע זמנן, במרווחי זמן מתוכננים
- ליצור ולערוך כרטיסיות עם טקסט בחזית ובגב, חפיסות ותגיות
- לחפש ולסנן בספרייה שלכם
- ליצור חפיסות מסוננות לפי תגיות ורמת מאמץ
- להתאים את הגדרות התזמון לחזרות הבאות
- לייצא את סביבת העבודה הנוכחית לקובץ CSV
- לשוחח עם הבינה המלאכותית על הכרטיסיות, לשפר את התוכן ולתכנן את הלימוד
- לצרף תמונות וקבצים לבקשות מהבינה המלאכותית או להשתמש בהכתבה קולית במכשירים נתמכים
- להתחבר בדוא״ל ולסנכרן את סביבת העבודה בין מכשירים
- להשתמש בשירות הרשמי או לחבר שרת משלכם

הבינה המלאכותית היא חלק מתהליך הלמידה. החזרות מהירות, עם פחות הסחות דעת ושלבים מיותרים. חפיסות, תגיות, מסננים והגדרות תזמון עוזרים לארגן את החומר. האפליקציה מציעה חוויית Android טבעית עם Material 3.

Nibomo מתאימה לתלמידים, לסטודנטים, ללומדי שפות, לסטודנטים לרפואה ולסיעוד, למפתחים ולכל מי שרוצים שגרת לימוד יומית עם כרטיסיות, בינה מלאכותית וחזרות מרווחות.

הפרויקט הוא בקוד פתוח. אפשר לבדוק את המערכת כולה, להרחיב אותה ולהפעיל אותה בשרת שלכם. הקוד של האפליקציה, צד השרת והתשתית זמין ב-GitHub:
https://github.com/kirill-markin/flashcards-open-source-app

## Croatian - hr

### App Name

Nibomo: Kartice uz AI

### Short Description

Pretvori bilješke i fotografije u kartice i uči ponavljanjem u razmacima

### Full Description

Nibomo je aplikacija s karticama i umjetnom inteligencijom za sve koji žele zapamtiti ono što uče. Prijašnji naziv aplikacije bio je Flashcards Open Source App.

Pripremi se za ispite i nastavu, uči nove riječi te ponavljaj medicinsko i tehničko gradivo. AI ti pomaže poboljšati kartice i planirati učenje. Špilovi, oznake i ponavljanje u razmacima olakšavaju svakodnevnu vježbu.

Što možeš raditi:
- Usredotočeno ponavljati kartice kojima je došao red za ponavljanje
- Izrađivati i uređivati kartice s tekstom na prednjoj i stražnjoj strani, špilovima i oznakama
- Pretraživati i filtrirati svoju zbirku
- Sastavljati filtrirane špilove prema oznakama i potrebnom trudu
- Prilagođavati raspored budućih ponavljanja
- Izvesti trenutačni radni prostor u CSV
- Razgovarati s AI-jem o karticama, poboljšavati sadržaj i planirati učenje
- Prilagati fotografije i datoteke upitima za AI ili diktirati na podržanim uređajima
- Prijaviti se e-poštom i sinkronizirati radni prostor među uređajima
- Koristiti službenu uslugu ili povezati vlastiti poslužitelj

AI je dio procesa učenja. Ponavljaj brzo, uz manje ometanja i nepotrebnih koraka. Špilovi, oznake, filtri i postavke rasporeda drže gradivo urednim. Aplikacija pruža izvorno Android iskustvo uz Material 3.

Nibomo je namijenjen učenicima, studentima, onima koji uče jezike, studentima medicine i sestrinstva, programerima te svima koji žele svakodnevno učiti uz kartice, AI i ponavljanje u razmacima.

Projekt je otvorenog koda. Možeš pregledati cijeli sustav, nadograđivati ga i samostalno ga hostati. Kod aplikacije, poslužiteljskog dijela i infrastrukture dostupan je na GitHubu:
https://github.com/kirill-markin/flashcards-open-source-app

## Hungarian - hu-HU

### App Name

Nibomo: AI-tanulókártyák

### Short Description

Készíts kártyákat jegyzetekből és fotókból, tanulj időzített ismétléssel

### Full Description

A Nibomo mesterséges intelligenciával segített tanulókártya-alkalmazás azoknak, akik emlékezni szeretnének arra, amit megtanultak. Korábban Flashcards Open Source App néven volt ismert.

Készülj vizsgákra és órákra, tanulj szavakat, ismételj orvosi és műszaki tananyagot. Az AI segít javítani a kártyákon és megtervezni a tanulást. A paklik, címkék és időzített ismétlések támogatják a napi gyakorlást.

Mire használhatod:
- Az esedékes kártyák összpontosított, időközönkénti ismétlésére
- Kártyák létrehozására és szerkesztésére elő- és hátoldali szöveggel, paklikkal és címkékkel
- Keresésre és szűrésre a gyűjteményedben
- Szűrt paklik összeállítására címkék és a szükséges erőfeszítés alapján
- A jövőbeli ismétlések ütemezésének beállítására
- Az aktuális munkaterület CSV-exportálására
- A kártyák megbeszélésére az AI-val, a tartalom javítására és a tanulás tervezésére
- Fotók és fájlok csatolására az AI-nak küldött kérésekhez, valamint diktálásra a támogatott eszközökön
- E-mailes bejelentkezésre és a munkaterület eszközök közötti szinkronizálására
- A hivatalos szolgáltatás használatára vagy saját szerver csatlakoztatására

Az AI a tanulás része. Gyorsan ismételhetsz, kevesebb zavaró elemmel és felesleges lépéssel. A paklik, címkék, szűrők és ütemezési beállítások rendben tartják az anyagot. Az alkalmazás natív Android-élményt nyújt a Material 3 segítségével.

A Nibomo diákoknak, nyelvtanulóknak, orvosi és ápolási képzésben részt vevőknek, fejlesztőknek és mindenkinek szól, aki naponta tanulna kártyákkal, AI-val és időzített ismétléssel.

A projekt nyílt forráskódú. Átnézheted a teljes rendszert, továbbfejlesztheted, és saját szerveren is futtathatod. Az alkalmazás, a háttérrendszer és az infrastruktúra kódja elérhető a GitHubon:
https://github.com/kirill-markin/flashcards-open-source-app

## Indonesian - id

### App Name

Nibomo: Flashcard AI

### Short Description

Ubah catatan dan foto jadi flashcard, lalu ingat dengan pengulangan berjarak

### Full Description

Nibomo adalah aplikasi flashcard berbantuan AI untuk kamu yang ingin mengingat apa yang dipelajari. Sebelumnya, aplikasi ini bernama Flashcards Open Source App.

Siapkan diri untuk ujian dan pelajaran, pelajari kosakata, serta ulangi materi medis dan teknis. AI membantu memperbaiki kartu dan merencanakan belajar. Set kartu, tag, dan pengulangan berjarak memudahkan latihan setiap hari.

Yang bisa kamu lakukan:
- Mengulang kartu yang sudah waktunya dipelajari dalam sesi pengulangan berjarak yang terfokus
- Membuat dan mengedit kartu dengan teks depan dan belakang, set kartu, serta tag
- Mencari dan memfilter koleksi
- Membuat set kartu terfilter berdasarkan tag dan tingkat usaha
- Mengatur penjadwalan untuk pengulangan berikutnya
- Mengekspor ruang kerja saat ini ke CSV
- Membahas kartu lewat chat AI, memperbaiki isinya, dan menyusun rencana belajar
- Melampirkan foto dan file ke permintaan AI atau memakai dikte suara pada perangkat yang mendukungnya
- Masuk dengan email dan menyinkronkan ruang kerja antarperangkat
- Memakai layanan resmi atau menghubungkan server sendiri

AI menjadi bagian dari proses belajar. Ulangi materi dengan cepat, lebih sedikit gangguan, dan tanpa banyak langkah tambahan. Atur materi dengan set kartu, tag, filter, dan pengaturan jadwal. Aplikasi ini mengikuti pengalaman Android native dengan Material 3.

Nibomo cocok untuk pelajar, mahasiswa, pembelajar bahasa, mahasiswa kedokteran dan keperawatan, developer, serta siapa pun yang ingin belajar rutin dengan flashcard, AI, dan pengulangan berjarak.

Proyek ini bersifat open source. Kamu bisa memeriksa seluruh sistem, mengembangkannya, dan menjalankannya di server sendiri. Semua kode aplikasi, backend, dan infrastruktur tersedia di GitHub:
https://github.com/kirill-markin/flashcards-open-source-app

## Icelandic - is-IS

### App Name

Nibomo: Námskort með AI

### Short Description

Breyttu glósum og myndum í námskort og lærðu með endurtekningu með millibili

### Full Description

Nibomo er námskortaforrit með gervigreind fyrir fólk sem vill muna það sem það lærir. Forritið hét áður Flashcards Open Source App.

Undirbúðu þig fyrir próf og námskeið, lærðu orðaforða og rifjaðu upp læknisfræði og tæknilegt efni. Gervigreind hjálpar þér að bæta kortin og skipuleggja námið. Kortastokkar, merki og endurtekning með millibili auðvelda daglega upprifjun.

Þetta geturðu gert:
- Rifjað einbeitt upp kort sem komið er að, með endurtekningu með millibili
- Búið til og breytt kortum með texta á fram- og bakhlið, stokkum og merkjum
- Leitað í safninu þínu og síað það
- Búið til síaða stokka eftir merkjum og áreynslustigi
- Stillt tímasetningar fyrir upprifjun í framtíðinni
- Flutt núverandi vinnusvæði út sem CSV
- Rætt kortin við gervigreind, bætt efnið og skipulagt námið
- Hengt myndir og skrár við beiðnir til gervigreindar eða notað raddinnslátt í tækjum sem styðja hann
- Skráð þig inn með netfangi og samstillt vinnusvæðið milli tækja
- Notað opinberu þjónustuna eða tengt eigin þjón

Gervigreind er hluti af náminu. Upprifjunin gengur hratt, með færri truflunum og óþarfa skrefum. Stokkar, merki, síur og tímastillingar halda utan um námsefnið. Forritið fylgir hefðum Android og notar Material 3.

Nibomo hentar nemendum, tungumálanemum, lækna- og hjúkrunarnemum, forriturum og öllum sem vilja læra daglega með námskortum, gervigreind og endurtekningu með millibili.

Verkefnið er opinn hugbúnaður. Þú getur skoðað allt kerfið, byggt ofan á það og hýst það á eigin þjóni. Allur kóði forritsins, bakendans og innviðanna er aðgengilegur á GitHub:
https://github.com/kirill-markin/flashcards-open-source-app

## Italian - it-IT

### App Name

Nibomo: Flashcard con IA

### Short Description

Trasforma appunti e foto in flashcard e impara con la ripetizione dilazionata

### Full Description

Nibomo è un’app di flashcard con IA per chi vuole ricordare quello che studia. Prima si chiamava Flashcards Open Source App.

Prepara esami e lezioni, impara nuovi vocaboli e ripassa contenuti medici e tecnici. L’IA ti aiuta a migliorare le carte e a pianificare lo studio. Mazzi, etichette e ripetizione dilazionata rendono più semplice il ripasso quotidiano.

Cosa puoi fare:
- Ripassare le carte in scadenza con un percorso di ripetizione dilazionata che aiuta a concentrarsi
- Creare e modificare carte con testo sul fronte e sul retro, mazzi ed etichette
- Cercare e filtrare nella tua raccolta
- Creare mazzi filtrati per etichette e livello di impegno
- Regolare la pianificazione dei ripassi futuri
- Esportare l’area di lavoro attuale in CSV
- Discutere le carte nella chat con IA, migliorare i contenuti e pianificare lo studio
- Allegare foto e file alle richieste per l’IA o usare la dettatura sui dispositivi compatibili
- Accedere con l’email e sincronizzare l’area di lavoro tra dispositivi
- Usare il servizio ufficiale o collegare un server personale

L’IA fa parte del modo di studiare. Le sessioni di ripasso sono rapide, con meno distrazioni e passaggi superflui. Mazzi, etichette, filtri e impostazioni di pianificazione tengono in ordine il materiale. L’app offre un’esperienza Android nativa con Material 3.

Nibomo è pensata per studenti, persone che imparano le lingue, studenti di medicina e infermieristica, sviluppatori e chiunque voglia studiare ogni giorno con flashcard, IA e ripetizione dilazionata.

Il progetto è open source: puoi esaminare l’intero sistema, ampliarlo e ospitarlo sul tuo server. Tutto il codice dell’app, del backend e dell’infrastruttura è disponibile su GitHub:
https://github.com/kirill-markin/flashcards-open-source-app

## Kannada (India) - kn-IN

### App Name

Nibomo: AI ಫ್ಲ್ಯಾಶ್‌ಕಾರ್ಡ್

### Short Description

ಟಿಪ್ಪಣಿ, ಫೋಟೋಗಳಿಂದ ಕಾರ್ಡ್ ರಚಿಸಿ; ಅಂತರ ಬಿಟ್ಟು ಅಭ್ಯಾಸ ಮಾಡಿ ನೆನಪಿಡಿ

### Full Description

ಕಲಿತದ್ದು ನೆನಪಿನಲ್ಲಿ ಉಳಿಯಲು Nibomoದಲ್ಲಿ AI ನೆರವಿನ ಫ್ಲ್ಯಾಶ್‌ಕಾರ್ಡ್‌ಗಳೊಂದಿಗೆ ಓದಿ. ಈ ಆ್ಯಪ್‌ನ ಹಿಂದಿನ ಹೆಸರು Flashcards Open Source App.

ಪರೀಕ್ಷೆಗಳಿಗೆ ಮತ್ತು ಪಾಠಗಳಿಗೆ ಸಿದ್ಧರಾಗಿ, ಹೊಸ ಪದಗಳನ್ನು ಕಲಿಯಿರಿ, ವೈದ್ಯಕೀಯ ಮತ್ತು ತಾಂತ್ರಿಕ ವಿಷಯಗಳನ್ನು ಪುನರಭ್ಯಾಸ ಮಾಡಿ. AI ಬಳಸಿ ಕಾರ್ಡ್‌ಗಳನ್ನು ಸುಧಾರಿಸಿ ಮತ್ತು ಓದಿನ ಯೋಜನೆ ರೂಪಿಸಿ. ಕಾರ್ಡ್‌ಗಳ ಗುಂಪುಗಳು, ಟ್ಯಾಗ್‌ಗಳು ಮತ್ತು ಅಂತರ ಬಿಟ್ಟು ಮಾಡುವ ಪುನರಭ್ಯಾಸ ದಿನವೂ ಓದುವ ಅಭ್ಯಾಸಕ್ಕೆ ನೆರವಾಗುತ್ತವೆ.

ನೀವು ಮಾಡಬಹುದಾದ ಕೆಲಸಗಳು:
- ಪುನರಭ್ಯಾಸದ ಸಮಯ ಬಂದ ಕಾರ್ಡ್‌ಗಳನ್ನು ಏಕಾಗ್ರತೆಯಿಂದ, ನಿಗದಿತ ಅಂತರಗಳಲ್ಲಿ ಓದಿರಿ
- ಮುಂಭಾಗ ಮತ್ತು ಹಿಂಭಾಗದ ಪಠ್ಯ, ಗುಂಪುಗಳು ಮತ್ತು ಟ್ಯಾಗ್‌ಗಳೊಂದಿಗೆ ಕಾರ್ಡ್ ರಚಿಸಿ, ತಿದ್ದಿ
- ನಿಮ್ಮ ಸಂಗ್ರಹದಲ್ಲಿ ಹುಡುಕಿ ಮತ್ತು ಫಿಲ್ಟರ್ ಮಾಡಿ
- ಟ್ಯಾಗ್ ಮತ್ತು ಬೇಕಾಗುವ ಪ್ರಯತ್ನದ ಮಟ್ಟದ ಆಧಾರದ ಮೇಲೆ ಫಿಲ್ಟರ್ ಮಾಡಿದ ಗುಂಪುಗಳನ್ನು ರಚಿಸಿ
- ಮುಂದಿನ ಪುನರಭ್ಯಾಸಗಳ ವೇಳಾಪಟ್ಟಿಯ ಸೆಟ್ಟಿಂಗ್‌ಗಳನ್ನು ಬದಲಿಸಿ
- ಈಗಿನ ಕಾರ್ಯಕ್ಷೇತ್ರವನ್ನು CSV ಆಗಿ ರಫ್ತು ಮಾಡಿ
- AI ಚಾಟ್‌ನಲ್ಲಿ ಕಾರ್ಡ್‌ಗಳ ಬಗ್ಗೆ ಚರ್ಚಿಸಿ, ವಿಷಯ ಸುಧಾರಿಸಿ ಮತ್ತು ಓದಿನ ಯೋಜನೆ ರೂಪಿಸಿ
- AIಗೆ ನೀಡುವ ವಿನಂತಿಗಳಿಗೆ ಫೋಟೋ ಮತ್ತು ಫೈಲ್‌ಗಳನ್ನು ಸೇರಿಸಿ, ಅಥವಾ ಬೆಂಬಲಿತ ಸಾಧನಗಳಲ್ಲಿ ಮಾತಿನ ಮೂಲಕ ಪಠ್ಯ ನಮೂದಿಸಿ
- ಇಮೇಲ್ ಮೂಲಕ ಪ್ರವೇಶಿಸಿ ಮತ್ತು ಸಾಧನಗಳ ನಡುವೆ ಕಾರ್ಯಕ್ಷೇತ್ರವನ್ನು ಸಿಂಕ್ ಮಾಡಿ
- ಅಧಿಕೃತ ಸೇವೆಯನ್ನು ಬಳಸಿ ಅಥವಾ ನಿಮ್ಮ ಸ್ವಂತ ಸರ್ವರ್ ಸಂಪರ್ಕಿಸಿ

AI ಓದುವ ಪ್ರಕ್ರಿಯೆಯ ಭಾಗವಾಗಿದೆ. ಕಡಿಮೆ ಅಡೆತಡೆಗಳು ಮತ್ತು ಅನಗತ್ಯ ಹಂತಗಳೊಂದಿಗೆ ಬೇಗನೆ ಪುನರಭ್ಯಾಸ ಮಾಡಿ. ಗುಂಪುಗಳು, ಟ್ಯಾಗ್‌ಗಳು, ಫಿಲ್ಟರ್‌ಗಳು ಮತ್ತು ವೇಳಾಪಟ್ಟಿ ನಿಯಂತ್ರಣಗಳಿಂದ ವಿಷಯವನ್ನು ಅಚ್ಚುಕಟ್ಟಾಗಿ ಇಡಿ. Material 3 ಬಳಸಿ ನಿರ್ಮಿಸಿದ ಆ್ಯಪ್ Androidನ ಸಹಜ ಬಳಕೆಯ ರೀತಿಯನ್ನು ಅನುಸರಿಸುತ್ತದೆ.

ವಿದ್ಯಾರ್ಥಿಗಳು, ಭಾಷೆ ಕಲಿಯುವವರು, ವೈದ್ಯಕೀಯ ಮತ್ತು ನರ್ಸಿಂಗ್ ವಿದ್ಯಾರ್ಥಿಗಳು, ಡೆವಲಪರ್‌ಗಳು ಹಾಗೂ ಕಾರ್ಡ್ ಮತ್ತು AI ನೆರವಿನಿಂದ ದಿನವೂ ಓದಲು ಬಯಸುವ ಎಲ್ಲರಿಗೂ Nibomo ಸೂಕ್ತವಾಗಿದೆ.

ಈ ಯೋಜನೆ ಮುಕ್ತ ಮೂಲದ್ದಾಗಿದೆ. ಇಡೀ ವ್ಯವಸ್ಥೆಯನ್ನು ಪರಿಶೀಲಿಸಬಹುದು, ವಿಸ್ತರಿಸಬಹುದು ಮತ್ತು ನಿಮ್ಮ ಸರ್ವರ್‌ನಲ್ಲಿ ನಡೆಸಬಹುದು. ಆ್ಯಪ್, ಬ್ಯಾಕೆಂಡ್ ಮತ್ತು ಮೂಲಸೌಕರ್ಯದ ಎಲ್ಲ ಕೋಡ್ GitHubನಲ್ಲಿ ಲಭ್ಯವಿದೆ:
https://github.com/kirill-markin/flashcards-open-source-app

## Korean - ko-KR

### App Name

Nibomo: AI 암기카드

### Short Description

노트와 사진으로 암기카드를 만들고 간격 반복으로 오래 기억하세요

### Full Description

Nibomo는 배운 내용을 기억하고 싶은 사람을 위한 AI 암기카드 앱입니다. 이전 이름은 Flashcards Open Source App이었습니다.

시험과 수업을 준비하고, 어휘를 익히고, 의학 및 기술 분야의 내용을 복습하세요. AI로 카드를 다듬고 학습 계획을 세울 수 있습니다. 카드 묶음, 태그, 간격 반복으로 매일 꾸준히 공부하는 습관을 만들어 보세요.

주요 기능:
- 복습할 때가 된 카드를 간격 반복 방식으로 집중해서 학습
- 앞면과 뒷면의 텍스트, 카드 묶음, 태그를 포함한 카드 만들기 및 편집
- 내 라이브러리 검색 및 필터링
- 태그와 필요한 노력 수준에 따라 필터링된 카드 묶음 만들기
- 앞으로의 복습 일정 설정 조정
- 현재 작업 공간을 CSV로 내보내기
- AI 채팅으로 카드를 살펴보고 내용을 개선하며 학습 계획 세우기
- AI 요청에 사진과 파일 첨부 또는 지원 기기에서 음성 입력 사용
- 이메일로 로그인하고 기기 간 작업 공간 동기화
- 공식 서비스 사용 또는 직접 운영하는 서버 연결

AI가 학습 과정에 함께합니다. 불필요한 단계와 방해 요소를 줄여 빠르게 복습할 수 있습니다. 카드 묶음, 태그, 필터, 일정 설정으로 학습 자료를 정리하세요. Material 3를 사용해 Android에 자연스럽게 어울리는 사용 경험을 제공합니다.

Nibomo는 학생, 외국어 학습자, 의학 및 간호학 학습자, 개발자뿐 아니라 AI와 간격 반복을 활용해 매일 암기카드로 공부하고 싶은 누구에게나 적합합니다.

이 프로젝트는 오픈 소스입니다. 전체 시스템을 살펴보고 확장하거나 직접 호스팅할 수 있습니다. 앱, 백엔드, 인프라의 모든 코드는 GitHub에서 확인할 수 있습니다:
https://github.com/kirill-markin/flashcards-open-source-app

## Lithuanian - lt

### App Name

Nibomo: Kortelės su DI

### Short Description

Paverskite užrašus ir nuotraukas kortelėmis, mokykitės kartodami su pertraukomis

### Full Description

Nibomo – mokymosi kortelių programėlė su dirbtiniu intelektu tiems, kurie nori prisiminti, ką išmoko. Ankstesnis jos pavadinimas buvo Flashcards Open Source App.

Ruoškitės egzaminams ir paskaitoms, mokykitės žodžių, kartokite medicinos ir technikos temas. DI padeda tobulinti korteles ir planuoti mokymąsi. Kortelių rinkiniai, žymos ir kartojimas intervalais palengvina kasdienę praktiką.

Ką galite daryti:
- Susikaupę kartoti korteles, kurioms atėjo kartojimo laikas
- Kurti ir redaguoti korteles su tekstu priekinėje bei galinėje pusėje, rinkiniais ir žymomis
- Ieškoti savo bibliotekoje ir filtruoti jos turinį
- Sudaryti filtruotus rinkinius pagal žymas ir pastangų lygį
- Keisti būsimų kartojimų tvarkaraščio nustatymus
- Eksportuoti dabartinę darbo sritį į CSV
- Aptarti korteles pokalbyje su DI, tobulinti turinį ir planuoti mokymąsi
- Prie užklausų DI pridėti nuotraukų ir failų arba palaikomuose įrenginiuose diktuoti balsu
- Prisijungti el. paštu ir sinchronizuoti darbo sritį tarp įrenginių
- Naudotis oficialia paslauga arba prijungti savo serverį

DI yra mokymosi proceso dalis. Kartokite greitai, su mažiau blaškančių elementų ir nereikalingų veiksmų. Rinkiniai, žymos, filtrai ir tvarkaraščio valdymas padeda palaikyti tvarką. Programėlė sukurta pagal Android naudojimo įpročius ir naudoja Material 3.

Nibomo tinka moksleiviams, studentams, besimokantiems kalbų, medicinos ir slaugos studentams, programuotojams bei visiems, norintiems kasdien mokytis su kortelėmis, DI ir kartojimu intervalais.

Projektas yra atvirojo kodo. Galite peržiūrėti visą sistemą, ją plėtoti ir patys talpinti serveryje. Programėlės, serverio dalies ir infrastruktūros kodas pasiekiamas GitHub:
https://github.com/kirill-markin/flashcards-open-source-app

## Latvian - lv

### App Name

Nibomo: Kartītes ar MI

### Short Description

Pārvērt piezīmes un foto mācību kartītēs un atceries ar atkārtošanu intervālos

### Full Description

Nibomo ir mācību kartīšu lietotne ar mākslīgo intelektu tiem, kuri vēlas atcerēties apgūto. Iepriekš tā saucās Flashcards Open Source App.

Gatavojies eksāmeniem un nodarbībām, mācies jaunus vārdus un atkārto medicīnas un tehnikas tēmas. MI palīdz uzlabot kartītes un plānot mācības. Kartīšu komplekti, birkas un atkārtošana intervālos atvieglo ikdienas mācīšanos.

Ko vari darīt:
- Koncentrēti atkārtot kartītes, kurām pienācis atkārtošanas laiks
- Veidot un rediģēt kartītes ar tekstu priekšpusē un aizmugurē, komplektiem un birkām
- Meklēt savā bibliotēkā un filtrēt saturu
- Veidot filtrētus komplektus pēc birkām un piepūles līmeņa
- Pielāgot turpmāko atkārtojumu plānošanas iestatījumus
- Eksportēt pašreizējo darbvietu CSV formātā
- Apspriest kartītes sarunā ar MI, uzlabot saturu un plānot mācības
- Pievienot foto un failus MI pieprasījumiem vai izmantot balss diktēšanu atbalstītajās ierīcēs
- Pierakstīties ar e-pastu un sinhronizēt darbvietu starp ierīcēm
- Izmantot oficiālo pakalpojumu vai pievienot savu serveri

MI ir daļa no mācību procesa. Atkārto ātri, ar mazāk traucēkļiem un liekām darbībām. Komplekti, birkas, filtri un plānošanas iestatījumi palīdz uzturēt materiālus kārtībā. Lietotne nodrošina Android ierasto lietošanas pieredzi ar Material 3.

Nibomo noder skolēniem, studentiem, valodu apguvējiem, medicīnas un māszinību studentiem, izstrādātājiem un ikvienam, kas vēlas mācīties katru dienu ar kartītēm, MI un atkārtošanu intervālos.

Projektam ir atvērts pirmkods. Vari izpētīt visu sistēmu, to papildināt un darbināt savā serverī. Lietotnes, servera daļas un infrastruktūras kods ir pieejams GitHub:
https://github.com/kirill-markin/flashcards-open-source-app

## Malayalam (India) - ml-IN

### App Name

Nibomo: AI ഫ്ലാഷ്‌കാർഡുകൾ

### Short Description

കുറിപ്പും ഫോട്ടോയും കാർഡുകളാക്കൂ; ഇടവേളകളിൽ ആവർത്തിച്ച് ഓർക്കൂ

### Full Description

പഠിച്ചത് ഓർത്തുവയ്ക്കാൻ Nibomoയിലെ AI സഹായമുള്ള ഫ്ലാഷ്‌കാർഡുകൾ ഉപയോഗിക്കൂ. ഈ ആപ്പിന്റെ പഴയ പേര് Flashcards Open Source App എന്നായിരുന്നു.

പരീക്ഷകൾക്കും ക്ലാസുകൾക്കും തയ്യാറെടുക്കൂ, പുതിയ വാക്കുകൾ പഠിക്കൂ, വൈദ്യശാസ്ത്രവും സാങ്കേതിക വിഷയങ്ങളും ആവർത്തിച്ച് പഠിക്കൂ. കാർഡുകൾ മെച്ചപ്പെടുത്താനും പഠനം ആസൂത്രണം ചെയ്യാനും AI സഹായിക്കുന്നു. കാർഡ് കൂട്ടങ്ങൾ, ടാഗുകൾ, ഇടവേളകളിലെ ആവർത്തനം എന്നിവ ദിവസവും പഠിക്കുന്ന ശീലം നിലനിർത്താൻ സഹായിക്കും.

ചെയ്യാവുന്ന കാര്യങ്ങൾ:
- ആവർത്തിക്കാനുള്ള സമയമായ കാർഡുകൾ നിശ്ചിത ഇടവേളകളിൽ ശ്രദ്ധയോടെ പഠിക്കൂ
- മുന്നിലും പിന്നിലുമുള്ള എഴുത്ത്, കൂട്ടങ്ങൾ, ടാഗുകൾ എന്നിവയോടെ കാർഡുകൾ ഉണ്ടാക്കുകയും തിരുത്തുകയും ചെയ്യൂ
- നിങ്ങളുടെ ശേഖരത്തിൽ തിരയുകയും ഫിൽട്ടർ ചെയ്യുകയും ചെയ്യൂ
- ടാഗുകളും വേണ്ടിവരുന്ന പരിശ്രമത്തിന്റെ തോതും അനുസരിച്ച് ഫിൽട്ടർ ചെയ്ത കൂട്ടങ്ങൾ ഉണ്ടാക്കൂ
- വരാനിരിക്കുന്ന ആവർത്തനങ്ങളുടെ സമയക്രമം ക്രമീകരിക്കൂ
- നിലവിലെ വർക്ക്‌സ്‌പേസ് CSV ആയി എക്‌സ്‌പോർട്ട് ചെയ്യൂ
- AI ചാറ്റിൽ കാർഡുകൾ ചർച്ച ചെയ്യൂ, ഉള്ളടക്കം മെച്ചപ്പെടുത്തൂ, പഠനം ആസൂത്രണം ചെയ്യൂ
- AIയോടുള്ള അഭ്യർഥനകളിൽ ഫോട്ടോകളും ഫയലുകളും ചേർക്കൂ, അല്ലെങ്കിൽ പിന്തുണയുള്ള ഉപകരണങ്ങളിൽ സംസാരിച്ച് എഴുതൂ
- ഇമെയിൽ വഴി പ്രവേശിച്ച് ഉപകരണങ്ങൾക്കിടയിൽ വർക്ക്‌സ്‌പേസ് സിങ്ക് ചെയ്യൂ
- ഔദ്യോഗിക സേവനം ഉപയോഗിക്കൂ അല്ലെങ്കിൽ സ്വന്തം സെർവർ ബന്ധിപ്പിക്കൂ

AI പഠനത്തിന്റെ ഭാഗമാണ്. അനാവശ്യ ഘട്ടങ്ങളും ശ്രദ്ധതിരിക്കുന്ന കാര്യങ്ങളും കുറച്ച് വേഗത്തിൽ ആവർത്തിക്കാം. കൂട്ടങ്ങൾ, ടാഗുകൾ, ഫിൽട്ടറുകൾ, സമയക്രമത്തിന്റെ നിയന്ത്രണങ്ങൾ എന്നിവ ഉപയോഗിച്ച് പഠനസാമഗ്രികൾ അടുക്കിവയ്ക്കാം. Material 3 ഉപയോഗിച്ചുള്ള ആപ്പ് Androidന്റെ സ്വാഭാവിക ഉപയോഗരീതികൾ പിന്തുടരുന്നു.

വിദ്യാർഥികൾ, ഭാഷ പഠിക്കുന്നവർ, മെഡിക്കൽ-നഴ്‌സിങ് വിദ്യാർഥികൾ, ഡെവലപ്പർമാർ, കാർഡുകളും AIയും ഉപയോഗിച്ച് ദിവസവും പഠിക്കാൻ ആഗ്രഹിക്കുന്നവർ എന്നിവർക്കായി Nibomo.

ഈ പ്രോജക്റ്റ് ഓപ്പൺ സോഴ്‌സാണ്. മുഴുവൻ സംവിധാനവും പരിശോധിക്കാനും വികസിപ്പിക്കാനും സ്വന്തം സെർവറിൽ പ്രവർത്തിപ്പിക്കാനും കഴിയും. ആപ്പ്, ബാക്കെൻഡ്, അടിസ്ഥാനസൗകര്യം എന്നിവയുടെ എല്ലാ കോഡും GitHubൽ ലഭ്യമാണ്:
https://github.com/kirill-markin/flashcards-open-source-app

## Marathi (India) - mr-IN

### App Name

Nibomo: AI फ्लॅशकार्ड्स

### Short Description

नोट्स आणि फोटोंपासून फ्लॅशकार्ड बनवा; अंतर ठेवून उजळणी करा आणि लक्षात ठेवा

### Full Description

शिकलेले लक्षात ठेवण्यासाठी Nibomoमध्ये AIच्या मदतीने फ्लॅशकार्ड वापरून अभ्यास करा. या अॅपचे पूर्वीचे नाव Flashcards Open Source App होते.

परीक्षा आणि अभ्यासक्रमाची तयारी करा, नवीन शब्द शिका आणि वैद्यकीय व तांत्रिक विषयांची उजळणी करा. AI वापरून कार्ड सुधारता येतात आणि अभ्यासाचे नियोजन करता येते. कार्डांचे संच, टॅग आणि ठरावीक अंतराने केलेली उजळणी रोज अभ्यास करण्याची सवय टिकवायला मदत करतात.

तुम्ही काय करू शकता:
- उजळणीची वेळ आलेल्या कार्डांचा लक्षपूर्वक, ठरावीक अंतराने अभ्यास करा
- पुढील आणि मागील बाजूचा मजकूर, संच आणि टॅगसह कार्ड तयार करा व संपादित करा
- तुमच्या संग्रहात शोधा आणि फिल्टर लावा
- टॅग आणि लागणाऱ्या मेहनतीच्या पातळीनुसार फिल्टर केलेले संच तयार करा
- पुढील उजळणीसाठी वेळापत्रकाची सेटिंग्ज बदला
- सध्याची कार्यजागा CSV स्वरूपात निर्यात करा
- AI चॅटमध्ये कार्डांवर चर्चा करा, मजकूर सुधारा आणि अभ्यासाचे नियोजन करा
- AIला दिलेल्या विनंत्यांमध्ये फोटो व फाइल जोडा किंवा समर्थित उपकरणांवर बोलून लिहा
- ईमेलने साइन इन करा आणि उपकरणांमध्ये कार्यजागा सिंक करा
- अधिकृत सेवा वापरा किंवा स्वतःचा सर्व्हर जोडा

AI हा अभ्यासाच्या प्रक्रियेचाच भाग आहे. कमी अडथळे आणि अनावश्यक पायऱ्यांसह पटकन उजळणी करा. संच, टॅग, फिल्टर आणि वेळापत्रकाच्या नियंत्रणांनी अभ्यासाचे साहित्य नीट ठेवा. Material 3 वापरून बनवलेले अॅप Androidच्या नेहमीच्या वापरपद्धतींशी जुळते.

विद्यार्थी, भाषा शिकणारे, वैद्यकीय आणि नर्सिंगचे विद्यार्थी, डेव्हलपर आणि फ्लॅशकार्ड व AI वापरून रोज अभ्यास करू इच्छिणाऱ्या प्रत्येकासाठी Nibomo उपयुक्त आहे.

हा प्रकल्प ओपन सोर्स आहे. संपूर्ण प्रणाली पाहता येते, पुढे विकसित करता येते आणि स्वतःच्या सर्व्हरवर चालवता येते. अॅप, बॅकएंड आणि पायाभूत सुविधांचा सर्व कोड GitHubवर उपलब्ध आहे:
https://github.com/kirill-markin/flashcards-open-source-app

## Dutch - nl-NL

### App Name

Nibomo: Flashcards met AI

### Short Description

Maak flashcards van notities en foto’s en leer met gespreide herhaling

### Full Description

Nibomo is een flashcard-app met AI voor wie wil onthouden wat die leert. De app heette eerder Flashcards Open Source App.

Bereid je voor op tentamens en lessen, leer woordenschat en herhaal medische en technische stof. AI helpt je kaarten te verbeteren en je studie te plannen. Kaartensets, tags en gespreide herhaling maken dagelijks oefenen overzichtelijk.

Dit kun je doen:
- Kaarten die aan de beurt zijn geconcentreerd oefenen met gespreide herhaling
- Kaarten maken en bewerken met tekst op de voor- en achterkant, kaartensets en tags
- Je bibliotheek doorzoeken en filteren
- Gefilterde kaartensets samenstellen op basis van tags en inspanningsniveau
- De planning van toekomstige herhalingen aanpassen
- Je huidige werkruimte exporteren naar CSV
- Met AI chatten over je kaarten, de inhoud verbeteren en je studie plannen
- Foto’s en bestanden toevoegen aan AI-opdrachten of spraakdicteren op ondersteunde apparaten
- Inloggen met e-mail en je werkruimte synchroniseren tussen apparaten
- De officiële dienst gebruiken of een eigen server aansluiten

AI is onderdeel van het studeren. Herhaal snel, met minder afleiding en onnodige stappen. Houd je materiaal op orde met kaartensets, tags, filters en planningsinstellingen. De app biedt een vertrouwde Android-ervaring met Material 3.

Nibomo past bij scholieren, studenten, taalleerders, studenten geneeskunde en verpleegkunde, ontwikkelaars en iedereen die dagelijks wil leren met flashcards, AI en gespreide herhaling.

Het project is open source. Je kunt het hele systeem bekijken, erop voortbouwen en het zelf hosten. Alle code voor de app, backend en infrastructuur staat op GitHub:
https://github.com/kirill-markin/flashcards-open-source-app

## Norwegian - no-NO

### App Name

Nibomo: Læringskort med KI

### Short Description

Gjør notater og bilder om til læringskort, og husk med repetisjon over tid

### Full Description

Nibomo er en app med læringskort og KI for deg som vil huske det du lærer. Appen het tidligere Flashcards Open Source App.

Forbered deg til eksamener og undervisning, lær nye ord og repeter medisinsk og teknisk stoff. KI hjelper deg med å forbedre kortene og planlegge studiene. Kortstokker, etiketter og repetisjon med mellomrom gjør det enklere å øve hver dag.

Dette kan du gjøre:
- Repetere kort som står for tur, i et fokusert opplegg med repetisjon med mellomrom
- Lage og redigere kort med tekst på for- og bakside, kortstokker og etiketter
- Søke og filtrere i biblioteket ditt
- Lage filtrerte kortstokker basert på etiketter og innsatsnivå
- Justere planleggingen av fremtidige repetisjoner
- Eksportere det nåværende arbeidsområdet til CSV
- Snakke med KI om kortene, forbedre innholdet og planlegge læringen
- Legge ved bilder og filer i forespørsler til KI eller bruke talediktering på støttede enheter
- Logge inn med e-post og synkronisere arbeidsområdet mellom enheter
- Bruke den offisielle tjenesten eller koble til din egen server

KI er en del av studiearbeidet. Raske repetisjonsøkter med færre forstyrrelser og unødige trinn gjør det lett å komme i gang. Hold orden med kortstokker, etiketter, filtre og planleggingsinnstillinger. Appen følger Androids egne bruksmønstre med Material 3.

Nibomo passer for elever, studenter, språkelever, medisin- og sykepleierstudenter, utviklere og alle som vil studere jevnlig med læringskort, KI og repetisjon over tid.

Prosjektet har åpen kildekode. Du kan undersøke hele systemet, bygge videre på det og drifte det selv. All kode for appen, backend og infrastrukturen er tilgjengelig på GitHub:
https://github.com/kirill-markin/flashcards-open-source-app

## Punjabi - pa

### App Name

Nibomo: AI ਫਲੈਸ਼ਕਾਰਡ

### Short Description

ਨੋਟਾਂ ਤੇ ਫੋਟੋਆਂ ਤੋਂ ਫਲੈਸ਼ਕਾਰਡ ਬਣਾਓ ਅਤੇ ਵਕਫ਼ੇ ਨਾਲ ਦੁਹਰਾ ਕੇ ਯਾਦ ਰੱਖੋ

### Full Description

ਸਿੱਖਿਆ ਹੋਇਆ ਯਾਦ ਰੱਖਣ ਲਈ Nibomo ਵਿੱਚ AI ਦੀ ਮਦਦ ਨਾਲ ਫਲੈਸ਼ਕਾਰਡਾਂ ਰਾਹੀਂ ਪੜ੍ਹੋ। ਇਸ ਐਪ ਦਾ ਪਹਿਲਾਂ ਨਾਂ Flashcards Open Source App ਸੀ।

ਇਮਤਿਹਾਨਾਂ ਅਤੇ ਪਾਠਾਂ ਦੀ ਤਿਆਰੀ ਕਰੋ, ਨਵੇਂ ਸ਼ਬਦ ਸਿੱਖੋ ਅਤੇ ਮੈਡੀਕਲ ਤੇ ਤਕਨੀਕੀ ਵਿਸ਼ੇ ਦੁਹਰਾਓ। AI ਨਾਲ ਕਾਰਡ ਸੁਧਾਰੋ ਅਤੇ ਪੜ੍ਹਾਈ ਦੀ ਯੋਜਨਾ ਬਣਾਓ। ਕਾਰਡਾਂ ਦੇ ਸੈੱਟ, ਟੈਗ ਅਤੇ ਵਕਫ਼ੇ ਨਾਲ ਦੁਹਰਾਈ ਰੋਜ਼ ਪੜ੍ਹਨ ਦੀ ਆਦਤ ਬਣਾਉਣ ਵਿੱਚ ਮਦਦ ਕਰਦੇ ਹਨ।

ਤੁਸੀਂ ਕੀ ਕਰ ਸਕਦੇ ਹੋ:
- ਜਿਨ੍ਹਾਂ ਕਾਰਡਾਂ ਦੀ ਵਾਰੀ ਆ ਗਈ ਹੈ, ਉਹਨਾਂ ਨੂੰ ਨਿਸ਼ਚਿਤ ਵਕਫ਼ਿਆਂ ਨਾਲ ਧਿਆਨ ਨਾਲ ਦੁਹਰਾਓ
- ਅੱਗੇ ਅਤੇ ਪਿੱਛੇ ਦੇ ਲਿਖਤ, ਸੈੱਟਾਂ ਤੇ ਟੈਗਾਂ ਨਾਲ ਕਾਰਡ ਬਣਾਓ ਅਤੇ ਸੋਧੋ
- ਆਪਣੇ ਸੰਗ੍ਰਹਿ ਵਿੱਚ ਖੋਜ ਕਰੋ ਅਤੇ ਫਿਲਟਰ ਲਗਾਓ
- ਟੈਗਾਂ ਅਤੇ ਲੋੜੀਂਦੀ ਮਿਹਨਤ ਦੇ ਪੱਧਰ ਅਨੁਸਾਰ ਫਿਲਟਰ ਕੀਤੇ ਸੈੱਟ ਬਣਾਓ
- ਅਗਲੀਆਂ ਦੁਹਰਾਈਆਂ ਲਈ ਸਮਾਂ-ਸਾਰਣੀ ਦੀਆਂ ਸੈਟਿੰਗਾਂ ਬਦਲੋ
- ਮੌਜੂਦਾ ਵਰਕਸਪੇਸ ਨੂੰ CSV ਵਜੋਂ ਐਕਸਪੋਰਟ ਕਰੋ
- AI ਚੈਟ ਵਿੱਚ ਕਾਰਡਾਂ ਬਾਰੇ ਗੱਲ ਕਰੋ, ਸਮੱਗਰੀ ਸੁਧਾਰੋ ਅਤੇ ਪੜ੍ਹਾਈ ਦੀ ਯੋਜਨਾ ਬਣਾਓ
- AI ਲਈ ਬੇਨਤੀਆਂ ਨਾਲ ਫੋਟੋਆਂ ਅਤੇ ਫਾਈਲਾਂ ਜੋੜੋ ਜਾਂ ਸਮਰਥਿਤ ਡਿਵਾਈਸਾਂ ਉੱਤੇ ਬੋਲ ਕੇ ਲਿਖੋ
- ਈਮੇਲ ਨਾਲ ਸਾਈਨ ਇਨ ਕਰੋ ਅਤੇ ਡਿਵਾਈਸਾਂ ਵਿਚਕਾਰ ਵਰਕਸਪੇਸ ਸਿੰਕ ਕਰੋ
- ਅਧਿਕਾਰਤ ਸੇਵਾ ਵਰਤੋ ਜਾਂ ਆਪਣਾ ਸਰਵਰ ਜੋੜੋ

AI ਪੜ੍ਹਾਈ ਦੀ ਪ੍ਰਕਿਰਿਆ ਦਾ ਹਿੱਸਾ ਹੈ। ਘੱਟ ਧਿਆਨ ਭਟਕਾਉਣ ਵਾਲੀਆਂ ਚੀਜ਼ਾਂ ਅਤੇ ਬੇਲੋੜੇ ਕਦਮਾਂ ਨਾਲ ਛੇਤੀ ਦੁਹਰਾਈ ਕਰੋ। ਸੈੱਟਾਂ, ਟੈਗਾਂ, ਫਿਲਟਰਾਂ ਅਤੇ ਸਮਾਂ-ਸਾਰਣੀ ਦੇ ਨਿਯੰਤਰਣਾਂ ਨਾਲ ਸਮੱਗਰੀ ਤਰਤੀਬ ਵਿੱਚ ਰੱਖੋ। Material 3 ਨਾਲ ਬਣੀ ਐਪ Android ਦੇ ਜਾਣੇ-ਪਛਾਣੇ ਵਰਤੋਂ ਦੇ ਢੰਗਾਂ ਨੂੰ ਅਪਣਾਉਂਦੀ ਹੈ।

Nibomo ਵਿਦਿਆਰਥੀਆਂ, ਭਾਸ਼ਾ ਸਿੱਖਣ ਵਾਲਿਆਂ, ਮੈਡੀਕਲ ਅਤੇ ਨਰਸਿੰਗ ਦੇ ਵਿਦਿਆਰਥੀਆਂ, ਡਿਵੈਲਪਰਾਂ ਅਤੇ ਕਾਰਡਾਂ ਤੇ AI ਨਾਲ ਰੋਜ਼ ਪੜ੍ਹਨ ਦੇ ਚਾਹਵਾਨਾਂ ਲਈ ਹੈ।

ਇਹ ਪ੍ਰੋਜੈਕਟ ਓਪਨ ਸੋਰਸ ਹੈ। ਤੁਸੀਂ ਪੂਰਾ ਸਿਸਟਮ ਵੇਖ ਸਕਦੇ ਹੋ, ਇਸ ਨੂੰ ਅੱਗੇ ਵਧਾ ਸਕਦੇ ਹੋ ਅਤੇ ਆਪਣੇ ਸਰਵਰ ਉੱਤੇ ਚਲਾ ਸਕਦੇ ਹੋ। ਐਪ, ਬੈਕਐਂਡ ਅਤੇ ਬੁਨਿਆਦੀ ਢਾਂਚੇ ਦਾ ਸਾਰਾ ਕੋਡ GitHub ਉੱਤੇ ਉਪਲਬਧ ਹੈ:
https://github.com/kirill-markin/flashcards-open-source-app

## Polish - pl-PL

### App Name

Nibomo: Fiszki z AI

### Short Description

Zamieniaj notatki i zdjęcia w fiszki i zapamiętuj dzięki powtórkom w odstępach

### Full Description

Nibomo to aplikacja z fiszkami i AI dla osób, które chcą pamiętać to, czego się uczą. Wcześniej nosiła nazwę Flashcards Open Source App.

Przygotuj się do egzaminów i zajęć, ucz się słówek i powtarzaj materiał medyczny oraz techniczny. AI pomaga poprawiać fiszki i planować naukę. Talie, tagi i powtórki w odstępach ułatwiają codzienną pracę.

Co możesz robić:
- Powtarzać w skupieniu fiszki, na które właśnie przyszła pora
- Tworzyć i edytować fiszki z tekstem na przodzie i odwrocie, taliami oraz tagami
- Przeszukiwać i filtrować swoją bibliotekę
- Tworzyć filtrowane talie według tagów i poziomu wysiłku
- Dostosowywać harmonogram przyszłych powtórek
- Eksportować bieżącą przestrzeń roboczą do CSV
- Omawiać fiszki na czacie z AI, poprawiać treść i planować naukę
- Dołączać zdjęcia i pliki do poleceń dla AI lub dyktować na obsługiwanych urządzeniach
- Logować się przez e-mail i synchronizować przestrzeń roboczą między urządzeniami
- Korzystać z oficjalnej usługi lub podłączyć własny serwer

AI jest częścią nauki. Powtarzaj szybko, z mniejszą liczbą rozpraszaczy i zbędnych kroków. Talie, tagi, filtry i ustawienia harmonogramu pomagają utrzymać porządek. Aplikacja oferuje natywną obsługę Androida z Material 3.

Nibomo sprawdzi się u uczniów, studentów, osób uczących się języków, studentów medycyny i pielęgniarstwa, programistów oraz wszystkich, którzy chcą uczyć się codziennie z fiszkami, AI i powtórkami w odstępach.

Projekt ma otwarty kod źródłowy. Możesz sprawdzić cały system, rozwijać go i uruchomić na własnym serwerze. Kod aplikacji, backendu i infrastruktury jest dostępny na GitHubie:
https://github.com/kirill-markin/flashcards-open-source-app

## Romanian - ro

### App Name

Nibomo: Fișe cu AI

### Short Description

Transformă notițele și pozele în fișe și memorează prin repetare spațiată

### Full Description

Nibomo este o aplicație de fișe de învățare cu AI pentru cei care vor să țină minte ce învață. Înainte se numea Flashcards Open Source App.

Pregătește-te pentru examene și cursuri, învață vocabular și recapitulează materie medicală și tehnică. AI te ajută să îmbunătățești fișele și să planifici studiul. Seturile de fișe, etichetele și repetarea spațiată fac mai ușor exercițiul zilnic.

Ce poți face:
- Recapitulează fișele ajunse la termen într-un flux de repetare spațiată care te ajută să te concentrezi
- Creează și editează fișe cu text pe față și pe verso, seturi și etichete
- Caută și filtrează în biblioteca ta
- Creează seturi filtrate după etichete și nivelul de efort
- Ajustează programarea recapitulărilor viitoare
- Exportă spațiul de lucru actual în CSV
- Discută fișele în chatul AI, îmbunătățește conținutul și planifică studiul
- Atașează poze și fișiere la cererile pentru AI sau folosește dictarea vocală pe dispozitivele compatibile
- Autentifică-te prin e-mail și sincronizează spațiul de lucru între dispozitive
- Folosește serviciul oficial sau conectează un server propriu

AI face parte din procesul de învățare. Recapitulează rapid, cu mai puține distrageri și pași inutili. Seturile, etichetele, filtrele și setările de programare păstrează materialele în ordine. Aplicația oferă o experiență Android nativă cu Material 3.

Nibomo se potrivește elevilor, studenților, celor care învață limbi străine, studenților la medicină și asistență medicală, dezvoltatorilor și oricui dorește o rutină zilnică de studiu cu fișe, AI și repetare spațiată.

Proiectul este open source. Poți examina întregul sistem, îl poți extinde și găzdui pe propriul server. Codul aplicației, al backendului și al infrastructurii este disponibil pe GitHub:
https://github.com/kirill-markin/flashcards-open-source-app

## Slovak - sk

### App Name

Nibomo: Kartičky s AI

### Short Description

Z poznámok a fotiek tvorte kartičky a učte sa opakovaním v rozostupoch

### Full Description

Nibomo je aplikácia s výučbovými kartičkami a AI pre ľudí, ktorí si chcú zapamätať, čo sa učia. Predtým sa volala Flashcards Open Source App.

Pripravujte sa na skúšky a vyučovanie, učte sa slovíčka a opakujte si medicínske aj technické učivo. AI pomáha zlepšovať kartičky a plánovať učenie. Balíčky, štítky a opakovanie v rozostupoch uľahčujú každodenné precvičovanie.

Čo môžete robiť:
- Sústredene opakovať kartičky, na ktoré prišiel čas
- Vytvárať a upravovať kartičky s textom na prednej aj zadnej strane, balíčkami a štítkami
- Vyhľadávať a filtrovať vo svojej knižnici
- Zostavovať filtrované balíčky podľa štítkov a náročnosti
- Prispôsobovať plánovanie budúcich opakovaní
- Exportovať aktuálny pracovný priestor do CSV
- Rozoberať kartičky v chate s AI, zlepšovať obsah a plánovať učenie
- Prikladať fotky a súbory k zadaniam pre AI alebo diktovať na podporovaných zariadeniach
- Prihlásiť sa e-mailom a synchronizovať pracovný priestor medzi zariadeniami
- Používať oficiálnu službu alebo pripojiť vlastný server

AI je súčasťou učenia. Opakovanie je rýchle, s menším množstvom rušivých prvkov a zbytočných krokov. Balíčky, štítky, filtre a nastavenia rozvrhu udržiavajú materiály prehľadné. Aplikácia ponúka natívne prostredie Androidu s Material 3.

Nibomo sa hodí žiakom, študentom, ľuďom učiacim sa jazyky, študentom medicíny a ošetrovateľstva, vývojárom aj všetkým, ktorí chcú denne študovať s kartičkami, AI a opakovaním v rozostupoch.

Projekt má otvorený zdrojový kód. Môžete preskúmať celý systém, rozvíjať ho a prevádzkovať na vlastnom serveri. Kód aplikácie, backendu aj infraštruktúry je na GitHube:
https://github.com/kirill-markin/flashcards-open-source-app

## Slovenian - sl

### App Name

Nibomo: Učne kartice z AI

### Short Description

Spremeni zapiske in fotografije v učne kartice ter se uči s časovnimi razmiki

### Full Description

Nibomo je aplikacija z učnimi karticami in umetno inteligenco za vse, ki si želijo zapomniti, kar se učijo. Prej se je imenovala Flashcards Open Source App.

Pripravi se na izpite in pouk, uči se novih besed ter ponavljaj medicinsko in tehnično snov. AI pomaga izboljšati kartice in načrtovati učenje. Kompleti kartic, oznake in ponavljanje v časovnih razmikih olajšajo vsakodnevno vajo.

Kaj lahko počneš:
- Zbrano ponavljaš kartice, ki so na vrsti za ponovitev
- Ustvarjaš in urejaš kartice z besedilom na sprednji in zadnji strani, kompleti ter oznakami
- Iščeš po svoji knjižnici in filtriraš vsebino
- Sestavljaš filtrirane komplete po oznakah in stopnji napora
- Prilagajaš razpored prihodnjih ponovitev
- Izvoziš trenutni delovni prostor v CSV
- V klepetu z AI razpravljaš o karticah, izboljšuješ vsebino in načrtuješ učenje
- Zahtevam za AI prilagaš fotografije in datoteke ali narekuješ na podprtih napravah
- Se prijaviš z e-pošto in sinhroniziraš delovni prostor med napravami
- Uporabljaš uradno storitev ali povežeš lasten strežnik

AI je del učenja. Ponavljanje je hitro, z manj motnjami in odvečnimi koraki. Kompleti, oznake, filtri in nastavitve razporeda ohranjajo gradivo urejeno. Aplikacija ponuja izvorno izkušnjo Android z Material 3.

Nibomo je primeren za učence, študente, vse, ki se učijo jezikov, študente medicine in zdravstvene nege, razvijalce ter vsakogar, ki želi vsak dan študirati s karticami, AI in ponavljanjem v časovnih razmikih.

Projekt je odprtokoden. Pregledaš lahko celoten sistem, ga nadgrajuješ in gostiš na svojem strežniku. Koda aplikacije, zaledja in infrastrukture je na voljo na GitHubu:
https://github.com/kirill-markin/flashcards-open-source-app

## Swedish - sv-SE

### App Name

Nibomo: Flashcards med AI

### Short Description

Gör anteckningar och foton till flashcards och minns med utspridd repetition

### Full Description

Nibomo är en flashcard-app med AI för dig som vill minnas det du lär dig. Appen hette tidigare Flashcards Open Source App.

Förbered dig inför prov och kurser, lär dig nya ord och repetera medicinskt och tekniskt material. AI hjälper dig att förbättra korten och planera studierna. Kortlekar, taggar och utspridd repetition gör det enklare att öva varje dag.

Det här kan du göra:
- Repetera de kort som står på tur i ett fokuserat flöde med utspridd repetition
- Skapa och redigera kort med text på fram- och baksidan, kortlekar och taggar
- Söka och filtrera i ditt bibliotek
- Skapa filtrerade kortlekar utifrån taggar och ansträngningsnivå
- Anpassa schemaläggningen för framtida repetitioner
- Exportera din nuvarande arbetsyta till CSV
- Diskutera korten i AI-chatten, förbättra innehållet och planera studierna
- Bifoga foton och filer till AI-förfrågningar eller använda röstdiktering på enheter som stöder det
- Logga in med e-post och synkronisera arbetsytan mellan enheter
- Använda den officiella tjänsten eller ansluta en egen server

AI är en del av studiearbetet. Repetera snabbt, med färre störningar och onödiga steg. Kortlekar, taggar, filter och schemainställningar håller ordning på materialet. Appen följer Androids egna användningsmönster med Material 3.

Nibomo passar elever, studenter, språkinlärare, läkar- och sjuksköterskestudenter, utvecklare och alla som vill plugga dagligen med flashcards, AI och utspridd repetition.

Projektet har öppen källkod. Du kan granska hela systemet, bygga vidare på det och köra det på din egen server. All kod för appen, backend och infrastrukturen finns på GitHub:
https://github.com/kirill-markin/flashcards-open-source-app

## Swahili - sw

### App Name

Nibomo: Kadi za kujifunza

### Short Description

Geuza madokezo na picha kuwa kadi; kumbuka kwa kurudia kwa vipindi

### Full Description

Nibomo ni programu ya kadi za kujifunza yenye AI kwa watu wanaotaka kukumbuka wanachojifunza. Jina lake la awali lilikuwa Flashcards Open Source App.

Jiandae kwa mitihani na masomo, jifunze msamiati, na rudia mada za tiba na teknolojia. AI hukusaidia kuboresha kadi na kupanga masomo. Makundi ya kadi, lebo na kurudia kwa vipindi hurahisisha mazoezi ya kila siku.

Unachoweza kufanya:
- Kurudia kadi ambazo wakati wake umefika, kwa umakini na kwa vipindi vilivyopangwa
- Kuunda na kuhariri kadi zenye maandishi mbele na nyuma, makundi na lebo
- Kutafuta na kuchuja maktaba yako
- Kuunda makundi ya kadi yaliyochujwa kwa lebo na kiwango cha juhudi
- Kurekebisha ratiba ya marudio yajayo
- Kuhamisha nafasi yako ya kazi ya sasa kuwa faili ya CSV
- Kujadili kadi katika mazungumzo na AI, kuboresha maudhui na kupanga masomo
- Kuambatisha picha na faili kwenye maombi kwa AI au kuandika kwa sauti kwenye vifaa vinavyoruhusu hilo
- Kuingia kwa barua pepe na kusawazisha nafasi ya kazi kati ya vifaa
- Kutumia huduma rasmi au kuunganisha seva yako mwenyewe

AI ni sehemu ya kujifunza. Rudia kwa haraka, ukiwa na vikwazo vichache na hatua chache zisizo za lazima. Panga maudhui kwa makundi, lebo, vichujio na mipangilio ya ratiba. Programu imeundwa kwa mtindo wa Android kwa kutumia Material 3.

Nibomo inafaa kwa wanafunzi, wanaojifunza lugha, wanafunzi wa udaktari na uuguzi, watengenezaji wa programu na yeyote anayetaka kujifunza kila siku kwa kadi, AI na kurudia kwa vipindi.

Mradi una msimbo huria. Unaweza kuchunguza mfumo mzima, kuuendeleza na kuuendesha kwenye seva yako. Msimbo wote wa programu, sehemu ya seva na miundombinu unapatikana kwenye GitHub:
https://github.com/kirill-markin/flashcards-open-source-app

## Tamil (India) - ta-IN

### App Name

Nibomo: AI கற்றல் அட்டைகள்

### Short Description

குறிப்புகள், படங்களிலிருந்து அட்டைகள் உருவாக்கி இடைவெளிவிட்டு படியுங்கள்

### Full Description

கற்றதை நினைவில் வைத்துக்கொள்ள Nibomoவில் AI உதவியுடன் கற்றல் அட்டைகளைப் பயன்படுத்துங்கள். இந்தச் செயலியின் முந்தைய பெயர் Flashcards Open Source App.

தேர்வுகளுக்கும் வகுப்புகளுக்கும் தயாராகுங்கள், புதிய சொற்களைக் கற்றுக்கொள்ளுங்கள், மருத்துவம் மற்றும் தொழில்நுட்பப் பாடங்களை மீண்டும் படியுங்கள். அட்டைகளை மேம்படுத்தவும் படிப்பைத் திட்டமிடவும் AI உதவுகிறது. அட்டைத் தொகுப்புகள், குறிச்சொற்கள், இடைவெளிவிட்டு மீண்டும் படித்தல் ஆகியவை தினசரிப் படிப்பை ஒழுங்குபடுத்த உதவும்.

நீங்கள் செய்யக்கூடியவை:
- மீண்டும் படிக்க வேண்டிய நேரம் வந்த அட்டைகளை, திட்டமிட்ட இடைவெளிகளில் கவனமாகப் படியுங்கள்
- முன்பக்க மற்றும் பின்பக்க உரை, தொகுப்புகள், குறிச்சொற்களுடன் அட்டைகளை உருவாக்கித் திருத்துங்கள்
- உங்கள் நூலகத்தில் தேடுங்கள், வடிகட்டுங்கள்
- குறிச்சொற்கள் மற்றும் தேவைப்படும் முயற்சியின் அளவைப் பொறுத்து வடிகட்டிய தொகுப்புகளை உருவாக்குங்கள்
- அடுத்த முறை படிப்பதற்கான அட்டவணை அமைப்புகளை மாற்றுங்கள்
- தற்போதைய பணியிடத்தை CSV ஆக ஏற்றுமதி செய்யுங்கள்
- AI அரட்டையில் அட்டைகளைப் பற்றி விவாதித்து, உள்ளடக்கத்தை மேம்படுத்தி, படிப்பைத் திட்டமிடுங்கள்
- AIக்கான கோரிக்கைகளில் படங்களையும் கோப்புகளையும் இணையுங்கள்; ஆதரிக்கும் சாதனங்களில் குரல் வழியாக உள்ளிடுங்கள்
- மின்னஞ்சல் மூலம் உள்நுழைந்து சாதனங்களுக்கு இடையே பணியிடத்தை ஒத்திசையுங்கள்
- அதிகாரப்பூர்வச் சேவையைப் பயன்படுத்துங்கள் அல்லது சொந்த சேவையகத்தை இணைக்குங்கள்

AI படிக்கும் முறையின் ஒரு பகுதியாக உள்ளது. குறைவான கவனச்சிதறல்கள் மற்றும் தேவையற்ற படிகளுடன் விரைவாக மீண்டும் படிக்கலாம். தொகுப்புகள், குறிச்சொற்கள், வடிகட்டிகள், அட்டவணைக் கட்டுப்பாடுகள் மூலம் பாடங்களை ஒழுங்காக வைத்திருங்கள். Material 3 பயன்படுத்தும் செயலி Androidன் இயல்பான பயன்பாட்டு முறைகளைப் பின்பற்றுகிறது.

மாணவர்கள், மொழி கற்பவர்கள், மருத்துவம் மற்றும் செவிலியர் பயிற்சி மாணவர்கள், மென்பொருள் உருவாக்குநர்கள், அட்டைகள் மற்றும் AI உதவியுடன் தினமும் படிக்க விரும்புபவர்கள் அனைவருக்கும் Nibomo உதவும்.

இந்தத் திட்டம் திறந்த மூலமாக உள்ளது. முழு அமைப்பையும் ஆராயலாம், விரிவுபடுத்தலாம், உங்கள் சேவையகத்தில் இயக்கலாம். செயலி, பின்தளம், உள்கட்டமைப்பு ஆகியவற்றின் குறியீடு முழுவதும் GitHubல் கிடைக்கும்:
https://github.com/kirill-markin/flashcards-open-source-app

## Telugu (India) - te-IN

### App Name

Nibomo: AI ఫ్లాష్‌కార్డులు

### Short Description

నోట్స్, ఫోటోలతో కార్డులు తయారు చేసి, విరామాలతో సాధన చేసి గుర్తుంచుకోండి

### Full Description

నేర్చుకున్నది గుర్తుండేందుకు Nibomoలో AI సహాయంతో ఫ్లాష్‌కార్డుల ద్వారా చదవండి. ఈ యాప్ పాత పేరు Flashcards Open Source App.

పరీక్షలు, పాఠాల కోసం సిద్ధమవండి, కొత్త పదాలు నేర్చుకోండి, వైద్య మరియు సాంకేతిక విషయాలను మళ్లీ చదవండి. కార్డులను మెరుగుపరచడానికి, చదువును ప్రణాళిక చేసుకోవడానికి AI సహాయపడుతుంది. కార్డుల సెట్లు, ట్యాగ్‌లు, విరామాలతో పునశ్చరణ రోజూ చదివే అలవాటుకు తోడ్పడతాయి.

మీరు చేయగలిగేవి:
- పునశ్చరణ సమయం వచ్చిన కార్డులను నిర్ణీత విరామాలలో ఏకాగ్రతతో చదవండి
- ముందు, వెనుక వైపు వచనం, సెట్లు, ట్యాగ్‌లతో కార్డులు సృష్టించి సవరించండి
- మీ లైబ్రరీలో వెతకండి, ఫిల్టర్ చేయండి
- ట్యాగ్‌లు, అవసరమైన శ్రమ స్థాయి ఆధారంగా ఫిల్టర్ చేసిన సెట్లు తయారు చేయండి
- భవిష్యత్తు పునశ్చరణల షెడ్యూల్ సెట్టింగ్‌లను మార్చండి
- ప్రస్తుత వర్క్‌స్పేస్‌ను CSVగా ఎగుమతి చేయండి
- AI చాట్‌లో కార్డుల గురించి చర్చించండి, విషయాన్ని మెరుగుపరచండి, చదువుకు ప్రణాళిక వేయండి
- AIకి ఇచ్చే అభ్యర్థనలకు ఫోటోలు, ఫైళ్లు జోడించండి లేదా మద్దతు ఉన్న పరికరాల్లో మాట్లాడి వచనం నమోదు చేయండి
- ఇమెయిల్‌తో సైన్ ఇన్ చేసి పరికరాల మధ్య వర్క్‌స్పేస్‌ను సింక్ చేయండి
- అధికారిక సేవ వాడండి లేదా మీ సొంత సర్వర్‌ను అనుసంధానించండి

AI చదివే ప్రక్రియలో భాగం. తక్కువ ఆటంకాలు, అనవసర దశలతో వేగంగా పునశ్చరణ చేయండి. సెట్లు, ట్యాగ్‌లు, ఫిల్టర్లు, షెడ్యూల్ నియంత్రణలతో విషయాన్ని క్రమంగా ఉంచండి. Material 3తో రూపొందించిన యాప్ Android సహజ వినియోగ పద్ధతులను అనుసరిస్తుంది.

విద్యార్థులు, భాషలు నేర్చుకునేవారు, వైద్య, నర్సింగ్ విద్యార్థులు, డెవలపర్లు, కార్డులు మరియు AIతో రోజూ చదవాలనుకునే వారందరికీ Nibomo ఉపయోగపడుతుంది.

ఈ ప్రాజెక్ట్ ఓపెన్ సోర్స్. మొత్తం వ్యవస్థను పరిశీలించవచ్చు, విస్తరించవచ్చు, మీ సర్వర్‌లో నడపవచ్చు. యాప్, బ్యాకెండ్, మౌలిక సదుపాయాల కోడ్ అంతా GitHubలో అందుబాటులో ఉంది:
https://github.com/kirill-markin/flashcards-open-source-app

## Thai - th

### App Name

Nibomo: แฟลชการ์ด AI

### Short Description

เปลี่ยนโน้ตและรูปเป็นแฟลชการ์ด จดจำด้วยการทบทวนแบบเว้นระยะ

### Full Description

Nibomo เป็นแอปแฟลชการ์ดที่มี AI ช่วยเรียน สำหรับคนที่อยากจำสิ่งที่เรียนได้ แอปนี้เคยใช้ชื่อ Flashcards Open Source App

เตรียมสอบและทบทวนบทเรียน ฝึกคำศัพท์ จดจำเนื้อหาทางการแพทย์และเทคนิค ใช้ AI ช่วยปรับปรุงการ์ดและวางแผนการเรียน ชุดการ์ด แท็ก และการทบทวนแบบเว้นระยะช่วยให้ฝึกได้เป็นประจำทุกวัน

สิ่งที่ทำได้:
- ทบทวนการ์ดที่ถึงกำหนดอย่างมีสมาธิด้วยการทบทวนแบบเว้นระยะ
- สร้างและแก้ไขการ์ดที่มีข้อความด้านหน้าและด้านหลัง พร้อมชุดการ์ดและแท็ก
- ค้นหาและกรองคลังการ์ดของคุณ
- สร้างชุดการ์ดที่กรองตามแท็กและระดับความพยายาม
- ปรับการตั้งค่าตารางสำหรับการทบทวนครั้งต่อไป
- ส่งออกพื้นที่ทำงานปัจจุบันเป็น CSV
- คุยกับ AI เกี่ยวกับการ์ด ปรับปรุงเนื้อหา และวางแผนการเรียน
- แนบรูปและไฟล์ในคำขอถึง AI หรือใช้การพิมพ์ด้วยเสียงบนอุปกรณ์ที่รองรับ
- เข้าสู่ระบบด้วยอีเมลและซิงค์พื้นที่ทำงานระหว่างอุปกรณ์
- ใช้บริการอย่างเป็นทางการหรือเชื่อมต่อเซิร์ฟเวอร์ของคุณเอง

AI เป็นส่วนหนึ่งของการเรียน ทบทวนได้รวดเร็วโดยมีสิ่งรบกวนและขั้นตอนที่ไม่จำเป็นน้อยลง จัดระเบียบเนื้อหาด้วยชุดการ์ด แท็ก ตัวกรอง และการตั้งค่าตาราง แอปใช้ Material 3 เพื่อให้ใช้งานได้อย่างเป็นธรรมชาติบน Android

Nibomo เหมาะกับนักเรียน นักศึกษา ผู้เรียนภาษา นักศึกษาแพทย์และพยาบาล นักพัฒนา และทุกคนที่อยากเรียนเป็นประจำด้วยแฟลชการ์ด AI และการทบทวนแบบเว้นระยะ

โปรเจกต์นี้เป็นโอเพนซอร์ส คุณสามารถตรวจดูระบบทั้งหมด พัฒนาต่อยอด และโฮสต์เองได้ โค้ดทั้งหมดของแอป แบ็กเอนด์ และโครงสร้างพื้นฐานมีให้ดูบน GitHub:
https://github.com/kirill-markin/flashcards-open-source-app

## Turkish - tr-TR

### App Name

Nibomo: Yapay Zekâ Kartları

### Short Description

Not ve fotoğrafları bilgi kartlarına dönüştür, aralıklı tekrarla hatırla

### Full Description

Nibomo, öğrendiklerini hatırlamak isteyenler için yapay zekâ destekli bir bilgi kartı uygulamasıdır. Önceki adı Flashcards Open Source App idi.

Sınavlara ve derslere hazırlan, yeni kelimeler öğren, tıbbi ve teknik konuları tekrar et. Yapay zekâyla kartlarını geliştir ve çalışmanı planla. Desteler, etiketler ve aralıklı tekrar, her gün düzenli çalışmanı kolaylaştırır.

Neler yapabilirsin:
- Tekrar zamanı gelen kartları odaklanarak, aralıklı tekrar yöntemiyle çalış
- Ön ve arka yüz metni, deste ve etiketlerle kart oluştur ve düzenle
- Kütüphanende arama yap ve filtre uygula
- Etiketlere ve gereken çaba düzeyine göre filtrelenmiş desteler oluştur
- Gelecekteki tekrarların zamanlama ayarlarını değiştir
- Mevcut çalışma alanını CSV olarak dışa aktar
- Yapay zekâyla kartların hakkında sohbet et, içeriği geliştir ve çalışmanı planla
- Yapay zekâya gönderdiğin isteklere fotoğraf ve dosya ekle veya desteklenen cihazlarda sesle yaz
- E-postayla giriş yap ve çalışma alanını cihazlar arasında eşitle
- Resmî hizmeti kullan veya kendi sunucunu bağla

Yapay zekâ çalışma sürecinin bir parçasıdır. Daha az dikkat dağıtıcı öğe ve gereksiz adımla hızlıca tekrar yap. Desteler, etiketler, filtreler ve zamanlama ayarlarıyla konuları düzenli tut. Uygulama, Material 3 ile Android’e özgü bir kullanım deneyimi sunar.

Nibomo; öğrencilere, dil öğrenenlere, tıp ve hemşirelik öğrencilerine, yazılımcılara ve bilgi kartları, yapay zekâ ve aralıklı tekrarla her gün çalışmak isteyen herkese uygundur.

Proje açık kaynaklıdır. Sistemin tamamını inceleyebilir, geliştirebilir ve kendi sunucunda barındırabilirsin. Uygulama, arka uç ve altyapının tüm kodu GitHub’da bulunur:
https://github.com/kirill-markin/flashcards-open-source-app

## Ukrainian - uk

### App Name

Nibomo: Флешкартки з ШІ

### Short Description

Створюйте картки з нотаток і фото та вчіться з інтервальними повтореннями

### Full Description

Nibomo — застосунок із флешкартками та ШІ для тих, хто хоче пам’ятати вивчене. Раніше він називався Flashcards Open Source App.

Готуйтеся до іспитів і занять, вивчайте слова, повторюйте медичні й технічні теми. ШІ допомагає покращувати картки та планувати навчання. Колоди, теги й інтервальні повторення полегшують щоденну практику.

Що можна робити:
- Зосереджено повторювати картки, для яких настав час повторення
- Створювати й редагувати картки з текстом на лицьовій і зворотній сторонах, колодами й тегами
- Шукати й фільтрувати матеріали у своїй бібліотеці
- Створювати фільтровані колоди за тегами й рівнем зусиль
- Налаштовувати розклад майбутніх повторень
- Експортувати поточний робочий простір у CSV
- Обговорювати картки в чаті з ШІ, покращувати зміст і планувати навчання
- Додавати фото й файли до запитів для ШІ або користуватися голосовим введенням на підтримуваних пристроях
- Входити за електронною поштою та синхронізувати робочий простір між пристроями
- Користуватися офіційним сервісом або підключати власний сервер

ШІ є частиною навчального процесу. Повторення проходить швидко, з меншою кількістю зайвих дій і відволікань. Колоди, теги, фільтри й налаштування розкладу допомагають упорядкувати матеріал. Застосунок пропонує нативний досвід Android із Material 3.

Nibomo підходить учням, студентам, тим, хто вивчає мови, студентам медичних і медсестринських програм, розробникам і всім, хто хоче щодня вчитися з картками, ШІ та інтервальними повтореннями.

Проєкт має відкритий код. Можна переглянути всю систему, розвивати її та розміщувати на власному сервері. Код застосунку, серверної частини й інфраструктури доступний на GitHub:
https://github.com/kirill-markin/flashcards-open-source-app

## Urdu - ur

### App Name

Nibomo: AI فلیش کارڈز

### Short Description

نوٹس اور تصاویر سے فلیش کارڈز بنائیں اور وقفوں سے دہرائیں تاکہ یاد رہیں

### Full Description

جو کچھ سیکھیں اسے یاد رکھنے کے لیے Nibomo میں AI کی مدد سے فلیش کارڈز پر پڑھیں۔ اس ایپ کا پرانا نام Flashcards Open Source App تھا۔

امتحانوں اور اسباق کی تیاری کریں، نئے الفاظ سیکھیں اور طبی و تکنیکی موضوعات دہرائیں۔ AI سے کارڈز بہتر بنائیں اور پڑھائی کی منصوبہ بندی کریں۔ کارڈز کے مجموعے، ٹیگز اور وقفوں سے دہرائی روزانہ مطالعے کی عادت برقرار رکھنے میں مدد دیتے ہیں۔

آپ کیا کر سکتے ہیں:
- جن کارڈز کی باری آ گئی ہو انہیں مقررہ وقفوں سے توجہ کے ساتھ دہرائیں
- سامنے اور پیچھے کے متن، مجموعوں اور ٹیگز کے ساتھ کارڈز بنائیں اور ان میں ترمیم کریں
- اپنی لائبریری میں تلاش کریں اور فلٹر لگائیں
- ٹیگز اور درکار محنت کی سطح کے مطابق فلٹر کیے ہوئے مجموعے بنائیں
- آئندہ دہرائی کے لیے اوقات کی ترتیبات بدلیں
- موجودہ ورک اسپیس کو CSV فائل میں ایکسپورٹ کریں
- AI چیٹ میں کارڈز پر بات کریں، مواد بہتر بنائیں اور پڑھائی کا منصوبہ بنائیں
- AI کو بھیجی گئی درخواستوں کے ساتھ تصاویر اور فائلیں لگائیں یا موزوں آلات پر بول کر لکھیں
- ای میل سے سائن ان کریں اور آلات کے درمیان ورک اسپیس سنک کریں
- آفیشل سروس استعمال کریں یا اپنا سرور جوڑیں

AI پڑھائی کے عمل کا حصہ ہے۔ کم خلل اور غیر ضروری مراحل کے ساتھ جلدی دہرائی کریں۔ مجموعوں، ٹیگز، فلٹرز اور وقت کی ترتیبات سے مواد منظم رکھیں۔ Material 3 سے بنی یہ ایپ Android کے مانوس استعمال کے طریقوں کی پیروی کرتی ہے۔

Nibomo طلبہ، زبانیں سیکھنے والوں، طب اور نرسنگ کے طلبہ، ڈویلپرز اور ہر اس شخص کے لیے ہے جو فلیش کارڈز، AI اور وقفوں سے دہرائی کے ذریعے روزانہ پڑھنا چاہتا ہے۔

یہ منصوبہ اوپن سورس ہے۔ آپ پورا نظام دیکھ سکتے ہیں، اسے آگے بڑھا سکتے ہیں اور اپنے سرور پر چلا سکتے ہیں۔ ایپ، بیک اینڈ اور بنیادی ڈھانچے کا تمام کوڈ GitHub پر دستیاب ہے:
https://github.com/kirill-markin/flashcards-open-source-app

## Vietnamese - vi

### App Name

Nibomo: Thẻ ghi nhớ AI

### Short Description

Biến ghi chú và ảnh thành thẻ ghi nhớ, học bằng lặp lại ngắt quãng

### Full Description

Nibomo là ứng dụng thẻ ghi nhớ có AI dành cho người muốn nhớ những gì mình học. Tên trước đây của ứng dụng là Flashcards Open Source App.

Ôn thi và bài học, học từ vựng, ghi nhớ kiến thức y khoa và kỹ thuật. AI giúp bạn cải thiện thẻ và lên kế hoạch học tập. Bộ thẻ, nhãn và phương pháp lặp lại ngắt quãng giúp việc ôn tập hằng ngày dễ duy trì hơn.

Bạn có thể:
- Tập trung ôn các thẻ đến hạn bằng phương pháp lặp lại ngắt quãng
- Tạo và chỉnh sửa thẻ với nội dung mặt trước, mặt sau, bộ thẻ và nhãn
- Tìm kiếm và lọc thư viện của mình
- Tạo bộ thẻ được lọc theo nhãn và mức độ nỗ lực
- Điều chỉnh lịch cho những lần ôn tập tiếp theo
- Xuất không gian làm việc hiện tại sang CSV
- Trao đổi về thẻ qua trò chuyện với AI, cải thiện nội dung và lên kế hoạch học
- Đính kèm ảnh và tệp vào yêu cầu gửi AI hoặc nhập bằng giọng nói trên thiết bị được hỗ trợ
- Đăng nhập bằng email và đồng bộ không gian làm việc giữa các thiết bị
- Dùng dịch vụ chính thức hoặc kết nối máy chủ riêng

AI là một phần của quá trình học. Ôn tập nhanh với ít yếu tố gây xao nhãng và thao tác thừa. Sắp xếp tài liệu bằng bộ thẻ, nhãn, bộ lọc và cài đặt lịch ôn. Ứng dụng mang lại trải nghiệm Android tự nhiên với Material 3.

Nibomo phù hợp với học sinh, sinh viên, người học ngoại ngữ, sinh viên y khoa và điều dưỡng, lập trình viên và bất kỳ ai muốn học mỗi ngày bằng thẻ ghi nhớ, AI và lặp lại ngắt quãng.

Dự án có mã nguồn mở. Bạn có thể xem toàn bộ hệ thống, phát triển thêm và tự triển khai trên máy chủ của mình. Mã nguồn của ứng dụng, phần máy chủ và hạ tầng đều có trên GitHub:
https://github.com/kirill-markin/flashcards-open-source-app

## Zulu - zu

### App Name

Nibomo: Amakhadi okufunda

### Short Description

Guqula amanothi nezithombe kube amakhadi; khumbula ngokuphinda ngezikhawu

### Full Description

I-Nibomo iwuhlelo lokufunda ngamakhadi olusebenzisa i-AI, olwenzelwe abantu abafuna ukukhumbula abakufundayo. Igama lalo langaphambili kwakungu-Flashcards Open Source App.

Lungiselela izivivinyo nezifundo, funda amagama amasha, uphinde ulwazi lwezokwelapha nolwezobuchwepheshe. I-AI ikusiza uthuthukise amakhadi futhi uhlele ukufunda. Amaqoqo amakhadi, omaka nokuphinda ngezikhawu kwenza kube lula ukuzijwayeza nsuku zonke.

Ongakwenza:
- Buyekeza amakhadi asesikhathini sokuphindwa, ugxile kuwo ngezikhawu ezihleliwe
- Dala futhi uhlele amakhadi anombhalo ngaphambili nangemuva, amaqoqo nomaka
- Sesha eqoqweni lakho futhi usebenzise izihlungi
- Dala amaqoqo ahlungwe ngomaka nangezinga lomzamo odingekayo
- Lungisa izilungiselelo zeshejuli yokuphinda esikhathini esizayo
- Khipha indawo yakho yokusebenza yamanje njengefayela le-CSV
- Xoxa ne-AI ngamakhadi akho, uthuthukise okuqukethwe futhi uhlele ukufunda
- Namathisela izithombe namafayela ezicelweni ze-AI noma usebenzise ukubhala ngezwi kumadivayisi akusekelayo
- Ngena nge-imeyili futhi uvumelanise indawo yokusebenza phakathi kwamadivayisi
- Sebenzisa isevisi esemthethweni noma uxhume iseva yakho

I-AI iyingxenye yokufunda. Phinda ngokushesha, kube neziphazamiso nezinyathelo ezingadingekile ezimbalwa. Hlela ulwazi ngamaqoqo, omaka, izihlungi nezilungiselelo zeshejuli. Uhlelo lulandela indlela yokusebenzisa i-Android nge-Material 3.

I-Nibomo ifanele abafundi, abafunda izilimi, abafundela ubudokotela nobuhlengikazi, abathuthukisi bezinhlelo nawo wonke umuntu ofuna ukufunda nsuku zonke ngamakhadi, nge-AI nangokuphinda ngezikhawu.

Le phrojekthi inomthombo wekhodi ovulekile. Ungahlola lonke uhlelo, uluthuthukise futhi ulusingathe kuseva yakho. Yonke ikhodi yohlelo, yengxenye yeseva neyengqalasizinda iyatholakala ku-GitHub:
https://github.com/kirill-markin/flashcards-open-source-app
