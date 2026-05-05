package com.flashcardsopensourceapp.app.marketing.screenshots

import androidx.test.platform.app.InstrumentationRegistry

internal const val marketingLocalePrefixInstrumentationArg: String = "marketingLocalePrefix"

internal data class MarketingScreenshotUiText(
    val emptyCardsMessage: String,
    val cardsTabTitle: String,
    val reviewTabTitle: String,
    val aiTabTitle: String,
    val searchCardsPlaceholder: String,
    val addCardContentDescription: String,
    val frontFieldTitle: String,
    val backFieldTitle: String,
    val tagsFieldTitle: String,
    val addTagFieldTitle: String,
    val addTagButtonTitle: String,
    val saveButtonTitle: String,
    val ratingAgainTitle: String,
    val ratingHardTitle: String,
    val ratingGoodTitle: String,
    val ratingEasyTitle: String
)

internal data class MarketingReviewCardFixture(
    val frontText: String,
    val backText: String,
    val tags: List<String>,
    val effortLevelTitle: String
)

internal data class MarketingConceptCard(
    val frontText: String,
    val backText: String,
    val subjectTag: String
)

internal data class MarketingScreenshotLocaleConfig(
    val localePrefix: String,
    val appLocaleTag: String,
    val uiText: MarketingScreenshotUiText,
    val reviewCard: MarketingReviewCardFixture,
    val reviewAiDraftMessage: String,
    val cards: List<MarketingConceptCard>
)

private fun makeEnglishUnitedStatesMarketingScreenshotLocaleConfig(
    localePrefix: String
): MarketingScreenshotLocaleConfig {
    return MarketingScreenshotLocaleConfig(
        localePrefix = localePrefix,
        appLocaleTag = "en-US",
        uiText = MarketingScreenshotUiText(
            emptyCardsMessage = "No cards yet. Tap the add button to create the first card.",
            cardsTabTitle = "Cards",
            reviewTabTitle = "Review",
            aiTabTitle = "AI",
            searchCardsPlaceholder = "Search cards",
            addCardContentDescription = "Add card",
            frontFieldTitle = "Front",
            backFieldTitle = "Back",
            tagsFieldTitle = "Tags",
            addTagFieldTitle = "Add a tag",
            addTagButtonTitle = "Add tag",
            saveButtonTitle = "Save",
            ratingAgainTitle = "Again",
            ratingHardTitle = "Hard",
            ratingGoodTitle = "Good",
            ratingEasyTitle = "Easy"
        ),
        reviewCard = MarketingReviewCardFixture(
            frontText = "In economics, what is opportunity cost?",
            backText = "Opportunity cost is the value of the next best alternative you give up when you choose one option over another.\n\n" +
                "Exam example: If you spend Saturday studying for a microeconomics exam instead of working a paid shift, " +
                "the lost wages are part of the opportunity cost.",
            tags = listOf("economics"),
            effortLevelTitle = "Medium"
        ),
        reviewAiDraftMessage = "Create 6 new flashcards on the same economics topic, covering closely related ideas that we do not already have.",
        cards = listOf(
            MarketingConceptCard(
                frontText = "In economics, what is opportunity cost?",
                backText = "The value of the next best alternative you give up when you choose one option over another.",
                subjectTag = "economics"
            ),
            MarketingConceptCard(
                frontText = "In biology, what is osmosis?",
                backText = "The movement of water through a membrane from lower solute concentration to higher solute concentration.",
                subjectTag = "biology"
            ),
            MarketingConceptCard(
                frontText = "In statistics, what is standard deviation?",
                backText = "A measure of how spread out values are around the average.",
                subjectTag = "statistics"
            ),
            MarketingConceptCard(
                frontText = "In chemistry, what is a catalyst?",
                backText = "A substance that speeds up a chemical reaction without being consumed by it.",
                subjectTag = "chemistry"
            ),
            MarketingConceptCard(
                frontText = "In psychology, what is cognitive bias?",
                backText = "A systematic pattern of thinking that can distort judgment and decision-making.",
                subjectTag = "psychology"
            ),
            MarketingConceptCard(
                frontText = "In physics, what is velocity?",
                backText = "The speed of an object together with the direction of its motion.",
                subjectTag = "physics"
            ),
            MarketingConceptCard(
                frontText = "In computer science, what is recursion?",
                backText = "A method where a function solves a problem by calling itself on smaller versions of that problem.",
                subjectTag = "computer science"
            )
        )
    )
}

private val arabicMarketingScreenshotLocaleConfig: MarketingScreenshotLocaleConfig = MarketingScreenshotLocaleConfig(
    localePrefix = "ar",
    appLocaleTag = "ar",
    uiText = MarketingScreenshotUiText(
        emptyCardsMessage = "لا توجد بطاقات بعد. اضغط على زر الإضافة لإنشاء أول بطاقة.",
        cardsTabTitle = "البطاقات",
        reviewTabTitle = "المراجعة",
        aiTabTitle = "AI",
        searchCardsPlaceholder = "ابحث في البطاقات",
        addCardContentDescription = "إضافة بطاقة",
        frontFieldTitle = "الوجه الأمامي",
        backFieldTitle = "الوجه الخلفي",
        tagsFieldTitle = "العلامات",
        addTagFieldTitle = "أضف علامة",
        addTagButtonTitle = "إضافة علامة",
        saveButtonTitle = "حفظ",
        ratingAgainTitle = "مرة أخرى",
        ratingHardTitle = "صعب",
        ratingGoodTitle = "جيد",
        ratingEasyTitle = "سهل"
    ),
    reviewCard = MarketingReviewCardFixture(
        frontText = "في الاقتصاد، ما هي تكلفة الفرصة البديلة؟",
        backText = "تكلفة الفرصة البديلة هي قيمة أفضل بديل تتخلى عنه عندما تختار خيارًا بدلًا من آخر.\n\n" +
            "مثال امتحاني: إذا قضيت يوم السبت في الاستعداد لامتحان الاقتصاد الجزئي بدلًا من العمل في وردية مدفوعة الأجر، فإن الأجر الذي خسرته يُعد جزءًا من تكلفة الفرصة البديلة.",
        tags = listOf("اقتصاد"),
        effortLevelTitle = "متوسط"
    ),
    reviewAiDraftMessage = "أنشئ 6 بطاقات تعليمية جديدة حول الموضوع الاقتصادي نفسه، تغطي أفكارًا مرتبطة به ارتباطًا وثيقًا ولا نملكها بعد.",
    cards = listOf(
        MarketingConceptCard(
            frontText = "في الاقتصاد، ما هي تكلفة الفرصة البديلة؟",
            backText = "هي قيمة أفضل بديل تتخلى عنه عندما تختار خيارًا بدلًا من آخر.",
            subjectTag = "اقتصاد"
        ),
        MarketingConceptCard(
            frontText = "في علم الأحياء، ما هو التناضح؟",
            backText = "هو انتقال الماء عبر غشاء من تركيز أقل للمذاب إلى تركيز أعلى للمذاب.",
            subjectTag = "أحياء"
        ),
        MarketingConceptCard(
            frontText = "في الإحصاء، ما هو الانحراف المعياري؟",
            backText = "هو مقياس يوضح مدى تشتت القيم حول المتوسط.",
            subjectTag = "إحصاء"
        ),
        MarketingConceptCard(
            frontText = "في الكيمياء، ما هو العامل الحفاز؟",
            backText = "هو مادة تسرّع التفاعل الكيميائي من دون أن تُستهلك أثناء التفاعل.",
            subjectTag = "كيمياء"
        ),
        MarketingConceptCard(
            frontText = "في علم النفس، ما هو التحيز المعرفي؟",
            backText = "هو نمط منهجي في التفكير يمكن أن يشوّه الحكم واتخاذ القرار.",
            subjectTag = "علم النفس"
        ),
        MarketingConceptCard(
            frontText = "في الفيزياء، ما هي السرعة المتجهة؟",
            backText = "هي مقدار حركة الجسم مع تحديد اتجاه هذه الحركة.",
            subjectTag = "فيزياء"
        ),
        MarketingConceptCard(
            frontText = "في علوم الحاسوب، ما هو الاستدعاء الذاتي؟",
            backText = "هو أسلوب تحل فيه الدالة المشكلة عبر استدعاء نفسها على نسخ أصغر من المشكلة.",
            subjectTag = "علوم الحاسوب"
        )
    )
)

private val chineseSimplifiedMarketingScreenshotLocaleConfig: MarketingScreenshotLocaleConfig = MarketingScreenshotLocaleConfig(
    localePrefix = "zh-CN",
    appLocaleTag = "zh-CN",
    uiText = MarketingScreenshotUiText(
        emptyCardsMessage = "还没有卡片。点按添加按钮来创建第一张卡片。",
        cardsTabTitle = "卡片",
        reviewTabTitle = "复习",
        aiTabTitle = "AI",
        searchCardsPlaceholder = "搜索卡片",
        addCardContentDescription = "添加卡片",
        frontFieldTitle = "正面",
        backFieldTitle = "背面",
        tagsFieldTitle = "标签",
        addTagFieldTitle = "添加标签",
        addTagButtonTitle = "添加标签",
        saveButtonTitle = "保存",
        ratingAgainTitle = "再来一次",
        ratingHardTitle = "困难",
        ratingGoodTitle = "良好",
        ratingEasyTitle = "简单"
    ),
    reviewCard = MarketingReviewCardFixture(
        frontText = "在经济学中，什么是机会成本？",
        backText = "机会成本是当你在多个选项中做出选择时，所放弃的最佳替代方案的价值。\n\n" +
            "考试示例：如果你把周六用来准备微观经济学考试，而不是去上一班有报酬的班次，那么失去的工资就是机会成本的一部分。",
        tags = listOf("经济学"),
        effortLevelTitle = "中等"
    ),
    reviewAiDraftMessage = "请围绕同一经济学主题再创建 6 张新卡片，覆盖与之密切相关且我们目前还没有的概念。",
    cards = listOf(
        MarketingConceptCard(
            frontText = "在经济学中，什么是机会成本？",
            backText = "是在做出选择时所放弃的最佳替代方案的价值。",
            subjectTag = "经济学"
        ),
        MarketingConceptCard(
            frontText = "在生物学中，什么是渗透作用？",
            backText = "是水分通过膜从低溶质浓度一侧向高溶质浓度一侧移动的过程。",
            subjectTag = "生物学"
        ),
        MarketingConceptCard(
            frontText = "在统计学中，什么是标准差？",
            backText = "是衡量数据围绕平均值分散程度的指标。",
            subjectTag = "统计学"
        ),
        MarketingConceptCard(
            frontText = "在化学中，什么是催化剂？",
            backText = "是在不被消耗的情况下加快化学反应速度的物质。",
            subjectTag = "化学"
        ),
        MarketingConceptCard(
            frontText = "在心理学中，什么是认知偏差？",
            backText = "是一种可能扭曲判断与决策的系统性思维模式。",
            subjectTag = "心理学"
        ),
        MarketingConceptCard(
            frontText = "在物理学中，什么是速度？",
            backText = "是物体运动快慢及其方向的综合量。",
            subjectTag = "物理学"
        ),
        MarketingConceptCard(
            frontText = "在计算机科学中，什么是递归？",
            backText = "是一种通过让函数调用自身来解决更小规模同类问题的方法。",
            subjectTag = "计算机科学"
        )
    )
)

private val germanMarketingScreenshotLocaleConfig: MarketingScreenshotLocaleConfig = MarketingScreenshotLocaleConfig(
    localePrefix = "de-DE",
    appLocaleTag = "de-DE",
    uiText = MarketingScreenshotUiText(
        emptyCardsMessage = "Es gibt noch keine Karten. Tippe auf die Hinzufügen-Schaltfläche, um die erste Karte zu erstellen.",
        cardsTabTitle = "Karten",
        reviewTabTitle = "Wiederholen",
        aiTabTitle = "AI",
        searchCardsPlaceholder = "Karten suchen",
        addCardContentDescription = "Karte hinzufügen",
        frontFieldTitle = "Vorderseite",
        backFieldTitle = "Rückseite",
        tagsFieldTitle = "Tags",
        addTagFieldTitle = "Tag hinzufügen",
        addTagButtonTitle = "Tag hinzufügen",
        saveButtonTitle = "Speichern",
        ratingAgainTitle = "Nochmal",
        ratingHardTitle = "Schwer",
        ratingGoodTitle = "Gut",
        ratingEasyTitle = "Leicht"
    ),
    reviewCard = MarketingReviewCardFixture(
        frontText = "Was sind in der Volkswirtschaftslehre Opportunitätskosten?",
        backText = "Opportunitätskosten sind der Wert der besten Alternative, auf die man verzichtet, wenn man sich für eine andere Option entscheidet.\n\n" +
            "Prüfungsbeispiel: Wenn du den Samstag damit verbringst, für eine Mikroökonomie-Klausur zu lernen, statt eine bezahlte Schicht zu arbeiten, gehört der entgangene Lohn zu den Opportunitätskosten.",
        tags = listOf("Volkswirtschaft"),
        effortLevelTitle = "Mittel"
    ),
    reviewAiDraftMessage = "Erstelle 6 neue Lernkarten zum selben volkswirtschaftlichen Thema, die eng verwandte Ideen abdecken und die wir noch nicht haben.",
    cards = listOf(
        MarketingConceptCard(
            frontText = "Was sind in der Volkswirtschaftslehre Opportunitätskosten?",
            backText = "Der Wert der besten Alternative, auf die man bei einer Entscheidung verzichtet.",
            subjectTag = "Volkswirtschaft"
        ),
        MarketingConceptCard(
            frontText = "Was ist in der Biologie Osmose?",
            backText = "Die Bewegung von Wasser durch eine Membran von niedrigerer zu höherer Konzentration gelöster Stoffe.",
            subjectTag = "Biologie"
        ),
        MarketingConceptCard(
            frontText = "Was bezeichnet in der Statistik die Standardabweichung?",
            backText = "Ein Maß dafür, wie stark Werte um den Durchschnitt streuen.",
            subjectTag = "Statistik"
        ),
        MarketingConceptCard(
            frontText = "Was ist in der Chemie ein Katalysator?",
            backText = "Ein Stoff, der eine chemische Reaktion beschleunigt, ohne selbst verbraucht zu werden.",
            subjectTag = "Chemie"
        ),
        MarketingConceptCard(
            frontText = "Was ist in der Psychologie eine kognitive Verzerrung?",
            backText = "Ein systematisches Denkmuster, das Urteile und Entscheidungen verfälschen kann.",
            subjectTag = "Psychologie"
        ),
        MarketingConceptCard(
            frontText = "Was ist in der Physik Geschwindigkeit?",
            backText = "Die Schnelligkeit einer Bewegung zusammen mit ihrer Richtung.",
            subjectTag = "Physik"
        ),
        MarketingConceptCard(
            frontText = "Was bedeutet in der Informatik Rekursion?",
            backText = "Eine Methode, bei der eine Funktion ein Problem löst, indem sie sich mit kleineren Teilproblemen selbst aufruft.",
            subjectTag = "Informatik"
        )
    )
)

private val hindiMarketingScreenshotLocaleConfig: MarketingScreenshotLocaleConfig = MarketingScreenshotLocaleConfig(
    localePrefix = "hi-IN",
    appLocaleTag = "hi-IN",
    uiText = MarketingScreenshotUiText(
        emptyCardsMessage = "अभी तक कोई कार्ड नहीं है। पहला कार्ड बनाने के लिए जोड़ें बटन पर टैप करें।",
        cardsTabTitle = "कार्ड",
        reviewTabTitle = "पुनरावलोकन",
        aiTabTitle = "AI",
        searchCardsPlaceholder = "कार्ड खोजें",
        addCardContentDescription = "कार्ड जोड़ें",
        frontFieldTitle = "सामने",
        backFieldTitle = "पीछे",
        tagsFieldTitle = "टैग",
        addTagFieldTitle = "टैग जोड़ें",
        addTagButtonTitle = "टैग जोड़ें",
        saveButtonTitle = "सहेजें",
        ratingAgainTitle = "फिर से",
        ratingHardTitle = "कठिन",
        ratingGoodTitle = "अच्छा",
        ratingEasyTitle = "आसान"
    ),
    reviewCard = MarketingReviewCardFixture(
        frontText = "अर्थशास्त्र में अवसर लागत क्या होती है?",
        backText = "अवसर लागत उस सबसे अच्छे विकल्प का मूल्य है, जिसे आप किसी दूसरी पसंद को चुनते समय छोड़ देते हैं।\n\n" +
            "परीक्षा उदाहरण: अगर आप शनिवार को माइक्रोइकॉनॉमिक्स की परीक्षा की तैयारी में लगाते हैं, बजाय किसी भुगतान वाली शिफ्ट में काम करने के, तो छूटी हुई मजदूरी अवसर लागत का हिस्सा होती है।",
        tags = listOf("अर्थशास्त्र"),
        effortLevelTitle = "मध्यम"
    ),
    reviewAiDraftMessage = "इसी अर्थशास्त्र विषय पर 6 नई फ्लैशकार्ड बनाओ, जो इससे करीबी रूप से जुड़े विचारों को कवर करें और जो हमारे पास पहले से मौजूद न हों।",
    cards = listOf(
        MarketingConceptCard(
            frontText = "अर्थशास्त्र में अवसर लागत क्या होती है?",
            backText = "किसी विकल्प को चुनते समय छोड़े गए सबसे अच्छे वैकल्पिक विकल्प का मूल्य।",
            subjectTag = "अर्थशास्त्र"
        ),
        MarketingConceptCard(
            frontText = "जीवविज्ञान में परासरण क्या है?",
            backText = "वह प्रक्रिया जिसमें पानी झिल्ली के आर-पार कम विलेय सांद्रता से अधिक विलेय सांद्रता की ओर बढ़ता है।",
            subjectTag = "जीवविज्ञान"
        ),
        MarketingConceptCard(
            frontText = "सांख्यिकी में मानक विचलन क्या है?",
            backText = "यह बताने वाला माप कि मान औसत के आसपास कितने फैले हुए हैं।",
            subjectTag = "सांख्यिकी"
        ),
        MarketingConceptCard(
            frontText = "रसायन विज्ञान में उत्प्रेरक क्या होता है?",
            backText = "ऐसा पदार्थ जो स्वयं खर्च हुए बिना रासायनिक अभिक्रिया की गति बढ़ाता है।",
            subjectTag = "रसायन"
        ),
        MarketingConceptCard(
            frontText = "मनोविज्ञान में संज्ञानात्मक पक्षपात क्या है?",
            backText = "सोचने का ऐसा व्यवस्थित पैटर्न जो निर्णय और आकलन को विकृत कर सकता है।",
            subjectTag = "मनोविज्ञान"
        ),
        MarketingConceptCard(
            frontText = "भौतिकी में वेग क्या है?",
            backText = "किसी वस्तु की चाल और उसकी दिशा का संयुक्त माप।",
            subjectTag = "भौतिकी"
        ),
        MarketingConceptCard(
            frontText = "कंप्यूटर विज्ञान में रिकर्शन क्या है?",
            backText = "ऐसी विधि जिसमें कोई फ़ंक्शन समस्या के छोटे रूपों को हल करने के लिए स्वयं को ही पुकारता है।",
            subjectTag = "कंप्यूटर विज्ञान"
        )
    )
)

private val japaneseMarketingScreenshotLocaleConfig: MarketingScreenshotLocaleConfig = MarketingScreenshotLocaleConfig(
    localePrefix = "ja-JP",
    appLocaleTag = "ja-JP",
    uiText = MarketingScreenshotUiText(
        emptyCardsMessage = "まだカードがありません。追加ボタンをタップして最初のカードを作成してください。",
        cardsTabTitle = "カード",
        reviewTabTitle = "復習",
        aiTabTitle = "AI",
        searchCardsPlaceholder = "カードを検索",
        addCardContentDescription = "カードを追加",
        frontFieldTitle = "表面",
        backFieldTitle = "裏面",
        tagsFieldTitle = "タグ",
        addTagFieldTitle = "タグを追加",
        addTagButtonTitle = "タグを追加",
        saveButtonTitle = "保存",
        ratingAgainTitle = "もう一度",
        ratingHardTitle = "難しい",
        ratingGoodTitle = "良い",
        ratingEasyTitle = "簡単"
    ),
    reviewCard = MarketingReviewCardFixture(
        frontText = "経済学でいう機会費用とは何ですか？",
        backText = "機会費用とは、ある選択をしたときに諦める最良の代替案の価値のことです。\n\n" +
            "試験の例：土曜日を有給シフトで働く代わりにミクロ経済学の試験勉強に使ったなら、得られなかった賃金は機会費用の一部になります。",
        tags = listOf("経済学"),
        effortLevelTitle = "中"
    ),
    reviewAiDraftMessage = "同じ経済学のテーマについて、関連性が高く、まだ私たちが持っていない内容の新しいフラッシュカードを 6 枚作ってください。",
    cards = listOf(
        MarketingConceptCard(
            frontText = "経済学でいう機会費用とは何ですか？",
            backText = "ある選択をしたときに諦める最良の代替案の価値です。",
            subjectTag = "経済学"
        ),
        MarketingConceptCard(
            frontText = "生物学でいう浸透とは何ですか？",
            backText = "溶質濃度の低い側から高い側へ、水が膜を通って移動する現象です。",
            subjectTag = "生物学"
        ),
        MarketingConceptCard(
            frontText = "統計学でいう標準偏差とは何ですか？",
            backText = "値が平均の周りにどの程度ばらついているかを表す指標です。",
            subjectTag = "統計学"
        ),
        MarketingConceptCard(
            frontText = "化学でいう触媒とは何ですか？",
            backText = "自らは消費されずに化学反応を速める物質です。",
            subjectTag = "化学"
        ),
        MarketingConceptCard(
            frontText = "心理学でいう認知バイアスとは何ですか？",
            backText = "判断や意思決定をゆがめるおそれのある、系統的な思考の偏りです。",
            subjectTag = "心理学"
        ),
        MarketingConceptCard(
            frontText = "物理学でいう速度とは何ですか？",
            backText = "物体の動く速さとその向きをあわせて表す量です。",
            subjectTag = "物理学"
        ),
        MarketingConceptCard(
            frontText = "情報科学でいう再帰とは何ですか？",
            backText = "関数が自分自身を呼び出しながら、より小さな同種の問題を解く方法です。",
            subjectTag = "情報科学"
        )
    )
)

private val russianMarketingScreenshotLocaleConfig: MarketingScreenshotLocaleConfig = MarketingScreenshotLocaleConfig(
    localePrefix = "ru-RU",
    appLocaleTag = "ru-RU",
    uiText = MarketingScreenshotUiText(
        emptyCardsMessage = "Карточек пока нет. Нажмите кнопку добавления, чтобы создать первую карточку.",
        cardsTabTitle = "Карточки",
        reviewTabTitle = "Повторение",
        aiTabTitle = "AI",
        searchCardsPlaceholder = "Поиск карточек",
        addCardContentDescription = "Добавить карточку",
        frontFieldTitle = "Лицевая сторона",
        backFieldTitle = "Обратная сторона",
        tagsFieldTitle = "Теги",
        addTagFieldTitle = "Добавить тег",
        addTagButtonTitle = "Добавить тег",
        saveButtonTitle = "Сохранить",
        ratingAgainTitle = "Снова",
        ratingHardTitle = "Трудно",
        ratingGoodTitle = "Хорошо",
        ratingEasyTitle = "Легко"
    ),
    reviewCard = MarketingReviewCardFixture(
        frontText = "Что такое альтернативная стоимость в экономике?",
        backText = "Альтернативная стоимость — это ценность лучшего варианта, от которого вы отказываетесь, выбирая другой вариант.\n\n" +
            "Пример для экзамена: если вы тратите субботу на подготовку к экзамену по микроэкономике вместо оплачиваемой смены, то недополученный заработок входит в альтернативную стоимость.",
        tags = listOf("экономика"),
        effortLevelTitle = "Средний"
    ),
    reviewAiDraftMessage = "Создай 6 новых карточек по той же теме экономики, которые охватывают тесно связанные идеи и которых у нас ещё нет.",
    cards = listOf(
        MarketingConceptCard(
            frontText = "Что такое альтернативная стоимость в экономике?",
            backText = "Это ценность лучшего варианта, от которого вы отказываетесь, делая выбор.",
            subjectTag = "экономика"
        ),
        MarketingConceptCard(
            frontText = "Что такое осмос в биологии?",
            backText = "Это движение воды через мембрану из области с меньшей концентрацией растворённых веществ в область с большей концентрацией.",
            subjectTag = "биология"
        ),
        MarketingConceptCard(
            frontText = "Что такое стандартное отклонение в статистике?",
            backText = "Это мера того, насколько сильно значения разбросаны вокруг среднего.",
            subjectTag = "статистика"
        ),
        MarketingConceptCard(
            frontText = "Что такое катализатор в химии?",
            backText = "Это вещество, которое ускоряет химическую реакцию и при этом не расходуется.",
            subjectTag = "химия"
        ),
        MarketingConceptCard(
            frontText = "Что такое когнитивное искажение в психологии?",
            backText = "Это систематический шаблон мышления, который может искажать суждения и решения.",
            subjectTag = "психология"
        ),
        MarketingConceptCard(
            frontText = "Что такое векторная скорость в физике?",
            backText = "Это величина, которая описывает быстроту движения объекта и его направление.",
            subjectTag = "физика"
        ),
        MarketingConceptCard(
            frontText = "Что такое рекурсия в информатике?",
            backText = "Это способ решения задачи, при котором функция вызывает саму себя для более маленьких версий той же задачи.",
            subjectTag = "информатика"
        )
    )
)

private val spanishLatinAmericaMarketingScreenshotLocaleConfig: MarketingScreenshotLocaleConfig = MarketingScreenshotLocaleConfig(
    localePrefix = "es-419",
    appLocaleTag = "es-419",
    uiText = MarketingScreenshotUiText(
        emptyCardsMessage = "Todavía no hay tarjetas. Toca el botón de agregar para crear la primera tarjeta.",
        cardsTabTitle = "Tarjetas",
        reviewTabTitle = "Repasar",
        aiTabTitle = "AI",
        searchCardsPlaceholder = "Buscar tarjetas",
        addCardContentDescription = "Agregar tarjeta",
        frontFieldTitle = "Frente",
        backFieldTitle = "Reverso",
        tagsFieldTitle = "Etiquetas",
        addTagFieldTitle = "Agregar una etiqueta",
        addTagButtonTitle = "Agregar etiqueta",
        saveButtonTitle = "Guardar",
        ratingAgainTitle = "Otra vez",
        ratingHardTitle = "Difícil",
        ratingGoodTitle = "Bien",
        ratingEasyTitle = "Fácil"
    ),
    reviewCard = MarketingReviewCardFixture(
        frontText = "En economía, ¿qué es el costo de oportunidad?",
        backText = "El costo de oportunidad es el valor de la mejor alternativa a la que renuncias cuando eliges una opción en lugar de otra.\n\n" +
            "Ejemplo de examen: si dedicas el sábado a estudiar para un examen de microeconomía en vez de trabajar en un turno pagado, el dinero que dejaste de ganar forma parte del costo de oportunidad.",
        tags = listOf("economía"),
        effortLevelTitle = "Medio"
    ),
    reviewAiDraftMessage = "Crea 6 tarjetas nuevas sobre el mismo tema de economía, que cubran ideas estrechamente relacionadas y que todavía no tengamos.",
    cards = listOf(
        MarketingConceptCard(
            frontText = "En economía, ¿qué es el costo de oportunidad?",
            backText = "El valor de la mejor alternativa a la que renuncias cuando eliges otra opción.",
            subjectTag = "economía"
        ),
        MarketingConceptCard(
            frontText = "En biología, ¿qué es la ósmosis?",
            backText = "El movimiento del agua a través de una membrana desde una concentración menor de solutos hacia una mayor.",
            subjectTag = "biología"
        ),
        MarketingConceptCard(
            frontText = "En estadística, ¿qué es la desviación estándar?",
            backText = "Una medida de qué tan dispersos están los valores alrededor del promedio.",
            subjectTag = "estadística"
        ),
        MarketingConceptCard(
            frontText = "En química, ¿qué es un catalizador?",
            backText = "Una sustancia que acelera una reacción química sin consumirse en el proceso.",
            subjectTag = "química"
        ),
        MarketingConceptCard(
            frontText = "En psicología, ¿qué es un sesgo cognitivo?",
            backText = "Un patrón sistemático de pensamiento que puede distorsionar el juicio y la toma de decisiones.",
            subjectTag = "psicología"
        ),
        MarketingConceptCard(
            frontText = "En física, ¿qué es la velocidad?",
            backText = "La rapidez de un objeto junto con la dirección de su movimiento.",
            subjectTag = "física"
        ),
        MarketingConceptCard(
            frontText = "En ciencias de la computación, ¿qué es la recursión?",
            backText = "Un método en el que una función resuelve un problema llamándose a sí misma sobre versiones más pequeñas del mismo problema.",
            subjectTag = "computación"
        )
    )
)

private val spanishSpainMarketingScreenshotLocaleConfig: MarketingScreenshotLocaleConfig = MarketingScreenshotLocaleConfig(
    localePrefix = "es-ES",
    appLocaleTag = "es-ES",
    uiText = MarketingScreenshotUiText(
        emptyCardsMessage = "Aún no hay tarjetas. Pulsa el botón de añadir para crear la primera tarjeta.",
        cardsTabTitle = "Tarjetas",
        reviewTabTitle = "Repasar",
        aiTabTitle = "AI",
        searchCardsPlaceholder = "Buscar tarjetas",
        addCardContentDescription = "Añadir tarjeta",
        frontFieldTitle = "Anverso",
        backFieldTitle = "Reverso",
        tagsFieldTitle = "Etiquetas",
        addTagFieldTitle = "Añadir una etiqueta",
        addTagButtonTitle = "Añadir etiqueta",
        saveButtonTitle = "Guardar",
        ratingAgainTitle = "Otra vez",
        ratingHardTitle = "Difícil",
        ratingGoodTitle = "Bien",
        ratingEasyTitle = "Fácil"
    ),
    reviewCard = MarketingReviewCardFixture(
        frontText = "En economía, ¿qué es el coste de oportunidad?",
        backText = "El coste de oportunidad es el valor de la mejor alternativa a la que renuncias cuando eliges una opción en lugar de otra.\n\n" +
            "Ejemplo de examen: si dedicas el sábado a preparar un examen de microeconomía en vez de trabajar en un turno remunerado, el sueldo que dejas de percibir forma parte del coste de oportunidad.",
        tags = listOf("economía"),
        effortLevelTitle = "Media"
    ),
    reviewAiDraftMessage = "Crea 6 tarjetas nuevas sobre el mismo tema de economía, que cubran ideas estrechamente relacionadas y que todavía no tengamos.",
    cards = listOf(
        MarketingConceptCard(
            frontText = "En economía, ¿qué es el coste de oportunidad?",
            backText = "El valor de la mejor alternativa a la que renuncias cuando eliges otra opción.",
            subjectTag = "economía"
        ),
        MarketingConceptCard(
            frontText = "En biología, ¿qué es la ósmosis?",
            backText = "El movimiento del agua a través de una membrana desde una concentración menor de solutos hacia una mayor.",
            subjectTag = "biología"
        ),
        MarketingConceptCard(
            frontText = "En estadística, ¿qué es la desviación típica?",
            backText = "Una medida de lo dispersos que están los valores alrededor de la media.",
            subjectTag = "estadística"
        ),
        MarketingConceptCard(
            frontText = "En química, ¿qué es un catalizador?",
            backText = "Una sustancia que acelera una reacción química sin consumirse en el proceso.",
            subjectTag = "química"
        ),
        MarketingConceptCard(
            frontText = "En psicología, ¿qué es un sesgo cognitivo?",
            backText = "Un patrón sistemático de pensamiento que puede distorsionar el juicio y la toma de decisiones.",
            subjectTag = "psicología"
        ),
        MarketingConceptCard(
            frontText = "En física, ¿qué es la velocidad?",
            backText = "La rapidez de un objeto junto con la dirección de su movimiento.",
            subjectTag = "física"
        ),
        MarketingConceptCard(
            frontText = "En informática, ¿qué es la recursión?",
            backText = "Un método en el que una función resuelve un problema llamándose a sí misma sobre versiones más pequeñas del mismo problema.",
            subjectTag = "informática"
        )
    )
)

private val spanishUnitedStatesMarketingScreenshotLocaleConfig: MarketingScreenshotLocaleConfig = MarketingScreenshotLocaleConfig(
    localePrefix = "es-US",
    appLocaleTag = "es-US",
    uiText = MarketingScreenshotUiText(
        emptyCardsMessage = "Todavía no hay tarjetas. Toca el botón de agregar para crear la primera tarjeta.",
        cardsTabTitle = "Tarjetas",
        reviewTabTitle = "Repasar",
        aiTabTitle = "AI",
        searchCardsPlaceholder = "Buscar tarjetas",
        addCardContentDescription = "Agregar tarjeta",
        frontFieldTitle = "Frente",
        backFieldTitle = "Reverso",
        tagsFieldTitle = "Etiquetas",
        addTagFieldTitle = "Agregar una etiqueta",
        addTagButtonTitle = "Agregar etiqueta",
        saveButtonTitle = "Guardar",
        ratingAgainTitle = "Otra vez",
        ratingHardTitle = "Difícil",
        ratingGoodTitle = "Bien",
        ratingEasyTitle = "Fácil"
    ),
    reviewCard = MarketingReviewCardFixture(
        frontText = "En economía, ¿qué es el costo de oportunidad?",
        backText = "El costo de oportunidad es el valor de la mejor alternativa a la que renuncias cuando eliges una opción en lugar de otra.\n\n" +
            "Ejemplo de examen: si dedicas el sábado a estudiar para un examen de microeconomía en vez de trabajar en un turno pagado, el ingreso que dejaste de ganar forma parte del costo de oportunidad.",
        tags = listOf("economía"),
        effortLevelTitle = "Medio"
    ),
    reviewAiDraftMessage = "Crea 6 tarjetas nuevas sobre el mismo tema de economía, que cubran ideas estrechamente relacionadas y que todavía no tengamos.",
    cards = listOf(
        MarketingConceptCard(
            frontText = "En economía, ¿qué es el costo de oportunidad?",
            backText = "El valor de la mejor alternativa a la que renuncias cuando eliges otra opción.",
            subjectTag = "economía"
        ),
        MarketingConceptCard(
            frontText = "En biología, ¿qué es la ósmosis?",
            backText = "El movimiento del agua a través de una membrana desde una concentración menor de solutos hacia una mayor.",
            subjectTag = "biología"
        ),
        MarketingConceptCard(
            frontText = "En estadística, ¿qué es la desviación estándar?",
            backText = "Una medida de qué tan dispersos están los valores alrededor del promedio.",
            subjectTag = "estadística"
        ),
        MarketingConceptCard(
            frontText = "En química, ¿qué es un catalizador?",
            backText = "Una sustancia que acelera una reacción química sin consumirse en el proceso.",
            subjectTag = "química"
        ),
        MarketingConceptCard(
            frontText = "En psicología, ¿qué es un sesgo cognitivo?",
            backText = "Un patrón sistemático de pensamiento que puede distorsionar el juicio y la toma de decisiones.",
            subjectTag = "psicología"
        ),
        MarketingConceptCard(
            frontText = "En física, ¿qué es la velocidad?",
            backText = "La rapidez de un objeto junto con la dirección de su movimiento.",
            subjectTag = "física"
        ),
        MarketingConceptCard(
            frontText = "En ciencias de la computación, ¿qué es la recursión?",
            backText = "Un método en el que una función resuelve un problema llamándose a sí misma sobre versiones más pequeñas del mismo problema.",
            subjectTag = "computación"
        )
    )
)

private val marketingScreenshotLocaleConfigs: List<MarketingScreenshotLocaleConfig> = listOf(
    makeEnglishUnitedStatesMarketingScreenshotLocaleConfig(localePrefix = "en"),
    makeEnglishUnitedStatesMarketingScreenshotLocaleConfig(localePrefix = "en-US"),
    arabicMarketingScreenshotLocaleConfig,
    chineseSimplifiedMarketingScreenshotLocaleConfig,
    germanMarketingScreenshotLocaleConfig,
    hindiMarketingScreenshotLocaleConfig,
    japaneseMarketingScreenshotLocaleConfig,
    russianMarketingScreenshotLocaleConfig,
    spanishLatinAmericaMarketingScreenshotLocaleConfig,
    spanishSpainMarketingScreenshotLocaleConfig,
    spanishUnitedStatesMarketingScreenshotLocaleConfig
)

private val defaultMarketingScreenshotLocaleConfig: MarketingScreenshotLocaleConfig =
    marketingScreenshotLocaleConfigs.first { config -> config.localePrefix == "en" }

private fun configuredMarketingScreenshotLocalePrefixOrNull(): String? {
    return InstrumentationRegistry.getArguments()
        .getString(marketingLocalePrefixInstrumentationArg)
        ?.trim()
        ?.takeIf { value -> value.isNotEmpty() }
}

private fun marketingScreenshotLocaleConfigForPrefix(
    localePrefix: String
): MarketingScreenshotLocaleConfig {
    return marketingScreenshotLocaleConfigs.firstOrNull { config ->
        config.localePrefix == localePrefix
    } ?: throw IllegalArgumentException(
        "Unsupported marketing screenshot locale prefix '$localePrefix'."
    )
}

internal fun configuredMarketingScreenshotLocaleConfigOrNull(): MarketingScreenshotLocaleConfig? {
    val configuredPrefix = configuredMarketingScreenshotLocalePrefixOrNull() ?: return null
    return marketingScreenshotLocaleConfigForPrefix(localePrefix = configuredPrefix)
}

internal fun activeMarketingScreenshotLocaleConfig(): MarketingScreenshotLocaleConfig {
    val configuredLocaleConfig = configuredMarketingScreenshotLocaleConfigOrNull()
    return configuredLocaleConfig ?: defaultMarketingScreenshotLocaleConfig
}

internal fun marketingScreenshotFileName(
    localeConfig: MarketingScreenshotLocaleConfig,
    screenshotIndex: Int,
    screenshotSlug: String
): String {
    return "${localeConfig.localePrefix}-$screenshotIndex" + "_" + screenshotSlug + ".png"
}
