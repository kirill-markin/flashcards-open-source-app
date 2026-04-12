import Foundation
import XCTest

struct MarketingScreenshotCardFixture {
    let frontText: String
    let backText: String
    let subjectTag: String
}

struct MarketingScreenshotLocaleFixture {
    let localizationCode: String
    let appleLanguage: String
    let appleLocale: String
    let reviewCard: MarketingScreenshotCardFixture
    let reviewAiDraftMessage: String
    let conceptCards: [MarketingScreenshotCardFixture]

    var launchArguments: [String] {
        [
            "-AppleLanguages",
            "(\(self.appleLanguage))",
            "-AppleLocale",
            self.appleLocale
        ]
    }

    var tabBarFallbackLocalization: LiveSmokeLaunchLocalization {
        switch self.localizationCode {
        case "ar":
            return .arabic
        default:
            return .english
        }
    }

    var reviewFrontFileName: String {
        self.screenshotFileName(
            screenshotIndex: 1,
            screenshotSlug: MarketingScreenshotFixture.reviewFrontScreenshotSlug
        )
    }

    var reviewResultFileName: String {
        self.screenshotFileName(
            screenshotIndex: 2,
            screenshotSlug: MarketingScreenshotFixture.reviewResultScreenshotSlug
        )
    }

    var cardsFileName: String {
        self.screenshotFileName(
            screenshotIndex: 3,
            screenshotSlug: MarketingScreenshotFixture.cardsScreenshotSlug
        )
    }

    var reviewAiDraftFileName: String {
        self.screenshotFileName(
            screenshotIndex: 4,
            screenshotSlug: MarketingScreenshotFixture.reviewAiDraftScreenshotSlug
        )
    }

    func screenshotFileName(screenshotIndex: Int, screenshotSlug: String) -> String {
        "\(self.localizationCode)-\(screenshotIndex)_\(screenshotSlug).png"
    }
}

private enum MarketingScreenshotLocaleCatalog {
    static let supportedLocalizationCodes: [String] = [
        "en-US",
        "ar",
        "zh-Hans",
        "de",
        "hi",
        "ja",
        "ru",
        "es-MX",
        "es-ES"
    ]

    static let localizationAliases: [String: String] = [
        "en": "en-US",
        "en-US": "en-US",
        "ar": "ar",
        "zh-CN": "zh-Hans",
        "zh-Hans": "zh-Hans",
        "de": "de",
        "de-DE": "de",
        "hi": "hi",
        "hi-IN": "hi",
        "ja": "ja",
        "ja-JP": "ja",
        "ru": "ru",
        "ru-RU": "ru",
        "es-MX": "es-MX",
        "es-419": "es-MX",
        "es-ES": "es-ES"
    ]

    static let fixturesByLocalizationCode: [String: MarketingScreenshotLocaleFixture] = Dictionary(
        uniqueKeysWithValues: Self.fixtures.map { fixture in
            (fixture.localizationCode, fixture)
        }
    )

    static let fixtures: [MarketingScreenshotLocaleFixture] = [
        MarketingScreenshotLocaleFixture(
            localizationCode: "en-US",
            appleLanguage: "en",
            appleLocale: "en_US",
            reviewCard: MarketingScreenshotCardFixture(
                frontText: "In economics, what is opportunity cost?",
                backText: """
                Opportunity cost is the value of the next best alternative you give up when you choose one option over another.

                Exam example: If you spend Saturday studying for a microeconomics exam instead of working a paid shift, the lost wages are part of the opportunity cost.
                """,
                subjectTag: "economics"
            ),
            reviewAiDraftMessage: "Create 6 new flashcards on the same economics topic, covering closely related ideas that we do not already have.",
            conceptCards: [
                MarketingScreenshotCardFixture(
                    frontText: "In economics, what is opportunity cost?",
                    backText: "The value of the next best alternative you give up when you choose one option over another.",
                    subjectTag: "economics"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "In biology, what is osmosis?",
                    backText: "The movement of water through a membrane from lower solute concentration to higher solute concentration.",
                    subjectTag: "biology"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "In statistics, what is standard deviation?",
                    backText: "A measure of how spread out values are around the average.",
                    subjectTag: "statistics"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "In chemistry, what is a catalyst?",
                    backText: "A substance that speeds up a chemical reaction without being consumed by it.",
                    subjectTag: "chemistry"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "In psychology, what is cognitive bias?",
                    backText: "A systematic pattern of thinking that can distort judgment and decision-making.",
                    subjectTag: "psychology"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "In physics, what is velocity?",
                    backText: "The speed of an object together with the direction of its motion.",
                    subjectTag: "physics"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "In computer science, what is recursion?",
                    backText: "A method where a function solves a problem by calling itself on smaller versions of that problem.",
                    subjectTag: "computer science"
                )
            ]
        ),
        MarketingScreenshotLocaleFixture(
            localizationCode: "ar",
            appleLanguage: "ar",
            appleLocale: "ar_SA",
            reviewCard: MarketingScreenshotCardFixture(
                frontText: "في الاقتصاد، ما هي تكلفة الفرصة البديلة؟",
                backText: """
                تكلفة الفرصة البديلة هي قيمة أفضل بديل تتخلى عنه عندما تختار خيارًا بدلًا من آخر.

                مثال امتحاني: إذا قضيت يوم السبت في الاستعداد لامتحان الاقتصاد الجزئي بدلًا من العمل في وردية مدفوعة الأجر، فإن الأجر الذي خسرته يُعد جزءًا من تكلفة الفرصة البديلة.
                """,
                subjectTag: "اقتصاد"
            ),
            reviewAiDraftMessage: "أنشئ 6 بطاقات تعليمية جديدة حول الموضوع الاقتصادي نفسه، تغطي أفكارًا مرتبطة به ارتباطًا وثيقًا ولا نملكها بعد.",
            conceptCards: [
                MarketingScreenshotCardFixture(
                    frontText: "في الاقتصاد، ما هي تكلفة الفرصة البديلة؟",
                    backText: "هي قيمة أفضل بديل تتخلى عنه عندما تختار خيارًا بدلًا من آخر.",
                    subjectTag: "اقتصاد"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "في علم الأحياء، ما هو التناضح؟",
                    backText: "هو انتقال الماء عبر غشاء من تركيز أقل للمذاب إلى تركيز أعلى للمذاب.",
                    subjectTag: "أحياء"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "في الإحصاء، ما هو الانحراف المعياري؟",
                    backText: "هو مقياس يوضح مدى تشتت القيم حول المتوسط.",
                    subjectTag: "إحصاء"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "في الكيمياء، ما هو العامل الحفاز؟",
                    backText: "هو مادة تسرّع التفاعل الكيميائي من دون أن تُستهلك أثناء التفاعل.",
                    subjectTag: "كيمياء"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "في علم النفس، ما هو التحيز المعرفي؟",
                    backText: "هو نمط منهجي في التفكير يمكن أن يشوّه الحكم واتخاذ القرار.",
                    subjectTag: "علم النفس"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "في الفيزياء، ما هي السرعة المتجهة؟",
                    backText: "هي مقدار حركة الجسم مع تحديد اتجاه هذه الحركة.",
                    subjectTag: "فيزياء"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "في علوم الحاسوب، ما هو الاستدعاء الذاتي؟",
                    backText: "هو أسلوب تحل فيه الدالة المشكلة عبر استدعاء نفسها على نسخ أصغر من المشكلة.",
                    subjectTag: "علوم الحاسوب"
                )
            ]
        ),
        MarketingScreenshotLocaleFixture(
            localizationCode: "zh-Hans",
            appleLanguage: "zh-Hans",
            appleLocale: "zh_CN",
            reviewCard: MarketingScreenshotCardFixture(
                frontText: "在经济学中，什么是机会成本？",
                backText: """
                机会成本是当你在多个选项中做出选择时，所放弃的最佳替代方案的价值。

                考试示例：如果你把周六用来准备微观经济学考试，而不是去上一班有报酬的班次，那么失去的工资就是机会成本的一部分。
                """,
                subjectTag: "经济学"
            ),
            reviewAiDraftMessage: "请围绕同一经济学主题再创建 6 张新卡片，覆盖与之密切相关且我们目前还没有的概念。",
            conceptCards: [
                MarketingScreenshotCardFixture(
                    frontText: "在经济学中，什么是机会成本？",
                    backText: "是在做出选择时所放弃的最佳替代方案的价值。",
                    subjectTag: "经济学"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "在生物学中，什么是渗透作用？",
                    backText: "是水分通过膜从低溶质浓度一侧向高溶质浓度一侧移动的过程。",
                    subjectTag: "生物学"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "在统计学中，什么是标准差？",
                    backText: "是衡量数据围绕平均值分散程度的指标。",
                    subjectTag: "统计学"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "在化学中，什么是催化剂？",
                    backText: "是在不被消耗的情况下加快化学反应速度的物质。",
                    subjectTag: "化学"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "在心理学中，什么是认知偏差？",
                    backText: "是一种可能扭曲判断与决策的系统性思维模式。",
                    subjectTag: "心理学"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "在物理学中，什么是速度？",
                    backText: "是物体运动快慢及其方向的综合量。",
                    subjectTag: "物理学"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "在计算机科学中，什么是递归？",
                    backText: "是一种通过让函数调用自身来解决更小规模同类问题的方法。",
                    subjectTag: "计算机科学"
                )
            ]
        ),
        MarketingScreenshotLocaleFixture(
            localizationCode: "de",
            appleLanguage: "de",
            appleLocale: "de_DE",
            reviewCard: MarketingScreenshotCardFixture(
                frontText: "Was sind in der Volkswirtschaftslehre Opportunitätskosten?",
                backText: """
                Opportunitätskosten sind der Wert der besten Alternative, auf die man verzichtet, wenn man sich für eine andere Option entscheidet.

                Prüfungsbeispiel: Wenn du den Samstag damit verbringst, für eine Mikroökonomie-Klausur zu lernen, statt eine bezahlte Schicht zu arbeiten, gehört der entgangene Lohn zu den Opportunitätskosten.
                """,
                subjectTag: "Volkswirtschaft"
            ),
            reviewAiDraftMessage: "Erstelle 6 neue Lernkarten zum selben volkswirtschaftlichen Thema, die eng verwandte Ideen abdecken und die wir noch nicht haben.",
            conceptCards: [
                MarketingScreenshotCardFixture(
                    frontText: "Was sind in der Volkswirtschaftslehre Opportunitätskosten?",
                    backText: "Der Wert der besten Alternative, auf die man bei einer Entscheidung verzichtet.",
                    subjectTag: "Volkswirtschaft"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Was ist in der Biologie Osmose?",
                    backText: "Die Bewegung von Wasser durch eine Membran von niedrigerer zu höherer Konzentration gelöster Stoffe.",
                    subjectTag: "Biologie"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Was bezeichnet in der Statistik die Standardabweichung?",
                    backText: "Ein Maß dafür, wie stark Werte um den Durchschnitt streuen.",
                    subjectTag: "Statistik"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Was ist in der Chemie ein Katalysator?",
                    backText: "Ein Stoff, der eine chemische Reaktion beschleunigt, ohne selbst verbraucht zu werden.",
                    subjectTag: "Chemie"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Was ist in der Psychologie eine kognitive Verzerrung?",
                    backText: "Ein systematisches Denkmuster, das Urteile und Entscheidungen verfälschen kann.",
                    subjectTag: "Psychologie"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Was ist in der Physik Geschwindigkeit?",
                    backText: "Die Schnelligkeit einer Bewegung zusammen mit ihrer Richtung.",
                    subjectTag: "Physik"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Was bedeutet in der Informatik Rekursion?",
                    backText: "Eine Methode, bei der eine Funktion ein Problem löst, indem sie sich mit kleineren Teilproblemen selbst aufruft.",
                    subjectTag: "Informatik"
                )
            ]
        ),
        MarketingScreenshotLocaleFixture(
            localizationCode: "hi",
            appleLanguage: "hi",
            appleLocale: "hi_IN",
            reviewCard: MarketingScreenshotCardFixture(
                frontText: "अर्थशास्त्र में अवसर लागत क्या होती है?",
                backText: """
                अवसर लागत उस सबसे अच्छे विकल्प का मूल्य है, जिसे आप किसी दूसरी पसंद को चुनते समय छोड़ देते हैं।

                परीक्षा उदाहरण: अगर आप शनिवार को माइक्रोइकॉनॉमिक्स की परीक्षा की तैयारी में लगाते हैं, बजाय किसी भुगतान वाली शिफ्ट में काम करने के, तो छूटी हुई मजदूरी अवसर लागत का हिस्सा होती है।
                """,
                subjectTag: "अर्थशास्त्र"
            ),
            reviewAiDraftMessage: "इसी अर्थशास्त्र विषय पर 6 नई फ्लैशकार्ड बनाओ, जो इससे करीबी रूप से जुड़े विचारों को कवर करें और जो हमारे पास पहले से मौजूद न हों।",
            conceptCards: [
                MarketingScreenshotCardFixture(
                    frontText: "अर्थशास्त्र में अवसर लागत क्या होती है?",
                    backText: "किसी विकल्प को चुनते समय छोड़े गए सबसे अच्छे वैकल्पिक विकल्प का मूल्य।",
                    subjectTag: "अर्थशास्त्र"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "जीवविज्ञान में परासरण क्या है?",
                    backText: "वह प्रक्रिया जिसमें पानी झिल्ली के आर-पार कम विलेय सांद्रता से अधिक विलेय सांद्रता की ओर बढ़ता है।",
                    subjectTag: "जीवविज्ञान"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "सांख्यिकी में मानक विचलन क्या है?",
                    backText: "यह बताने वाला माप कि मान औसत के आसपास कितने फैले हुए हैं।",
                    subjectTag: "सांख्यिकी"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "रसायन विज्ञान में उत्प्रेरक क्या होता है?",
                    backText: "ऐसा पदार्थ जो स्वयं खर्च हुए बिना रासायनिक अभिक्रिया की गति बढ़ाता है।",
                    subjectTag: "रसायन"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "मनोविज्ञान में संज्ञानात्मक पक्षपात क्या है?",
                    backText: "सोचने का ऐसा व्यवस्थित पैटर्न जो निर्णय और आकलन को विकृत कर सकता है।",
                    subjectTag: "मनोविज्ञान"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "भौतिकी में वेग क्या है?",
                    backText: "किसी वस्तु की चाल और उसकी दिशा का संयुक्त माप।",
                    subjectTag: "भौतिकी"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "कंप्यूटर विज्ञान में रिकर्शन क्या है?",
                    backText: "ऐसी विधि जिसमें कोई फ़ंक्शन समस्या के छोटे रूपों को हल करने के लिए स्वयं को ही पुकारता है।",
                    subjectTag: "कंप्यूटर विज्ञान"
                )
            ]
        ),
        MarketingScreenshotLocaleFixture(
            localizationCode: "ja",
            appleLanguage: "ja",
            appleLocale: "ja_JP",
            reviewCard: MarketingScreenshotCardFixture(
                frontText: "経済学でいう機会費用とは何ですか？",
                backText: """
                機会費用とは、ある選択をしたときに諦める最良の代替案の価値のことです。

                試験の例：土曜日を有給シフトで働く代わりにミクロ経済学の試験勉強に使ったなら、得られなかった賃金は機会費用の一部になります。
                """,
                subjectTag: "経済学"
            ),
            reviewAiDraftMessage: "同じ経済学のテーマについて、関連性が高く、まだ私たちが持っていない内容の新しいフラッシュカードを 6 枚作ってください。",
            conceptCards: [
                MarketingScreenshotCardFixture(
                    frontText: "経済学でいう機会費用とは何ですか？",
                    backText: "ある選択をしたときに諦める最良の代替案の価値です。",
                    subjectTag: "経済学"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "生物学でいう浸透とは何ですか？",
                    backText: "溶質濃度の低い側から高い側へ、水が膜を通って移動する現象です。",
                    subjectTag: "生物学"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "統計学でいう標準偏差とは何ですか？",
                    backText: "値が平均の周りにどの程度ばらついているかを表す指標です。",
                    subjectTag: "統計学"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "化学でいう触媒とは何ですか？",
                    backText: "自らは消費されずに化学反応を速める物質です。",
                    subjectTag: "化学"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "心理学でいう認知バイアスとは何ですか？",
                    backText: "判断や意思決定をゆがめるおそれのある、系統的な思考の偏りです。",
                    subjectTag: "心理学"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "物理学でいう速度とは何ですか？",
                    backText: "物体の動く速さとその向きをあわせて表す量です。",
                    subjectTag: "物理学"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "情報科学でいう再帰とは何ですか？",
                    backText: "関数が自分自身を呼び出しながら、より小さな同種の問題を解く方法です。",
                    subjectTag: "情報科学"
                )
            ]
        ),
        MarketingScreenshotLocaleFixture(
            localizationCode: "ru",
            appleLanguage: "ru",
            appleLocale: "ru_RU",
            reviewCard: MarketingScreenshotCardFixture(
                frontText: "Что такое альтернативная стоимость в экономике?",
                backText: """
                Альтернативная стоимость — это ценность лучшего варианта, от которого вы отказываетесь, выбирая другой вариант.

                Пример для экзамена: если вы тратите субботу на подготовку к экзамену по микроэкономике вместо оплачиваемой смены, то недополученный заработок входит в альтернативную стоимость.
                """,
                subjectTag: "экономика"
            ),
            reviewAiDraftMessage: "Создай 6 новых карточек по той же теме экономики, которые охватывают тесно связанные идеи и которых у нас ещё нет.",
            conceptCards: [
                MarketingScreenshotCardFixture(
                    frontText: "Что такое альтернативная стоимость в экономике?",
                    backText: "Это ценность лучшего варианта, от которого вы отказываетесь, делая выбор.",
                    subjectTag: "экономика"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Что такое осмос в биологии?",
                    backText: "Это движение воды через мембрану из области с меньшей концентрацией растворённых веществ в область с большей концентрацией.",
                    subjectTag: "биология"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Что такое стандартное отклонение в статистике?",
                    backText: "Это мера того, насколько сильно значения разбросаны вокруг среднего.",
                    subjectTag: "статистика"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Что такое катализатор в химии?",
                    backText: "Это вещество, которое ускоряет химическую реакцию и при этом не расходуется.",
                    subjectTag: "химия"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Что такое когнитивное искажение в психологии?",
                    backText: "Это систематический шаблон мышления, который может искажать суждения и решения.",
                    subjectTag: "психология"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Что такое векторная скорость в физике?",
                    backText: "Это величина, которая описывает быстроту движения объекта и его направление.",
                    subjectTag: "физика"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Что такое рекурсия в информатике?",
                    backText: "Это способ решения задачи, при котором функция вызывает саму себя для более маленьких версий той же задачи.",
                    subjectTag: "информатика"
                )
            ]
        ),
        MarketingScreenshotLocaleFixture(
            localizationCode: "es-MX",
            appleLanguage: "es-MX",
            appleLocale: "es_MX",
            reviewCard: MarketingScreenshotCardFixture(
                frontText: "En economía, ¿qué es el costo de oportunidad?",
                backText: """
                El costo de oportunidad es el valor de la mejor alternativa a la que renuncias cuando eliges una opción en lugar de otra.

                Ejemplo de examen: si dedicas el sábado a estudiar para un examen de microeconomía en vez de trabajar en un turno pagado, el dinero que dejaste de ganar forma parte del costo de oportunidad.
                """,
                subjectTag: "economía"
            ),
            reviewAiDraftMessage: "Crea 6 tarjetas nuevas sobre el mismo tema de economía, que cubran ideas estrechamente relacionadas y que todavía no tengamos.",
            conceptCards: [
                MarketingScreenshotCardFixture(
                    frontText: "En economía, ¿qué es el costo de oportunidad?",
                    backText: "El valor de la mejor alternativa a la que renuncias cuando eliges otra opción.",
                    subjectTag: "economía"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "En biología, ¿qué es la ósmosis?",
                    backText: "El movimiento del agua a través de una membrana desde una concentración menor de solutos hacia una mayor.",
                    subjectTag: "biología"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "En estadística, ¿qué es la desviación estándar?",
                    backText: "Una medida de qué tan dispersos están los valores alrededor del promedio.",
                    subjectTag: "estadística"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "En química, ¿qué es un catalizador?",
                    backText: "Una sustancia que acelera una reacción química sin consumirse en el proceso.",
                    subjectTag: "química"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "En psicología, ¿qué es un sesgo cognitivo?",
                    backText: "Un patrón sistemático de pensamiento que puede distorsionar el juicio y la toma de decisiones.",
                    subjectTag: "psicología"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "En física, ¿qué es la velocidad?",
                    backText: "La rapidez de un objeto junto con la dirección de su movimiento.",
                    subjectTag: "física"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "En ciencias de la computación, ¿qué es la recursión?",
                    backText: "Un método en el que una función resuelve un problema llamándose a sí misma sobre versiones más pequeñas del mismo problema.",
                    subjectTag: "computación"
                )
            ]
        ),
        MarketingScreenshotLocaleFixture(
            localizationCode: "es-ES",
            appleLanguage: "es-ES",
            appleLocale: "es_ES",
            reviewCard: MarketingScreenshotCardFixture(
                frontText: "En economía, ¿qué es el coste de oportunidad?",
                backText: """
                El coste de oportunidad es el valor de la mejor alternativa a la que renuncias cuando eliges una opción en lugar de otra.

                Ejemplo de examen: si dedicas el sábado a preparar un examen de microeconomía en vez de trabajar en un turno remunerado, el sueldo que dejas de percibir forma parte del coste de oportunidad.
                """,
                subjectTag: "economía"
            ),
            reviewAiDraftMessage: "Crea 6 tarjetas nuevas sobre el mismo tema de economía, que cubran ideas estrechamente relacionadas y que todavía no tengamos.",
            conceptCards: [
                MarketingScreenshotCardFixture(
                    frontText: "En economía, ¿qué es el coste de oportunidad?",
                    backText: "El valor de la mejor alternativa a la que renuncias cuando eliges otra opción.",
                    subjectTag: "economía"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "En biología, ¿qué es la ósmosis?",
                    backText: "El movimiento del agua a través de una membrana desde una concentración menor de solutos hacia una mayor.",
                    subjectTag: "biología"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "En estadística, ¿qué es la desviación típica?",
                    backText: "Una medida de lo dispersos que están los valores alrededor de la media.",
                    subjectTag: "estadística"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "En química, ¿qué es un catalizador?",
                    backText: "Una sustancia que acelera una reacción química sin consumirse en el proceso.",
                    subjectTag: "química"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "En psicología, ¿qué es un sesgo cognitivo?",
                    backText: "Un patrón sistemático de pensamiento que puede distorsionar el juicio y la toma de decisiones.",
                    subjectTag: "psicología"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "En física, ¿qué es la velocidad?",
                    backText: "La rapidez de un objeto junto con la dirección de su movimiento.",
                    subjectTag: "física"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "En informática, ¿qué es la recursión?",
                    backText: "Un método en el que una función resuelve un problema llamándose a sí misma sobre versiones más pequeñas del mismo problema.",
                    subjectTag: "informática"
                )
            ]
        )
    ]
}

enum MarketingScreenshotFixture {
    static let defaultLocalizationCode: String = "en-US"
    static let reviewFrontScreenshotSlug: String = "review-card-front-app-store-opportunity-cost"
    static let reviewResultScreenshotSlug: String = "review-card-result-app-store-opportunity-cost"
    static let cardsScreenshotSlug: String = "cards-list-app-store-vocabulary"
    static let reviewAiDraftScreenshotSlug: String = "review-card-ai-draft-app-store-opportunity-cost"
    static let supportedLocalizationCodes: [String] = MarketingScreenshotLocaleCatalog.supportedLocalizationCodes

    static func localeFixture(localizationCode: String) -> MarketingScreenshotLocaleFixture? {
        guard let normalizedCode = MarketingScreenshotLocaleCatalog.localizationAliases[localizationCode] else {
            return nil
        }

        return MarketingScreenshotLocaleCatalog.fixturesByLocalizationCode[normalizedCode]
    }
}

extension MarketingManualScreenshotTestCase {
    @MainActor
    func prepareAiDraftWithCurrentAttachment(draftText: String) throws {
        try self.assertScreenVisible(screen: .ai, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
        try self.assertAiEntrySurfaceVisible()

        let consentButton = self.app.buttons[LiveSmokeIdentifier.aiConsentAcceptButton]
        if self.waitForOptionalElement(
            consentButton,
            identifier: LiveSmokeIdentifier.aiConsentAcceptButton,
            timeout: LiveSmokeConfiguration.optionalProbeTimeoutSeconds
        ) {
            try self.tapButton(
                identifier: LiveSmokeIdentifier.aiConsentAcceptButton,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
            try self.waitForAiComposerAfterConsent()
        }

        try self.assertElementExists(
            identifier: LiveSmokeIdentifier.aiComposerTextField,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )
        try self.assertElementExists(
            identifier: LiveSmokeIdentifier.aiComposerCardAttachmentChip,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )
        try self.replaceAiComposerText(
            draftText,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )
        try self.dismissAiComposerKeyboardIfVisible(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
    }

    @MainActor
    func dismissAiComposerKeyboardIfVisible(timeout: TimeInterval) throws {
        guard self.softwareKeyboardIsVisible() else {
            return
        }

        let dismissalSurface = self.app.descendants(matching: .any)
            .matching(identifier: LiveSmokeIdentifier.aiScreen)
            .firstMatch
        let emptyStateLabel = self.app.staticTexts
            .matching(identifier: LiveSmokeIdentifier.aiEmptyState)
            .element(boundBy: 0)
        let navigationBar = self.app.navigationBars.firstMatch
        let composerTextField = self.app.descendants(matching: .any)
            .matching(identifier: LiveSmokeIdentifier.aiComposerTextField)
            .firstMatch
        let deadline = Date().addingTimeInterval(timeout)

        while Date() < deadline {
            if dismissalSurface.exists && dismissalSurface.isHittable {
                dismissalSurface.coordinate(
                    withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2)
                ).tap()
            } else if emptyStateLabel.exists && emptyStateLabel.isHittable {
                emptyStateLabel.tap()
            } else if navigationBar.exists && navigationBar.isHittable {
                navigationBar.tap()
            } else {
                let coordinate = self.app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2))
                coordinate.tap()
            }

            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.2))
            if self.softwareKeyboardIsVisible() == false {
                return
            }
        }

        if dismissalSurface.exists && dismissalSurface.isHittable {
            dismissalSurface.swipeDown()
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.2))
            if self.softwareKeyboardIsVisible() == false {
                return
            }
        }

        if navigationBar.exists && navigationBar.isHittable {
            navigationBar.tap()
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.2))
            if self.softwareKeyboardIsVisible() == false {
                return
            }
        }

        let returnButtons = self.app.keyboards.buttons.matching(identifier: "Return")
        for index in 0..<returnButtons.count {
            let returnButton = returnButtons.element(boundBy: index)
            if returnButton.exists && returnButton.isHittable {
                returnButton.tap()
                RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.2))
                if self.softwareKeyboardIsVisible() == false {
                    return
                }
            }
        }

        if composerTextField.exists && self.elementHasKeyboardFocus(element: composerTextField) {
            composerTextField.typeText(XCUIKeyboardKey.return.rawValue)
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.2))
            if self.softwareKeyboardIsVisible() == false {
                return
            }
        }

        throw LiveSmokeFailure.unexpectedAiConversationState(
            message: "AI composer keyboard remained visible after dismissal attempts.",
            screen: self.currentScreenSummary(),
            step: self.currentStepTitle
        )
    }
}
