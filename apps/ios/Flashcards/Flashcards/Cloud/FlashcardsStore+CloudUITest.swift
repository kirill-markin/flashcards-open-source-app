import Foundation

private let marketingScreenshotLocalizationEnvironmentKey: String = "FLASHCARDS_MARKETING_SCREENSHOT_LOCALIZATION"

enum FlashcardsUITestResetState: String {
    case localGuest = "local_guest"
    case localGuestSeededManualReviewCard = "local_guest_seeded_manual_review_card"
    case localGuestSeededAIReviewCard = "local_guest_seeded_ai_review_card"
    case marketingOpportunityCostReviewCard = "marketing_opportunity_cost_review_card"
    case marketingConceptCards = "marketing_concept_cards"
}

private struct FlashcardsUITestSeedCard {
    let frontText: String
    let backText: String
    let tags: [String]
}

private struct FlashcardsUITestMarketingLocaleFixture {
    let localizationCode: String
    let reviewCard: FlashcardsUITestSeedCard
    let conceptCards: [FlashcardsUITestSeedCard]
}

private enum FlashcardsUITestSeedData {
    static let manualReviewCard: FlashcardsUITestSeedCard = FlashcardsUITestSeedCard(
        frontText: "Smoke seeded manual review question",
        backText: "Smoke seeded manual review answer",
        tags: []
    )
    static let aiReviewCard: FlashcardsUITestSeedCard = FlashcardsUITestSeedCard(
        frontText: "Smoke seeded AI review question",
        backText: "Smoke seeded AI review answer",
        tags: ["smoke-seeded-ai-review"]
    )
}

private enum FlashcardsUITestMarketingFixtureError: LocalizedError {
    case missingEnvironmentValue(String)
    case unsupportedLocalization(String)

    var errorDescription: String? {
        switch self {
        case .missingEnvironmentValue(let key):
            return "Missing iOS marketing screenshot localization environment value '\(key)'."
        case .unsupportedLocalization(let value):
            let supportedValues = FlashcardsUITestMarketingFixtures.supportedLocalizationCodes.joined(separator: ", ")
            return "Unsupported iOS marketing screenshot localization '\(value)'. Supported values: \(supportedValues)."
        }
    }
}

private enum FlashcardsUITestMarketingFixtures {
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

    static let fixturesByLocalizationCode: [String: FlashcardsUITestMarketingLocaleFixture] = Dictionary(
        uniqueKeysWithValues: Self.fixtures.map { fixture in
            (fixture.localizationCode, fixture)
        }
    )

    static let fixtures: [FlashcardsUITestMarketingLocaleFixture] = [
        FlashcardsUITestMarketingLocaleFixture(
            localizationCode: "en-US",
            reviewCard: FlashcardsUITestSeedCard(
                frontText: "In economics, what is opportunity cost?",
                backText: """
                Opportunity cost is the value of the next best alternative you give up when you choose one option over another.

                Exam example: If you spend Saturday studying for a microeconomics exam instead of working a paid shift, the lost wages are part of the opportunity cost.
                """,
                tags: ["economics"]
            ),
            conceptCards: [
                FlashcardsUITestSeedCard(
                    frontText: "In economics, what is opportunity cost?",
                    backText: "The value of the next best alternative you give up when you choose one option over another.",
                    tags: ["economics"]
                ),
                FlashcardsUITestSeedCard(
                    frontText: "In biology, what is osmosis?",
                    backText: "The movement of water through a membrane from lower solute concentration to higher solute concentration.",
                    tags: ["biology"]
                ),
                FlashcardsUITestSeedCard(
                    frontText: "In statistics, what is standard deviation?",
                    backText: "A measure of how spread out values are around the average.",
                    tags: ["statistics"]
                ),
                FlashcardsUITestSeedCard(
                    frontText: "In chemistry, what is a catalyst?",
                    backText: "A substance that speeds up a chemical reaction without being consumed by it.",
                    tags: ["chemistry"]
                ),
                FlashcardsUITestSeedCard(
                    frontText: "In psychology, what is cognitive bias?",
                    backText: "A systematic pattern of thinking that can distort judgment and decision-making.",
                    tags: ["psychology"]
                ),
                FlashcardsUITestSeedCard(
                    frontText: "In physics, what is velocity?",
                    backText: "The speed of an object together with the direction of its motion.",
                    tags: ["physics"]
                ),
                FlashcardsUITestSeedCard(
                    frontText: "In computer science, what is recursion?",
                    backText: "A method where a function solves a problem by calling itself on smaller versions of that problem.",
                    tags: ["computer science"]
                )
            ]
        ),
        FlashcardsUITestMarketingLocaleFixture(
            localizationCode: "ar",
            reviewCard: FlashcardsUITestSeedCard(
                frontText: "في الاقتصاد، ما هي تكلفة الفرصة البديلة؟",
                backText: """
                تكلفة الفرصة البديلة هي قيمة أفضل بديل تتخلى عنه عندما تختار خيارًا بدلًا من آخر.

                مثال امتحاني: إذا قضيت يوم السبت في الاستعداد لامتحان الاقتصاد الجزئي بدلًا من العمل في وردية مدفوعة الأجر، فإن الأجر الذي خسرته يُعد جزءًا من تكلفة الفرصة البديلة.
                """,
                tags: ["اقتصاد"]
            ),
            conceptCards: [
                FlashcardsUITestSeedCard(
                    frontText: "في الاقتصاد، ما هي تكلفة الفرصة البديلة؟",
                    backText: "هي قيمة أفضل بديل تتخلى عنه عندما تختار خيارًا بدلًا من آخر.",
                    tags: ["اقتصاد"]
                ),
                FlashcardsUITestSeedCard(
                    frontText: "في علم الأحياء، ما هو التناضح؟",
                    backText: "هو انتقال الماء عبر غشاء من تركيز أقل للمذاب إلى تركيز أعلى للمذاب.",
                    tags: ["أحياء"]
                ),
                FlashcardsUITestSeedCard(
                    frontText: "في الإحصاء، ما هو الانحراف المعياري؟",
                    backText: "هو مقياس يوضح مدى تشتت القيم حول المتوسط.",
                    tags: ["إحصاء"]
                ),
                FlashcardsUITestSeedCard(
                    frontText: "في الكيمياء، ما هو العامل الحفاز؟",
                    backText: "هو مادة تسرّع التفاعل الكيميائي من دون أن تُستهلك أثناء التفاعل.",
                    tags: ["كيمياء"]
                ),
                FlashcardsUITestSeedCard(
                    frontText: "في علم النفس، ما هو التحيز المعرفي؟",
                    backText: "هو نمط منهجي في التفكير يمكن أن يشوّه الحكم واتخاذ القرار.",
                    tags: ["علم النفس"]
                ),
                FlashcardsUITestSeedCard(
                    frontText: "في الفيزياء، ما هي السرعة المتجهة؟",
                    backText: "هي مقدار حركة الجسم مع تحديد اتجاه هذه الحركة.",
                    tags: ["فيزياء"]
                ),
                FlashcardsUITestSeedCard(
                    frontText: "في علوم الحاسوب، ما هو الاستدعاء الذاتي؟",
                    backText: "هو أسلوب تحل فيه الدالة المشكلة عبر استدعاء نفسها على نسخ أصغر من المشكلة.",
                    tags: ["علوم الحاسوب"]
                )
            ]
        ),
        FlashcardsUITestMarketingLocaleFixture(
            localizationCode: "zh-Hans",
            reviewCard: FlashcardsUITestSeedCard(
                frontText: "在经济学中，什么是机会成本？",
                backText: """
                机会成本是当你在多个选项中做出选择时，所放弃的最佳替代方案的价值。

                考试示例：如果你把周六用来准备微观经济学考试，而不是去上一班有报酬的班次，那么失去的工资就是机会成本的一部分。
                """,
                tags: ["经济学"]
            ),
            conceptCards: [
                FlashcardsUITestSeedCard(
                    frontText: "在经济学中，什么是机会成本？",
                    backText: "是在做出选择时所放弃的最佳替代方案的价值。",
                    tags: ["经济学"]
                ),
                FlashcardsUITestSeedCard(
                    frontText: "在生物学中，什么是渗透作用？",
                    backText: "是水分通过膜从低溶质浓度一侧向高溶质浓度一侧移动的过程。",
                    tags: ["生物学"]
                ),
                FlashcardsUITestSeedCard(
                    frontText: "在统计学中，什么是标准差？",
                    backText: "是衡量数据围绕平均值分散程度的指标。",
                    tags: ["统计学"]
                ),
                FlashcardsUITestSeedCard(
                    frontText: "在化学中，什么是催化剂？",
                    backText: "是在不被消耗的情况下加快化学反应速度的物质。",
                    tags: ["化学"]
                ),
                FlashcardsUITestSeedCard(
                    frontText: "在心理学中，什么是认知偏差？",
                    backText: "是一种可能扭曲判断与决策的系统性思维模式。",
                    tags: ["心理学"]
                ),
                FlashcardsUITestSeedCard(
                    frontText: "在物理学中，什么是速度？",
                    backText: "是物体运动快慢及其方向的综合量。",
                    tags: ["物理学"]
                ),
                FlashcardsUITestSeedCard(
                    frontText: "在计算机科学中，什么是递归？",
                    backText: "是一种通过让函数调用自身来解决更小规模同类问题的方法。",
                    tags: ["计算机科学"]
                )
            ]
        ),
        FlashcardsUITestMarketingLocaleFixture(
            localizationCode: "de",
            reviewCard: FlashcardsUITestSeedCard(
                frontText: "Was sind in der Volkswirtschaftslehre Opportunitätskosten?",
                backText: """
                Opportunitätskosten sind der Wert der besten Alternative, auf die man verzichtet, wenn man sich für eine andere Option entscheidet.

                Prüfungsbeispiel: Wenn du den Samstag damit verbringst, für eine Mikroökonomie-Klausur zu lernen, statt eine bezahlte Schicht zu arbeiten, gehört der entgangene Lohn zu den Opportunitätskosten.
                """,
                tags: ["Volkswirtschaft"]
            ),
            conceptCards: [
                FlashcardsUITestSeedCard(
                    frontText: "Was sind in der Volkswirtschaftslehre Opportunitätskosten?",
                    backText: "Der Wert der besten Alternative, auf die man bei einer Entscheidung verzichtet.",
                    tags: ["Volkswirtschaft"]
                ),
                FlashcardsUITestSeedCard(
                    frontText: "Was ist in der Biologie Osmose?",
                    backText: "Die Bewegung von Wasser durch eine Membran von niedrigerer zu höherer Konzentration gelöster Stoffe.",
                    tags: ["Biologie"]
                ),
                FlashcardsUITestSeedCard(
                    frontText: "Was bezeichnet in der Statistik die Standardabweichung?",
                    backText: "Ein Maß dafür, wie stark Werte um den Durchschnitt streuen.",
                    tags: ["Statistik"]
                ),
                FlashcardsUITestSeedCard(
                    frontText: "Was ist in der Chemie ein Katalysator?",
                    backText: "Ein Stoff, der eine chemische Reaktion beschleunigt, ohne selbst verbraucht zu werden.",
                    tags: ["Chemie"]
                ),
                FlashcardsUITestSeedCard(
                    frontText: "Was ist in der Psychologie eine kognitive Verzerrung?",
                    backText: "Ein systematisches Denkmuster, das Urteile und Entscheidungen verfälschen kann.",
                    tags: ["Psychologie"]
                ),
                FlashcardsUITestSeedCard(
                    frontText: "Was ist in der Physik Geschwindigkeit?",
                    backText: "Die Schnelligkeit einer Bewegung zusammen mit ihrer Richtung.",
                    tags: ["Physik"]
                ),
                FlashcardsUITestSeedCard(
                    frontText: "Was bedeutet in der Informatik Rekursion?",
                    backText: "Eine Methode, bei der eine Funktion ein Problem löst, indem sie sich mit kleineren Teilproblemen selbst aufruft.",
                    tags: ["Informatik"]
                )
            ]
        ),
        FlashcardsUITestMarketingLocaleFixture(
            localizationCode: "hi",
            reviewCard: FlashcardsUITestSeedCard(
                frontText: "अर्थशास्त्र में अवसर लागत क्या होती है?",
                backText: """
                अवसर लागत उस सबसे अच्छे विकल्प का मूल्य है, जिसे आप किसी दूसरी पसंद को चुनते समय छोड़ देते हैं।

                परीक्षा उदाहरण: अगर आप शनिवार को माइक्रोइकॉनॉमिक्स की परीक्षा की तैयारी में लगाते हैं, बजाय किसी भुगतान वाली शिफ्ट में काम करने के, तो छूटी हुई मजदूरी अवसर लागत का हिस्सा होती है।
                """,
                tags: ["अर्थशास्त्र"]
            ),
            conceptCards: [
                FlashcardsUITestSeedCard(
                    frontText: "अर्थशास्त्र में अवसर लागत क्या होती है?",
                    backText: "किसी विकल्प को चुनते समय छोड़े गए सबसे अच्छे वैकल्पिक विकल्प का मूल्य।",
                    tags: ["अर्थशास्त्र"]
                ),
                FlashcardsUITestSeedCard(
                    frontText: "जीवविज्ञान में परासरण क्या है?",
                    backText: "वह प्रक्रिया जिसमें पानी झिल्ली के आर-पार कम विलेय सांद्रता से अधिक विलेय सांद्रता की ओर बढ़ता है।",
                    tags: ["जीवविज्ञान"]
                ),
                FlashcardsUITestSeedCard(
                    frontText: "सांख्यिकी में मानक विचलन क्या है?",
                    backText: "यह बताने वाला माप कि मान औसत के आसपास कितने फैले हुए हैं।",
                    tags: ["सांख्यिकी"]
                ),
                FlashcardsUITestSeedCard(
                    frontText: "रसायन विज्ञान में उत्प्रेरक क्या होता है?",
                    backText: "ऐसा पदार्थ जो स्वयं खर्च हुए बिना रासायनिक अभिक्रिया की गति बढ़ाता है।",
                    tags: ["रसायन"]
                ),
                FlashcardsUITestSeedCard(
                    frontText: "मनोविज्ञान में संज्ञानात्मक पक्षपात क्या है?",
                    backText: "सोचने का ऐसा व्यवस्थित पैटर्न जो निर्णय और आकलन को विकृत कर सकता है।",
                    tags: ["मनोविज्ञान"]
                ),
                FlashcardsUITestSeedCard(
                    frontText: "भौतिकी में वेग क्या है?",
                    backText: "किसी वस्तु की चाल और उसकी दिशा का संयुक्त माप।",
                    tags: ["भौतिकी"]
                ),
                FlashcardsUITestSeedCard(
                    frontText: "कंप्यूटर विज्ञान में रिकर्शन क्या है?",
                    backText: "ऐसी विधि जिसमें कोई फ़ंक्शन समस्या के छोटे रूपों को हल करने के लिए स्वयं को ही पुकारता है।",
                    tags: ["कंप्यूटर विज्ञान"]
                )
            ]
        ),
        FlashcardsUITestMarketingLocaleFixture(
            localizationCode: "ja",
            reviewCard: FlashcardsUITestSeedCard(
                frontText: "経済学でいう機会費用とは何ですか？",
                backText: """
                機会費用とは、ある選択をしたときに諦める最良の代替案の価値のことです。

                試験の例：土曜日を有給シフトで働く代わりにミクロ経済学の試験勉強に使ったなら、得られなかった賃金は機会費用の一部になります。
                """,
                tags: ["経済学"]
            ),
            conceptCards: [
                FlashcardsUITestSeedCard(
                    frontText: "経済学でいう機会費用とは何ですか？",
                    backText: "ある選択をしたときに諦める最良の代替案の価値です。",
                    tags: ["経済学"]
                ),
                FlashcardsUITestSeedCard(
                    frontText: "生物学でいう浸透とは何ですか？",
                    backText: "溶質濃度の低い側から高い側へ、水が膜を通って移動する現象です。",
                    tags: ["生物学"]
                ),
                FlashcardsUITestSeedCard(
                    frontText: "統計学でいう標準偏差とは何ですか？",
                    backText: "値が平均の周りにどの程度ばらついているかを表す指標です。",
                    tags: ["統計学"]
                ),
                FlashcardsUITestSeedCard(
                    frontText: "化学でいう触媒とは何ですか？",
                    backText: "自らは消費されずに化学反応を速める物質です。",
                    tags: ["化学"]
                ),
                FlashcardsUITestSeedCard(
                    frontText: "心理学でいう認知バイアスとは何ですか？",
                    backText: "判断や意思決定をゆがめるおそれのある、系統的な思考の偏りです。",
                    tags: ["心理学"]
                ),
                FlashcardsUITestSeedCard(
                    frontText: "物理学でいう速度とは何ですか？",
                    backText: "物体の動く速さとその向きをあわせて表す量です。",
                    tags: ["物理学"]
                ),
                FlashcardsUITestSeedCard(
                    frontText: "情報科学でいう再帰とは何ですか？",
                    backText: "関数が自分自身を呼び出しながら、より小さな同種の問題を解く方法です。",
                    tags: ["情報科学"]
                )
            ]
        ),
        FlashcardsUITestMarketingLocaleFixture(
            localizationCode: "ru",
            reviewCard: FlashcardsUITestSeedCard(
                frontText: "Что такое альтернативная стоимость в экономике?",
                backText: """
                Альтернативная стоимость — это ценность лучшего варианта, от которого вы отказываетесь, выбирая другой вариант.

                Пример для экзамена: если вы тратите субботу на подготовку к экзамену по микроэкономике вместо оплачиваемой смены, то недополученный заработок входит в альтернативную стоимость.
                """,
                tags: ["экономика"]
            ),
            conceptCards: [
                FlashcardsUITestSeedCard(
                    frontText: "Что такое альтернативная стоимость в экономике?",
                    backText: "Это ценность лучшего варианта, от которого вы отказываетесь, делая выбор.",
                    tags: ["экономика"]
                ),
                FlashcardsUITestSeedCard(
                    frontText: "Что такое осмос в биологии?",
                    backText: "Это движение воды через мембрану из области с меньшей концентрацией растворённых веществ в область с большей концентрацией.",
                    tags: ["биология"]
                ),
                FlashcardsUITestSeedCard(
                    frontText: "Что такое стандартное отклонение в статистике?",
                    backText: "Это мера того, насколько сильно значения разбросаны вокруг среднего.",
                    tags: ["статистика"]
                ),
                FlashcardsUITestSeedCard(
                    frontText: "Что такое катализатор в химии?",
                    backText: "Это вещество, которое ускоряет химическую реакцию и при этом не расходуется.",
                    tags: ["химия"]
                ),
                FlashcardsUITestSeedCard(
                    frontText: "Что такое когнитивное искажение в психологии?",
                    backText: "Это систематический шаблон мышления, который может искажать суждения и решения.",
                    tags: ["психология"]
                ),
                FlashcardsUITestSeedCard(
                    frontText: "Что такое векторная скорость в физике?",
                    backText: "Это величина, которая описывает быстроту движения объекта и его направление.",
                    tags: ["физика"]
                ),
                FlashcardsUITestSeedCard(
                    frontText: "Что такое рекурсия в информатике?",
                    backText: "Это способ решения задачи, при котором функция вызывает саму себя для более маленьких версий той же задачи.",
                    tags: ["информатика"]
                )
            ]
        ),
        FlashcardsUITestMarketingLocaleFixture(
            localizationCode: "es-MX",
            reviewCard: FlashcardsUITestSeedCard(
                frontText: "En economía, ¿qué es el costo de oportunidad?",
                backText: """
                El costo de oportunidad es el valor de la mejor alternativa a la que renuncias cuando eliges una opción en lugar de otra.

                Ejemplo de examen: si dedicas el sábado a estudiar para un examen de microeconomía en vez de trabajar en un turno pagado, el dinero que dejaste de ganar forma parte del costo de oportunidad.
                """,
                tags: ["economía"]
            ),
            conceptCards: [
                FlashcardsUITestSeedCard(
                    frontText: "En economía, ¿qué es el costo de oportunidad?",
                    backText: "El valor de la mejor alternativa a la que renuncias cuando eliges otra opción.",
                    tags: ["economía"]
                ),
                FlashcardsUITestSeedCard(
                    frontText: "En biología, ¿qué es la ósmosis?",
                    backText: "El movimiento del agua a través de una membrana desde una concentración menor de solutos hacia una mayor.",
                    tags: ["biología"]
                ),
                FlashcardsUITestSeedCard(
                    frontText: "En estadística, ¿qué es la desviación estándar?",
                    backText: "Una medida de qué tan dispersos están los valores alrededor del promedio.",
                    tags: ["estadística"]
                ),
                FlashcardsUITestSeedCard(
                    frontText: "En química, ¿qué es un catalizador?",
                    backText: "Una sustancia que acelera una reacción química sin consumirse en el proceso.",
                    tags: ["química"]
                ),
                FlashcardsUITestSeedCard(
                    frontText: "En psicología, ¿qué es un sesgo cognitivo?",
                    backText: "Un patrón sistemático de pensamiento que puede distorsionar el juicio y la toma de decisiones.",
                    tags: ["psicología"]
                ),
                FlashcardsUITestSeedCard(
                    frontText: "En física, ¿qué es la velocidad?",
                    backText: "La rapidez de un objeto junto con la dirección de su movimiento.",
                    tags: ["física"]
                ),
                FlashcardsUITestSeedCard(
                    frontText: "En ciencias de la computación, ¿qué es la recursión?",
                    backText: "Un método en el que una función resuelve un problema llamándose a sí misma sobre versiones más pequeñas del mismo problema.",
                    tags: ["computación"]
                )
            ]
        ),
        FlashcardsUITestMarketingLocaleFixture(
            localizationCode: "es-ES",
            reviewCard: FlashcardsUITestSeedCard(
                frontText: "En economía, ¿qué es el coste de oportunidad?",
                backText: """
                El coste de oportunidad es el valor de la mejor alternativa a la que renuncias cuando eliges una opción en lugar de otra.

                Ejemplo de examen: si dedicas el sábado a preparar un examen de microeconomía en vez de trabajar en un turno remunerado, el sueldo que dejas de percibir forma parte del coste de oportunidad.
                """,
                tags: ["economía"]
            ),
            conceptCards: [
                FlashcardsUITestSeedCard(
                    frontText: "En economía, ¿qué es el coste de oportunidad?",
                    backText: "El valor de la mejor alternativa a la que renuncias cuando eliges otra opción.",
                    tags: ["economía"]
                ),
                FlashcardsUITestSeedCard(
                    frontText: "En biología, ¿qué es la ósmosis?",
                    backText: "El movimiento del agua a través de una membrana desde una concentración menor de solutos hacia una mayor.",
                    tags: ["biología"]
                ),
                FlashcardsUITestSeedCard(
                    frontText: "En estadística, ¿qué es la desviación típica?",
                    backText: "Una medida de lo dispersos que están los valores alrededor de la media.",
                    tags: ["estadística"]
                ),
                FlashcardsUITestSeedCard(
                    frontText: "En química, ¿qué es un catalizador?",
                    backText: "Una sustancia que acelera una reacción química sin consumirse en el proceso.",
                    tags: ["química"]
                ),
                FlashcardsUITestSeedCard(
                    frontText: "En psicología, ¿qué es un sesgo cognitivo?",
                    backText: "Un patrón sistemático de pensamiento que puede distorsionar el juicio y la toma de decisiones.",
                    tags: ["psicología"]
                ),
                FlashcardsUITestSeedCard(
                    frontText: "En física, ¿qué es la velocidad?",
                    backText: "La rapidez de un objeto junto con la dirección de su movimiento.",
                    tags: ["física"]
                ),
                FlashcardsUITestSeedCard(
                    frontText: "En informática, ¿qué es la recursión?",
                    backText: "Un método en el que una función resuelve un problema llamándose a sí misma sobre versiones más pequeñas del mismo problema.",
                    tags: ["informática"]
                )
            ]
        )
    ]

    static func localeFixture(processInfo: ProcessInfo) throws -> FlashcardsUITestMarketingLocaleFixture {
        guard let rawValue = processInfo.environment[marketingScreenshotLocalizationEnvironmentKey] else {
            throw FlashcardsUITestMarketingFixtureError.missingEnvironmentValue(marketingScreenshotLocalizationEnvironmentKey)
        }

        let trimmedValue = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmedValue.isEmpty == false else {
            throw FlashcardsUITestMarketingFixtureError.missingEnvironmentValue(marketingScreenshotLocalizationEnvironmentKey)
        }

        guard let normalizedLocalizationCode = Self.localizationAliases[trimmedValue] else {
            throw FlashcardsUITestMarketingFixtureError.unsupportedLocalization(trimmedValue)
        }

        guard let localeFixture = Self.fixturesByLocalizationCode[normalizedLocalizationCode] else {
            throw FlashcardsUITestMarketingFixtureError.unsupportedLocalization(trimmedValue)
        }

        return localeFixture
    }
}

@MainActor
extension FlashcardsStore {
    func applyUITestResetState(resetState: FlashcardsUITestResetState) throws {
        try self.resetLocalStateForCloudIdentityChange()

        switch resetState {
        case .localGuest:
            return
        case .localGuestSeededManualReviewCard:
            try self.seedUITestCard(card: FlashcardsUITestSeedData.manualReviewCard)
        case .localGuestSeededAIReviewCard:
            try self.seedUITestCard(card: FlashcardsUITestSeedData.aiReviewCard)
        case .marketingOpportunityCostReviewCard:
            let localeFixture = try FlashcardsUITestMarketingFixtures.localeFixture(processInfo: ProcessInfo.processInfo)
            try self.seedUITestCard(card: localeFixture.reviewCard)
        case .marketingConceptCards:
            let localeFixture = try FlashcardsUITestMarketingFixtures.localeFixture(processInfo: ProcessInfo.processInfo)
            try self.seedUITestCards(cards: localeFixture.conceptCards)
        }
    }

    private func seedUITestCards(cards: [FlashcardsUITestSeedCard]) throws {
        for card in cards {
            try self.seedUITestCard(card: card)
        }
    }

    private func seedUITestCard(card: FlashcardsUITestSeedCard) throws {
        try self.saveCard(
            input: CardEditorInput(
                frontText: card.frontText,
                backText: card.backText,
                tags: card.tags,
                effortLevel: .medium
            ),
            editingCardId: nil
        )
    }
}
