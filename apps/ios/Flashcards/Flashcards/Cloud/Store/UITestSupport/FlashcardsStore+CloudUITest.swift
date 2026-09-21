import Foundation

private let marketingScreenshotLocalizationEnvironmentKey: String = "FLASHCARDS_MARKETING_SCREENSHOT_LOCALIZATION"

enum FlashcardsUITestLaunchScenario: String {
    case guestEmptyWorkspace = "guest_empty_workspace"
    case guestManualReviewCard = "guest_manual_review_card"
    case guestManualReviewCardWithReminderAttention = "guest_manual_review_card_with_reminder_attention"
    case guestAIReviewCard = "guest_ai_review_card"
    case marketingScreenshots = "marketing_screenshots"
    case marketingGuestSessionCleanup = "marketing_guest_session_cleanup"

    var requiresGuestCloudBootstrap: Bool {
        switch self {
        case .guestEmptyWorkspace, .guestManualReviewCard, .guestManualReviewCardWithReminderAttention, .guestAIReviewCard:
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
        case .guestEmptyWorkspace, .guestManualReviewCard, .guestManualReviewCardWithReminderAttention, .guestAIReviewCard:
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
        tags: [
            "smoke-guest-ai-review",
            "smoke-overflow-01",
            "smoke-overflow-02",
            "smoke-overflow-03",
            "smoke-overflow-04",
            "smoke-overflow-05",
            "smoke-overflow-06",
            "smoke-overflow-07",
            "smoke-overflow-08",
            "smoke-overflow-09",
            "smoke-overflow-10",
            "smoke-overflow-11",
            "smoke-overflow-12"
        ]
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
        "fr",
        "de",
        "hi",
        "ja",
        "pt-BR",
        "ru",
        "es-MX",
        "es-ES",
        "bg",
        "bn",
        "ca",
        "cs",
        "da",
        "el",
        "et",
        "fa",
        "fi",
        "gu",
        "he",
        "hr",
        "hu",
        "id",
        "is",
        "it",
        "kn",
        "ko",
        "lt",
        "lv",
        "ml",
        "mr",
        "nb",
        "nl",
        "pa",
        "pl",
        "ro",
        "sk",
        "sl",
        "sv",
        "sw",
        "ta",
        "te",
        "th",
        "tr",
        "uk",
        "ur",
        "vi",
        "zu"
    ]

    static let localizationAliases: [String: String] = [
        "en": "en-US",
        "en-US": "en-US",
        "ar": "ar",
        "zh-CN": "zh-Hans",
        "zh-Hans": "zh-Hans",
        "fr": "fr",
        "fr-FR": "fr",
        "de": "de",
        "de-DE": "de",
        "hi": "hi",
        "hi-IN": "hi",
        "ja": "ja",
        "ja-JP": "ja",
        "pt-BR": "pt-BR",
        "pt": "pt-BR",
        "ru": "ru",
        "ru-RU": "ru",
        "es-MX": "es-MX",
        "es-419": "es-MX",
        "es-ES": "es-ES",
        "ar-SA": "ar",
        "bg": "bg",
        "bn": "bn",
        "bn-BD": "bn",
        "ca": "ca",
        "cs": "cs",
        "da": "da",
        "el": "el",
        "et": "et",
        "fa": "fa",
        "fi": "fi",
        "gu": "gu",
        "gu-IN": "gu",
        "he": "he",
        "hr": "hr",
        "hu": "hu",
        "id": "id",
        "is": "is",
        "it": "it",
        "kn": "kn",
        "kn-IN": "kn",
        "ko": "ko",
        "lt": "lt",
        "lv": "lv",
        "ml": "ml",
        "ml-IN": "ml",
        "mr": "mr",
        "mr-IN": "mr",
        "nb": "nb",
        "no": "nb",
        "nl": "nl",
        "nl-NL": "nl",
        "pa": "pa",
        "pa-IN": "pa",
        "pl": "pl",
        "ro": "ro",
        "sk": "sk",
        "sl": "sl",
        "sl-SI": "sl",
        "sv": "sv",
        "sw": "sw",
        "ta": "ta",
        "ta-IN": "ta",
        "te": "te",
        "te-IN": "te",
        "th": "th",
        "tr": "tr",
        "uk": "uk",
        "ur": "ur",
        "ur-PK": "ur",
        "vi": "vi",
        "zu": "zu"
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
            localizationCode: "fr",
            reviewCard: FlashcardsUITestFixtureCard(
                frontText: "En économie, qu'est-ce que le coût d'opportunité ?",
                backText: """
                Le coût d'opportunité est la valeur de la meilleure option à laquelle vous renoncez lorsque vous en choisissez une autre.

                Exemple d'examen : si vous passez votre samedi à réviser un examen de microéconomie au lieu de faire un service rémunéré, le salaire perdu fait partie du coût d'opportunité.
                """,
                tags: ["économie"]
            ),
            conceptCards: [
                FlashcardsUITestFixtureCard(
                    frontText: "En économie, qu'est-ce que le coût d'opportunité ?",
                    backText: "La valeur de la meilleure option à laquelle vous renoncez lorsque vous en choisissez une autre.",
                    tags: ["économie"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "En biologie, qu'est-ce que l'osmose ?",
                    backText: "Le passage de l'eau à travers une membrane, d'une concentration en soluté plus faible vers une concentration plus élevée.",
                    tags: ["biologie"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "En statistique, qu'est-ce que l'écart type ?",
                    backText: "Une mesure de la dispersion des valeurs autour de la moyenne.",
                    tags: ["statistique"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "En chimie, qu'est-ce qu'un catalyseur ?",
                    backText: "Une substance qui accélère une réaction chimique sans être consommée par celle-ci.",
                    tags: ["chimie"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "En psychologie, qu'est-ce qu'un biais cognitif ?",
                    backText: "Un schéma de pensée systématique qui peut fausser le jugement et la prise de décision.",
                    tags: ["psychologie"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "En physique, qu'est-ce que la vitesse vectorielle ?",
                    backText: "La rapidité d'un objet associée à la direction de son mouvement.",
                    tags: ["physique"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "En informatique, qu'est-ce que la récursivité ?",
                    backText: "Une méthode où une fonction résout un problème en s'appelant elle-même sur des versions plus petites de ce problème.",
                    tags: ["informatique"]
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
            localizationCode: "pt-BR",
            reviewCard: FlashcardsUITestFixtureCard(
                frontText: "Em economia, o que é custo de oportunidade?",
                backText: """
                Custo de oportunidade é o valor da melhor alternativa de que você abre mão ao escolher uma opção em vez de outra.

                Exemplo de prova: se você passa o sábado estudando para uma prova de microeconomia em vez de trabalhar em um turno remunerado, o salário perdido faz parte do custo de oportunidade.
                """,
                tags: ["economia"]
            ),
            conceptCards: [
                FlashcardsUITestFixtureCard(
                    frontText: "Em economia, o que é custo de oportunidade?",
                    backText: "O valor da melhor alternativa de que você abre mão ao escolher outra opção.",
                    tags: ["economia"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Em biologia, o que é osmose?",
                    backText: "O movimento da água através de uma membrana, de uma concentração menor de soluto para uma concentração maior.",
                    tags: ["biologia"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Em estatística, o que é desvio padrão?",
                    backText: "Uma medida de quanto os valores se espalham em torno da média.",
                    tags: ["estatística"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Em química, o que é um catalisador?",
                    backText: "Uma substância que acelera uma reação química sem ser consumida por ela.",
                    tags: ["química"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Em psicologia, o que é viés cognitivo?",
                    backText: "Um padrão sistemático de pensamento que pode distorcer o julgamento e a tomada de decisão.",
                    tags: ["psicologia"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Em física, o que é velocidade vetorial?",
                    backText: "A rapidez de um objeto junto com a direção do seu movimento.",
                    tags: ["física"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Em ciência da computação, o que é recursão?",
                    backText: "Um método em que uma função resolve um problema chamando a si mesma em versões menores desse problema.",
                    tags: ["ciência da computação"]
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
        ),
        FlashcardsUITestMarketingLocaleFixture(
            localizationCode: "bg",
            reviewCard: FlashcardsUITestFixtureCard(
                frontText: "В икономиката какво е алтернативна цена?",
                backText: """
                Алтернативната цена е стойността на най-добрата алтернатива, от която се отказвате, когато изберете една възможност вместо друга.

                Пример за изпит: ако прекарате съботата в подготовка за изпит по микроикономика вместо да работите платена смяна, пропуснатото възнаграждение е част от алтернативната цена.
                """,
                tags: ["икономика"]
            ),
            conceptCards: [
                FlashcardsUITestFixtureCard(
                    frontText: "В икономиката какво е алтернативна цена?",
                    backText: "Стойността на най-добрата алтернатива, от която се отказвате, когато изберете една възможност вместо друга.",
                    tags: ["икономика"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "В биологията какво е осмоза?",
                    backText: "Движението на водата през мембрана от по-ниска към по-висока концентрация на разтвореното вещество.",
                    tags: ["биология"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "В статистиката какво е стандартно отклонение?",
                    backText: "Мярка за това колко са разпръснати стойностите около средната стойност.",
                    tags: ["статистика"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "В химията какво е катализатор?",
                    backText: "Вещество, което ускорява химична реакция, без да се изразходва в нея.",
                    tags: ["химия"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "В психологията какво е когнитивно изкривяване?",
                    backText: "Систематичен модел на мислене, който може да изкриви преценката и вземането на решения.",
                    tags: ["психология"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Във физиката какво е скорост?",
                    backText: "Бързината на движение на тялото заедно с посоката на това движение.",
                    tags: ["физика"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "В компютърните науки какво е рекурсия?",
                    backText: "Метод, при който функция решава задача, като извиква сама себе си върху по-малки версии на същата задача.",
                    tags: ["компютърни науки"]
                )
            ]
        ),
        FlashcardsUITestMarketingLocaleFixture(
            localizationCode: "bn",
            reviewCard: FlashcardsUITestFixtureCard(
                frontText: "অর্থনীতিতে সুযোগ ব্যয় কী?",
                backText: """
                একটি বিকল্প বেছে নেওয়ার সময় ছেড়ে দেওয়া সেরা বিকল্পটির মূল্য।

                পরীক্ষার উদাহরণ: শনিবার পারিশ্রমিকের বিনিময়ে কাজ না করে ক্ষুদ্র অর্থনীতির পরীক্ষার জন্য পড়লে, হারানো মজুরি সুযোগ ব্যয়ের অংশ।
                """,
                tags: ["অর্থনীতি"]
            ),
            conceptCards: [
                FlashcardsUITestFixtureCard(
                    frontText: "অর্থনীতিতে সুযোগ ব্যয় কী?",
                    backText: "একটি বিকল্প বেছে নেওয়ার সময় ছেড়ে দেওয়া সেরা বিকল্পটির মূল্য।",
                    tags: ["অর্থনীতি"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "জীববিজ্ঞানে অভিস্রবণ কী?",
                    backText: "একটি ঝিল্লির মধ্য দিয়ে কম দ্রব ঘনত্বের অঞ্চল থেকে বেশি দ্রব ঘনত্বের অঞ্চলে জলের চলাচল।",
                    tags: ["জীববিজ্ঞান"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "পরিসংখ্যানে প্রমিত বিচ্যুতি কী?",
                    backText: "মানগুলো গড়ের চারপাশে কতটা ছড়িয়ে আছে তার পরিমাপ।",
                    tags: ["পরিসংখ্যান"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "রসায়নে অনুঘটক কী?",
                    backText: "যে পদার্থ নিজে ক্ষয় না হয়ে রাসায়নিক বিক্রিয়ার গতি বাড়ায়।",
                    tags: ["রসায়ন"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "মনোবিজ্ঞানে জ্ঞানগত পক্ষপাত কী?",
                    backText: "চিন্তার একটি নিয়মিত প্রবণতা যা বিচারবোধ ও সিদ্ধান্তকে বিকৃত করতে পারে।",
                    tags: ["মনোবিজ্ঞান"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "পদার্থবিজ্ঞানে বেগ কী?",
                    backText: "কোনো বস্তুর গতির দিকসহ তার দ্রুতি।",
                    tags: ["পদার্থবিজ্ঞান"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "কম্পিউটার বিজ্ঞানে রিকার্শন কী?",
                    backText: "এমন একটি পদ্ধতি যেখানে একটি ফাংশন একই সমস্যার ছোট সংস্করণ সমাধান করতে নিজেকেই ডাকে।",
                    tags: ["কম্পিউটার বিজ্ঞান"]
                )
            ]
        ),
        FlashcardsUITestMarketingLocaleFixture(
            localizationCode: "ca",
            reviewCard: FlashcardsUITestFixtureCard(
                frontText: "En economia, què és el cost d'oportunitat?",
                backText: """
                El valor de la millor alternativa a què renuncies quan tries una altra opció.

                Exemple d'examen: si passes el dissabte estudiant per a un examen de microeconomia en lloc de fer un torn remunerat, el sou que deixes de guanyar forma part del cost d'oportunitat.
                """,
                tags: ["economia"]
            ),
            conceptCards: [
                FlashcardsUITestFixtureCard(
                    frontText: "En economia, què és el cost d'oportunitat?",
                    backText: "El valor de la millor alternativa a què renuncies quan tries una altra opció.",
                    tags: ["economia"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "En biologia, què és l'osmosi?",
                    backText: "El moviment de l'aigua a través d'una membrana des d'una concentració de solut més baixa cap a una de més alta.",
                    tags: ["biologia"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "En estadística, què és la desviació estàndard?",
                    backText: "Una mesura de com es dispersen els valors al voltant de la mitjana.",
                    tags: ["estadística"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "En química, què és un catalitzador?",
                    backText: "Una substància que accelera una reacció química sense consumir-se.",
                    tags: ["química"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "En psicologia, què és un biaix cognitiu?",
                    backText: "Un patró sistemàtic de pensament que pot distorsionar el judici i la presa de decisions.",
                    tags: ["psicologia"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "En física, què és la velocitat?",
                    backText: "La rapidesa d'un objecte juntament amb la direcció del seu moviment.",
                    tags: ["física"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "En informàtica, què és la recursivitat?",
                    backText: "Un mètode en què una funció resol un problema cridant-se a si mateixa per resoldre versions més petites del mateix problema.",
                    tags: ["informàtica"]
                )
            ]
        ),
        FlashcardsUITestMarketingLocaleFixture(
            localizationCode: "cs",
            reviewCard: FlashcardsUITestFixtureCard(
                frontText: "Co jsou v ekonomii náklady obětované příležitosti?",
                backText: """
                Hodnota nejlepší alternativy, které se vzdáte, když si vyberete jinou možnost.

                Příklad ke zkoušce: pokud v sobotu místo placené směny studujete na zkoušku z mikroekonomie, ušlá mzda je součástí nákladů obětované příležitosti.
                """,
                tags: ["ekonomie"]
            ),
            conceptCards: [
                FlashcardsUITestFixtureCard(
                    frontText: "Co jsou v ekonomii náklady obětované příležitosti?",
                    backText: "Hodnota nejlepší alternativy, které se vzdáte, když si vyberete jinou možnost.",
                    tags: ["ekonomie"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Co je v biologii osmóza?",
                    backText: "Pohyb vody přes membránu z oblasti s nižší koncentrací rozpuštěných látek do oblasti s vyšší koncentrací.",
                    tags: ["biologie"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Co je ve statistice směrodatná odchylka?",
                    backText: "Míra toho, jak jsou hodnoty rozptýlené kolem průměru.",
                    tags: ["statistika"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Co je v chemii katalyzátor?",
                    backText: "Látka, která urychluje chemickou reakci, aniž by se při ní spotřebovávala.",
                    tags: ["chemie"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Co je v psychologii kognitivní zkreslení?",
                    backText: "Systematický vzorec myšlení, který může zkreslovat úsudek a rozhodování.",
                    tags: ["psychologie"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Co je ve fyzice vektor rychlosti?",
                    backText: "Veličina, která vyjadřuje rychlost pohybu tělesa i jeho směr.",
                    tags: ["fyzika"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Co je v informatice rekurze?",
                    backText: "Metoda, při které funkce řeší problém tím, že volá sama sebe pro menší verze téhož problému.",
                    tags: ["informatika"]
                )
            ]
        ),
        FlashcardsUITestMarketingLocaleFixture(
            localizationCode: "da",
            reviewCard: FlashcardsUITestFixtureCard(
                frontText: "Hvad er alternativomkostning i økonomi?",
                backText: """
                Værdien af det bedste alternativ, du giver afkald på, når du vælger en anden mulighed.

                Eksamenseksempel: Hvis du bruger lørdagen på at læse til en eksamen i mikroøkonomi i stedet for at tage en betalt vagt, er den mistede løn en del af alternativomkostningen.
                """,
                tags: ["økonomi"]
            ),
            conceptCards: [
                FlashcardsUITestFixtureCard(
                    frontText: "Hvad er alternativomkostning i økonomi?",
                    backText: "Værdien af det bedste alternativ, du giver afkald på, når du vælger en anden mulighed.",
                    tags: ["økonomi"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Hvad er osmose i biologi?",
                    backText: "Vandets bevægelse gennem en membran fra lavere til højere koncentration af opløste stoffer.",
                    tags: ["biologi"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Hvad er standardafvigelse i statistik?",
                    backText: "Et mål for, hvor spredte værdierne er omkring gennemsnittet.",
                    tags: ["statistik"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Hvad er en katalysator i kemi?",
                    backText: "Et stof, der fremskynder en kemisk reaktion uden selv at blive forbrugt.",
                    tags: ["kemi"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Hvad er en kognitiv bias i psykologi?",
                    backText: "Et systematisk tankemønster, der kan forvrænge vurderinger og beslutninger.",
                    tags: ["psykologi"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Hvad er hastighed som vektor i fysik?",
                    backText: "Et objekts fart sammen med retningen af dets bevægelse.",
                    tags: ["fysik"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Hvad er rekursion i datalogi?",
                    backText: "En metode, hvor en funktion løser et problem ved at kalde sig selv på mindre udgaver af problemet.",
                    tags: ["datalogi"]
                )
            ]
        ),
        FlashcardsUITestMarketingLocaleFixture(
            localizationCode: "el",
            reviewCard: FlashcardsUITestFixtureCard(
                frontText: "Τι είναι το κόστος ευκαιρίας στα οικονομικά;",
                backText: """
                Η αξία της καλύτερης εναλλακτικής που θυσιάζεις όταν επιλέγεις μια άλλη δυνατότητα.

                Παράδειγμα εξέτασης: αν περάσεις το Σάββατο διαβάζοντας για μια εξέταση μικροοικονομίας αντί να εργαστείς σε αμειβόμενη βάρδια, ο χαμένος μισθός αποτελεί μέρος του κόστους ευκαιρίας.
                """,
                tags: ["οικονομικά"]
            ),
            conceptCards: [
                FlashcardsUITestFixtureCard(
                    frontText: "Τι είναι το κόστος ευκαιρίας στα οικονομικά;",
                    backText: "Η αξία της καλύτερης εναλλακτικής που θυσιάζεις όταν επιλέγεις μια άλλη δυνατότητα.",
                    tags: ["οικονομικά"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Τι είναι η ώσμωση στη βιολογία;",
                    backText: "Η μετακίνηση νερού μέσα από μια μεμβράνη από χαμηλότερη προς υψηλότερη συγκέντρωση διαλυμένης ουσίας.",
                    tags: ["βιολογία"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Τι είναι η τυπική απόκλιση στη στατιστική;",
                    backText: "Ένα μέτρο του πόσο διασκορπισμένες είναι οι τιμές γύρω από τον μέσο όρο.",
                    tags: ["στατιστική"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Τι είναι ο καταλύτης στη χημεία;",
                    backText: "Μια ουσία που επιταχύνει μια χημική αντίδραση χωρίς να καταναλώνεται.",
                    tags: ["χημεία"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Τι είναι η γνωστική προκατάληψη στην ψυχολογία;",
                    backText: "Ένα συστηματικό μοτίβο σκέψης που μπορεί να διαστρεβλώσει την κρίση και τη λήψη αποφάσεων.",
                    tags: ["ψυχολογία"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Τι είναι η διανυσματική ταχύτητα στη φυσική;",
                    backText: "Το μέτρο της ταχύτητας ενός αντικειμένου μαζί με την κατεύθυνση της κίνησής του.",
                    tags: ["φυσική"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Τι είναι η αναδρομή στην πληροφορική;",
                    backText: "Μια μέθοδος όπου μια συνάρτηση λύνει ένα πρόβλημα καλώντας τον εαυτό της για μικρότερες εκδοχές του ίδιου προβλήματος.",
                    tags: ["πληροφορική"]
                )
            ]
        ),
        FlashcardsUITestMarketingLocaleFixture(
            localizationCode: "et",
            reviewCard: FlashcardsUITestFixtureCard(
                frontText: "Mis on majanduses alternatiivkulu?",
                backText: """
                Alternatiivkulu on parima kõrvalejäetud valiku väärtus, millest sa loobud, kui valid ühe võimaluse teise asemel.

                Eksaminäide: kui veedad laupäeva mikroökonoomika eksamiks õppides, selle asemel et teha tasustatud vahetus, on saamata jäänud palk osa alternatiivkulust.
                """,
                tags: ["majandus"]
            ),
            conceptCards: [
                FlashcardsUITestFixtureCard(
                    frontText: "Mis on majanduses alternatiivkulu?",
                    backText: "Parima kõrvalejäetud valiku väärtus, millest sa loobud, kui valid ühe võimaluse teise asemel.",
                    tags: ["majandus"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Mis on bioloogias osmoos?",
                    backText: "Vee liikumine läbi membraani madalama lahustunud aine sisaldusega poolelt kõrgema poole.",
                    tags: ["bioloogia"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Mis on statistikas standardhälve?",
                    backText: "Näitaja, mis mõõdab väärtuste hajuvust keskmise ümber.",
                    tags: ["statistika"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Mis on keemias katalüsaator?",
                    backText: "Aine, mis kiirendab keemilist reaktsiooni, ilma et see reaktsioonis ära kuluks.",
                    tags: ["keemia"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Mis on psühholoogias kognitiivne kallutatus?",
                    backText: "Süstemaatiline mõttemuster, mis võib moonutada hinnanguid ja otsuste tegemist.",
                    tags: ["psühholoogia"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Mis on füüsikas kiirus?",
                    backText: "Keha liikumise kiirus koos selle liikumise suunaga.",
                    tags: ["füüsika"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Mis on arvutiteaduses rekursioon?",
                    backText: "Meetod, kus funktsioon lahendab ülesande, kutsudes iseennast sama ülesande väiksemate osade jaoks.",
                    tags: ["arvutiteadus"]
                )
            ]
        ),
        FlashcardsUITestMarketingLocaleFixture(
            localizationCode: "fa",
            reviewCard: FlashcardsUITestFixtureCard(
                frontText: "در اقتصاد، هزینه فرصت چیست؟",
                backText: """
                هزینه فرصت ارزش بهترین گزینه جایگزینی است که وقتی یک گزینه را به جای گزینه دیگر انتخاب می‌کنید، از آن چشم‌پوشی می‌کنید.

                مثال امتحانی: اگر شنبه را به جای کار کردن در یک شیفت با حقوق، صرف مطالعه برای امتحان اقتصاد خرد کنید، دستمزد از دست‌رفته بخشی از هزینه فرصت است.
                """,
                tags: ["اقتصاد"]
            ),
            conceptCards: [
                FlashcardsUITestFixtureCard(
                    frontText: "در اقتصاد، هزینه فرصت چیست؟",
                    backText: "ارزش بهترین گزینه جایگزینی که هنگام انتخاب یک گزینه به جای گزینه دیگر از آن چشم‌پوشی می‌کنید.",
                    tags: ["اقتصاد"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "در زیست‌شناسی، اسمز چیست؟",
                    backText: "حرکت آب از میان یک غشا از غلظت کمتر ماده حل‌شده به غلظت بیشتر آن.",
                    tags: ["زیست‌شناسی"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "در آمار، انحراف معیار چیست؟",
                    backText: "معیاری برای سنجش میزان پراکندگی مقادیر حول میانگین.",
                    tags: ["آمار"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "در شیمی، کاتالیزور چیست؟",
                    backText: "ماده‌ای که سرعت یک واکنش شیمیایی را افزایش می‌دهد بدون آنکه در آن مصرف شود.",
                    tags: ["شیمی"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "در روان‌شناسی، سوگیری شناختی چیست؟",
                    backText: "الگویی نظام‌مند در تفکر که می‌تواند قضاوت و تصمیم‌گیری را منحرف کند.",
                    tags: ["روان‌شناسی"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "در فیزیک، سرعت برداری چیست؟",
                    backText: "تندی حرکت یک جسم همراه با جهت آن حرکت.",
                    tags: ["فیزیک"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "در علوم کامپیوتر، بازگشت چیست؟",
                    backText: "روشی که در آن یک تابع مسئله را با فراخوانی خودش روی نسخه‌های کوچک‌تر همان مسئله حل می‌کند.",
                    tags: ["علوم کامپیوتر"]
                )
            ]
        ),
        FlashcardsUITestMarketingLocaleFixture(
            localizationCode: "fi",
            reviewCard: FlashcardsUITestFixtureCard(
                frontText: "Mitä vaihtoehtoiskustannus tarkoittaa taloustieteessä?",
                backText: """
                Parhaan sellaisen vaihtoehdon arvo, josta luovut valitessasi toisen vaihtoehdon.

                Tenttiesimerkki: jos käytät lauantain mikrotaloustieteen tenttiin lukemiseen palkallisen työvuoron sijaan, menetetty palkka on osa vaihtoehtoiskustannusta.
                """,
                tags: ["taloustiede"]
            ),
            conceptCards: [
                FlashcardsUITestFixtureCard(
                    frontText: "Mitä vaihtoehtoiskustannus tarkoittaa taloustieteessä?",
                    backText: "Parhaan sellaisen vaihtoehdon arvo, josta luovut valitessasi toisen vaihtoehdon.",
                    tags: ["taloustiede"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Mitä osmoosi tarkoittaa biologiassa?",
                    backText: "Veden liikkumista kalvon läpi pienemmästä liuenneen aineen pitoisuudesta suurempaan.",
                    tags: ["biologia"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Mitä keskihajonta tarkoittaa tilastotieteessä?",
                    backText: "Mittaa, joka kuvaa arvojen hajontaa keskiarvon ympärillä.",
                    tags: ["tilastotiede"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Mikä on katalyytti kemiassa?",
                    backText: "Aine, joka nopeuttaa kemiallista reaktiota kulumatta itse reaktiossa.",
                    tags: ["kemia"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Mitä kognitiivinen vinouma tarkoittaa psykologiassa?",
                    backText: "Järjestelmällistä ajattelumallia, joka voi vääristää arviointia ja päätöksentekoa.",
                    tags: ["psykologia"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Mitä nopeusvektori tarkoittaa fysiikassa?",
                    backText: "Suuretta, joka kuvaa kappaleen vauhtia ja liikkeen suuntaa.",
                    tags: ["fysiikka"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Mitä rekursio tarkoittaa tietojenkäsittelytieteessä?",
                    backText: "Menetelmää, jossa funktio ratkaisee ongelman kutsumalla itseään saman ongelman pienemmille versioille.",
                    tags: ["tietojenkäsittelytiede"]
                )
            ]
        ),
        FlashcardsUITestMarketingLocaleFixture(
            localizationCode: "gu",
            reviewCard: FlashcardsUITestFixtureCard(
                frontText: "અર્થશાસ્ત્રમાં તક ખર્ચ શું છે?",
                backText: """
                એક વિકલ્પ પસંદ કરતી વખતે તમે છોડી દો છો તે શ્રેષ્ઠ વૈકલ્પિક પસંદગીનું મૂલ્ય.

                પરીક્ષાનું ઉદાહરણ: જો તમે શનિવારે પગારવાળી પાળીમાં કામ કરવાને બદલે સૂક્ષ્મ અર્થશાસ્ત્રની પરીક્ષા માટે અભ્યાસ કરો, તો ગુમાવેલો પગાર તક ખર્ચનો ભાગ છે.
                """,
                tags: ["અર્થશાસ્ત્ર"]
            ),
            conceptCards: [
                FlashcardsUITestFixtureCard(
                    frontText: "અર્થશાસ્ત્રમાં તક ખર્ચ શું છે?",
                    backText: "એક વિકલ્પ પસંદ કરતી વખતે તમે છોડી દો છો તે શ્રેષ્ઠ વૈકલ્પિક પસંદગીનું મૂલ્ય.",
                    tags: ["અર્થશાસ્ત્ર"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "જીવવિજ્ઞાનમાં પરાસરણ શું છે?",
                    backText: "પટલમાંથી પાણીનું ઓછી દ્રાવ્ય સાંદ્રતા ધરાવતા વિસ્તારથી વધુ દ્રાવ્ય સાંદ્રતા ધરાવતા વિસ્તાર તરફ વહન.",
                    tags: ["જીવવિજ્ઞાન"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "આંકડાશાસ્ત્રમાં પ્રમાણિત વિચલન શું છે?",
                    backText: "મૂલ્યો સરેરાશની આસપાસ કેટલાં ફેલાયેલાં છે તેનું માપ.",
                    tags: ["આંકડાશાસ્ત્ર"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "રસાયણશાસ્ત્રમાં ઉત્પ્રેરક શું છે?",
                    backText: "એવો પદાર્થ જે પોતે વપરાઈ ગયા વિના રાસાયણિક પ્રક્રિયાને ઝડપી બનાવે છે.",
                    tags: ["રસાયણશાસ્ત્ર"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "મનોવિજ્ઞાનમાં જ્ઞાનાત્મક પૂર્વગ્રહ શું છે?",
                    backText: "વિચારવાની એક વ્યવસ્થિત ઢબ જે મૂલ્યાંકન અને નિર્ણય લેવાની પ્રક્રિયાને વિકૃત કરી શકે છે.",
                    tags: ["મનોવિજ્ઞાન"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "ભૌતિકશાસ્ત્રમાં વેગ શું છે?",
                    backText: "વસ્તુની ગતિની દિશા સાથે તેની ઝડપ.",
                    tags: ["ભૌતિકશાસ્ત્ર"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "કમ્પ્યુટર વિજ્ઞાનમાં રિકર્ઝન શું છે?",
                    backText: "એવી પદ્ધતિ જેમાં ફંક્શન એ જ સમસ્યાનાં નાનાં સ્વરૂપો ઉકેલવા પોતાને જ બોલાવે છે.",
                    tags: ["કમ્પ્યુટર વિજ્ઞાન"]
                )
            ]
        ),
        FlashcardsUITestMarketingLocaleFixture(
            localizationCode: "he",
            reviewCard: FlashcardsUITestFixtureCard(
                frontText: "מהי עלות אלטרנטיבית בכלכלה?",
                backText: """
                הערך של החלופה הטובה ביותר שעליה מוותרים כשבוחרים באפשרות אחרת.

                דוגמה לבחינה: אם מקדישים את השבת ללימוד לבחינה במיקרו־כלכלה במקום לעבוד במשמרת בתשלום, השכר שלא התקבל הוא חלק מהעלות האלטרנטיבית.
                """,
                tags: ["כלכלה"]
            ),
            conceptCards: [
                FlashcardsUITestFixtureCard(
                    frontText: "מהי עלות אלטרנטיבית בכלכלה?",
                    backText: "הערך של החלופה הטובה ביותר שעליה מוותרים כשבוחרים באפשרות אחרת.",
                    tags: ["כלכלה"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "מהי אוסמוזה בביולוגיה?",
                    backText: "תנועה של מים דרך קרום מאזור עם ריכוז מומסים נמוך לאזור עם ריכוז מומסים גבוה.",
                    tags: ["ביולוגיה"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "מהי סטיית תקן בסטטיסטיקה?",
                    backText: "מדד למידת הפיזור של הערכים סביב הממוצע.",
                    tags: ["סטטיסטיקה"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "מהו זרז בכימיה?",
                    backText: "חומר שמאיץ תגובה כימית בלי להיצרך במהלכה.",
                    tags: ["כימיה"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "מהי הטיה קוגניטיבית בפסיכולוגיה?",
                    backText: "דפוס חשיבה שיטתי שעלול לעוות שיפוט וקבלת החלטות.",
                    tags: ["פסיכולוגיה"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "מהי מהירות וקטורית בפיזיקה?",
                    backText: "גודל המהירות של גוף יחד עם כיוון תנועתו.",
                    tags: ["פיזיקה"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "מהי רקורסיה במדעי המחשב?",
                    backText: "שיטה שבה פונקציה פותרת בעיה באמצעות קריאה לעצמה עבור גרסאות קטנות יותר של אותה בעיה.",
                    tags: ["מדעי המחשב"]
                )
            ]
        ),
        FlashcardsUITestMarketingLocaleFixture(
            localizationCode: "hr",
            reviewCard: FlashcardsUITestFixtureCard(
                frontText: "Što je oportunitetni trošak u ekonomiji?",
                backText: """
                Vrijednost najbolje alternative koje se odričete kada odaberete drugu mogućnost.

                Primjer za ispit: ako subotu provedete učeći za ispit iz mikroekonomije umjesto radeći plaćenu smjenu, izgubljena zarada dio je oportunitetnog troška.
                """,
                tags: ["ekonomija"]
            ),
            conceptCards: [
                FlashcardsUITestFixtureCard(
                    frontText: "Što je oportunitetni trošak u ekonomiji?",
                    backText: "Vrijednost najbolje alternative koje se odričete kada odaberete drugu mogućnost.",
                    tags: ["ekonomija"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Što je osmoza u biologiji?",
                    backText: "Kretanje vode kroz membranu iz područja niže koncentracije otopljenih tvari prema području više koncentracije.",
                    tags: ["biologija"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Što je standardna devijacija u statistici?",
                    backText: "Mjera raspršenosti vrijednosti oko prosjeka.",
                    tags: ["statistika"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Što je katalizator u kemiji?",
                    backText: "Tvar koja ubrzava kemijsku reakciju, a pritom se ne troši.",
                    tags: ["kemija"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Što je kognitivna pristranost u psihologiji?",
                    backText: "Sustavan obrazac razmišljanja koji može iskriviti prosuđivanje i donošenje odluka.",
                    tags: ["psihologija"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Što je vektor brzine u fizici?",
                    backText: "Veličina koja opisuje brzinu gibanja tijela i njegov smjer.",
                    tags: ["fizika"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Što je rekurzija u računarstvu?",
                    backText: "Metoda kojom funkcija rješava problem pozivajući samu sebe za manje inačice istog problema.",
                    tags: ["računarstvo"]
                )
            ]
        ),
        FlashcardsUITestMarketingLocaleFixture(
            localizationCode: "hu",
            reviewCard: FlashcardsUITestFixtureCard(
                frontText: "Mit jelent az alternatív költség a közgazdaságtanban?",
                backText: """
                Annak a legjobb alternatívának az értéke, amelyről lemondasz, amikor egy másik lehetőséget választasz.

                Vizsgapélda: ha szombaton fizetett műszak helyett a mikroökonómia-vizsgára tanulsz, az elmaradt munkabér az alternatív költség része.
                """,
                tags: ["közgazdaságtan"]
            ),
            conceptCards: [
                FlashcardsUITestFixtureCard(
                    frontText: "Mit jelent az alternatív költség a közgazdaságtanban?",
                    backText: "Annak a legjobb alternatívának az értéke, amelyről lemondasz, amikor egy másik lehetőséget választasz.",
                    tags: ["közgazdaságtan"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Mi az ozmózis a biológiában?",
                    backText: "A víz áramlása egy membránon keresztül az alacsonyabb oldottanyag-koncentrációjú helyről a magasabb felé.",
                    tags: ["biológia"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Mi a szórás a statisztikában?",
                    backText: "Annak mértéke, hogy az értékek mennyire szóródnak az átlag körül.",
                    tags: ["statisztika"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Mi a katalizátor a kémiában?",
                    backText: "Olyan anyag, amely felgyorsít egy kémiai reakciót anélkül, hogy közben elfogyna.",
                    tags: ["kémia"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Mi a kognitív torzítás a pszichológiában?",
                    backText: "Rendszeres gondolkodási mintázat, amely torzíthatja az ítéletalkotást és a döntéshozatalt.",
                    tags: ["pszichológia"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Mi a sebességvektor a fizikában?",
                    backText: "Olyan mennyiség, amely a test mozgásának gyorsaságát és irányát is leírja.",
                    tags: ["fizika"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Mi a rekurzió az informatikában?",
                    backText: "Olyan módszer, amelyben egy függvény önmagát hívja meg ugyanazon probléma kisebb változatainak megoldására.",
                    tags: ["informatika"]
                )
            ]
        ),
        FlashcardsUITestMarketingLocaleFixture(
            localizationCode: "id",
            reviewCard: FlashcardsUITestFixtureCard(
                frontText: "Dalam ekonomi, apa itu biaya peluang?",
                backText: """
                Nilai alternatif terbaik yang kamu korbankan saat memilih opsi lain.

                Contoh ujian: jika kamu menghabiskan hari Sabtu belajar untuk ujian mikroekonomi alih-alih bekerja dalam sif berbayar, upah yang tidak diperoleh termasuk biaya peluang.
                """,
                tags: ["ekonomi"]
            ),
            conceptCards: [
                FlashcardsUITestFixtureCard(
                    frontText: "Dalam ekonomi, apa itu biaya peluang?",
                    backText: "Nilai alternatif terbaik yang kamu korbankan saat memilih opsi lain.",
                    tags: ["ekonomi"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Dalam biologi, apa itu osmosis?",
                    backText: "Perpindahan air melalui membran dari konsentrasi zat terlarut yang lebih rendah ke yang lebih tinggi.",
                    tags: ["biologi"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Dalam statistika, apa itu simpangan baku?",
                    backText: "Ukuran seberapa tersebar nilai-nilai di sekitar rata-rata.",
                    tags: ["statistika"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Dalam kimia, apa itu katalis?",
                    backText: "Zat yang mempercepat reaksi kimia tanpa ikut habis dalam reaksi tersebut.",
                    tags: ["kimia"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Dalam psikologi, apa itu bias kognitif?",
                    backText: "Pola berpikir sistematis yang dapat menyimpangkan penilaian dan pengambilan keputusan.",
                    tags: ["psikologi"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Dalam fisika, apa itu kecepatan?",
                    backText: "Kelajuan suatu benda beserta arah geraknya.",
                    tags: ["fisika"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Dalam ilmu komputer, apa itu rekursi?",
                    backText: "Metode ketika sebuah fungsi memecahkan masalah dengan memanggil dirinya sendiri untuk versi yang lebih kecil dari masalah yang sama.",
                    tags: ["ilmu komputer"]
                )
            ]
        ),
        FlashcardsUITestMarketingLocaleFixture(
            localizationCode: "is",
            reviewCard: FlashcardsUITestFixtureCard(
                frontText: "Hvað er fórnarkostnaður í hagfræði?",
                backText: """
                Fórnarkostnaður er verðmæti næstbesta kostarins sem þú gefur eftir þegar þú velur einn valkost fram yfir annan.

                Prófdæmi: ef þú eyðir laugardeginum í að lesa fyrir próf í örhagfræði í stað þess að vinna launaða vakt eru töpuðu launin hluti af fórnarkostnaðinum.
                """,
                tags: ["hagfræði"]
            ),
            conceptCards: [
                FlashcardsUITestFixtureCard(
                    frontText: "Hvað er fórnarkostnaður í hagfræði?",
                    backText: "Verðmæti næstbesta kostarins sem þú gefur eftir þegar þú velur einn valkost fram yfir annan.",
                    tags: ["hagfræði"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Hvað er himnuflæði í líffræði?",
                    backText: "Flæði vatns gegnum himnu frá lægri styrk uppleysts efnis til hærri styrks.",
                    tags: ["líffræði"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Hvað er staðalfrávik í tölfræði?",
                    backText: "Mælikvarði á hversu dreifð gildin eru í kringum meðaltalið.",
                    tags: ["tölfræði"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Hvað er hvati í efnafræði?",
                    backText: "Efni sem flýtir efnahvarfi án þess að eyðast í því.",
                    tags: ["efnafræði"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Hvað er hugræn skekkja í sálfræði?",
                    backText: "Kerfisbundið hugsanamynstur sem getur skekkt mat og ákvarðanatöku.",
                    tags: ["sálfræði"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Hvað er hraði í eðlisfræði?",
                    backText: "Hraði hlutar ásamt stefnu hreyfingar hans.",
                    tags: ["eðlisfræði"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Hvað er endurkvæmni í tölvunarfræði?",
                    backText: "Aðferð þar sem fall leysir verkefni með því að kalla á sjálft sig fyrir minni útgáfur sama verkefnis.",
                    tags: ["tölvunarfræði"]
                )
            ]
        ),
        FlashcardsUITestMarketingLocaleFixture(
            localizationCode: "it",
            reviewCard: FlashcardsUITestFixtureCard(
                frontText: "In economia, che cos'è il costo opportunità?",
                backText: """
                Il valore della migliore alternativa a cui rinunci quando scegli un'altra opzione.

                Esempio d'esame: se passi il sabato a studiare per un esame di microeconomia invece di fare un turno retribuito, il mancato guadagno fa parte del costo opportunità.
                """,
                tags: ["economia"]
            ),
            conceptCards: [
                FlashcardsUITestFixtureCard(
                    frontText: "In economia, che cos'è il costo opportunità?",
                    backText: "Il valore della migliore alternativa a cui rinunci quando scegli un'altra opzione.",
                    tags: ["economia"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "In biologia, che cos'è l'osmosi?",
                    backText: "Il movimento dell'acqua attraverso una membrana da una concentrazione di soluto minore a una maggiore.",
                    tags: ["biologia"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "In statistica, che cos'è la deviazione standard?",
                    backText: "Una misura di quanto i valori sono dispersi intorno alla media.",
                    tags: ["statistica"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "In chimica, che cos'è un catalizzatore?",
                    backText: "Una sostanza che accelera una reazione chimica senza essere consumata.",
                    tags: ["chimica"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "In psicologia, che cos'è un bias cognitivo?",
                    backText: "Uno schema sistematico di pensiero che può alterare il giudizio e le decisioni.",
                    tags: ["psicologia"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "In fisica, che cos'è la velocità vettoriale?",
                    backText: "Una grandezza che descrive quanto rapidamente si muove un oggetto, insieme alla direzione e al verso del moto.",
                    tags: ["fisica"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "In informatica, che cos'è la ricorsione?",
                    backText: "Un metodo in cui una funzione risolve un problema richiamando sé stessa su versioni più piccole dello stesso problema.",
                    tags: ["informatica"]
                )
            ]
        ),
        FlashcardsUITestMarketingLocaleFixture(
            localizationCode: "kn",
            reviewCard: FlashcardsUITestFixtureCard(
                frontText: "ಅರ್ಥಶಾಸ್ತ್ರದಲ್ಲಿ ಅವಕಾಶ ವೆಚ್ಚ ಎಂದರೇನು?",
                backText: """
                ಒಂದು ಆಯ್ಕೆಯನ್ನು ಮಾಡುವಾಗ ಬಿಟ್ಟುಕೊಡುವ ಅತ್ಯುತ್ತಮ ಪರ್ಯಾಯದ ಮೌಲ್ಯ.

                ಪರೀಕ್ಷೆಯ ಉದಾಹರಣೆ: ಶನಿವಾರ ಸಂಬಳ ಸಿಗುವ ಪಾಳಿಯಲ್ಲಿ ಕೆಲಸ ಮಾಡುವ ಬದಲು ಸೂಕ್ಷ್ಮ ಅರ್ಥಶಾಸ್ತ್ರದ ಪರೀಕ್ಷೆಗೆ ಓದಿದರೆ, ಕಳೆದುಕೊಂಡ ಸಂಬಳವು ಅವಕಾಶ ವೆಚ್ಚದ ಭಾಗವಾಗುತ್ತದೆ.
                """,
                tags: ["ಅರ್ಥಶಾಸ್ತ್ರ"]
            ),
            conceptCards: [
                FlashcardsUITestFixtureCard(
                    frontText: "ಅರ್ಥಶಾಸ್ತ್ರದಲ್ಲಿ ಅವಕಾಶ ವೆಚ್ಚ ಎಂದರೇನು?",
                    backText: "ಒಂದು ಆಯ್ಕೆಯನ್ನು ಮಾಡುವಾಗ ಬಿಟ್ಟುಕೊಡುವ ಅತ್ಯುತ್ತಮ ಪರ್ಯಾಯದ ಮೌಲ್ಯ.",
                    tags: ["ಅರ್ಥಶಾಸ್ತ್ರ"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "ಜೀವಶಾಸ್ತ್ರದಲ್ಲಿ ಆಸ್ಮೋಸಿಸ್ ಎಂದರೇನು?",
                    backText: "ದ್ರಾವ್ಯದ ಸಾಂದ್ರತೆ ಕಡಿಮೆ ಇರುವ ಪ್ರದೇಶದಿಂದ ಹೆಚ್ಚು ಇರುವ ಪ್ರದೇಶಕ್ಕೆ ಪೊರೆಯ ಮೂಲಕ ನೀರು ಚಲಿಸುವುದು.",
                    tags: ["ಜೀವಶಾಸ್ತ್ರ"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "ಸಂಖ್ಯಾಶಾಸ್ತ್ರದಲ್ಲಿ ಪ್ರಮಾಣಿತ ವಿಚಲನ ಎಂದರೇನು?",
                    backText: "ಮೌಲ್ಯಗಳು ಸರಾಸರಿಯ ಸುತ್ತ ಎಷ್ಟು ಚದುರಿವೆ ಎಂಬುದರ ಅಳತೆ.",
                    tags: ["ಸಂಖ್ಯಾಶಾಸ್ತ್ರ"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "ರಸಾಯನಶಾಸ್ತ್ರದಲ್ಲಿ ವೇಗವರ್ಧಕ ಎಂದರೇನು?",
                    backText: "ತಾನು ಖರ್ಚಾಗದೆ ರಾಸಾಯನಿಕ ಕ್ರಿಯೆಯ ವೇಗವನ್ನು ಹೆಚ್ಚಿಸುವ ವಸ್ತು.",
                    tags: ["ರಸಾಯನಶಾಸ್ತ್ರ"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "ಮನೋವಿಜ್ಞಾನದಲ್ಲಿ ಅರಿವಿನ ಪಕ್ಷಪಾತ ಎಂದರೇನು?",
                    backText: "ತೀರ್ಮಾನಿಸುವಿಕೆ ಮತ್ತು ನಿರ್ಧಾರ ತೆಗೆದುಕೊಳ್ಳುವಿಕೆಯನ್ನು ತಿರುಚಬಹುದಾದ ವ್ಯವಸ್ಥಿತ ಆಲೋಚನಾ ಮಾದರಿ.",
                    tags: ["ಮನೋವಿಜ್ಞಾನ"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "ಭೌತಶಾಸ್ತ್ರದಲ್ಲಿ ವೇಗ ಎಂದರೇನು?",
                    backText: "ವಸ್ತುವಿನ ಚಲನೆಯ ದಿಕ್ಕಿನೊಂದಿಗೆ ಅದರ ಜವ.",
                    tags: ["ಭೌತಶಾಸ್ತ್ರ"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "ಕಂಪ್ಯೂಟರ್ ವಿಜ್ಞಾನದಲ್ಲಿ ರಿಕರ್ಷನ್ ಎಂದರೇನು?",
                    backText: "ಒಂದು ಫಂಕ್ಷನ್ ಅದೇ ಸಮಸ್ಯೆಯ ಸಣ್ಣ ರೂಪಗಳನ್ನು ಪರಿಹರಿಸಲು ತನ್ನನ್ನೇ ಕರೆದುಕೊಳ್ಳುವ ವಿಧಾನ.",
                    tags: ["ಕಂಪ್ಯೂಟರ್ ವಿಜ್ಞಾನ"]
                )
            ]
        ),
        FlashcardsUITestMarketingLocaleFixture(
            localizationCode: "ko",
            reviewCard: FlashcardsUITestFixtureCard(
                frontText: "경제학에서 기회비용이란 무엇인가요?",
                backText: """
                어떤 선택을 할 때 포기하는 최선의 대안이 지닌 가치입니다.

                시험 예시: 토요일에 유급 근무를 하는 대신 미시경제학 시험공부를 한다면, 받지 못한 임금은 기회비용의 일부입니다.
                """,
                tags: ["경제학"]
            ),
            conceptCards: [
                FlashcardsUITestFixtureCard(
                    frontText: "경제학에서 기회비용이란 무엇인가요?",
                    backText: "어떤 선택을 할 때 포기하는 최선의 대안이 지닌 가치입니다.",
                    tags: ["경제학"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "생물학에서 삼투란 무엇인가요?",
                    backText: "용질 농도가 낮은 쪽에서 높은 쪽으로 물이 막을 통과해 이동하는 현상입니다.",
                    tags: ["생물학"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "통계학에서 표준편차란 무엇인가요?",
                    backText: "값들이 평균 주위에 얼마나 퍼져 있는지 나타내는 척도입니다.",
                    tags: ["통계학"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "화학에서 촉매란 무엇인가요?",
                    backText: "자신은 소모되지 않으면서 화학 반응의 속도를 높이는 물질입니다.",
                    tags: ["화학"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "심리학에서 인지 편향이란 무엇인가요?",
                    backText: "판단과 의사결정을 왜곡할 수 있는 체계적인 사고 경향입니다.",
                    tags: ["심리학"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "물리학에서 속도란 무엇인가요?",
                    backText: "물체의 빠르기와 운동 방향을 함께 나타내는 양입니다.",
                    tags: ["물리학"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "컴퓨터 과학에서 재귀란 무엇인가요?",
                    backText: "함수가 같은 문제의 더 작은 형태에 대해 자기 자신을 호출하여 문제를 해결하는 방법입니다.",
                    tags: ["컴퓨터 과학"]
                )
            ]
        ),
        FlashcardsUITestMarketingLocaleFixture(
            localizationCode: "lt",
            reviewCard: FlashcardsUITestFixtureCard(
                frontText: "Kas ekonomikoje yra alternatyvieji kaštai?",
                backText: """
                Alternatyvieji kaštai yra geriausios atsisakytos alternatyvos vertė, kurios netenkate pasirinkę vieną variantą vietoj kito.

                Egzamino pavyzdys: jei šeštadienį praleidžiate ruošdamiesi mikroekonomikos egzaminui, užuot dirbę apmokamą pamainą, prarastas atlyginimas yra alternatyviųjų kaštų dalis.
                """,
                tags: ["ekonomika"]
            ),
            conceptCards: [
                FlashcardsUITestFixtureCard(
                    frontText: "Kas ekonomikoje yra alternatyvieji kaštai?",
                    backText: "Geriausios atsisakytos alternatyvos vertė, kurios netenkate pasirinkę vieną variantą vietoj kito.",
                    tags: ["ekonomika"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Kas biologijoje yra osmosas?",
                    backText: "Vandens judėjimas pro membraną iš mažesnės ištirpusios medžiagos koncentracijos į didesnę.",
                    tags: ["biologija"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Kas statistikoje yra standartinis nuokrypis?",
                    backText: "Matas, rodantis, kaip plačiai reikšmės išsidėsčiusios apie vidurkį.",
                    tags: ["statistika"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Kas chemijoje yra katalizatorius?",
                    backText: "Medžiaga, kuri pagreitina cheminę reakciją ir pati joje nesunaudojama.",
                    tags: ["chemija"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Kas psichologijoje yra kognityvinis iškraipymas?",
                    backText: "Sistemingas mąstymo modelis, galintis iškreipti vertinimą ir sprendimų priėmimą.",
                    tags: ["psichologija"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Kas fizikoje yra greitis?",
                    backText: "Kūno judėjimo sparta kartu su to judėjimo kryptimi.",
                    tags: ["fizika"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Kas informatikoje yra rekursija?",
                    backText: "Metodas, kai funkcija sprendžia uždavinį kviesdama pati save mažesnėms to paties uždavinio dalims.",
                    tags: ["informatika"]
                )
            ]
        ),
        FlashcardsUITestMarketingLocaleFixture(
            localizationCode: "lv",
            reviewCard: FlashcardsUITestFixtureCard(
                frontText: "Kas ekonomikā ir alternatīvās izmaksas?",
                backText: """
                Alternatīvās izmaksas ir labākās noraidītās izvēles vērtība, no kuras jūs atsakāties, izvēloties vienu iespēju citas vietā.

                Eksāmena piemērs: ja sestdienu pavadāt, gatavojoties mikroekonomikas eksāmenam, nevis strādājot apmaksātā maiņā, zaudētā alga ir daļa no alternatīvajām izmaksām.
                """,
                tags: ["ekonomika"]
            ),
            conceptCards: [
                FlashcardsUITestFixtureCard(
                    frontText: "Kas ekonomikā ir alternatīvās izmaksas?",
                    backText: "Labākās noraidītās izvēles vērtība, no kuras jūs atsakāties, izvēloties vienu iespēju citas vietā.",
                    tags: ["ekonomika"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Kas bioloģijā ir osmoze?",
                    backText: "Ūdens kustība caur membrānu no zemākas izšķīdušās vielas koncentrācijas uz augstāku.",
                    tags: ["bioloģija"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Kas statistikā ir standartnovirze?",
                    backText: "Rādītājs, kas parāda, cik izkliedētas ir vērtības ap vidējo lielumu.",
                    tags: ["statistika"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Kas ķīmijā ir katalizators?",
                    backText: "Viela, kas paātrina ķīmisko reakciju un pati tajā netiek patērēta.",
                    tags: ["ķīmija"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Kas psiholoģijā ir kognitīvā novirze?",
                    backText: "Sistemātisks domāšanas modelis, kas var izkropļot spriedumus un lēmumu pieņemšanu.",
                    tags: ["psiholoģija"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Kas fizikā ir ātrums?",
                    backText: "Ķermeņa kustības ātrums kopā ar šīs kustības virzienu.",
                    tags: ["fizika"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Kas datorzinātnē ir rekursija?",
                    backText: "Metode, kurā funkcija atrisina uzdevumu, izsaucot pati sevi mazākām tā paša uzdevuma daļām.",
                    tags: ["datorzinātne"]
                )
            ]
        ),
        FlashcardsUITestMarketingLocaleFixture(
            localizationCode: "ml",
            reviewCard: FlashcardsUITestFixtureCard(
                frontText: "സാമ്പത്തികശാസ്ത്രത്തിൽ അവസരച്ചെലവ് എന്താണ്?",
                backText: """
                ഒരു മാർഗം തിരഞ്ഞെടുക്കുമ്പോൾ ഉപേക്ഷിക്കുന്ന ഏറ്റവും മികച്ച ബദൽ മാർഗത്തിന്റെ മൂല്യം.

                പരീക്ഷയ്ക്കുള്ള ഉദാഹരണം: ശനിയാഴ്ച വേതനം ലഭിക്കുന്ന ജോലിക്ക് പോകുന്നതിനു പകരം സൂക്ഷ്മ സാമ്പത്തികശാസ്ത്ര പരീക്ഷയ്ക്കായി പഠിച്ചാൽ, നഷ്ടമായ വേതനം അവസരച്ചെലവിന്റെ ഭാഗമാണ്.
                """,
                tags: ["സാമ്പത്തികശാസ്ത്രം"]
            ),
            conceptCards: [
                FlashcardsUITestFixtureCard(
                    frontText: "സാമ്പത്തികശാസ്ത്രത്തിൽ അവസരച്ചെലവ് എന്താണ്?",
                    backText: "ഒരു മാർഗം തിരഞ്ഞെടുക്കുമ്പോൾ ഉപേക്ഷിക്കുന്ന ഏറ്റവും മികച്ച ബദൽ മാർഗത്തിന്റെ മൂല്യം.",
                    tags: ["സാമ്പത്തികശാസ്ത്രം"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "ജീവശാസ്ത്രത്തിൽ ഓസ്മോസിസ് എന്താണ്?",
                    backText: "ലീനപദാർഥത്തിന്റെ സാന്ദ്രത കുറഞ്ഞ ഭാഗത്തുനിന്ന് കൂടിയ ഭാഗത്തേക്ക് ഒരു സ്തരത്തിലൂടെ വെള്ളം നീങ്ങുന്നത്.",
                    tags: ["ജീവശാസ്ത്രം"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "സ്ഥിതിവിവരശാസ്ത്രത്തിൽ മാനക വ്യതിയാനം എന്താണ്?",
                    backText: "മൂല്യങ്ങൾ ശരാശരിക്ക് ചുറ്റും എത്രത്തോളം ചിതറിക്കിടക്കുന്നു എന്നതിന്റെ അളവ്.",
                    tags: ["സ്ഥിതിവിവരശാസ്ത്രം"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "രസതന്ത്രത്തിൽ ഉൽപ്രേരകം എന്താണ്?",
                    backText: "സ്വയം ഉപഭോഗിക്കപ്പെടാതെ രാസപ്രവർത്തനത്തിന്റെ വേഗം കൂട്ടുന്ന പദാർഥം.",
                    tags: ["രസതന്ത്രം"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "മനഃശാസ്ത്രത്തിൽ ബൗദ്ധിക പക്ഷപാതം എന്താണ്?",
                    backText: "വിലയിരുത്തലിനെയും തീരുമാനങ്ങളെയും വികലമാക്കാവുന്ന ചിട്ടയായ ചിന്താരീതി.",
                    tags: ["മനഃശാസ്ത്രം"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "ഭൗതികശാസ്ത്രത്തിൽ പ്രവേഗം എന്താണ്?",
                    backText: "ഒരു വസ്തുവിന്റെ ചലനദിശയും വേഗവും ചേർന്ന അളവ്.",
                    tags: ["ഭൗതികശാസ്ത്രം"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "കമ്പ്യൂട്ടർ ശാസ്ത്രത്തിൽ റിക്കർഷൻ എന്താണ്?",
                    backText: "ഒരു പ്രശ്നത്തിന്റെ ചെറിയ രൂപങ്ങൾ പരിഹരിക്കാൻ ഒരു ഫങ്ഷൻ സ്വയം വിളിക്കുന്ന രീതി.",
                    tags: ["കമ്പ്യൂട്ടർ ശാസ്ത്രം"]
                )
            ]
        ),
        FlashcardsUITestMarketingLocaleFixture(
            localizationCode: "mr",
            reviewCard: FlashcardsUITestFixtureCard(
                frontText: "अर्थशास्त्रात संधी खर्च म्हणजे काय?",
                backText: """
                एखादा पर्याय निवडताना सोडून दिलेल्या सर्वोत्तम पर्यायाचे मूल्य.

                परीक्षेतील उदाहरण: शनिवारी पगाराची पाळी करण्याऐवजी सूक्ष्म अर्थशास्त्राच्या परीक्षेचा अभ्यास केल्यास, बुडालेला पगार हा संधी खर्चाचा भाग असतो.
                """,
                tags: ["अर्थशास्त्र"]
            ),
            conceptCards: [
                FlashcardsUITestFixtureCard(
                    frontText: "अर्थशास्त्रात संधी खर्च म्हणजे काय?",
                    backText: "एखादा पर्याय निवडताना सोडून दिलेल्या सर्वोत्तम पर्यायाचे मूल्य.",
                    tags: ["अर्थशास्त्र"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "जीवशास्त्रात परासरण म्हणजे काय?",
                    backText: "पटलातून कमी द्राव्य सांद्रतेच्या भागाकडून अधिक द्राव्य सांद्रतेच्या भागाकडे पाण्याची हालचाल.",
                    tags: ["जीवशास्त्र"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "सांख्यिकीमध्ये प्रमाण विचलन म्हणजे काय?",
                    backText: "मूल्ये सरासरीभोवती किती विखुरलेली आहेत याचे मोजमाप.",
                    tags: ["सांख्यिकी"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "रसायनशास्त्रात उत्प्रेरक म्हणजे काय?",
                    backText: "स्वतः खर्च न होता रासायनिक अभिक्रियेचा वेग वाढवणारा पदार्थ.",
                    tags: ["रसायनशास्त्र"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "मानसशास्त्रात संज्ञानात्मक पूर्वग्रह म्हणजे काय?",
                    backText: "विचार करण्याची एक पद्धतशीर प्रवृत्ती, जी मूल्यमापन आणि निर्णयप्रक्रियेला विपरीत वळण देऊ शकते.",
                    tags: ["मानसशास्त्र"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "भौतिकशास्त्रात वेग म्हणजे काय?",
                    backText: "वस्तूच्या गतीची दिशा आणि तिची चाल यांचा एकत्रित निर्देश करणारी राशी.",
                    tags: ["भौतिकशास्त्र"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "संगणकशास्त्रात रिकर्शन म्हणजे काय?",
                    backText: "ज्यात एखादे फंक्शन त्याच समस्येची लहान रूपे सोडवण्यासाठी स्वतःलाच बोलावते अशी पद्धत.",
                    tags: ["संगणकशास्त्र"]
                )
            ]
        ),
        FlashcardsUITestMarketingLocaleFixture(
            localizationCode: "nb",
            reviewCard: FlashcardsUITestFixtureCard(
                frontText: "Hva er alternativkostnad i økonomi?",
                backText: """
                Verdien av det beste alternativet du gir avkall på når du velger en annen mulighet.

                Eksamenseksempel: Hvis du bruker lørdagen på å lese til en eksamen i mikroøkonomi i stedet for å jobbe en betalt vakt, er den tapte lønnen en del av alternativkostnaden.
                """,
                tags: ["økonomi"]
            ),
            conceptCards: [
                FlashcardsUITestFixtureCard(
                    frontText: "Hva er alternativkostnad i økonomi?",
                    backText: "Verdien av det beste alternativet du gir avkall på når du velger en annen mulighet.",
                    tags: ["økonomi"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Hva er osmose i biologi?",
                    backText: "Vannets bevegelse gjennom en membran fra lavere til høyere konsentrasjon av oppløste stoffer.",
                    tags: ["biologi"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Hva er standardavvik i statistikk?",
                    backText: "Et mål på hvor spredt verdiene ligger rundt gjennomsnittet.",
                    tags: ["statistikk"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Hva er en katalysator i kjemi?",
                    backText: "Et stoff som øker farten på en kjemisk reaksjon uten selv å bli brukt opp.",
                    tags: ["kjemi"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Hva er en kognitiv skjevhet i psykologi?",
                    backText: "Et systematisk tankemønster som kan forvrenge vurderinger og beslutninger.",
                    tags: ["psykologi"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Hva er hastighet som vektor i fysikk?",
                    backText: "Farten til et objekt sammen med retningen det beveger seg i.",
                    tags: ["fysikk"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Hva er rekursjon i informatikk?",
                    backText: "En metode der en funksjon løser et problem ved å kalle seg selv på mindre utgaver av det samme problemet.",
                    tags: ["informatikk"]
                )
            ]
        ),
        FlashcardsUITestMarketingLocaleFixture(
            localizationCode: "nl",
            reviewCard: FlashcardsUITestFixtureCard(
                frontText: "Wat zijn opportuniteitskosten in de economie?",
                backText: """
                De waarde van het beste alternatief dat je opgeeft wanneer je voor een andere optie kiest.

                Examenvoorbeeld: als je zaterdag voor een tentamen micro-economie studeert in plaats van een betaalde dienst te werken, maakt het misgelopen loon deel uit van de opportuniteitskosten.
                """,
                tags: ["economie"]
            ),
            conceptCards: [
                FlashcardsUITestFixtureCard(
                    frontText: "Wat zijn opportuniteitskosten in de economie?",
                    backText: "De waarde van het beste alternatief dat je opgeeft wanneer je voor een andere optie kiest.",
                    tags: ["economie"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Wat is osmose in de biologie?",
                    backText: "De verplaatsing van water door een membraan van een lagere naar een hogere concentratie opgeloste stoffen.",
                    tags: ["biologie"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Wat is standaardafwijking in de statistiek?",
                    backText: "Een maat voor de spreiding van waarden rond het gemiddelde.",
                    tags: ["statistiek"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Wat is een katalysator in de scheikunde?",
                    backText: "Een stof die een chemische reactie versnelt zonder daarbij te worden verbruikt.",
                    tags: ["scheikunde"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Wat is een cognitieve vertekening in de psychologie?",
                    backText: "Een systematisch denkpatroon dat het oordeel en de besluitvorming kan vertekenen.",
                    tags: ["psychologie"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Wat is de snelheidsvector in de natuurkunde?",
                    backText: "De snelheid van een voorwerp samen met de richting waarin het beweegt.",
                    tags: ["natuurkunde"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Wat is recursie in de informatica?",
                    backText: "Een methode waarbij een functie een probleem oplost door zichzelf aan te roepen voor kleinere versies van hetzelfde probleem.",
                    tags: ["informatica"]
                )
            ]
        ),
        FlashcardsUITestMarketingLocaleFixture(
            localizationCode: "pa",
            reviewCard: FlashcardsUITestFixtureCard(
                frontText: "ਅਰਥਸ਼ਾਸਤਰ ਵਿੱਚ ਅਵਸਰ ਲਾਗਤ ਕੀ ਹੈ?",
                backText: """
                ਇੱਕ ਵਿਕਲਪ ਚੁਣਨ ਵੇਲੇ ਛੱਡੇ ਗਏ ਸਭ ਤੋਂ ਵਧੀਆ ਬਦਲਵੇਂ ਵਿਕਲਪ ਦਾ ਮੁੱਲ।

                ਇਮਤਿਹਾਨ ਦੀ ਉਦਾਹਰਨ: ਜੇ ਤੁਸੀਂ ਸ਼ਨੀਵਾਰ ਨੂੰ ਤਨਖ਼ਾਹ ਵਾਲੀ ਸ਼ਿਫ਼ਟ ਕਰਨ ਦੀ ਬਜਾਏ ਸੂਖਮ ਅਰਥਸ਼ਾਸਤਰ ਦੇ ਇਮਤਿਹਾਨ ਲਈ ਪੜ੍ਹਦੇ ਹੋ, ਤਾਂ ਗੁਆਈ ਤਨਖ਼ਾਹ ਅਵਸਰ ਲਾਗਤ ਦਾ ਹਿੱਸਾ ਹੈ।
                """,
                tags: ["ਅਰਥਸ਼ਾਸਤਰ"]
            ),
            conceptCards: [
                FlashcardsUITestFixtureCard(
                    frontText: "ਅਰਥਸ਼ਾਸਤਰ ਵਿੱਚ ਅਵਸਰ ਲਾਗਤ ਕੀ ਹੈ?",
                    backText: "ਇੱਕ ਵਿਕਲਪ ਚੁਣਨ ਵੇਲੇ ਛੱਡੇ ਗਏ ਸਭ ਤੋਂ ਵਧੀਆ ਬਦਲਵੇਂ ਵਿਕਲਪ ਦਾ ਮੁੱਲ।",
                    tags: ["ਅਰਥਸ਼ਾਸਤਰ"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "ਜੀਵ ਵਿਗਿਆਨ ਵਿੱਚ ਪਰਾਸਰਣ ਕੀ ਹੈ?",
                    backText: "ਝਿੱਲੀ ਰਾਹੀਂ ਪਾਣੀ ਦਾ ਘੱਟ ਘੁਲਣਸ਼ੀਲ ਪਦਾਰਥ ਦੀ ਸੰਘਣਤਾ ਵਾਲੇ ਖੇਤਰ ਤੋਂ ਵੱਧ ਸੰਘਣਤਾ ਵਾਲੇ ਖੇਤਰ ਵੱਲ ਜਾਣਾ।",
                    tags: ["ਜੀਵ ਵਿਗਿਆਨ"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "ਅੰਕੜਾ ਵਿਗਿਆਨ ਵਿੱਚ ਮਿਆਰੀ ਵਿਛਲਨ ਕੀ ਹੈ?",
                    backText: "ਮੁੱਲ ਔਸਤ ਦੇ ਆਲੇ-ਦੁਆਲੇ ਕਿੰਨੇ ਖਿੰਡੇ ਹੋਏ ਹਨ, ਇਸ ਦਾ ਮਾਪ।",
                    tags: ["ਅੰਕੜਾ ਵਿਗਿਆਨ"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "ਰਸਾਇਣ ਵਿਗਿਆਨ ਵਿੱਚ ਉਤਪ੍ਰੇਰਕ ਕੀ ਹੈ?",
                    backText: "ਅਜਿਹਾ ਪਦਾਰਥ ਜੋ ਆਪ ਖ਼ਰਚ ਹੋਏ ਬਿਨਾਂ ਰਸਾਇਣਕ ਕਿਰਿਆ ਨੂੰ ਤੇਜ਼ ਕਰਦਾ ਹੈ।",
                    tags: ["ਰਸਾਇਣ ਵਿਗਿਆਨ"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "ਮਨੋਵਿਗਿਆਨ ਵਿੱਚ ਬੋਧਾਤਮਕ ਪੱਖਪਾਤ ਕੀ ਹੈ?",
                    backText: "ਸੋਚਣ ਦਾ ਇੱਕ ਨਿਯਮਤ ਢੰਗ ਜੋ ਪਰਖ ਅਤੇ ਫ਼ੈਸਲੇ ਲੈਣ ਨੂੰ ਵਿਗਾੜ ਸਕਦਾ ਹੈ।",
                    tags: ["ਮਨੋਵਿਗਿਆਨ"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "ਭੌਤਿਕ ਵਿਗਿਆਨ ਵਿੱਚ ਵੇਗ ਕੀ ਹੈ?",
                    backText: "ਕਿਸੇ ਵਸਤੂ ਦੀ ਚਾਲ ਅਤੇ ਉਸ ਦੀ ਗਤੀ ਦੀ ਦਿਸ਼ਾ ਦਾ ਸਾਂਝਾ ਮਾਪ।",
                    tags: ["ਭੌਤਿਕ ਵਿਗਿਆਨ"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "ਕੰਪਿਊਟਰ ਵਿਗਿਆਨ ਵਿੱਚ ਰਿਕਰਸ਼ਨ ਕੀ ਹੈ?",
                    backText: "ਅਜਿਹੀ ਵਿਧੀ ਜਿਸ ਵਿੱਚ ਇੱਕ ਫੰਕਸ਼ਨ ਉਸੇ ਸਮੱਸਿਆ ਦੇ ਛੋਟੇ ਰੂਪ ਹੱਲ ਕਰਨ ਲਈ ਆਪਣੇ ਆਪ ਨੂੰ ਸੱਦਦਾ ਹੈ।",
                    tags: ["ਕੰਪਿਊਟਰ ਵਿਗਿਆਨ"]
                )
            ]
        ),
        FlashcardsUITestMarketingLocaleFixture(
            localizationCode: "pl",
            reviewCard: FlashcardsUITestFixtureCard(
                frontText: "Czym jest koszt alternatywny w ekonomii?",
                backText: """
                Wartością najlepszej alternatywy, z której rezygnujesz, wybierając inną możliwość.

                Przykład egzaminacyjny: jeśli w sobotę uczysz się do egzaminu z mikroekonomii zamiast pracować na płatnej zmianie, utracone wynagrodzenie jest częścią kosztu alternatywnego.
                """,
                tags: ["ekonomia"]
            ),
            conceptCards: [
                FlashcardsUITestFixtureCard(
                    frontText: "Czym jest koszt alternatywny w ekonomii?",
                    backText: "Wartością najlepszej alternatywy, z której rezygnujesz, wybierając inną możliwość.",
                    tags: ["ekonomia"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Czym jest osmoza w biologii?",
                    backText: "Przemieszczaniem się wody przez błonę z obszaru o niższym stężeniu substancji rozpuszczonych do obszaru o wyższym stężeniu.",
                    tags: ["biologia"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Czym jest odchylenie standardowe w statystyce?",
                    backText: "Miarą rozproszenia wartości wokół średniej.",
                    tags: ["statystyka"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Czym jest katalizator w chemii?",
                    backText: "Substancją, która przyspiesza reakcję chemiczną, nie zużywając się w jej trakcie.",
                    tags: ["chemia"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Czym jest błąd poznawczy w psychologii?",
                    backText: "Systematycznym wzorcem myślenia, który może zniekształcać osąd i podejmowanie decyzji.",
                    tags: ["psychologia"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Czym jest prędkość wektorowa w fizyce?",
                    backText: "Wielkością opisującą szybkość ruchu obiektu wraz z jego kierunkiem i zwrotem.",
                    tags: ["fizyka"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Czym jest rekurencja w informatyce?",
                    backText: "Metodą, w której funkcja rozwiązuje problem, wywołując samą siebie dla mniejszych wersji tego samego problemu.",
                    tags: ["informatyka"]
                )
            ]
        ),
        FlashcardsUITestMarketingLocaleFixture(
            localizationCode: "ro",
            reviewCard: FlashcardsUITestFixtureCard(
                frontText: "În economie, ce este costul de oportunitate?",
                backText: """
                Valoarea celei mai bune alternative la care renunți când alegi o altă opțiune.

                Exemplu de examen: dacă îți petreci sâmbăta învățând pentru un examen de microeconomie în loc să lucrezi într-o tură plătită, salariul pierdut face parte din costul de oportunitate.
                """,
                tags: ["economie"]
            ),
            conceptCards: [
                FlashcardsUITestFixtureCard(
                    frontText: "În economie, ce este costul de oportunitate?",
                    backText: "Valoarea celei mai bune alternative la care renunți când alegi o altă opțiune.",
                    tags: ["economie"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "În biologie, ce este osmoza?",
                    backText: "Deplasarea apei printr-o membrană de la o concentrație mai mică de substanțe dizolvate la una mai mare.",
                    tags: ["biologie"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "În statistică, ce este abaterea standard?",
                    backText: "O măsură a gradului de dispersie a valorilor în jurul mediei.",
                    tags: ["statistică"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "În chimie, ce este un catalizator?",
                    backText: "O substanță care accelerează o reacție chimică fără a fi consumată.",
                    tags: ["chimie"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "În psihologie, ce este o eroare cognitivă?",
                    backText: "Un tipar sistematic de gândire care poate distorsiona judecata și luarea deciziilor.",
                    tags: ["psihologie"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "În fizică, ce este viteza vectorială?",
                    backText: "O mărime care descrie cât de repede se mișcă un obiect, împreună cu direcția și sensul mișcării.",
                    tags: ["fizică"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "În informatică, ce este recursivitatea?",
                    backText: "O metodă prin care o funcție rezolvă o problemă apelându-se pe sine pentru versiuni mai mici ale aceleiași probleme.",
                    tags: ["informatică"]
                )
            ]
        ),
        FlashcardsUITestMarketingLocaleFixture(
            localizationCode: "sk",
            reviewCard: FlashcardsUITestFixtureCard(
                frontText: "Čo sú v ekonómii náklady obetovanej príležitosti?",
                backText: """
                Hodnota najlepšej alternatívy, ktorej sa vzdáte, keď si vyberiete inú možnosť.

                Príklad na skúšku: ak v sobotu namiesto platenej zmeny študujete na skúšku z mikroekonómie, ušlá mzda je súčasťou nákladov obetovanej príležitosti.
                """,
                tags: ["ekonómia"]
            ),
            conceptCards: [
                FlashcardsUITestFixtureCard(
                    frontText: "Čo sú v ekonómii náklady obetovanej príležitosti?",
                    backText: "Hodnota najlepšej alternatívy, ktorej sa vzdáte, keď si vyberiete inú možnosť.",
                    tags: ["ekonómia"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Čo je v biológii osmóza?",
                    backText: "Pohyb vody cez membránu z oblasti s nižšou koncentráciou rozpustených látok do oblasti s vyššou koncentráciou.",
                    tags: ["biológia"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Čo je v štatistike smerodajná odchýlka?",
                    backText: "Miera toho, ako sú hodnoty rozptýlené okolo priemeru.",
                    tags: ["štatistika"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Čo je v chémii katalyzátor?",
                    backText: "Látka, ktorá urýchľuje chemickú reakciu bez toho, aby sa pri nej spotrebovala.",
                    tags: ["chémia"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Čo je v psychológii kognitívne skreslenie?",
                    backText: "Systematický vzorec myslenia, ktorý môže skresľovať úsudok a rozhodovanie.",
                    tags: ["psychológia"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Čo je vo fyzike vektor rýchlosti?",
                    backText: "Veličina, ktorá vyjadruje rýchlosť pohybu telesa aj jeho smer.",
                    tags: ["fyzika"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Čo je v informatike rekurzia?",
                    backText: "Metóda, pri ktorej funkcia rieši problém volaním samej seba pre menšie verzie toho istého problému.",
                    tags: ["informatika"]
                )
            ]
        ),
        FlashcardsUITestMarketingLocaleFixture(
            localizationCode: "sl",
            reviewCard: FlashcardsUITestFixtureCard(
                frontText: "Kaj so oportunitetni stroški v ekonomiji?",
                backText: """
                Vrednost najboljše alternative, ki se ji odpoveste, ko izberete drugo možnost.

                Primer za izpit: če soboto namesto plačanemu delu namenite učenju za izpit iz mikroekonomije, je izgubljeni zaslužek del oportunitetnih stroškov.
                """,
                tags: ["ekonomija"]
            ),
            conceptCards: [
                FlashcardsUITestFixtureCard(
                    frontText: "Kaj so oportunitetni stroški v ekonomiji?",
                    backText: "Vrednost najboljše alternative, ki se ji odpoveste, ko izberete drugo možnost.",
                    tags: ["ekonomija"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Kaj je osmoza v biologiji?",
                    backText: "Prehajanje vode skozi membrano iz območja z nižjo koncentracijo raztopljenih snovi v območje z višjo koncentracijo.",
                    tags: ["biologija"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Kaj je standardni odklon v statistiki?",
                    backText: "Mera razpršenosti vrednosti okoli povprečja.",
                    tags: ["statistika"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Kaj je katalizator v kemiji?",
                    backText: "Snov, ki pospeši kemijsko reakcijo, ne da bi se pri tem porabljala.",
                    tags: ["kemija"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Kaj je kognitivna pristranskost v psihologiji?",
                    backText: "Sistematičen vzorec razmišljanja, ki lahko izkrivlja presojo in odločanje.",
                    tags: ["psihologija"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Kaj je vektor hitrosti v fiziki?",
                    backText: "Količina, ki opisuje hitrost gibanja telesa in njegovo smer.",
                    tags: ["fizika"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Kaj je rekurzija v računalništvu?",
                    backText: "Metoda, pri kateri funkcija rešuje problem tako, da kliče samo sebe za manjše različice istega problema.",
                    tags: ["računalništvo"]
                )
            ]
        ),
        FlashcardsUITestMarketingLocaleFixture(
            localizationCode: "sv",
            reviewCard: FlashcardsUITestFixtureCard(
                frontText: "Vad är alternativkostnad inom ekonomi?",
                backText: """
                Värdet av det bästa alternativet du avstår från när du väljer ett annat alternativ.

                Exempel inför tentamen: Om du ägnar lördagen åt att plugga till en tenta i mikroekonomi i stället för att arbeta ett betalt pass, är den förlorade lönen en del av alternativkostnaden.
                """,
                tags: ["ekonomi"]
            ),
            conceptCards: [
                FlashcardsUITestFixtureCard(
                    frontText: "Vad är alternativkostnad inom ekonomi?",
                    backText: "Värdet av det bästa alternativet du avstår från när du väljer ett annat alternativ.",
                    tags: ["ekonomi"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Vad är osmos inom biologi?",
                    backText: "Vattnets rörelse genom ett membran från lägre till högre koncentration av lösta ämnen.",
                    tags: ["biologi"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Vad är standardavvikelse inom statistik?",
                    backText: "Ett mått på hur utspridda värdena är kring medelvärdet.",
                    tags: ["statistik"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Vad är en katalysator inom kemi?",
                    backText: "Ett ämne som påskyndar en kemisk reaktion utan att självt förbrukas.",
                    tags: ["kemi"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Vad är en kognitiv snedvridning inom psykologi?",
                    backText: "Ett systematiskt tankemönster som kan förvränga omdömet och beslutsfattandet.",
                    tags: ["psykologi"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Vad är hastighet som vektor inom fysik?",
                    backText: "Ett föremåls fart tillsammans med rörelsens riktning.",
                    tags: ["fysik"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Vad är rekursion inom datavetenskap?",
                    backText: "En metod där en funktion löser ett problem genom att anropa sig själv för mindre versioner av samma problem.",
                    tags: ["datavetenskap"]
                )
            ]
        ),
        FlashcardsUITestMarketingLocaleFixture(
            localizationCode: "sw",
            reviewCard: FlashcardsUITestFixtureCard(
                frontText: "Katika uchumi, gharama ya fursa ni nini?",
                backText: """
                Gharama ya fursa ni thamani ya chaguo bora unaloachana nalo unapochagua chaguo moja badala ya lingine.

                Mfano wa mtihani: ukitumia Jumamosi kusomea mtihani wa uchumi mdogo badala ya kufanya zamu inayolipwa, mshahara uliopotea ni sehemu ya gharama ya fursa.
                """,
                tags: ["uchumi"]
            ),
            conceptCards: [
                FlashcardsUITestFixtureCard(
                    frontText: "Katika uchumi, gharama ya fursa ni nini?",
                    backText: "Thamani ya chaguo bora unaloachana nalo unapochagua chaguo moja badala ya lingine.",
                    tags: ["uchumi"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Katika biolojia, osmosisi ni nini?",
                    backText: "Msogeo wa maji kupitia utando kutoka mkusanyiko mdogo wa kiyeyushwa kwenda mkusanyiko mkubwa.",
                    tags: ["biolojia"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Katika takwimu, mkengeuko wa kawaida ni nini?",
                    backText: "Kipimo cha jinsi thamani zilivyotawanyika kuzunguka wastani.",
                    tags: ["takwimu"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Katika kemia, kichocheo ni nini?",
                    backText: "Kitu kinachoharakisha mmenyuko wa kemikali bila chenyewe kutumika ndani yake.",
                    tags: ["kemia"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Katika saikolojia, upendeleo wa kifikra ni nini?",
                    backText: "Mtindo wa kufikiri wa kimfumo unaoweza kupotosha tathmini na uamuzi.",
                    tags: ["saikolojia"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Katika fizikia, kasi yenye mwelekeo ni nini?",
                    backText: "Mwendo wa kitu pamoja na mwelekeo wa mwendo huo.",
                    tags: ["fizikia"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Katika sayansi ya kompyuta, urudiaji ni nini?",
                    backText: "Mbinu ambapo kazi hutatua tatizo kwa kujiita yenyewe kwa matoleo madogo ya tatizo hilo.",
                    tags: ["sayansi ya kompyuta"]
                )
            ]
        ),
        FlashcardsUITestMarketingLocaleFixture(
            localizationCode: "ta",
            reviewCard: FlashcardsUITestFixtureCard(
                frontText: "பொருளியலில் வாய்ப்புச் செலவு என்றால் என்ன?",
                backText: """
                ஒரு விருப்பத்தைத் தேர்ந்தெடுக்கும்போது கைவிடும் சிறந்த மாற்று விருப்பத்தின் மதிப்பு.

                தேர்வுக்கான எடுத்துக்காட்டு: சனிக்கிழமை ஊதியம் தரும் வேலைக்குச் செல்வதற்குப் பதிலாக நுண்பொருளியல் தேர்வுக்குப் படித்தால், இழந்த ஊதியம் வாய்ப்புச் செலவின் ஒரு பகுதியாகும்.
                """,
                tags: ["பொருளியல்"]
            ),
            conceptCards: [
                FlashcardsUITestFixtureCard(
                    frontText: "பொருளியலில் வாய்ப்புச் செலவு என்றால் என்ன?",
                    backText: "ஒரு விருப்பத்தைத் தேர்ந்தெடுக்கும்போது கைவிடும் சிறந்த மாற்று விருப்பத்தின் மதிப்பு.",
                    tags: ["பொருளியல்"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "உயிரியலில் சவ்வூடுபரவல் என்றால் என்ன?",
                    backText: "கரைபொருளின் செறிவு குறைந்த பகுதியிலிருந்து அதிகமான பகுதிக்கு ஒரு சவ்வின் வழியாக நீர் நகர்வது.",
                    tags: ["உயிரியல்"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "புள்ளியியலில் திட்ட விலக்கம் என்றால் என்ன?",
                    backText: "மதிப்புகள் சராசரியைச் சுற்றி எவ்வளவு பரவியுள்ளன என்பதற்கான அளவீடு.",
                    tags: ["புள்ளியியல்"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "வேதியியலில் வினையூக்கி என்றால் என்ன?",
                    backText: "தான் செலவாகாமல் ஒரு வேதிவினையின் வேகத்தை அதிகரிக்கும் பொருள்.",
                    tags: ["வேதியியல்"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "உளவியலில் அறிவுசார் சார்பு என்றால் என்ன?",
                    backText: "மதிப்பீட்டையும் முடிவெடுப்பதையும் திரிக்கக்கூடிய முறையான சிந்தனைப் பாங்கு.",
                    tags: ["உளவியல்"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "இயற்பியலில் திசைவேகம் என்றால் என்ன?",
                    backText: "ஒரு பொருளின் இயக்கத் திசையுடன் கூடிய அதன் வேகம்.",
                    tags: ["இயற்பியல்"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "கணினி அறிவியலில் தற்சுழற்சி என்றால் என்ன?",
                    backText: "ஒரு சிக்கலின் சிறிய வடிவங்களைத் தீர்க்க ஒரு செயல்கூறு தன்னைத்தானே அழைக்கும் முறை.",
                    tags: ["கணினி அறிவியல்"]
                )
            ]
        ),
        FlashcardsUITestMarketingLocaleFixture(
            localizationCode: "te",
            reviewCard: FlashcardsUITestFixtureCard(
                frontText: "ఆర్థికశాస్త్రంలో అవకాశ వ్యయం అంటే ఏమిటి?",
                backText: """
                ఒక ఎంపికను చేసుకున్నప్పుడు వదులుకునే ఉత్తమ ప్రత్యామ్నాయం విలువ.

                పరీక్ష ఉదాహరణ: శనివారం జీతం వచ్చే షిఫ్ట్‌లో పని చేయకుండా సూక్ష్మ ఆర్థికశాస్త్ర పరీక్ష కోసం చదివితే, కోల్పోయిన జీతం అవకాశ వ్యయంలో భాగం.
                """,
                tags: ["ఆర్థికశాస్త్రం"]
            ),
            conceptCards: [
                FlashcardsUITestFixtureCard(
                    frontText: "ఆర్థికశాస్త్రంలో అవకాశ వ్యయం అంటే ఏమిటి?",
                    backText: "ఒక ఎంపికను చేసుకున్నప్పుడు వదులుకునే ఉత్తమ ప్రత్యామ్నాయం విలువ.",
                    tags: ["ఆర్థికశాస్త్రం"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "జీవశాస్త్రంలో ద్రవాభిసరణం అంటే ఏమిటి?",
                    backText: "ద్రావిత పదార్థ సాంద్రత తక్కువగా ఉన్న ప్రాంతం నుంచి ఎక్కువగా ఉన్న ప్రాంతానికి పొర ద్వారా నీరు కదలడం.",
                    tags: ["జీవశాస్త్రం"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "గణాంకశాస్త్రంలో ప్రామాణిక విచలనం అంటే ఏమిటి?",
                    backText: "విలువలు సగటు చుట్టూ ఎంతగా విస్తరించి ఉన్నాయో తెలిపే కొలత.",
                    tags: ["గణాంకశాస్త్రం"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "రసాయనశాస్త్రంలో ఉత్ప్రేరకం అంటే ఏమిటి?",
                    backText: "తాను ఖర్చు కాకుండా రసాయన చర్య వేగాన్ని పెంచే పదార్థం.",
                    tags: ["రసాయనశాస్త్రం"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "మనోవిజ్ఞానశాస్త్రంలో అభిజ్ఞా పక్షపాతం అంటే ఏమిటి?",
                    backText: "అంచనాలను, నిర్ణయాలను వక్రీకరించగల క్రమబద్ధమైన ఆలోచనా ధోరణి.",
                    tags: ["మనోవిజ్ఞానశాస్త్రం"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "భౌతికశాస్త్రంలో వేగం అంటే ఏమిటి?",
                    backText: "వస్తువు గమన దిశతో కూడిన దాని వడి.",
                    tags: ["భౌతికశాస్త్రం"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "కంప్యూటర్ శాస్త్రంలో రికర్షన్ అంటే ఏమిటి?",
                    backText: "ఒక ఫంక్షన్ అదే సమస్యలోని చిన్న రూపాలను పరిష్కరించడానికి తనను తానే పిలుచుకునే పద్ధతి.",
                    tags: ["కంప్యూటర్ శాస్త్రం"]
                )
            ]
        ),
        FlashcardsUITestMarketingLocaleFixture(
            localizationCode: "th",
            reviewCard: FlashcardsUITestFixtureCard(
                frontText: "ในวิชาเศรษฐศาสตร์ ต้นทุนค่าเสียโอกาสคืออะไร?",
                backText: """
                มูลค่าของทางเลือกที่ดีที่สุดที่คุณสละไปเมื่อเลือกอีกทางหนึ่ง

                ตัวอย่างข้อสอบ: หากคุณใช้วันเสาร์อ่านหนังสือสอบเศรษฐศาสตร์จุลภาคแทนการทำงานเป็นกะที่ได้รับค่าจ้าง ค่าจ้างที่เสียไปเป็นส่วนหนึ่งของต้นทุนค่าเสียโอกาส
                """,
                tags: ["เศรษฐศาสตร์"]
            ),
            conceptCards: [
                FlashcardsUITestFixtureCard(
                    frontText: "ในวิชาเศรษฐศาสตร์ ต้นทุนค่าเสียโอกาสคืออะไร?",
                    backText: "มูลค่าของทางเลือกที่ดีที่สุดที่คุณสละไปเมื่อเลือกอีกทางหนึ่ง",
                    tags: ["เศรษฐศาสตร์"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "ในวิชาชีววิทยา ออสโมซิสคืออะไร?",
                    backText: "การเคลื่อนที่ของน้ำผ่านเยื่อจากบริเวณที่มีความเข้มข้นของตัวถูกละลายต่ำไปยังบริเวณที่มีความเข้มข้นสูง",
                    tags: ["ชีววิทยา"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "ในวิชาสถิติ ส่วนเบี่ยงเบนมาตรฐานคืออะไร?",
                    backText: "ค่าที่วัดว่าข้อมูลกระจายตัวรอบค่าเฉลี่ยมากเพียงใด",
                    tags: ["สถิติ"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "ในวิชาเคมี ตัวเร่งปฏิกิริยาคืออะไร?",
                    backText: "สารที่เพิ่มอัตราการเกิดปฏิกิริยาเคมีโดยไม่ถูกใช้หมดไปในปฏิกิริยา",
                    tags: ["เคมี"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "ในวิชาจิตวิทยา อคติทางความคิดคืออะไร?",
                    backText: "รูปแบบการคิดอย่างเป็นระบบที่อาจบิดเบือนการใช้วิจารณญาณและการตัดสินใจ",
                    tags: ["จิตวิทยา"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "ในวิชาฟิสิกส์ ความเร็วคืออะไร?",
                    backText: "อัตราเร็วของวัตถุพร้อมทิศทางการเคลื่อนที่",
                    tags: ["ฟิสิกส์"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "ในวิชาวิทยาการคอมพิวเตอร์ การเรียกซ้ำคืออะไร?",
                    backText: "วิธีที่ฟังก์ชันแก้ปัญหาโดยเรียกตัวเองเพื่อแก้ปัญหาแบบเดียวกันที่มีขนาดเล็กลง",
                    tags: ["วิทยาการคอมพิวเตอร์"]
                )
            ]
        ),
        FlashcardsUITestMarketingLocaleFixture(
            localizationCode: "tr",
            reviewCard: FlashcardsUITestFixtureCard(
                frontText: "Ekonomide fırsat maliyeti nedir?",
                backText: """
                Bir seçeneği tercih ettiğinde vazgeçtiğin en iyi alternatifin değeridir.

                Sınav örneği: Cumartesiyi ücretli bir vardiyada çalışmak yerine mikroekonomi sınavına hazırlanarak geçirirsen, kazanamadığın ücret fırsat maliyetinin bir parçasıdır.
                """,
                tags: ["ekonomi"]
            ),
            conceptCards: [
                FlashcardsUITestFixtureCard(
                    frontText: "Ekonomide fırsat maliyeti nedir?",
                    backText: "Bir seçeneği tercih ettiğinde vazgeçtiğin en iyi alternatifin değeridir.",
                    tags: ["ekonomi"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Biyolojide ozmoz nedir?",
                    backText: "Suyun bir zardan, çözünen madde derişiminin düşük olduğu bölgeden yüksek olduğu bölgeye geçmesidir.",
                    tags: ["biyoloji"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "İstatistikte standart sapma nedir?",
                    backText: "Değerlerin ortalama etrafında ne kadar yayıldığını gösteren bir ölçüdür.",
                    tags: ["istatistik"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Kimyada katalizör nedir?",
                    backText: "Kendisi tüketilmeden kimyasal bir tepkimeyi hızlandıran maddedir.",
                    tags: ["kimya"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Psikolojide bilişsel yanlılık nedir?",
                    backText: "Yargıları ve karar vermeyi çarpıtabilecek sistematik bir düşünme örüntüsüdür.",
                    tags: ["psikoloji"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Fizikte hız nedir?",
                    backText: "Bir cismin süratini ve hareket yönünü birlikte ifade eden büyüklüktür.",
                    tags: ["fizik"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Bilgisayar biliminde özyineleme nedir?",
                    backText: "Bir fonksiyonun, aynı problemin daha küçük biçimleri için kendisini çağırarak çözüm üretmesidir.",
                    tags: ["bilgisayar bilimi"]
                )
            ]
        ),
        FlashcardsUITestMarketingLocaleFixture(
            localizationCode: "uk",
            reviewCard: FlashcardsUITestFixtureCard(
                frontText: "Що таке альтернативна вартість в економіці?",
                backText: """
                Цінність найкращого варіанта, від якого ви відмовляєтеся, обираючи інший.

                Приклад для іспиту: якщо ви витрачаєте суботу на підготовку до іспиту з мікроекономіки замість оплачуваної зміни, втрачена зарплата є частиною альтернативної вартості.
                """,
                tags: ["економіка"]
            ),
            conceptCards: [
                FlashcardsUITestFixtureCard(
                    frontText: "Що таке альтернативна вартість в економіці?",
                    backText: "Цінність найкращого варіанта, від якого ви відмовляєтеся, обираючи інший.",
                    tags: ["економіка"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Що таке осмос у біології?",
                    backText: "Рух води крізь мембрану з ділянки з нижчою концентрацією розчинених речовин до ділянки з вищою концентрацією.",
                    tags: ["біологія"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Що таке стандартне відхилення у статистиці?",
                    backText: "Міра того, наскільки значення розкидані навколо середнього.",
                    tags: ["статистика"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Що таке каталізатор у хімії?",
                    backText: "Речовина, яка прискорює хімічну реакцію і при цьому не витрачається.",
                    tags: ["хімія"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Що таке когнітивне упередження у психології?",
                    backText: "Систематичний шаблон мислення, який може спотворювати судження та ухвалення рішень.",
                    tags: ["психологія"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Що таке векторна швидкість у фізиці?",
                    backText: "Величина, що описує швидкість руху об’єкта разом із напрямком його руху.",
                    tags: ["фізика"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Що таке рекурсія в інформатиці?",
                    backText: "Метод, за якого функція розв’язує задачу, викликаючи саму себе для менших версій тієї самої задачі.",
                    tags: ["інформатика"]
                )
            ]
        ),
        FlashcardsUITestMarketingLocaleFixture(
            localizationCode: "ur",
            reviewCard: FlashcardsUITestFixtureCard(
                frontText: "معاشیات میں موقعی لاگت کیا ہے؟",
                backText: """
                وہ بہترین متبادل جسے آپ کسی دوسرے انتخاب کی خاطر چھوڑ دیتے ہیں، اس کی قدر۔

                امتحان کی مثال: اگر آپ ہفتے کے دن اجرت والی شفٹ میں کام کرنے کے بجائے خرد معاشیات کے امتحان کی تیاری کریں تو چھوٹ جانے والی اجرت موقعی لاگت کا حصہ ہے۔
                """,
                tags: ["معاشیات"]
            ),
            conceptCards: [
                FlashcardsUITestFixtureCard(
                    frontText: "معاشیات میں موقعی لاگت کیا ہے؟",
                    backText: "وہ بہترین متبادل جسے آپ کسی دوسرے انتخاب کی خاطر چھوڑ دیتے ہیں، اس کی قدر۔",
                    tags: ["معاشیات"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "حیاتیات میں اسموسس کیا ہے؟",
                    backText: "جھلی کے پار پانی کی حرکت، حل شدہ مادے کے کم ارتکاز والے حصے سے زیادہ ارتکاز والے حصے کی طرف۔",
                    tags: ["حیاتیات"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "شماریات میں معیاری انحراف کیا ہے؟",
                    backText: "اس بات کی پیمائش کہ قدریں اوسط کے گرد کتنی پھیلی ہوئی ہیں۔",
                    tags: ["شماریات"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "کیمیا میں عمل انگیز کیا ہے؟",
                    backText: "ایسا مادہ جو خود صرف ہوئے بغیر کیمیائی تعامل کی رفتار بڑھاتا ہے۔",
                    tags: ["کیمیا"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "نفسیات میں ادراکی تعصب کیا ہے؟",
                    backText: "سوچ کا ایک منظم انداز جو رائے قائم کرنے اور فیصلے کرنے میں بگاڑ پیدا کر سکتا ہے۔",
                    tags: ["نفسیات"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "طبیعیات میں سمتی رفتار کیا ہے؟",
                    backText: "کسی جسم کی حرکت کی سمت کے ساتھ اس کی تیزی۔",
                    tags: ["طبیعیات"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "کمپیوٹر سائنس میں ریکرشن کیا ہے؟",
                    backText: "ایک طریقہ جس میں کوئی فنکشن اسی مسئلے کی چھوٹی صورتیں حل کرنے کے لیے خود کو بلاتا ہے۔",
                    tags: ["کمپیوٹر سائنس"]
                )
            ]
        ),
        FlashcardsUITestMarketingLocaleFixture(
            localizationCode: "vi",
            reviewCard: FlashcardsUITestFixtureCard(
                frontText: "Trong kinh tế học, chi phí cơ hội là gì?",
                backText: """
                Giá trị của phương án tốt nhất mà bạn từ bỏ khi chọn một phương án khác.

                Ví dụ ôn thi: nếu bạn dành thứ Bảy để ôn thi kinh tế vi mô thay vì làm một ca có trả lương, khoản lương bị bỏ lỡ là một phần của chi phí cơ hội.
                """,
                tags: ["kinh tế học"]
            ),
            conceptCards: [
                FlashcardsUITestFixtureCard(
                    frontText: "Trong kinh tế học, chi phí cơ hội là gì?",
                    backText: "Giá trị của phương án tốt nhất mà bạn từ bỏ khi chọn một phương án khác.",
                    tags: ["kinh tế học"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Trong sinh học, thẩm thấu là gì?",
                    backText: "Sự di chuyển của nước qua màng từ nơi có nồng độ chất tan thấp đến nơi có nồng độ chất tan cao.",
                    tags: ["sinh học"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Trong thống kê, độ lệch chuẩn là gì?",
                    backText: "Thước đo mức độ phân tán của các giá trị quanh giá trị trung bình.",
                    tags: ["thống kê"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Trong hóa học, chất xúc tác là gì?",
                    backText: "Chất làm tăng tốc độ phản ứng hóa học mà không bị tiêu hao trong phản ứng.",
                    tags: ["hóa học"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Trong tâm lý học, thiên kiến nhận thức là gì?",
                    backText: "Một kiểu tư duy có hệ thống có thể làm sai lệch phán đoán và việc ra quyết định.",
                    tags: ["tâm lý học"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Trong vật lý, vận tốc là gì?",
                    backText: "Đại lượng mô tả tốc độ của một vật cùng với hướng chuyển động của vật đó.",
                    tags: ["vật lý"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Trong khoa học máy tính, đệ quy là gì?",
                    backText: "Phương pháp trong đó một hàm giải bài toán bằng cách tự gọi chính nó để giải các phiên bản nhỏ hơn của cùng bài toán.",
                    tags: ["khoa học máy tính"]
                )
            ]
        ),
        FlashcardsUITestMarketingLocaleFixture(
            localizationCode: "zu",
            reviewCard: FlashcardsUITestFixtureCard(
                frontText: "Kwezomnotho, iyini indleko yethuba?",
                backText: """
                Indleko yethuba iyinani lenketho engcono kunazo zonke oyilahlayo lapho ukhetha enye inketho esikhundleni senye.

                Isibonelo sesivivinyo: uma uchitha uMgqibelo ufundela isivivinyo somnotho omncane esikhundleni sokusebenza ishifu ekhokhelwayo, iholo olilahlekelwe liyingxenye yendleko yethuba.
                """,
                tags: ["ezomnotho"]
            ),
            conceptCards: [
                FlashcardsUITestFixtureCard(
                    frontText: "Kwezomnotho, iyini indleko yethuba?",
                    backText: "Inani lenketho engcono kunazo zonke oyilahlayo lapho ukhetha enye inketho esikhundleni senye.",
                    tags: ["ezomnotho"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Kwibhayoloji, iyini i-osmosis?",
                    backText: "Ukunyakaza kwamanzi ngolwelwesi kusuka ekugxileni okuphansi kwesincibilikisiwe kuya kokuphakeme.",
                    tags: ["ibhayoloji"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Kwizibalo, iyini ukuchezuka okujwayelekile?",
                    backText: "Isilinganiso sokuthi amanani asakazeke kangakanani ngokuzungeza isilinganiso.",
                    tags: ["izibalo"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Kwikhemistri, iyini i-catalyst?",
                    backText: "Into esheshisa ukusabela kwamakhemikhali ngaphandle kokuthi isetshenziswe kukho.",
                    tags: ["ikhemistri"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Kwisayikholoji, iyini ukuchema kwengqondo?",
                    backText: "Iphethini yokucabanga ehlelekile engahlanekezela ukwahlulela nokuthatha izinqumo.",
                    tags: ["isayikholoji"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Kwifiziksi, iyini ijubane?",
                    backText: "Isivinini sento kanye nendlela eqonde kuyo ekunyakazeni kwayo.",
                    tags: ["ifiziksi"]
                ),
                FlashcardsUITestFixtureCard(
                    frontText: "Kwisayensi yamakhompiyutha, iyini i-recursion?",
                    backText: "Indlela lapho umsebenzi uxazulula inkinga ngokuzibiza wona ngokwawo ezinguqulweni ezincane zaleyo nkinga.",
                    tags: ["isayensi yamakhompiyutha"]
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
        case .guestManualReviewCardWithReminderAttention:
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

    func markUITestReviewReminderAttentionAfterNotificationCleanup() async throws {
        while let task = self.activeReviewNotificationsRescheduleTask {
            await task.value
        }

        let context = try requireLocalMutationContext(database: self.database, workspace: self.workspace)
        self.markReviewReminderAttention(
            workspaceId: context.workspaceId,
            requestId: "ui-test-review-reminder-attention",
            deliveredAtMillis: epochMillis(date: Date())
        )
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

        let reviewCard = try context.database.saveCard(
            workspaceId: context.workspaceId,
            input: self.cardEditorInput(card: localeFixture.reviewCard),
            cardId: nil,
            mediaAssetIdsReadyForUpload: []
        )
        let cardsSnapshot = try context.database.cardStore.loadCardsListSnapshot(
            workspaceId: context.workspaceId,
            searchText: "",
            filter: nil
        )
        guard let newestCard = cardsSnapshot.cards.first,
              let latestUpdatedAt = parseIsoTimestamp(value: newestCard.updatedAt) else {
            throw LocalStoreError.validation("Marketing cards require a valid latest updatedAt timestamp")
        }

        // Millisecond ties fall back to random card IDs. Give the review fixture a
        // distinct local timestamp; guest bootstrap preserves these local rows.
        try context.database.core.execute(
            sql: "UPDATE cards SET updated_at = ? WHERE workspace_id = ? AND card_id = ?",
            values: [
                .text(formatIsoTimestamp(date: latestUpdatedAt.addingTimeInterval(1))),
                .text(context.workspaceId),
                .text(reviewCard.cardId)
            ]
        )
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
            cardId: nil,
            mediaAssetIdsReadyForUpload: []
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
                    reviewedAtClient: reviewedAtClient,
                    reviewedTimeZone: TimeZone.current.identifier
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
            // Canonical 30-day-ish pattern with gaps, 16 active days, and a freeze-aware 12-day streak ending today.
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
            tags: card.tags
        )
    }
}
