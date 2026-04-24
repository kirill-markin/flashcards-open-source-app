import Foundation

private let marketingScreenshotLocalizationEnvironmentKey: String = "FLASHCARDS_MARKETING_SCREENSHOT_LOCALIZATION"

enum FlashcardsUITestLaunchScenario: String {
    case guestEmptyWorkspace = "guest_empty_workspace"
    case guestManualReviewCard = "guest_manual_review_card"
    case guestAIReviewCard = "guest_ai_review_card"
    case marketingScreenshots = "marketing_screenshots"
    case marketingGuestSessionCleanup = "marketing_guest_session_cleanup"

    var requiresGuestCloudBootstrap: Bool {
        switch self {
        case .guestEmptyWorkspace, .guestManualReviewCard, .guestAIReviewCard:
            return false
        case .marketingScreenshots:
            return true
        case .marketingGuestSessionCleanup:
            return false
        }
    }

    var requiresStoredGuestRemoteCleanup: Bool {
        switch self {
        case .marketingScreenshots, .marketingGuestSessionCleanup:
            return true
        case .guestEmptyWorkspace, .guestManualReviewCard, .guestAIReviewCard:
            return false
        }
    }
}

enum FlashcardsUITestLaunchPreparationStatus: Equatable {
    case hidden
    case running(launchScenario: FlashcardsUITestLaunchScenario)
    case ready(launchScenario: FlashcardsUITestLaunchScenario)
    case failed(launchScenario: FlashcardsUITestLaunchScenario, message: String)

    var accessibilityValue: String? {
        switch self {
        case .hidden:
            return nil
        case .running(let launchScenario):
            return "state=running;launchScenario=\(launchScenario.rawValue)"
        case .ready(let launchScenario):
            return "state=ready;launchScenario=\(launchScenario.rawValue)"
        case .failed(let launchScenario, let message):
            let sanitizedMessage = message
                .replacingOccurrences(of: "\n", with: " ")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            return "state=failed;launchScenario=\(launchScenario.rawValue);message=\(sanitizedMessage)"
        }
    }
}

private struct FlashcardsUITestFixtureCard {
    let frontText: String
    let backText: String
    let tags: [String]
}

private struct FlashcardsUITestMarketingLocaleFixture {
    let localizationCode: String
    let reviewCard: FlashcardsUITestFixtureCard
    let conceptCards: [FlashcardsUITestFixtureCard]
}

private struct FlashcardsUITestMarketingReviewHistorySeed {
    let supportCardIndex: Int
    let reviewedAtDayOffset: Int
    let rating: ReviewRating
}

private enum FlashcardsUITestLaunchScenarioData {
    static let manualReviewCard: FlashcardsUITestFixtureCard = FlashcardsUITestFixtureCard(
        frontText: "Smoke guest manual review question",
        backText: "Smoke guest manual review answer",
        tags: []
    )
    static let aiReviewCard: FlashcardsUITestFixtureCard = FlashcardsUITestFixtureCard(
        frontText: "Smoke guest AI review question",
        backText: "Smoke guest AI review answer",
        tags: ["smoke-guest-ai-review"]
    )
}

private enum FlashcardsUITestMarketingReviewHistorySeedError: LocalizedError {
    case reviewedAtDateCreationFailed(dayOffset: Int)

    var errorDescription: String? {
        switch self {
        case .reviewedAtDateCreationFailed(let dayOffset):
            return "Failed to create marketing screenshot review timestamp for day offset \(dayOffset)."
        }
    }
}

private enum FlashcardsUITestLaunchScenarioError: LocalizedError {
    case createdCardCountMismatch(expected: Int, actual: Int)
    case missingMarketingCardsFixture(localizationCode: String)
    case insufficientMarketingReviewHistoryCards(localizationCode: String, required: Int, actual: Int)
    case marketingReviewCardPromptMismatch(localizationCode: String, reviewPrompt: String, cardsPrompt: String)

    var errorDescription: String? {
        switch self {
        case .createdCardCountMismatch(let expected, let actual):
            return "Expected \(expected) UI test cards but created \(actual)."
        case .missingMarketingCardsFixture(let localizationCode):
            return "Marketing screenshots require at least one cards fixture for localization '\(localizationCode)'."
        case .insufficientMarketingReviewHistoryCards(let localizationCode, let required, let actual):
            return "Marketing screenshots require at least \(required) support cards for localization '\(localizationCode)', but found \(actual)."
        case .marketingReviewCardPromptMismatch(let localizationCode, let reviewPrompt, let cardsPrompt):
            return "Marketing screenshots require the review prompt and first cards-list prompt to match for localization '\(localizationCode)'. reviewPrompt='\(reviewPrompt)' cardsPrompt='\(cardsPrompt)'."
        }
    }
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
            reviewCard: FlashcardsUITestFixtureCard(
                frontText: "In economics, what is opportunity cost?",
                backText: """
                Opportunity cost is the value of the next best alternative you give up when you choose one option over another.

                Exam example: If you spend Saturday studying for a microeconomics exam instead of working a paid shift, the lost wages are part of the opportunity cost.
                """,
                tags: ["economics"]
            ),
            conceptCards: [
                FlashcardsUITestFixtureCard(
                    frontText: "In economics, what is opportunity cost?",
                    backText: "The value of the next best alternative you give up when you choose one option over another.",
                    tags: ["economics"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "In biology, what is osmosis?",
                    backText: "The movement of water through a membrane from lower solute concentration to higher solute concentration.",
                    tags: ["biology"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "In statistics, what is standard deviation?",
                    backText: "A measure of how spread out values are around the average.",
                    tags: ["statistics"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "In chemistry, what is a catalyst?",
                    backText: "A substance that speeds up a chemical reaction without being consumed by it.",
                    tags: ["chemistry"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "In psychology, what is cognitive bias?",
                    backText: "A systematic pattern of thinking that can distort judgment and decision-making.",
                    tags: ["psychology"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "In physics, what is velocity?",
                    backText: "The speed of an object together with the direction of its motion.",
                    tags: ["physics"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "In computer science, what is recursion?",
                    backText: "A method where a function solves a problem by calling itself on smaller versions of that problem.",
                    tags: ["computer science"]
                )
            ]
        ),
        FlashcardsUITestMarketingLocaleFixture(
            localizationCode: "ar",
            reviewCard: FlashcardsUITestFixtureCard(
                frontText: "في الاقتصاد، ما هي تكلفة الفرصة البديلة؟",
                backText: """
                تكلفة الفرصة البديلة هي قيمة أفضل بديل تتخلى عنه عندما تختار خيارًا بدلًا من آخر.

                مثال امتحاني: إذا قضيت يوم السبت في الاستعداد لامتحان الاقتصاد الجزئي بدلًا من العمل في وردية مدفوعة الأجر، فإن الأجر الذي خسرته يُعد جزءًا من تكلفة الفرصة البديلة.
                """,
                tags: ["اقتصاد"]
            ),
            conceptCards: [
                FlashcardsUITestFixtureCard(
                    frontText: "في الاقتصاد، ما هي تكلفة الفرصة البديلة؟",
                    backText: "هي قيمة أفضل بديل تتخلى عنه عندما تختار خيارًا بدلًا من آخر.",
                    tags: ["اقتصاد"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "في علم الأحياء، ما هو التناضح؟",
                    backText: "هو انتقال الماء عبر غشاء من تركيز أقل للمذاب إلى تركيز أعلى للمذاب.",
                    tags: ["أحياء"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "في الإحصاء، ما هو الانحراف المعياري؟",
                    backText: "هو مقياس يوضح مدى تشتت القيم حول المتوسط.",
                    tags: ["إحصاء"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "في الكيمياء، ما هو العامل الحفاز؟",
                    backText: "هو مادة تسرّع التفاعل الكيميائي من دون أن تُستهلك أثناء التفاعل.",
                    tags: ["كيمياء"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "في علم النفس، ما هو التحيز المعرفي؟",
                    backText: "هو نمط منهجي في التفكير يمكن أن يشوّه الحكم واتخاذ القرار.",
                    tags: ["علم النفس"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "في الفيزياء، ما هي السرعة المتجهة؟",
                    backText: "هي مقدار حركة الجسم مع تحديد اتجاه هذه الحركة.",
                    tags: ["فيزياء"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "في علوم الحاسوب، ما هو الاستدعاء الذاتي؟",
                    backText: "هو أسلوب تحل فيه الدالة المشكلة عبر استدعاء نفسها على نسخ أصغر من المشكلة.",
                    tags: ["علوم الحاسوب"]
                )
            ]
        ),
        FlashcardsUITestMarketingLocaleFixture(
            localizationCode: "zh-Hans",
            reviewCard: FlashcardsUITestFixtureCard(
                frontText: "在经济学中，什么是机会成本？",
                backText: """
                机会成本是当你在多个选项中做出选择时，所放弃的最佳替代方案的价值。

                考试示例：如果你把周六用来准备微观经济学考试，而不是去上一班有报酬的班次，那么失去的工资就是机会成本的一部分。
                """,
                tags: ["经济学"]
            ),
            conceptCards: [
                FlashcardsUITestFixtureCard(
                    frontText: "在经济学中，什么是机会成本？",
                    backText: "是在做出选择时所放弃的最佳替代方案的价值。",
                    tags: ["经济学"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "在生物学中，什么是渗透作用？",
                    backText: "是水分通过膜从低溶质浓度一侧向高溶质浓度一侧移动的过程。",
                    tags: ["生物学"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "在统计学中，什么是标准差？",
                    backText: "是衡量数据围绕平均值分散程度的指标。",
                    tags: ["统计学"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "在化学中，什么是催化剂？",
                    backText: "是在不被消耗的情况下加快化学反应速度的物质。",
                    tags: ["化学"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "在心理学中，什么是认知偏差？",
                    backText: "是一种可能扭曲判断与决策的系统性思维模式。",
                    tags: ["心理学"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "在物理学中，什么是速度？",
                    backText: "是物体运动快慢及其方向的综合量。",
                    tags: ["物理学"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "在计算机科学中，什么是递归？",
                    backText: "是一种通过让函数调用自身来解决更小规模同类问题的方法。",
                    tags: ["计算机科学"]
                )
            ]
        ),
        FlashcardsUITestMarketingLocaleFixture(
            localizationCode: "de",
            reviewCard: FlashcardsUITestFixtureCard(
                frontText: "Was sind in der Volkswirtschaftslehre Opportunitätskosten?",
                backText: """
                Opportunitätskosten sind der Wert der besten Alternative, auf die man verzichtet, wenn man sich für eine andere Option entscheidet.

                Prüfungsbeispiel: Wenn du den Samstag damit verbringst, für eine Mikroökonomie-Klausur zu lernen, statt eine bezahlte Schicht zu arbeiten, gehört der entgangene Lohn zu den Opportunitätskosten.
                """,
                tags: ["Volkswirtschaft"]
            ),
            conceptCards: [
                FlashcardsUITestFixtureCard(
                    frontText: "Was sind in der Volkswirtschaftslehre Opportunitätskosten?",
                    backText: "Der Wert der besten Alternative, auf die man bei einer Entscheidung verzichtet.",
                    tags: ["Volkswirtschaft"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Was ist in der Biologie Osmose?",
                    backText: "Die Bewegung von Wasser durch eine Membran von niedrigerer zu höherer Konzentration gelöster Stoffe.",
                    tags: ["Biologie"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Was bezeichnet in der Statistik die Standardabweichung?",
                    backText: "Ein Maß dafür, wie stark Werte um den Durchschnitt streuen.",
                    tags: ["Statistik"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Was ist in der Chemie ein Katalysator?",
                    backText: "Ein Stoff, der eine chemische Reaktion beschleunigt, ohne selbst verbraucht zu werden.",
                    tags: ["Chemie"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Was ist in der Psychologie eine kognitive Verzerrung?",
                    backText: "Ein systematisches Denkmuster, das Urteile und Entscheidungen verfälschen kann.",
                    tags: ["Psychologie"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Was ist in der Physik Geschwindigkeit?",
                    backText: "Die Schnelligkeit einer Bewegung zusammen mit ihrer Richtung.",
                    tags: ["Physik"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Was bedeutet in der Informatik Rekursion?",
                    backText: "Eine Methode, bei der eine Funktion ein Problem löst, indem sie sich mit kleineren Teilproblemen selbst aufruft.",
                    tags: ["Informatik"]
                )
            ]
        ),
        FlashcardsUITestMarketingLocaleFixture(
            localizationCode: "hi",
            reviewCard: FlashcardsUITestFixtureCard(
                frontText: "अर्थशास्त्र में अवसर लागत क्या होती है?",
                backText: """
                अवसर लागत उस सबसे अच्छे विकल्प का मूल्य है, जिसे आप किसी दूसरी पसंद को चुनते समय छोड़ देते हैं।

                परीक्षा उदाहरण: अगर आप शनिवार को माइक्रोइकॉनॉमिक्स की परीक्षा की तैयारी में लगाते हैं, बजाय किसी भुगतान वाली शिफ्ट में काम करने के, तो छूटी हुई मजदूरी अवसर लागत का हिस्सा होती है।
                """,
                tags: ["अर्थशास्त्र"]
            ),
            conceptCards: [
                FlashcardsUITestFixtureCard(
                    frontText: "अर्थशास्त्र में अवसर लागत क्या होती है?",
                    backText: "किसी विकल्प को चुनते समय छोड़े गए सबसे अच्छे वैकल्पिक विकल्प का मूल्य।",
                    tags: ["अर्थशास्त्र"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "जीवविज्ञान में परासरण क्या है?",
                    backText: "वह प्रक्रिया जिसमें पानी झिल्ली के आर-पार कम विलेय सांद्रता से अधिक विलेय सांद्रता की ओर बढ़ता है।",
                    tags: ["जीवविज्ञान"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "सांख्यिकी में मानक विचलन क्या है?",
                    backText: "यह बताने वाला माप कि मान औसत के आसपास कितने फैले हुए हैं।",
                    tags: ["सांख्यिकी"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "रसायन विज्ञान में उत्प्रेरक क्या होता है?",
                    backText: "ऐसा पदार्थ जो स्वयं खर्च हुए बिना रासायनिक अभिक्रिया की गति बढ़ाता है।",
                    tags: ["रसायन"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "मनोविज्ञान में संज्ञानात्मक पक्षपात क्या है?",
                    backText: "सोचने का ऐसा व्यवस्थित पैटर्न जो निर्णय और आकलन को विकृत कर सकता है।",
                    tags: ["मनोविज्ञान"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "भौतिकी में वेग क्या है?",
                    backText: "किसी वस्तु की चाल और उसकी दिशा का संयुक्त माप।",
                    tags: ["भौतिकी"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "कंप्यूटर विज्ञान में रिकर्शन क्या है?",
                    backText: "ऐसी विधि जिसमें कोई फ़ंक्शन समस्या के छोटे रूपों को हल करने के लिए स्वयं को ही पुकारता है।",
                    tags: ["कंप्यूटर विज्ञान"]
                )
            ]
        ),
        FlashcardsUITestMarketingLocaleFixture(
            localizationCode: "ja",
            reviewCard: FlashcardsUITestFixtureCard(
                frontText: "経済学でいう機会費用とは何ですか？",
                backText: """
                機会費用とは、ある選択をしたときに諦める最良の代替案の価値のことです。

                試験の例：土曜日を有給シフトで働く代わりにミクロ経済学の試験勉強に使ったなら、得られなかった賃金は機会費用の一部になります。
                """,
                tags: ["経済学"]
            ),
            conceptCards: [
                FlashcardsUITestFixtureCard(
                    frontText: "経済学でいう機会費用とは何ですか？",
                    backText: "ある選択をしたときに諦める最良の代替案の価値です。",
                    tags: ["経済学"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "生物学でいう浸透とは何ですか？",
                    backText: "溶質濃度の低い側から高い側へ、水が膜を通って移動する現象です。",
                    tags: ["生物学"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "統計学でいう標準偏差とは何ですか？",
                    backText: "値が平均の周りにどの程度ばらついているかを表す指標です。",
                    tags: ["統計学"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "化学でいう触媒とは何ですか？",
                    backText: "自らは消費されずに化学反応を速める物質です。",
                    tags: ["化学"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "心理学でいう認知バイアスとは何ですか？",
                    backText: "判断や意思決定をゆがめるおそれのある、系統的な思考の偏りです。",
                    tags: ["心理学"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "物理学でいう速度とは何ですか？",
                    backText: "物体の動く速さとその向きをあわせて表す量です。",
                    tags: ["物理学"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "情報科学でいう再帰とは何ですか？",
                    backText: "関数が自分自身を呼び出しながら、より小さな同種の問題を解く方法です。",
                    tags: ["情報科学"]
                )
            ]
        ),
        FlashcardsUITestMarketingLocaleFixture(
            localizationCode: "ru",
            reviewCard: FlashcardsUITestFixtureCard(
                frontText: "Что такое альтернативная стоимость в экономике?",
                backText: """
                Альтернативная стоимость — это ценность лучшего варианта, от которого вы отказываетесь, выбирая другой вариант.

                Пример для экзамена: если вы тратите субботу на подготовку к экзамену по микроэкономике вместо оплачиваемой смены, то недополученный заработок входит в альтернативную стоимость.
                """,
                tags: ["экономика"]
            ),
            conceptCards: [
                FlashcardsUITestFixtureCard(
                    frontText: "Что такое альтернативная стоимость в экономике?",
                    backText: "Это ценность лучшего варианта, от которого вы отказываетесь, делая выбор.",
                    tags: ["экономика"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Что такое осмос в биологии?",
                    backText: "Это движение воды через мембрану из области с меньшей концентрацией растворённых веществ в область с большей концентрацией.",
                    tags: ["биология"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Что такое стандартное отклонение в статистике?",
                    backText: "Это мера того, насколько сильно значения разбросаны вокруг среднего.",
                    tags: ["статистика"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Что такое катализатор в химии?",
                    backText: "Это вещество, которое ускоряет химическую реакцию и при этом не расходуется.",
                    tags: ["химия"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Что такое когнитивное искажение в психологии?",
                    backText: "Это систематический шаблон мышления, который может искажать суждения и решения.",
                    tags: ["психология"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Что такое векторная скорость в физике?",
                    backText: "Это величина, которая описывает быстроту движения объекта и его направление.",
                    tags: ["физика"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Что такое рекурсия в информатике?",
                    backText: "Это способ решения задачи, при котором функция вызывает саму себя для более маленьких версий той же задачи.",
                    tags: ["информатика"]
                )
            ]
        ),
        FlashcardsUITestMarketingLocaleFixture(
            localizationCode: "es-MX",
            reviewCard: FlashcardsUITestFixtureCard(
                frontText: "En economía, ¿qué es el costo de oportunidad?",
                backText: """
                El costo de oportunidad es el valor de la mejor alternativa a la que renuncias cuando eliges una opción en lugar de otra.

                Ejemplo de examen: si dedicas el sábado a estudiar para un examen de microeconomía en vez de trabajar en un turno pagado, el dinero que dejaste de ganar forma parte del costo de oportunidad.
                """,
                tags: ["economía"]
            ),
            conceptCards: [
                FlashcardsUITestFixtureCard(
                    frontText: "En economía, ¿qué es el costo de oportunidad?",
                    backText: "El valor de la mejor alternativa a la que renuncias cuando eliges otra opción.",
                    tags: ["economía"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "En biología, ¿qué es la ósmosis?",
                    backText: "El movimiento del agua a través de una membrana desde una concentración menor de solutos hacia una mayor.",
                    tags: ["biología"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "En estadística, ¿qué es la desviación estándar?",
                    backText: "Una medida de qué tan dispersos están los valores alrededor del promedio.",
                    tags: ["estadística"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "En química, ¿qué es un catalizador?",
                    backText: "Una sustancia que acelera una reacción química sin consumirse en el proceso.",
                    tags: ["química"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "En psicología, ¿qué es un sesgo cognitivo?",
                    backText: "Un patrón sistemático de pensamiento que puede distorsionar el juicio y la toma de decisiones.",
                    tags: ["psicología"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "En física, ¿qué es la velocidad?",
                    backText: "La rapidez de un objeto junto con la dirección de su movimiento.",
                    tags: ["física"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "En ciencias de la computación, ¿qué es la recursión?",
                    backText: "Un método en el que una función resuelve un problema llamándose a sí misma sobre versiones más pequeñas del mismo problema.",
                    tags: ["computación"]
                )
            ]
        ),
        FlashcardsUITestMarketingLocaleFixture(
            localizationCode: "es-ES",
            reviewCard: FlashcardsUITestFixtureCard(
                frontText: "En economía, ¿qué es el coste de oportunidad?",
                backText: """
                El coste de oportunidad es el valor de la mejor alternativa a la que renuncias cuando eliges una opción en lugar de otra.

                Ejemplo de examen: si dedicas el sábado a preparar un examen de microeconomía en vez de trabajar en un turno remunerado, el sueldo que dejas de percibir forma parte del coste de oportunidad.
                """,
                tags: ["economía"]
            ),
            conceptCards: [
                FlashcardsUITestFixtureCard(
                    frontText: "En economía, ¿qué es el coste de oportunidad?",
                    backText: "El valor de la mejor alternativa a la que renuncias cuando eliges otra opción.",
                    tags: ["economía"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "En biología, ¿qué es la ósmosis?",
                    backText: "El movimiento del agua a través de una membrana desde una concentración menor de solutos hacia una mayor.",
                    tags: ["biología"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "En estadística, ¿qué es la desviación típica?",
                    backText: "Una medida de lo dispersos que están los valores alrededor de la media.",
                    tags: ["estadística"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "En química, ¿qué es un catalizador?",
                    backText: "Una sustancia que acelera una reacción química sin consumirse en el proceso.",
                    tags: ["química"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "En psicología, ¿qué es un sesgo cognitivo?",
                    backText: "Un patrón sistemático de pensamiento que puede distorsionar el juicio y la toma de decisiones.",
                    tags: ["psicología"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "En física, ¿qué es la velocidad?",
                    backText: "La rapidez de un objeto junto con la dirección de su movimiento.",
                    tags: ["física"]
                ),
                FlashcardsUITestFixtureCard(
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
    func applyUITestLaunchScenarioContent(
        launchScenario: FlashcardsUITestLaunchScenario,
        processInfo: ProcessInfo
    ) throws {
        let context = try requireLocalMutationContext(database: self.database, workspace: self.workspace)
        switch launchScenario {
        case .guestEmptyWorkspace:
            return
        case .guestManualReviewCard:
            try self.createUITestCard(card: FlashcardsUITestLaunchScenarioData.manualReviewCard, context: context)
        case .guestAIReviewCard:
            try self.createUITestCard(card: FlashcardsUITestLaunchScenarioData.aiReviewCard, context: context)
        case .marketingScreenshots:
            let localeFixture = try FlashcardsUITestMarketingFixtures.localeFixture(processInfo: processInfo)
            try self.createUITestMarketingScreenshotsData(localeFixture: localeFixture, context: context)
        case .marketingGuestSessionCleanup:
            return
        }
    }

    private func createUITestMarketingScreenshotsData(
        localeFixture: FlashcardsUITestMarketingLocaleFixture,
        context: LocalMutationContext
    ) throws {
        guard let firstConceptCard = localeFixture.conceptCards.first else {
            throw FlashcardsUITestLaunchScenarioError.missingMarketingCardsFixture(
                localizationCode: localeFixture.localizationCode
            )
        }

        guard firstConceptCard.frontText == localeFixture.reviewCard.frontText else {
            throw FlashcardsUITestLaunchScenarioError.marketingReviewCardPromptMismatch(
                localizationCode: localeFixture.localizationCode,
                reviewPrompt: localeFixture.reviewCard.frontText,
                cardsPrompt: firstConceptCard.frontText
            )
        }

        let remainingConceptCards = Array(localeFixture.conceptCards.dropFirst())
        let requiredSupportCardCount = 6
        guard remainingConceptCards.count >= requiredSupportCardCount else {
            throw FlashcardsUITestLaunchScenarioError.insufficientMarketingReviewHistoryCards(
                localizationCode: localeFixture.localizationCode,
                required: requiredSupportCardCount,
                actual: remainingConceptCards.count
            )
        }
        let createdSupportCards = try self.createUITestCards(cards: remainingConceptCards, context: context)
        try self.applyUITestMarketingReviewHistory(
            supportCards: createdSupportCards,
            localizationCode: localeFixture.localizationCode,
            context: context
        )

        // Save the review card last so it remains first in review and at the top of the cards list
        // after the support-card history updates rewrite their timestamps.
        try self.createUITestCard(card: localeFixture.reviewCard, context: context)
    }

    private func createUITestCards(
        cards: [FlashcardsUITestFixtureCard],
        context: LocalMutationContext
    ) throws -> [Card] {
        let inputs = cards.map { card in
            self.cardEditorInput(card: card)
        }
        return try context.database.createCards(workspaceId: context.workspaceId, inputs: inputs)
    }

    private func createUITestCard(
        card: FlashcardsUITestFixtureCard,
        context: LocalMutationContext
    ) throws {
        _ = try context.database.saveCard(
            workspaceId: context.workspaceId,
            input: self.cardEditorInput(card: card),
            cardId: nil
        )
    }

    private func applyUITestMarketingReviewHistory(
        supportCards: [Card],
        localizationCode: String,
        context: LocalMutationContext
    ) throws {
        let reviewSeeds = try self.marketingReviewHistorySeeds(
            localizationCode: localizationCode,
            supportCardCount: supportCards.count
        )
        let now: Date = Date()
        let calendar: Calendar = Calendar.current

        for reviewSeed in reviewSeeds {
            let card = supportCards[reviewSeed.supportCardIndex]
            let reviewedAtClient: String = try self.marketingReviewHistoryReviewedAtClient(
                dayOffset: reviewSeed.reviewedAtDayOffset,
                now: now,
                calendar: calendar
            )
            _ = try context.database.submitReview(
                workspaceId: context.workspaceId,
                reviewSubmission: ReviewSubmission(
                    cardId: card.cardId,
                    rating: reviewSeed.rating,
                    reviewedAtClient: reviewedAtClient
                )
            )
        }
    }

    private func marketingReviewHistorySeeds(
        localizationCode: String,
        supportCardCount: Int
    ) throws -> [FlashcardsUITestMarketingReviewHistorySeed] {
        let requiredSupportCardCount = 6
        guard supportCardCount >= requiredSupportCardCount else {
            throw FlashcardsUITestLaunchScenarioError.insufficientMarketingReviewHistoryCards(
                localizationCode: localizationCode,
                required: requiredSupportCardCount,
                actual: supportCardCount
            )
        }

        return [
            // Canonical 30-day-ish pattern with gaps, 16 active days, and a final 8-day streak ending today.
            FlashcardsUITestMarketingReviewHistorySeed(supportCardIndex: 0, reviewedAtDayOffset: -29, rating: .easy),
            FlashcardsUITestMarketingReviewHistorySeed(supportCardIndex: 1, reviewedAtDayOffset: -26, rating: .easy),
            FlashcardsUITestMarketingReviewHistorySeed(supportCardIndex: 2, reviewedAtDayOffset: -22, rating: .easy),
            FlashcardsUITestMarketingReviewHistorySeed(supportCardIndex: 3, reviewedAtDayOffset: -19, rating: .easy),
            FlashcardsUITestMarketingReviewHistorySeed(supportCardIndex: 0, reviewedAtDayOffset: -16, rating: .easy),
            FlashcardsUITestMarketingReviewHistorySeed(supportCardIndex: 1, reviewedAtDayOffset: -13, rating: .easy),
            FlashcardsUITestMarketingReviewHistorySeed(supportCardIndex: 2, reviewedAtDayOffset: -11, rating: .easy),
            FlashcardsUITestMarketingReviewHistorySeed(supportCardIndex: 3, reviewedAtDayOffset: -9, rating: .easy),
            FlashcardsUITestMarketingReviewHistorySeed(supportCardIndex: 0, reviewedAtDayOffset: -7, rating: .easy),
            FlashcardsUITestMarketingReviewHistorySeed(supportCardIndex: 1, reviewedAtDayOffset: -6, rating: .easy),
            FlashcardsUITestMarketingReviewHistorySeed(supportCardIndex: 2, reviewedAtDayOffset: -5, rating: .easy),
            FlashcardsUITestMarketingReviewHistorySeed(supportCardIndex: 3, reviewedAtDayOffset: -4, rating: .easy),
            FlashcardsUITestMarketingReviewHistorySeed(supportCardIndex: 4, reviewedAtDayOffset: -3, rating: .easy),
            FlashcardsUITestMarketingReviewHistorySeed(supportCardIndex: 5, reviewedAtDayOffset: -2, rating: .easy),
            FlashcardsUITestMarketingReviewHistorySeed(supportCardIndex: 5, reviewedAtDayOffset: -1, rating: .easy),
            FlashcardsUITestMarketingReviewHistorySeed(supportCardIndex: 0, reviewedAtDayOffset: 0, rating: .easy),
            FlashcardsUITestMarketingReviewHistorySeed(supportCardIndex: 1, reviewedAtDayOffset: 0, rating: .easy),
            FlashcardsUITestMarketingReviewHistorySeed(supportCardIndex: 2, reviewedAtDayOffset: 0, rating: .easy),
            FlashcardsUITestMarketingReviewHistorySeed(supportCardIndex: 3, reviewedAtDayOffset: 0, rating: .easy),
            FlashcardsUITestMarketingReviewHistorySeed(supportCardIndex: 4, reviewedAtDayOffset: 0, rating: .easy),
            FlashcardsUITestMarketingReviewHistorySeed(supportCardIndex: 5, reviewedAtDayOffset: 0, rating: .easy)
        ]
    }

    private func marketingReviewHistoryReviewedAtClient(
        dayOffset: Int,
        now: Date,
        calendar: Calendar
    ) throws -> String {
        let startOfToday = calendar.startOfDay(for: now)
        guard let todayNoon: Date = calendar.date(
            byAdding: .hour,
            value: 12,
            to: startOfToday
        ),
            let reviewedAt: Date = calendar.date(
                byAdding: .day,
                value: dayOffset,
                to: todayNoon,
                wrappingComponents: false
            ) else {
            throw FlashcardsUITestMarketingReviewHistorySeedError.reviewedAtDateCreationFailed(dayOffset: dayOffset)
        }

        return formatIsoTimestamp(date: reviewedAt)
    }

    private func cardEditorInput(card: FlashcardsUITestFixtureCard) -> CardEditorInput {
        CardEditorInput(
            frontText: card.frontText,
            backText: card.backText,
            tags: card.tags,
            effortLevel: .medium
        )
    }
}
