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
            screenshotIndex: 5,
            screenshotSlug: MarketingScreenshotFixture.cardsScreenshotSlug
        )
    }

    var progressFileName: String {
        self.screenshotFileName(
            screenshotIndex: 3,
            screenshotSlug: MarketingScreenshotFixture.progressScreenshotSlug
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
            localizationCode: "fr",
            appleLanguage: "fr",
            appleLocale: "fr_FR",
            reviewCard: MarketingScreenshotCardFixture(
                frontText: "En économie, qu'est-ce que le coût d'opportunité ?",
                backText: """
                Le coût d'opportunité est la valeur de la meilleure option à laquelle vous renoncez lorsque vous en choisissez une autre.

                Exemple d'examen : si vous passez votre samedi à réviser un examen de microéconomie au lieu de faire un service rémunéré, le salaire perdu fait partie du coût d'opportunité.
                """,
                subjectTag: "économie"
            ),
            reviewAiDraftMessage: "Crée 6 nouvelles cartes sur le même sujet d'économie, couvrant des notions étroitement liées que nous n'avons pas encore.",
            conceptCards: [
                MarketingScreenshotCardFixture(
                    frontText: "En économie, qu'est-ce que le coût d'opportunité ?",
                    backText: "La valeur de la meilleure option à laquelle vous renoncez lorsque vous en choisissez une autre.",
                    subjectTag: "économie"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "En biologie, qu'est-ce que l'osmose ?",
                    backText: "Le passage de l'eau à travers une membrane, d'une concentration en soluté plus faible vers une concentration plus élevée.",
                    subjectTag: "biologie"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "En statistique, qu'est-ce que l'écart type ?",
                    backText: "Une mesure de la dispersion des valeurs autour de la moyenne.",
                    subjectTag: "statistique"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "En chimie, qu'est-ce qu'un catalyseur ?",
                    backText: "Une substance qui accélère une réaction chimique sans être consommée par celle-ci.",
                    subjectTag: "chimie"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "En psychologie, qu'est-ce qu'un biais cognitif ?",
                    backText: "Un schéma de pensée systématique qui peut fausser le jugement et la prise de décision.",
                    subjectTag: "psychologie"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "En physique, qu'est-ce que la vitesse vectorielle ?",
                    backText: "La rapidité d'un objet associée à la direction de son mouvement.",
                    subjectTag: "physique"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "En informatique, qu'est-ce que la récursivité ?",
                    backText: "Une méthode où une fonction résout un problème en s'appelant elle-même sur des versions plus petites de ce problème.",
                    subjectTag: "informatique"
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
            localizationCode: "pt-BR",
            appleLanguage: "pt-BR",
            appleLocale: "pt_BR",
            reviewCard: MarketingScreenshotCardFixture(
                frontText: "Em economia, o que é custo de oportunidade?",
                backText: """
                Custo de oportunidade é o valor da melhor alternativa de que você abre mão ao escolher uma opção em vez de outra.

                Exemplo de prova: se você passa o sábado estudando para uma prova de microeconomia em vez de trabalhar em um turno remunerado, o salário perdido faz parte do custo de oportunidade.
                """,
                subjectTag: "economia"
            ),
            reviewAiDraftMessage: "Crie 6 novos cartões sobre o mesmo tema de economia, cobrindo ideias bem relacionadas que ainda não temos.",
            conceptCards: [
                MarketingScreenshotCardFixture(
                    frontText: "Em economia, o que é custo de oportunidade?",
                    backText: "O valor da melhor alternativa de que você abre mão ao escolher outra opção.",
                    subjectTag: "economia"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Em biologia, o que é osmose?",
                    backText: "O movimento da água através de uma membrana, de uma concentração menor de soluto para uma concentração maior.",
                    subjectTag: "biologia"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Em estatística, o que é desvio padrão?",
                    backText: "Uma medida de quanto os valores se espalham em torno da média.",
                    subjectTag: "estatística"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Em química, o que é um catalisador?",
                    backText: "Uma substância que acelera uma reação química sem ser consumida por ela.",
                    subjectTag: "química"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Em psicologia, o que é viés cognitivo?",
                    backText: "Um padrão sistemático de pensamento que pode distorcer o julgamento e a tomada de decisão.",
                    subjectTag: "psicologia"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Em física, o que é velocidade vetorial?",
                    backText: "A rapidez de um objeto junto com a direção do seu movimento.",
                    subjectTag: "física"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Em ciência da computação, o que é recursão?",
                    backText: "Um método em que uma função resolve um problema chamando a si mesma em versões menores desse problema.",
                    subjectTag: "ciência da computação"
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
        ),
        MarketingScreenshotLocaleFixture(
            localizationCode: "bg",
            appleLanguage: "bg",
            appleLocale: "bg_BG",
            reviewCard: MarketingScreenshotCardFixture(
                frontText: "В икономиката какво е алтернативна цена?",
                backText: """
                Алтернативната цена е стойността на най-добрата алтернатива, от която се отказвате, когато изберете една възможност вместо друга.

                Пример за изпит: ако прекарате съботата в подготовка за изпит по микроикономика вместо да работите платена смяна, пропуснатото възнаграждение е част от алтернативната цена.
                """,
                subjectTag: "икономика"
            ),
            reviewAiDraftMessage: "Създай 6 нови карти по същата икономическа тема, които покриват тясно свързани идеи, каквито още нямаме.",
            conceptCards: [
                MarketingScreenshotCardFixture(
                    frontText: "В икономиката какво е алтернативна цена?",
                    backText: "Стойността на най-добрата алтернатива, от която се отказвате, когато изберете една възможност вместо друга.",
                    subjectTag: "икономика"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "В биологията какво е осмоза?",
                    backText: "Движението на водата през мембрана от по-ниска към по-висока концентрация на разтвореното вещество.",
                    subjectTag: "биология"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "В статистиката какво е стандартно отклонение?",
                    backText: "Мярка за това колко са разпръснати стойностите около средната стойност.",
                    subjectTag: "статистика"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "В химията какво е катализатор?",
                    backText: "Вещество, което ускорява химична реакция, без да се изразходва в нея.",
                    subjectTag: "химия"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "В психологията какво е когнитивно изкривяване?",
                    backText: "Систематичен модел на мислене, който може да изкриви преценката и вземането на решения.",
                    subjectTag: "психология"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Във физиката какво е скорост?",
                    backText: "Бързината на движение на тялото заедно с посоката на това движение.",
                    subjectTag: "физика"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "В компютърните науки какво е рекурсия?",
                    backText: "Метод, при който функция решава задача, като извиква сама себе си върху по-малки версии на същата задача.",
                    subjectTag: "компютърни науки"
                )
            ]
        ),
        MarketingScreenshotLocaleFixture(
            localizationCode: "bn",
            appleLanguage: "bn",
            appleLocale: "bn_BD",
            reviewCard: MarketingScreenshotCardFixture(
                frontText: "অর্থনীতিতে সুযোগ ব্যয় কী?",
                backText: """
                একটি বিকল্প বেছে নেওয়ার সময় ছেড়ে দেওয়া সেরা বিকল্পটির মূল্য।

                পরীক্ষার উদাহরণ: শনিবার পারিশ্রমিকের বিনিময়ে কাজ না করে ক্ষুদ্র অর্থনীতির পরীক্ষার জন্য পড়লে, হারানো মজুরি সুযোগ ব্যয়ের অংশ।
                """,
                subjectTag: "অর্থনীতি"
            ),
            reviewAiDraftMessage: "একই অর্থনীতির বিষয়ে ঘনিষ্ঠভাবে সম্পর্কিত এমন ধারণা নিয়ে ৬টি নতুন ফ্ল্যাশকার্ড তৈরি করো, যা আমাদের কাছে এখনও নেই।",
            conceptCards: [
                MarketingScreenshotCardFixture(
                    frontText: "অর্থনীতিতে সুযোগ ব্যয় কী?",
                    backText: "একটি বিকল্প বেছে নেওয়ার সময় ছেড়ে দেওয়া সেরা বিকল্পটির মূল্য।",
                    subjectTag: "অর্থনীতি"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "জীববিজ্ঞানে অভিস্রবণ কী?",
                    backText: "একটি ঝিল্লির মধ্য দিয়ে কম দ্রব ঘনত্বের অঞ্চল থেকে বেশি দ্রব ঘনত্বের অঞ্চলে জলের চলাচল।",
                    subjectTag: "জীববিজ্ঞান"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "পরিসংখ্যানে প্রমিত বিচ্যুতি কী?",
                    backText: "মানগুলো গড়ের চারপাশে কতটা ছড়িয়ে আছে তার পরিমাপ।",
                    subjectTag: "পরিসংখ্যান"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "রসায়নে অনুঘটক কী?",
                    backText: "যে পদার্থ নিজে ক্ষয় না হয়ে রাসায়নিক বিক্রিয়ার গতি বাড়ায়।",
                    subjectTag: "রসায়ন"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "মনোবিজ্ঞানে জ্ঞানগত পক্ষপাত কী?",
                    backText: "চিন্তার একটি নিয়মিত প্রবণতা যা বিচারবোধ ও সিদ্ধান্তকে বিকৃত করতে পারে।",
                    subjectTag: "মনোবিজ্ঞান"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "পদার্থবিজ্ঞানে বেগ কী?",
                    backText: "কোনো বস্তুর গতির দিকসহ তার দ্রুতি।",
                    subjectTag: "পদার্থবিজ্ঞান"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "কম্পিউটার বিজ্ঞানে রিকার্শন কী?",
                    backText: "এমন একটি পদ্ধতি যেখানে একটি ফাংশন একই সমস্যার ছোট সংস্করণ সমাধান করতে নিজেকেই ডাকে।",
                    subjectTag: "কম্পিউটার বিজ্ঞান"
                )
            ]
        ),
        MarketingScreenshotLocaleFixture(
            localizationCode: "ca",
            appleLanguage: "ca",
            appleLocale: "ca_ES",
            reviewCard: MarketingScreenshotCardFixture(
                frontText: "En economia, què és el cost d'oportunitat?",
                backText: """
                El valor de la millor alternativa a què renuncies quan tries una altra opció.

                Exemple d'examen: si passes el dissabte estudiant per a un examen de microeconomia en lloc de fer un torn remunerat, el sou que deixes de guanyar forma part del cost d'oportunitat.
                """,
                subjectTag: "economia"
            ),
            reviewAiDraftMessage: "Crea 6 fitxes noves sobre el mateix tema d'economia, amb idees estretament relacionades que encara no tinguem.",
            conceptCards: [
                MarketingScreenshotCardFixture(
                    frontText: "En economia, què és el cost d'oportunitat?",
                    backText: "El valor de la millor alternativa a què renuncies quan tries una altra opció.",
                    subjectTag: "economia"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "En biologia, què és l'osmosi?",
                    backText: "El moviment de l'aigua a través d'una membrana des d'una concentració de solut més baixa cap a una de més alta.",
                    subjectTag: "biologia"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "En estadística, què és la desviació estàndard?",
                    backText: "Una mesura de com es dispersen els valors al voltant de la mitjana.",
                    subjectTag: "estadística"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "En química, què és un catalitzador?",
                    backText: "Una substància que accelera una reacció química sense consumir-se.",
                    subjectTag: "química"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "En psicologia, què és un biaix cognitiu?",
                    backText: "Un patró sistemàtic de pensament que pot distorsionar el judici i la presa de decisions.",
                    subjectTag: "psicologia"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "En física, què és la velocitat?",
                    backText: "La rapidesa d'un objecte juntament amb la direcció del seu moviment.",
                    subjectTag: "física"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "En informàtica, què és la recursivitat?",
                    backText: "Un mètode en què una funció resol un problema cridant-se a si mateixa per resoldre versions més petites del mateix problema.",
                    subjectTag: "informàtica"
                )
            ]
        ),
        MarketingScreenshotLocaleFixture(
            localizationCode: "cs",
            appleLanguage: "cs",
            appleLocale: "cs_CZ",
            reviewCard: MarketingScreenshotCardFixture(
                frontText: "Co jsou v ekonomii náklady obětované příležitosti?",
                backText: """
                Hodnota nejlepší alternativy, které se vzdáte, když si vyberete jinou možnost.

                Příklad ke zkoušce: pokud v sobotu místo placené směny studujete na zkoušku z mikroekonomie, ušlá mzda je součástí nákladů obětované příležitosti.
                """,
                subjectTag: "ekonomie"
            ),
            reviewAiDraftMessage: "Vytvoř 6 nových kartiček na stejné ekonomické téma s úzce souvisejícími pojmy, které ještě nemáme.",
            conceptCards: [
                MarketingScreenshotCardFixture(
                    frontText: "Co jsou v ekonomii náklady obětované příležitosti?",
                    backText: "Hodnota nejlepší alternativy, které se vzdáte, když si vyberete jinou možnost.",
                    subjectTag: "ekonomie"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Co je v biologii osmóza?",
                    backText: "Pohyb vody přes membránu z oblasti s nižší koncentrací rozpuštěných látek do oblasti s vyšší koncentrací.",
                    subjectTag: "biologie"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Co je ve statistice směrodatná odchylka?",
                    backText: "Míra toho, jak jsou hodnoty rozptýlené kolem průměru.",
                    subjectTag: "statistika"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Co je v chemii katalyzátor?",
                    backText: "Látka, která urychluje chemickou reakci, aniž by se při ní spotřebovávala.",
                    subjectTag: "chemie"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Co je v psychologii kognitivní zkreslení?",
                    backText: "Systematický vzorec myšlení, který může zkreslovat úsudek a rozhodování.",
                    subjectTag: "psychologie"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Co je ve fyzice vektor rychlosti?",
                    backText: "Veličina, která vyjadřuje rychlost pohybu tělesa i jeho směr.",
                    subjectTag: "fyzika"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Co je v informatice rekurze?",
                    backText: "Metoda, při které funkce řeší problém tím, že volá sama sebe pro menší verze téhož problému.",
                    subjectTag: "informatika"
                )
            ]
        ),
        MarketingScreenshotLocaleFixture(
            localizationCode: "da",
            appleLanguage: "da",
            appleLocale: "da_DK",
            reviewCard: MarketingScreenshotCardFixture(
                frontText: "Hvad er alternativomkostning i økonomi?",
                backText: """
                Værdien af det bedste alternativ, du giver afkald på, når du vælger en anden mulighed.

                Eksamenseksempel: Hvis du bruger lørdagen på at læse til en eksamen i mikroøkonomi i stedet for at tage en betalt vagt, er den mistede løn en del af alternativomkostningen.
                """,
                subjectTag: "økonomi"
            ),
            reviewAiDraftMessage: "Lav 6 nye huskekort om det samme økonomiske emne med nært beslægtede begreber, som vi ikke allerede har.",
            conceptCards: [
                MarketingScreenshotCardFixture(
                    frontText: "Hvad er alternativomkostning i økonomi?",
                    backText: "Værdien af det bedste alternativ, du giver afkald på, når du vælger en anden mulighed.",
                    subjectTag: "økonomi"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Hvad er osmose i biologi?",
                    backText: "Vandets bevægelse gennem en membran fra lavere til højere koncentration af opløste stoffer.",
                    subjectTag: "biologi"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Hvad er standardafvigelse i statistik?",
                    backText: "Et mål for, hvor spredte værdierne er omkring gennemsnittet.",
                    subjectTag: "statistik"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Hvad er en katalysator i kemi?",
                    backText: "Et stof, der fremskynder en kemisk reaktion uden selv at blive forbrugt.",
                    subjectTag: "kemi"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Hvad er en kognitiv bias i psykologi?",
                    backText: "Et systematisk tankemønster, der kan forvrænge vurderinger og beslutninger.",
                    subjectTag: "psykologi"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Hvad er hastighed som vektor i fysik?",
                    backText: "Et objekts fart sammen med retningen af dets bevægelse.",
                    subjectTag: "fysik"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Hvad er rekursion i datalogi?",
                    backText: "En metode, hvor en funktion løser et problem ved at kalde sig selv på mindre udgaver af problemet.",
                    subjectTag: "datalogi"
                )
            ]
        ),
        MarketingScreenshotLocaleFixture(
            localizationCode: "el",
            appleLanguage: "el",
            appleLocale: "el_GR",
            reviewCard: MarketingScreenshotCardFixture(
                frontText: "Τι είναι το κόστος ευκαιρίας στα οικονομικά;",
                backText: """
                Η αξία της καλύτερης εναλλακτικής που θυσιάζεις όταν επιλέγεις μια άλλη δυνατότητα.

                Παράδειγμα εξέτασης: αν περάσεις το Σάββατο διαβάζοντας για μια εξέταση μικροοικονομίας αντί να εργαστείς σε αμειβόμενη βάρδια, ο χαμένος μισθός αποτελεί μέρος του κόστους ευκαιρίας.
                """,
                subjectTag: "οικονομικά"
            ),
            reviewAiDraftMessage: "Δημιούργησε 6 νέες κάρτες για το ίδιο θέμα οικονομικών, με στενά συνδεδεμένες έννοιες που δεν έχουμε ήδη.",
            conceptCards: [
                MarketingScreenshotCardFixture(
                    frontText: "Τι είναι το κόστος ευκαιρίας στα οικονομικά;",
                    backText: "Η αξία της καλύτερης εναλλακτικής που θυσιάζεις όταν επιλέγεις μια άλλη δυνατότητα.",
                    subjectTag: "οικονομικά"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Τι είναι η ώσμωση στη βιολογία;",
                    backText: "Η μετακίνηση νερού μέσα από μια μεμβράνη από χαμηλότερη προς υψηλότερη συγκέντρωση διαλυμένης ουσίας.",
                    subjectTag: "βιολογία"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Τι είναι η τυπική απόκλιση στη στατιστική;",
                    backText: "Ένα μέτρο του πόσο διασκορπισμένες είναι οι τιμές γύρω από τον μέσο όρο.",
                    subjectTag: "στατιστική"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Τι είναι ο καταλύτης στη χημεία;",
                    backText: "Μια ουσία που επιταχύνει μια χημική αντίδραση χωρίς να καταναλώνεται.",
                    subjectTag: "χημεία"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Τι είναι η γνωστική προκατάληψη στην ψυχολογία;",
                    backText: "Ένα συστηματικό μοτίβο σκέψης που μπορεί να διαστρεβλώσει την κρίση και τη λήψη αποφάσεων.",
                    subjectTag: "ψυχολογία"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Τι είναι η διανυσματική ταχύτητα στη φυσική;",
                    backText: "Το μέτρο της ταχύτητας ενός αντικειμένου μαζί με την κατεύθυνση της κίνησής του.",
                    subjectTag: "φυσική"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Τι είναι η αναδρομή στην πληροφορική;",
                    backText: "Μια μέθοδος όπου μια συνάρτηση λύνει ένα πρόβλημα καλώντας τον εαυτό της για μικρότερες εκδοχές του ίδιου προβλήματος.",
                    subjectTag: "πληροφορική"
                )
            ]
        ),
        MarketingScreenshotLocaleFixture(
            localizationCode: "et",
            appleLanguage: "et",
            appleLocale: "et_EE",
            reviewCard: MarketingScreenshotCardFixture(
                frontText: "Mis on majanduses alternatiivkulu?",
                backText: """
                Alternatiivkulu on parima kõrvalejäetud valiku väärtus, millest sa loobud, kui valid ühe võimaluse teise asemel.

                Eksaminäide: kui veedad laupäeva mikroökonoomika eksamiks õppides, selle asemel et teha tasustatud vahetus, on saamata jäänud palk osa alternatiivkulust.
                """,
                subjectTag: "majandus"
            ),
            reviewAiDraftMessage: "Loo 6 uut kaarti sama majandusteema kohta, mis katavad tihedalt seotud mõisteid, mida meil veel ei ole.",
            conceptCards: [
                MarketingScreenshotCardFixture(
                    frontText: "Mis on majanduses alternatiivkulu?",
                    backText: "Parima kõrvalejäetud valiku väärtus, millest sa loobud, kui valid ühe võimaluse teise asemel.",
                    subjectTag: "majandus"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Mis on bioloogias osmoos?",
                    backText: "Vee liikumine läbi membraani madalama lahustunud aine sisaldusega poolelt kõrgema poole.",
                    subjectTag: "bioloogia"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Mis on statistikas standardhälve?",
                    backText: "Näitaja, mis mõõdab väärtuste hajuvust keskmise ümber.",
                    subjectTag: "statistika"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Mis on keemias katalüsaator?",
                    backText: "Aine, mis kiirendab keemilist reaktsiooni, ilma et see reaktsioonis ära kuluks.",
                    subjectTag: "keemia"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Mis on psühholoogias kognitiivne kallutatus?",
                    backText: "Süstemaatiline mõttemuster, mis võib moonutada hinnanguid ja otsuste tegemist.",
                    subjectTag: "psühholoogia"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Mis on füüsikas kiirus?",
                    backText: "Keha liikumise kiirus koos selle liikumise suunaga.",
                    subjectTag: "füüsika"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Mis on arvutiteaduses rekursioon?",
                    backText: "Meetod, kus funktsioon lahendab ülesande, kutsudes iseennast sama ülesande väiksemate osade jaoks.",
                    subjectTag: "arvutiteadus"
                )
            ]
        ),
        MarketingScreenshotLocaleFixture(
            localizationCode: "fa",
            appleLanguage: "fa",
            appleLocale: "fa_IR",
            reviewCard: MarketingScreenshotCardFixture(
                frontText: "در اقتصاد، هزینه فرصت چیست؟",
                backText: """
                هزینه فرصت ارزش بهترین گزینه جایگزینی است که وقتی یک گزینه را به جای گزینه دیگر انتخاب می‌کنید، از آن چشم‌پوشی می‌کنید.

                مثال امتحانی: اگر شنبه را به جای کار کردن در یک شیفت با حقوق، صرف مطالعه برای امتحان اقتصاد خرد کنید، دستمزد از دست‌رفته بخشی از هزینه فرصت است.
                """,
                subjectTag: "اقتصاد"
            ),
            reviewAiDraftMessage: "6 کارت جدید درباره همان موضوع اقتصادی بساز که مفاهیم نزدیک به آن را پوشش دهد و هنوز آن‌ها را نداریم.",
            conceptCards: [
                MarketingScreenshotCardFixture(
                    frontText: "در اقتصاد، هزینه فرصت چیست؟",
                    backText: "ارزش بهترین گزینه جایگزینی که هنگام انتخاب یک گزینه به جای گزینه دیگر از آن چشم‌پوشی می‌کنید.",
                    subjectTag: "اقتصاد"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "در زیست‌شناسی، اسمز چیست؟",
                    backText: "حرکت آب از میان یک غشا از غلظت کمتر ماده حل‌شده به غلظت بیشتر آن.",
                    subjectTag: "زیست‌شناسی"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "در آمار، انحراف معیار چیست؟",
                    backText: "معیاری برای سنجش میزان پراکندگی مقادیر حول میانگین.",
                    subjectTag: "آمار"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "در شیمی، کاتالیزور چیست؟",
                    backText: "ماده‌ای که سرعت یک واکنش شیمیایی را افزایش می‌دهد بدون آنکه در آن مصرف شود.",
                    subjectTag: "شیمی"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "در روان‌شناسی، سوگیری شناختی چیست؟",
                    backText: "الگویی نظام‌مند در تفکر که می‌تواند قضاوت و تصمیم‌گیری را منحرف کند.",
                    subjectTag: "روان‌شناسی"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "در فیزیک، سرعت برداری چیست؟",
                    backText: "تندی حرکت یک جسم همراه با جهت آن حرکت.",
                    subjectTag: "فیزیک"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "در علوم کامپیوتر، بازگشت چیست؟",
                    backText: "روشی که در آن یک تابع مسئله را با فراخوانی خودش روی نسخه‌های کوچک‌تر همان مسئله حل می‌کند.",
                    subjectTag: "علوم کامپیوتر"
                )
            ]
        ),
        MarketingScreenshotLocaleFixture(
            localizationCode: "fi",
            appleLanguage: "fi",
            appleLocale: "fi_FI",
            reviewCard: MarketingScreenshotCardFixture(
                frontText: "Mitä vaihtoehtoiskustannus tarkoittaa taloustieteessä?",
                backText: """
                Parhaan sellaisen vaihtoehdon arvo, josta luovut valitessasi toisen vaihtoehdon.

                Tenttiesimerkki: jos käytät lauantain mikrotaloustieteen tenttiin lukemiseen palkallisen työvuoron sijaan, menetetty palkka on osa vaihtoehtoiskustannusta.
                """,
                subjectTag: "taloustiede"
            ),
            reviewAiDraftMessage: "Luo 6 uutta muistikorttia samasta taloustieteen aiheesta. Käsittele läheisesti liittyviä käsitteitä, joista meillä ei vielä ole kortteja.",
            conceptCards: [
                MarketingScreenshotCardFixture(
                    frontText: "Mitä vaihtoehtoiskustannus tarkoittaa taloustieteessä?",
                    backText: "Parhaan sellaisen vaihtoehdon arvo, josta luovut valitessasi toisen vaihtoehdon.",
                    subjectTag: "taloustiede"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Mitä osmoosi tarkoittaa biologiassa?",
                    backText: "Veden liikkumista kalvon läpi pienemmästä liuenneen aineen pitoisuudesta suurempaan.",
                    subjectTag: "biologia"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Mitä keskihajonta tarkoittaa tilastotieteessä?",
                    backText: "Mittaa, joka kuvaa arvojen hajontaa keskiarvon ympärillä.",
                    subjectTag: "tilastotiede"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Mikä on katalyytti kemiassa?",
                    backText: "Aine, joka nopeuttaa kemiallista reaktiota kulumatta itse reaktiossa.",
                    subjectTag: "kemia"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Mitä kognitiivinen vinouma tarkoittaa psykologiassa?",
                    backText: "Järjestelmällistä ajattelumallia, joka voi vääristää arviointia ja päätöksentekoa.",
                    subjectTag: "psykologia"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Mitä nopeusvektori tarkoittaa fysiikassa?",
                    backText: "Suuretta, joka kuvaa kappaleen vauhtia ja liikkeen suuntaa.",
                    subjectTag: "fysiikka"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Mitä rekursio tarkoittaa tietojenkäsittelytieteessä?",
                    backText: "Menetelmää, jossa funktio ratkaisee ongelman kutsumalla itseään saman ongelman pienemmille versioille.",
                    subjectTag: "tietojenkäsittelytiede"
                )
            ]
        ),
        MarketingScreenshotLocaleFixture(
            localizationCode: "gu",
            appleLanguage: "gu",
            appleLocale: "gu_IN",
            reviewCard: MarketingScreenshotCardFixture(
                frontText: "અર્થશાસ્ત્રમાં તક ખર્ચ શું છે?",
                backText: """
                એક વિકલ્પ પસંદ કરતી વખતે તમે છોડી દો છો તે શ્રેષ્ઠ વૈકલ્પિક પસંદગીનું મૂલ્ય.

                પરીક્ષાનું ઉદાહરણ: જો તમે શનિવારે પગારવાળી પાળીમાં કામ કરવાને બદલે સૂક્ષ્મ અર્થશાસ્ત્રની પરીક્ષા માટે અભ્યાસ કરો, તો ગુમાવેલો પગાર તક ખર્ચનો ભાગ છે.
                """,
                subjectTag: "અર્થશાસ્ત્ર"
            ),
            reviewAiDraftMessage: "અર્થશાસ્ત્રના આ જ વિષય પર નજીકથી સંબંધિત એવા વિચારો આવરી લેતાં ૬ નવા ફ્લૅશકાર્ડ બનાવો, જે આપણી પાસે હજી નથી.",
            conceptCards: [
                MarketingScreenshotCardFixture(
                    frontText: "અર્થશાસ્ત્રમાં તક ખર્ચ શું છે?",
                    backText: "એક વિકલ્પ પસંદ કરતી વખતે તમે છોડી દો છો તે શ્રેષ્ઠ વૈકલ્પિક પસંદગીનું મૂલ્ય.",
                    subjectTag: "અર્થશાસ્ત્ર"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "જીવવિજ્ઞાનમાં પરાસરણ શું છે?",
                    backText: "પટલમાંથી પાણીનું ઓછી દ્રાવ્ય સાંદ્રતા ધરાવતા વિસ્તારથી વધુ દ્રાવ્ય સાંદ્રતા ધરાવતા વિસ્તાર તરફ વહન.",
                    subjectTag: "જીવવિજ્ઞાન"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "આંકડાશાસ્ત્રમાં પ્રમાણિત વિચલન શું છે?",
                    backText: "મૂલ્યો સરેરાશની આસપાસ કેટલાં ફેલાયેલાં છે તેનું માપ.",
                    subjectTag: "આંકડાશાસ્ત્ર"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "રસાયણશાસ્ત્રમાં ઉત્પ્રેરક શું છે?",
                    backText: "એવો પદાર્થ જે પોતે વપરાઈ ગયા વિના રાસાયણિક પ્રક્રિયાને ઝડપી બનાવે છે.",
                    subjectTag: "રસાયણશાસ્ત્ર"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "મનોવિજ્ઞાનમાં જ્ઞાનાત્મક પૂર્વગ્રહ શું છે?",
                    backText: "વિચારવાની એક વ્યવસ્થિત ઢબ જે મૂલ્યાંકન અને નિર્ણય લેવાની પ્રક્રિયાને વિકૃત કરી શકે છે.",
                    subjectTag: "મનોવિજ્ઞાન"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "ભૌતિકશાસ્ત્રમાં વેગ શું છે?",
                    backText: "વસ્તુની ગતિની દિશા સાથે તેની ઝડપ.",
                    subjectTag: "ભૌતિકશાસ્ત્ર"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "કમ્પ્યુટર વિજ્ઞાનમાં રિકર્ઝન શું છે?",
                    backText: "એવી પદ્ધતિ જેમાં ફંક્શન એ જ સમસ્યાનાં નાનાં સ્વરૂપો ઉકેલવા પોતાને જ બોલાવે છે.",
                    subjectTag: "કમ્પ્યુટર વિજ્ઞાન"
                )
            ]
        ),
        MarketingScreenshotLocaleFixture(
            localizationCode: "he",
            appleLanguage: "he",
            appleLocale: "he_IL",
            reviewCard: MarketingScreenshotCardFixture(
                frontText: "מהי עלות אלטרנטיבית בכלכלה?",
                backText: """
                הערך של החלופה הטובה ביותר שעליה מוותרים כשבוחרים באפשרות אחרת.

                דוגמה לבחינה: אם מקדישים את השבת ללימוד לבחינה במיקרו־כלכלה במקום לעבוד במשמרת בתשלום, השכר שלא התקבל הוא חלק מהעלות האלטרנטיבית.
                """,
                subjectTag: "כלכלה"
            ),
            reviewAiDraftMessage: "צור 6 כרטיסיות חדשות באותו נושא בכלכלה, שעוסקות ברעיונות קרובים שעדיין אין לנו.",
            conceptCards: [
                MarketingScreenshotCardFixture(
                    frontText: "מהי עלות אלטרנטיבית בכלכלה?",
                    backText: "הערך של החלופה הטובה ביותר שעליה מוותרים כשבוחרים באפשרות אחרת.",
                    subjectTag: "כלכלה"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "מהי אוסמוזה בביולוגיה?",
                    backText: "תנועה של מים דרך קרום מאזור עם ריכוז מומסים נמוך לאזור עם ריכוז מומסים גבוה.",
                    subjectTag: "ביולוגיה"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "מהי סטיית תקן בסטטיסטיקה?",
                    backText: "מדד למידת הפיזור של הערכים סביב הממוצע.",
                    subjectTag: "סטטיסטיקה"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "מהו זרז בכימיה?",
                    backText: "חומר שמאיץ תגובה כימית בלי להיצרך במהלכה.",
                    subjectTag: "כימיה"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "מהי הטיה קוגניטיבית בפסיכולוגיה?",
                    backText: "דפוס חשיבה שיטתי שעלול לעוות שיפוט וקבלת החלטות.",
                    subjectTag: "פסיכולוגיה"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "מהי מהירות וקטורית בפיזיקה?",
                    backText: "גודל המהירות של גוף יחד עם כיוון תנועתו.",
                    subjectTag: "פיזיקה"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "מהי רקורסיה במדעי המחשב?",
                    backText: "שיטה שבה פונקציה פותרת בעיה באמצעות קריאה לעצמה עבור גרסאות קטנות יותר של אותה בעיה.",
                    subjectTag: "מדעי המחשב"
                )
            ]
        ),
        MarketingScreenshotLocaleFixture(
            localizationCode: "hr",
            appleLanguage: "hr",
            appleLocale: "hr_HR",
            reviewCard: MarketingScreenshotCardFixture(
                frontText: "Što je oportunitetni trošak u ekonomiji?",
                backText: """
                Vrijednost najbolje alternative koje se odričete kada odaberete drugu mogućnost.

                Primjer za ispit: ako subotu provedete učeći za ispit iz mikroekonomije umjesto radeći plaćenu smjenu, izgubljena zarada dio je oportunitetnog troška.
                """,
                subjectTag: "ekonomija"
            ),
            reviewAiDraftMessage: "Izradi 6 novih kartica na istu ekonomsku temu s usko povezanim pojmovima koje još nemamo.",
            conceptCards: [
                MarketingScreenshotCardFixture(
                    frontText: "Što je oportunitetni trošak u ekonomiji?",
                    backText: "Vrijednost najbolje alternative koje se odričete kada odaberete drugu mogućnost.",
                    subjectTag: "ekonomija"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Što je osmoza u biologiji?",
                    backText: "Kretanje vode kroz membranu iz područja niže koncentracije otopljenih tvari prema području više koncentracije.",
                    subjectTag: "biologija"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Što je standardna devijacija u statistici?",
                    backText: "Mjera raspršenosti vrijednosti oko prosjeka.",
                    subjectTag: "statistika"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Što je katalizator u kemiji?",
                    backText: "Tvar koja ubrzava kemijsku reakciju, a pritom se ne troši.",
                    subjectTag: "kemija"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Što je kognitivna pristranost u psihologiji?",
                    backText: "Sustavan obrazac razmišljanja koji može iskriviti prosuđivanje i donošenje odluka.",
                    subjectTag: "psihologija"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Što je vektor brzine u fizici?",
                    backText: "Veličina koja opisuje brzinu gibanja tijela i njegov smjer.",
                    subjectTag: "fizika"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Što je rekurzija u računarstvu?",
                    backText: "Metoda kojom funkcija rješava problem pozivajući samu sebe za manje inačice istog problema.",
                    subjectTag: "računarstvo"
                )
            ]
        ),
        MarketingScreenshotLocaleFixture(
            localizationCode: "hu",
            appleLanguage: "hu",
            appleLocale: "hu_HU",
            reviewCard: MarketingScreenshotCardFixture(
                frontText: "Mit jelent az alternatív költség a közgazdaságtanban?",
                backText: """
                Annak a legjobb alternatívának az értéke, amelyről lemondasz, amikor egy másik lehetőséget választasz.

                Vizsgapélda: ha szombaton fizetett műszak helyett a mikroökonómia-vizsgára tanulsz, az elmaradt munkabér az alternatív költség része.
                """,
                subjectTag: "közgazdaságtan"
            ),
            reviewAiDraftMessage: "Készíts 6 új tanulókártyát ugyanerről a közgazdasági témáról, szorosan kapcsolódó fogalmakkal, amelyekről még nincs kártyánk.",
            conceptCards: [
                MarketingScreenshotCardFixture(
                    frontText: "Mit jelent az alternatív költség a közgazdaságtanban?",
                    backText: "Annak a legjobb alternatívának az értéke, amelyről lemondasz, amikor egy másik lehetőséget választasz.",
                    subjectTag: "közgazdaságtan"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Mi az ozmózis a biológiában?",
                    backText: "A víz áramlása egy membránon keresztül az alacsonyabb oldottanyag-koncentrációjú helyről a magasabb felé.",
                    subjectTag: "biológia"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Mi a szórás a statisztikában?",
                    backText: "Annak mértéke, hogy az értékek mennyire szóródnak az átlag körül.",
                    subjectTag: "statisztika"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Mi a katalizátor a kémiában?",
                    backText: "Olyan anyag, amely felgyorsít egy kémiai reakciót anélkül, hogy közben elfogyna.",
                    subjectTag: "kémia"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Mi a kognitív torzítás a pszichológiában?",
                    backText: "Rendszeres gondolkodási mintázat, amely torzíthatja az ítéletalkotást és a döntéshozatalt.",
                    subjectTag: "pszichológia"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Mi a sebességvektor a fizikában?",
                    backText: "Olyan mennyiség, amely a test mozgásának gyorsaságát és irányát is leírja.",
                    subjectTag: "fizika"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Mi a rekurzió az informatikában?",
                    backText: "Olyan módszer, amelyben egy függvény önmagát hívja meg ugyanazon probléma kisebb változatainak megoldására.",
                    subjectTag: "informatika"
                )
            ]
        ),
        MarketingScreenshotLocaleFixture(
            localizationCode: "id",
            appleLanguage: "id",
            appleLocale: "id_ID",
            reviewCard: MarketingScreenshotCardFixture(
                frontText: "Dalam ekonomi, apa itu biaya peluang?",
                backText: """
                Nilai alternatif terbaik yang kamu korbankan saat memilih opsi lain.

                Contoh ujian: jika kamu menghabiskan hari Sabtu belajar untuk ujian mikroekonomi alih-alih bekerja dalam sif berbayar, upah yang tidak diperoleh termasuk biaya peluang.
                """,
                subjectTag: "ekonomi"
            ),
            reviewAiDraftMessage: "Buat 6 kartu belajar baru tentang topik ekonomi yang sama, mencakup konsep yang berkaitan erat dan belum kita miliki.",
            conceptCards: [
                MarketingScreenshotCardFixture(
                    frontText: "Dalam ekonomi, apa itu biaya peluang?",
                    backText: "Nilai alternatif terbaik yang kamu korbankan saat memilih opsi lain.",
                    subjectTag: "ekonomi"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Dalam biologi, apa itu osmosis?",
                    backText: "Perpindahan air melalui membran dari konsentrasi zat terlarut yang lebih rendah ke yang lebih tinggi.",
                    subjectTag: "biologi"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Dalam statistika, apa itu simpangan baku?",
                    backText: "Ukuran seberapa tersebar nilai-nilai di sekitar rata-rata.",
                    subjectTag: "statistika"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Dalam kimia, apa itu katalis?",
                    backText: "Zat yang mempercepat reaksi kimia tanpa ikut habis dalam reaksi tersebut.",
                    subjectTag: "kimia"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Dalam psikologi, apa itu bias kognitif?",
                    backText: "Pola berpikir sistematis yang dapat menyimpangkan penilaian dan pengambilan keputusan.",
                    subjectTag: "psikologi"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Dalam fisika, apa itu kecepatan?",
                    backText: "Kelajuan suatu benda beserta arah geraknya.",
                    subjectTag: "fisika"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Dalam ilmu komputer, apa itu rekursi?",
                    backText: "Metode ketika sebuah fungsi memecahkan masalah dengan memanggil dirinya sendiri untuk versi yang lebih kecil dari masalah yang sama.",
                    subjectTag: "ilmu komputer"
                )
            ]
        ),
        MarketingScreenshotLocaleFixture(
            localizationCode: "is",
            appleLanguage: "is",
            appleLocale: "is_IS",
            reviewCard: MarketingScreenshotCardFixture(
                frontText: "Hvað er fórnarkostnaður í hagfræði?",
                backText: """
                Fórnarkostnaður er verðmæti næstbesta kostarins sem þú gefur eftir þegar þú velur einn valkost fram yfir annan.

                Prófdæmi: ef þú eyðir laugardeginum í að lesa fyrir próf í örhagfræði í stað þess að vinna launaða vakt eru töpuðu launin hluti af fórnarkostnaðinum.
                """,
                subjectTag: "hagfræði"
            ),
            reviewAiDraftMessage: "Búðu til 6 ný spjöld um sama hagfræðiefni sem fjalla um náskyld hugtök sem við eigum ekki þegar.",
            conceptCards: [
                MarketingScreenshotCardFixture(
                    frontText: "Hvað er fórnarkostnaður í hagfræði?",
                    backText: "Verðmæti næstbesta kostarins sem þú gefur eftir þegar þú velur einn valkost fram yfir annan.",
                    subjectTag: "hagfræði"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Hvað er himnuflæði í líffræði?",
                    backText: "Flæði vatns gegnum himnu frá lægri styrk uppleysts efnis til hærri styrks.",
                    subjectTag: "líffræði"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Hvað er staðalfrávik í tölfræði?",
                    backText: "Mælikvarði á hversu dreifð gildin eru í kringum meðaltalið.",
                    subjectTag: "tölfræði"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Hvað er hvati í efnafræði?",
                    backText: "Efni sem flýtir efnahvarfi án þess að eyðast í því.",
                    subjectTag: "efnafræði"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Hvað er hugræn skekkja í sálfræði?",
                    backText: "Kerfisbundið hugsanamynstur sem getur skekkt mat og ákvarðanatöku.",
                    subjectTag: "sálfræði"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Hvað er hraði í eðlisfræði?",
                    backText: "Hraði hlutar ásamt stefnu hreyfingar hans.",
                    subjectTag: "eðlisfræði"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Hvað er endurkvæmni í tölvunarfræði?",
                    backText: "Aðferð þar sem fall leysir verkefni með því að kalla á sjálft sig fyrir minni útgáfur sama verkefnis.",
                    subjectTag: "tölvunarfræði"
                )
            ]
        ),
        MarketingScreenshotLocaleFixture(
            localizationCode: "it",
            appleLanguage: "it",
            appleLocale: "it_IT",
            reviewCard: MarketingScreenshotCardFixture(
                frontText: "In economia, che cos'è il costo opportunità?",
                backText: """
                Il valore della migliore alternativa a cui rinunci quando scegli un'altra opzione.

                Esempio d'esame: se passi il sabato a studiare per un esame di microeconomia invece di fare un turno retribuito, il mancato guadagno fa parte del costo opportunità.
                """,
                subjectTag: "economia"
            ),
            reviewAiDraftMessage: "Crea 6 nuove schede sullo stesso argomento di economia, con concetti strettamente correlati che non abbiamo ancora.",
            conceptCards: [
                MarketingScreenshotCardFixture(
                    frontText: "In economia, che cos'è il costo opportunità?",
                    backText: "Il valore della migliore alternativa a cui rinunci quando scegli un'altra opzione.",
                    subjectTag: "economia"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "In biologia, che cos'è l'osmosi?",
                    backText: "Il movimento dell'acqua attraverso una membrana da una concentrazione di soluto minore a una maggiore.",
                    subjectTag: "biologia"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "In statistica, che cos'è la deviazione standard?",
                    backText: "Una misura di quanto i valori sono dispersi intorno alla media.",
                    subjectTag: "statistica"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "In chimica, che cos'è un catalizzatore?",
                    backText: "Una sostanza che accelera una reazione chimica senza essere consumata.",
                    subjectTag: "chimica"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "In psicologia, che cos'è un bias cognitivo?",
                    backText: "Uno schema sistematico di pensiero che può alterare il giudizio e le decisioni.",
                    subjectTag: "psicologia"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "In fisica, che cos'è la velocità vettoriale?",
                    backText: "Una grandezza che descrive quanto rapidamente si muove un oggetto, insieme alla direzione e al verso del moto.",
                    subjectTag: "fisica"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "In informatica, che cos'è la ricorsione?",
                    backText: "Un metodo in cui una funzione risolve un problema richiamando sé stessa su versioni più piccole dello stesso problema.",
                    subjectTag: "informatica"
                )
            ]
        ),
        MarketingScreenshotLocaleFixture(
            localizationCode: "kn",
            appleLanguage: "kn",
            appleLocale: "kn_IN",
            reviewCard: MarketingScreenshotCardFixture(
                frontText: "ಅರ್ಥಶಾಸ್ತ್ರದಲ್ಲಿ ಅವಕಾಶ ವೆಚ್ಚ ಎಂದರೇನು?",
                backText: """
                ಒಂದು ಆಯ್ಕೆಯನ್ನು ಮಾಡುವಾಗ ಬಿಟ್ಟುಕೊಡುವ ಅತ್ಯುತ್ತಮ ಪರ್ಯಾಯದ ಮೌಲ್ಯ.

                ಪರೀಕ್ಷೆಯ ಉದಾಹರಣೆ: ಶನಿವಾರ ಸಂಬಳ ಸಿಗುವ ಪಾಳಿಯಲ್ಲಿ ಕೆಲಸ ಮಾಡುವ ಬದಲು ಸೂಕ್ಷ್ಮ ಅರ್ಥಶಾಸ್ತ್ರದ ಪರೀಕ್ಷೆಗೆ ಓದಿದರೆ, ಕಳೆದುಕೊಂಡ ಸಂಬಳವು ಅವಕಾಶ ವೆಚ್ಚದ ಭಾಗವಾಗುತ್ತದೆ.
                """,
                subjectTag: "ಅರ್ಥಶಾಸ್ತ್ರ"
            ),
            reviewAiDraftMessage: "ಇದೇ ಅರ್ಥಶಾಸ್ತ್ರದ ವಿಷಯಕ್ಕೆ ನಿಕಟವಾಗಿ ಸಂಬಂಧಿಸಿದ, ನಮ್ಮ ಬಳಿ ಇನ್ನೂ ಇಲ್ಲದ ಪರಿಕಲ್ಪನೆಗಳ ಕುರಿತು 6 ಹೊಸ ಕಲಿಕಾ ಕಾರ್ಡ್‌ಗಳನ್ನು ರಚಿಸಿ.",
            conceptCards: [
                MarketingScreenshotCardFixture(
                    frontText: "ಅರ್ಥಶಾಸ್ತ್ರದಲ್ಲಿ ಅವಕಾಶ ವೆಚ್ಚ ಎಂದರೇನು?",
                    backText: "ಒಂದು ಆಯ್ಕೆಯನ್ನು ಮಾಡುವಾಗ ಬಿಟ್ಟುಕೊಡುವ ಅತ್ಯುತ್ತಮ ಪರ್ಯಾಯದ ಮೌಲ್ಯ.",
                    subjectTag: "ಅರ್ಥಶಾಸ್ತ್ರ"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "ಜೀವಶಾಸ್ತ್ರದಲ್ಲಿ ಆಸ್ಮೋಸಿಸ್ ಎಂದರೇನು?",
                    backText: "ದ್ರಾವ್ಯದ ಸಾಂದ್ರತೆ ಕಡಿಮೆ ಇರುವ ಪ್ರದೇಶದಿಂದ ಹೆಚ್ಚು ಇರುವ ಪ್ರದೇಶಕ್ಕೆ ಪೊರೆಯ ಮೂಲಕ ನೀರು ಚಲಿಸುವುದು.",
                    subjectTag: "ಜೀವಶಾಸ್ತ್ರ"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "ಸಂಖ್ಯಾಶಾಸ್ತ್ರದಲ್ಲಿ ಪ್ರಮಾಣಿತ ವಿಚಲನ ಎಂದರೇನು?",
                    backText: "ಮೌಲ್ಯಗಳು ಸರಾಸರಿಯ ಸುತ್ತ ಎಷ್ಟು ಚದುರಿವೆ ಎಂಬುದರ ಅಳತೆ.",
                    subjectTag: "ಸಂಖ್ಯಾಶಾಸ್ತ್ರ"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "ರಸಾಯನಶಾಸ್ತ್ರದಲ್ಲಿ ವೇಗವರ್ಧಕ ಎಂದರೇನು?",
                    backText: "ತಾನು ಖರ್ಚಾಗದೆ ರಾಸಾಯನಿಕ ಕ್ರಿಯೆಯ ವೇಗವನ್ನು ಹೆಚ್ಚಿಸುವ ವಸ್ತು.",
                    subjectTag: "ರಸಾಯನಶಾಸ್ತ್ರ"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "ಮನೋವಿಜ್ಞಾನದಲ್ಲಿ ಅರಿವಿನ ಪಕ್ಷಪಾತ ಎಂದರೇನು?",
                    backText: "ತೀರ್ಮಾನಿಸುವಿಕೆ ಮತ್ತು ನಿರ್ಧಾರ ತೆಗೆದುಕೊಳ್ಳುವಿಕೆಯನ್ನು ತಿರುಚಬಹುದಾದ ವ್ಯವಸ್ಥಿತ ಆಲೋಚನಾ ಮಾದರಿ.",
                    subjectTag: "ಮನೋವಿಜ್ಞಾನ"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "ಭೌತಶಾಸ್ತ್ರದಲ್ಲಿ ವೇಗ ಎಂದರೇನು?",
                    backText: "ವಸ್ತುವಿನ ಚಲನೆಯ ದಿಕ್ಕಿನೊಂದಿಗೆ ಅದರ ಜವ.",
                    subjectTag: "ಭೌತಶಾಸ್ತ್ರ"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "ಕಂಪ್ಯೂಟರ್ ವಿಜ್ಞಾನದಲ್ಲಿ ರಿಕರ್ಷನ್ ಎಂದರೇನು?",
                    backText: "ಒಂದು ಫಂಕ್ಷನ್ ಅದೇ ಸಮಸ್ಯೆಯ ಸಣ್ಣ ರೂಪಗಳನ್ನು ಪರಿಹರಿಸಲು ತನ್ನನ್ನೇ ಕರೆದುಕೊಳ್ಳುವ ವಿಧಾನ.",
                    subjectTag: "ಕಂಪ್ಯೂಟರ್ ವಿಜ್ಞಾನ"
                )
            ]
        ),
        MarketingScreenshotLocaleFixture(
            localizationCode: "ko",
            appleLanguage: "ko",
            appleLocale: "ko_KR",
            reviewCard: MarketingScreenshotCardFixture(
                frontText: "경제학에서 기회비용이란 무엇인가요?",
                backText: """
                어떤 선택을 할 때 포기하는 최선의 대안이 지닌 가치입니다.

                시험 예시: 토요일에 유급 근무를 하는 대신 미시경제학 시험공부를 한다면, 받지 못한 임금은 기회비용의 일부입니다.
                """,
                subjectTag: "경제학"
            ),
            reviewAiDraftMessage: "같은 경제학 주제에서 밀접하게 관련된 개념 중 아직 없는 내용을 다루는 새 플래시카드 6개를 만들어 주세요.",
            conceptCards: [
                MarketingScreenshotCardFixture(
                    frontText: "경제학에서 기회비용이란 무엇인가요?",
                    backText: "어떤 선택을 할 때 포기하는 최선의 대안이 지닌 가치입니다.",
                    subjectTag: "경제학"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "생물학에서 삼투란 무엇인가요?",
                    backText: "용질 농도가 낮은 쪽에서 높은 쪽으로 물이 막을 통과해 이동하는 현상입니다.",
                    subjectTag: "생물학"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "통계학에서 표준편차란 무엇인가요?",
                    backText: "값들이 평균 주위에 얼마나 퍼져 있는지 나타내는 척도입니다.",
                    subjectTag: "통계학"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "화학에서 촉매란 무엇인가요?",
                    backText: "자신은 소모되지 않으면서 화학 반응의 속도를 높이는 물질입니다.",
                    subjectTag: "화학"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "심리학에서 인지 편향이란 무엇인가요?",
                    backText: "판단과 의사결정을 왜곡할 수 있는 체계적인 사고 경향입니다.",
                    subjectTag: "심리학"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "물리학에서 속도란 무엇인가요?",
                    backText: "물체의 빠르기와 운동 방향을 함께 나타내는 양입니다.",
                    subjectTag: "물리학"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "컴퓨터 과학에서 재귀란 무엇인가요?",
                    backText: "함수가 같은 문제의 더 작은 형태에 대해 자기 자신을 호출하여 문제를 해결하는 방법입니다.",
                    subjectTag: "컴퓨터 과학"
                )
            ]
        ),
        MarketingScreenshotLocaleFixture(
            localizationCode: "lt",
            appleLanguage: "lt",
            appleLocale: "lt_LT",
            reviewCard: MarketingScreenshotCardFixture(
                frontText: "Kas ekonomikoje yra alternatyvieji kaštai?",
                backText: """
                Alternatyvieji kaštai yra geriausios atsisakytos alternatyvos vertė, kurios netenkate pasirinkę vieną variantą vietoj kito.

                Egzamino pavyzdys: jei šeštadienį praleidžiate ruošdamiesi mikroekonomikos egzaminui, užuot dirbę apmokamą pamainą, prarastas atlyginimas yra alternatyviųjų kaštų dalis.
                """,
                subjectTag: "ekonomika"
            ),
            reviewAiDraftMessage: "Sukurk 6 naujas korteles ta pačia ekonomikos tema, apimančias glaudžiai susijusias sąvokas, kurių dar neturime.",
            conceptCards: [
                MarketingScreenshotCardFixture(
                    frontText: "Kas ekonomikoje yra alternatyvieji kaštai?",
                    backText: "Geriausios atsisakytos alternatyvos vertė, kurios netenkate pasirinkę vieną variantą vietoj kito.",
                    subjectTag: "ekonomika"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Kas biologijoje yra osmosas?",
                    backText: "Vandens judėjimas pro membraną iš mažesnės ištirpusios medžiagos koncentracijos į didesnę.",
                    subjectTag: "biologija"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Kas statistikoje yra standartinis nuokrypis?",
                    backText: "Matas, rodantis, kaip plačiai reikšmės išsidėsčiusios apie vidurkį.",
                    subjectTag: "statistika"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Kas chemijoje yra katalizatorius?",
                    backText: "Medžiaga, kuri pagreitina cheminę reakciją ir pati joje nesunaudojama.",
                    subjectTag: "chemija"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Kas psichologijoje yra kognityvinis iškraipymas?",
                    backText: "Sistemingas mąstymo modelis, galintis iškreipti vertinimą ir sprendimų priėmimą.",
                    subjectTag: "psichologija"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Kas fizikoje yra greitis?",
                    backText: "Kūno judėjimo sparta kartu su to judėjimo kryptimi.",
                    subjectTag: "fizika"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Kas informatikoje yra rekursija?",
                    backText: "Metodas, kai funkcija sprendžia uždavinį kviesdama pati save mažesnėms to paties uždavinio dalims.",
                    subjectTag: "informatika"
                )
            ]
        ),
        MarketingScreenshotLocaleFixture(
            localizationCode: "lv",
            appleLanguage: "lv",
            appleLocale: "lv_LV",
            reviewCard: MarketingScreenshotCardFixture(
                frontText: "Kas ekonomikā ir alternatīvās izmaksas?",
                backText: """
                Alternatīvās izmaksas ir labākās noraidītās izvēles vērtība, no kuras jūs atsakāties, izvēloties vienu iespēju citas vietā.

                Eksāmena piemērs: ja sestdienu pavadāt, gatavojoties mikroekonomikas eksāmenam, nevis strādājot apmaksātā maiņā, zaudētā alga ir daļa no alternatīvajām izmaksām.
                """,
                subjectTag: "ekonomika"
            ),
            reviewAiDraftMessage: "Izveido 6 jaunas kartītes par to pašu ekonomikas tēmu, aptverot cieši saistītas idejas, kādu mums vēl nav.",
            conceptCards: [
                MarketingScreenshotCardFixture(
                    frontText: "Kas ekonomikā ir alternatīvās izmaksas?",
                    backText: "Labākās noraidītās izvēles vērtība, no kuras jūs atsakāties, izvēloties vienu iespēju citas vietā.",
                    subjectTag: "ekonomika"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Kas bioloģijā ir osmoze?",
                    backText: "Ūdens kustība caur membrānu no zemākas izšķīdušās vielas koncentrācijas uz augstāku.",
                    subjectTag: "bioloģija"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Kas statistikā ir standartnovirze?",
                    backText: "Rādītājs, kas parāda, cik izkliedētas ir vērtības ap vidējo lielumu.",
                    subjectTag: "statistika"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Kas ķīmijā ir katalizators?",
                    backText: "Viela, kas paātrina ķīmisko reakciju un pati tajā netiek patērēta.",
                    subjectTag: "ķīmija"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Kas psiholoģijā ir kognitīvā novirze?",
                    backText: "Sistemātisks domāšanas modelis, kas var izkropļot spriedumus un lēmumu pieņemšanu.",
                    subjectTag: "psiholoģija"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Kas fizikā ir ātrums?",
                    backText: "Ķermeņa kustības ātrums kopā ar šīs kustības virzienu.",
                    subjectTag: "fizika"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Kas datorzinātnē ir rekursija?",
                    backText: "Metode, kurā funkcija atrisina uzdevumu, izsaucot pati sevi mazākām tā paša uzdevuma daļām.",
                    subjectTag: "datorzinātne"
                )
            ]
        ),
        MarketingScreenshotLocaleFixture(
            localizationCode: "ml",
            appleLanguage: "ml",
            appleLocale: "ml_IN",
            reviewCard: MarketingScreenshotCardFixture(
                frontText: "സാമ്പത്തികശാസ്ത്രത്തിൽ അവസരച്ചെലവ് എന്താണ്?",
                backText: """
                ഒരു മാർഗം തിരഞ്ഞെടുക്കുമ്പോൾ ഉപേക്ഷിക്കുന്ന ഏറ്റവും മികച്ച ബദൽ മാർഗത്തിന്റെ മൂല്യം.

                പരീക്ഷയ്ക്കുള്ള ഉദാഹരണം: ശനിയാഴ്ച വേതനം ലഭിക്കുന്ന ജോലിക്ക് പോകുന്നതിനു പകരം സൂക്ഷ്മ സാമ്പത്തികശാസ്ത്ര പരീക്ഷയ്ക്കായി പഠിച്ചാൽ, നഷ്ടമായ വേതനം അവസരച്ചെലവിന്റെ ഭാഗമാണ്.
                """,
                subjectTag: "സാമ്പത്തികശാസ്ത്രം"
            ),
            reviewAiDraftMessage: "ഇതേ സാമ്പത്തികശാസ്ത്ര വിഷയവുമായി അടുത്ത ബന്ധമുള്ള, നമ്മുടെ പക്കൽ ഇതുവരെ ഇല്ലാത്ത ആശയങ്ങളെക്കുറിച്ച് 6 പുതിയ പഠന കാർഡുകൾ ഉണ്ടാക്കൂ.",
            conceptCards: [
                MarketingScreenshotCardFixture(
                    frontText: "സാമ്പത്തികശാസ്ത്രത്തിൽ അവസരച്ചെലവ് എന്താണ്?",
                    backText: "ഒരു മാർഗം തിരഞ്ഞെടുക്കുമ്പോൾ ഉപേക്ഷിക്കുന്ന ഏറ്റവും മികച്ച ബദൽ മാർഗത്തിന്റെ മൂല്യം.",
                    subjectTag: "സാമ്പത്തികശാസ്ത്രം"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "ജീവശാസ്ത്രത്തിൽ ഓസ്മോസിസ് എന്താണ്?",
                    backText: "ലീനപദാർഥത്തിന്റെ സാന്ദ്രത കുറഞ്ഞ ഭാഗത്തുനിന്ന് കൂടിയ ഭാഗത്തേക്ക് ഒരു സ്തരത്തിലൂടെ വെള്ളം നീങ്ങുന്നത്.",
                    subjectTag: "ജീവശാസ്ത്രം"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "സ്ഥിതിവിവരശാസ്ത്രത്തിൽ മാനക വ്യതിയാനം എന്താണ്?",
                    backText: "മൂല്യങ്ങൾ ശരാശരിക്ക് ചുറ്റും എത്രത്തോളം ചിതറിക്കിടക്കുന്നു എന്നതിന്റെ അളവ്.",
                    subjectTag: "സ്ഥിതിവിവരശാസ്ത്രം"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "രസതന്ത്രത്തിൽ ഉൽപ്രേരകം എന്താണ്?",
                    backText: "സ്വയം ഉപഭോഗിക്കപ്പെടാതെ രാസപ്രവർത്തനത്തിന്റെ വേഗം കൂട്ടുന്ന പദാർഥം.",
                    subjectTag: "രസതന്ത്രം"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "മനഃശാസ്ത്രത്തിൽ ബൗദ്ധിക പക്ഷപാതം എന്താണ്?",
                    backText: "വിലയിരുത്തലിനെയും തീരുമാനങ്ങളെയും വികലമാക്കാവുന്ന ചിട്ടയായ ചിന്താരീതി.",
                    subjectTag: "മനഃശാസ്ത്രം"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "ഭൗതികശാസ്ത്രത്തിൽ പ്രവേഗം എന്താണ്?",
                    backText: "ഒരു വസ്തുവിന്റെ ചലനദിശയും വേഗവും ചേർന്ന അളവ്.",
                    subjectTag: "ഭൗതികശാസ്ത്രം"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "കമ്പ്യൂട്ടർ ശാസ്ത്രത്തിൽ റിക്കർഷൻ എന്താണ്?",
                    backText: "ഒരു പ്രശ്നത്തിന്റെ ചെറിയ രൂപങ്ങൾ പരിഹരിക്കാൻ ഒരു ഫങ്ഷൻ സ്വയം വിളിക്കുന്ന രീതി.",
                    subjectTag: "കമ്പ്യൂട്ടർ ശാസ്ത്രം"
                )
            ]
        ),
        MarketingScreenshotLocaleFixture(
            localizationCode: "mr",
            appleLanguage: "mr",
            appleLocale: "mr_IN",
            reviewCard: MarketingScreenshotCardFixture(
                frontText: "अर्थशास्त्रात संधी खर्च म्हणजे काय?",
                backText: """
                एखादा पर्याय निवडताना सोडून दिलेल्या सर्वोत्तम पर्यायाचे मूल्य.

                परीक्षेतील उदाहरण: शनिवारी पगाराची पाळी करण्याऐवजी सूक्ष्म अर्थशास्त्राच्या परीक्षेचा अभ्यास केल्यास, बुडालेला पगार हा संधी खर्चाचा भाग असतो.
                """,
                subjectTag: "अर्थशास्त्र"
            ),
            reviewAiDraftMessage: "याच अर्थशास्त्राच्या विषयाशी जवळून संबंधित आणि आपल्याकडे अजून नसलेल्या संकल्पनांवर ६ नवीन अभ्यास कार्डे तयार कर.",
            conceptCards: [
                MarketingScreenshotCardFixture(
                    frontText: "अर्थशास्त्रात संधी खर्च म्हणजे काय?",
                    backText: "एखादा पर्याय निवडताना सोडून दिलेल्या सर्वोत्तम पर्यायाचे मूल्य.",
                    subjectTag: "अर्थशास्त्र"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "जीवशास्त्रात परासरण म्हणजे काय?",
                    backText: "पटलातून कमी द्राव्य सांद्रतेच्या भागाकडून अधिक द्राव्य सांद्रतेच्या भागाकडे पाण्याची हालचाल.",
                    subjectTag: "जीवशास्त्र"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "सांख्यिकीमध्ये प्रमाण विचलन म्हणजे काय?",
                    backText: "मूल्ये सरासरीभोवती किती विखुरलेली आहेत याचे मोजमाप.",
                    subjectTag: "सांख्यिकी"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "रसायनशास्त्रात उत्प्रेरक म्हणजे काय?",
                    backText: "स्वतः खर्च न होता रासायनिक अभिक्रियेचा वेग वाढवणारा पदार्थ.",
                    subjectTag: "रसायनशास्त्र"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "मानसशास्त्रात संज्ञानात्मक पूर्वग्रह म्हणजे काय?",
                    backText: "विचार करण्याची एक पद्धतशीर प्रवृत्ती, जी मूल्यमापन आणि निर्णयप्रक्रियेला विपरीत वळण देऊ शकते.",
                    subjectTag: "मानसशास्त्र"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "भौतिकशास्त्रात वेग म्हणजे काय?",
                    backText: "वस्तूच्या गतीची दिशा आणि तिची चाल यांचा एकत्रित निर्देश करणारी राशी.",
                    subjectTag: "भौतिकशास्त्र"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "संगणकशास्त्रात रिकर्शन म्हणजे काय?",
                    backText: "ज्यात एखादे फंक्शन त्याच समस्येची लहान रूपे सोडवण्यासाठी स्वतःलाच बोलावते अशी पद्धत.",
                    subjectTag: "संगणकशास्त्र"
                )
            ]
        ),
        MarketingScreenshotLocaleFixture(
            localizationCode: "nb",
            appleLanguage: "nb",
            appleLocale: "nb_NO",
            reviewCard: MarketingScreenshotCardFixture(
                frontText: "Hva er alternativkostnad i økonomi?",
                backText: """
                Verdien av det beste alternativet du gir avkall på når du velger en annen mulighet.

                Eksamenseksempel: Hvis du bruker lørdagen på å lese til en eksamen i mikroøkonomi i stedet for å jobbe en betalt vakt, er den tapte lønnen en del av alternativkostnaden.
                """,
                subjectTag: "økonomi"
            ),
            reviewAiDraftMessage: "Lag 6 nye læringskort om det samme økonomiske emnet, med nært beslektede begreper som vi ikke allerede har.",
            conceptCards: [
                MarketingScreenshotCardFixture(
                    frontText: "Hva er alternativkostnad i økonomi?",
                    backText: "Verdien av det beste alternativet du gir avkall på når du velger en annen mulighet.",
                    subjectTag: "økonomi"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Hva er osmose i biologi?",
                    backText: "Vannets bevegelse gjennom en membran fra lavere til høyere konsentrasjon av oppløste stoffer.",
                    subjectTag: "biologi"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Hva er standardavvik i statistikk?",
                    backText: "Et mål på hvor spredt verdiene ligger rundt gjennomsnittet.",
                    subjectTag: "statistikk"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Hva er en katalysator i kjemi?",
                    backText: "Et stoff som øker farten på en kjemisk reaksjon uten selv å bli brukt opp.",
                    subjectTag: "kjemi"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Hva er en kognitiv skjevhet i psykologi?",
                    backText: "Et systematisk tankemønster som kan forvrenge vurderinger og beslutninger.",
                    subjectTag: "psykologi"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Hva er hastighet som vektor i fysikk?",
                    backText: "Farten til et objekt sammen med retningen det beveger seg i.",
                    subjectTag: "fysikk"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Hva er rekursjon i informatikk?",
                    backText: "En metode der en funksjon løser et problem ved å kalle seg selv på mindre utgaver av det samme problemet.",
                    subjectTag: "informatikk"
                )
            ]
        ),
        MarketingScreenshotLocaleFixture(
            localizationCode: "nl",
            appleLanguage: "nl",
            appleLocale: "nl_NL",
            reviewCard: MarketingScreenshotCardFixture(
                frontText: "Wat zijn opportuniteitskosten in de economie?",
                backText: """
                De waarde van het beste alternatief dat je opgeeft wanneer je voor een andere optie kiest.

                Examenvoorbeeld: als je zaterdag voor een tentamen micro-economie studeert in plaats van een betaalde dienst te werken, maakt het misgelopen loon deel uit van de opportuniteitskosten.
                """,
                subjectTag: "economie"
            ),
            reviewAiDraftMessage: "Maak 6 nieuwe leerkaarten over hetzelfde economische onderwerp, met nauw verwante begrippen die we nog niet hebben.",
            conceptCards: [
                MarketingScreenshotCardFixture(
                    frontText: "Wat zijn opportuniteitskosten in de economie?",
                    backText: "De waarde van het beste alternatief dat je opgeeft wanneer je voor een andere optie kiest.",
                    subjectTag: "economie"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Wat is osmose in de biologie?",
                    backText: "De verplaatsing van water door een membraan van een lagere naar een hogere concentratie opgeloste stoffen.",
                    subjectTag: "biologie"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Wat is standaardafwijking in de statistiek?",
                    backText: "Een maat voor de spreiding van waarden rond het gemiddelde.",
                    subjectTag: "statistiek"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Wat is een katalysator in de scheikunde?",
                    backText: "Een stof die een chemische reactie versnelt zonder daarbij te worden verbruikt.",
                    subjectTag: "scheikunde"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Wat is een cognitieve vertekening in de psychologie?",
                    backText: "Een systematisch denkpatroon dat het oordeel en de besluitvorming kan vertekenen.",
                    subjectTag: "psychologie"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Wat is de snelheidsvector in de natuurkunde?",
                    backText: "De snelheid van een voorwerp samen met de richting waarin het beweegt.",
                    subjectTag: "natuurkunde"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Wat is recursie in de informatica?",
                    backText: "Een methode waarbij een functie een probleem oplost door zichzelf aan te roepen voor kleinere versies van hetzelfde probleem.",
                    subjectTag: "informatica"
                )
            ]
        ),
        MarketingScreenshotLocaleFixture(
            localizationCode: "pa",
            appleLanguage: "pa",
            appleLocale: "pa_IN",
            reviewCard: MarketingScreenshotCardFixture(
                frontText: "ਅਰਥਸ਼ਾਸਤਰ ਵਿੱਚ ਅਵਸਰ ਲਾਗਤ ਕੀ ਹੈ?",
                backText: """
                ਇੱਕ ਵਿਕਲਪ ਚੁਣਨ ਵੇਲੇ ਛੱਡੇ ਗਏ ਸਭ ਤੋਂ ਵਧੀਆ ਬਦਲਵੇਂ ਵਿਕਲਪ ਦਾ ਮੁੱਲ।

                ਇਮਤਿਹਾਨ ਦੀ ਉਦਾਹਰਨ: ਜੇ ਤੁਸੀਂ ਸ਼ਨੀਵਾਰ ਨੂੰ ਤਨਖ਼ਾਹ ਵਾਲੀ ਸ਼ਿਫ਼ਟ ਕਰਨ ਦੀ ਬਜਾਏ ਸੂਖਮ ਅਰਥਸ਼ਾਸਤਰ ਦੇ ਇਮਤਿਹਾਨ ਲਈ ਪੜ੍ਹਦੇ ਹੋ, ਤਾਂ ਗੁਆਈ ਤਨਖ਼ਾਹ ਅਵਸਰ ਲਾਗਤ ਦਾ ਹਿੱਸਾ ਹੈ।
                """,
                subjectTag: "ਅਰਥਸ਼ਾਸਤਰ"
            ),
            reviewAiDraftMessage: "ਅਰਥਸ਼ਾਸਤਰ ਦੇ ਇਸੇ ਵਿਸ਼ੇ ਨਾਲ ਨੇੜਿਓਂ ਜੁੜੇ ਅਜਿਹੇ ਵਿਚਾਰਾਂ ਬਾਰੇ 6 ਨਵੇਂ ਫਲੈਸ਼ਕਾਰਡ ਬਣਾਓ ਜੋ ਸਾਡੇ ਕੋਲ ਅਜੇ ਨਹੀਂ ਹਨ।",
            conceptCards: [
                MarketingScreenshotCardFixture(
                    frontText: "ਅਰਥਸ਼ਾਸਤਰ ਵਿੱਚ ਅਵਸਰ ਲਾਗਤ ਕੀ ਹੈ?",
                    backText: "ਇੱਕ ਵਿਕਲਪ ਚੁਣਨ ਵੇਲੇ ਛੱਡੇ ਗਏ ਸਭ ਤੋਂ ਵਧੀਆ ਬਦਲਵੇਂ ਵਿਕਲਪ ਦਾ ਮੁੱਲ।",
                    subjectTag: "ਅਰਥਸ਼ਾਸਤਰ"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "ਜੀਵ ਵਿਗਿਆਨ ਵਿੱਚ ਪਰਾਸਰਣ ਕੀ ਹੈ?",
                    backText: "ਝਿੱਲੀ ਰਾਹੀਂ ਪਾਣੀ ਦਾ ਘੱਟ ਘੁਲਣਸ਼ੀਲ ਪਦਾਰਥ ਦੀ ਸੰਘਣਤਾ ਵਾਲੇ ਖੇਤਰ ਤੋਂ ਵੱਧ ਸੰਘਣਤਾ ਵਾਲੇ ਖੇਤਰ ਵੱਲ ਜਾਣਾ।",
                    subjectTag: "ਜੀਵ ਵਿਗਿਆਨ"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "ਅੰਕੜਾ ਵਿਗਿਆਨ ਵਿੱਚ ਮਿਆਰੀ ਵਿਛਲਨ ਕੀ ਹੈ?",
                    backText: "ਮੁੱਲ ਔਸਤ ਦੇ ਆਲੇ-ਦੁਆਲੇ ਕਿੰਨੇ ਖਿੰਡੇ ਹੋਏ ਹਨ, ਇਸ ਦਾ ਮਾਪ।",
                    subjectTag: "ਅੰਕੜਾ ਵਿਗਿਆਨ"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "ਰਸਾਇਣ ਵਿਗਿਆਨ ਵਿੱਚ ਉਤਪ੍ਰੇਰਕ ਕੀ ਹੈ?",
                    backText: "ਅਜਿਹਾ ਪਦਾਰਥ ਜੋ ਆਪ ਖ਼ਰਚ ਹੋਏ ਬਿਨਾਂ ਰਸਾਇਣਕ ਕਿਰਿਆ ਨੂੰ ਤੇਜ਼ ਕਰਦਾ ਹੈ।",
                    subjectTag: "ਰਸਾਇਣ ਵਿਗਿਆਨ"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "ਮਨੋਵਿਗਿਆਨ ਵਿੱਚ ਬੋਧਾਤਮਕ ਪੱਖਪਾਤ ਕੀ ਹੈ?",
                    backText: "ਸੋਚਣ ਦਾ ਇੱਕ ਨਿਯਮਤ ਢੰਗ ਜੋ ਪਰਖ ਅਤੇ ਫ਼ੈਸਲੇ ਲੈਣ ਨੂੰ ਵਿਗਾੜ ਸਕਦਾ ਹੈ।",
                    subjectTag: "ਮਨੋਵਿਗਿਆਨ"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "ਭੌਤਿਕ ਵਿਗਿਆਨ ਵਿੱਚ ਵੇਗ ਕੀ ਹੈ?",
                    backText: "ਕਿਸੇ ਵਸਤੂ ਦੀ ਚਾਲ ਅਤੇ ਉਸ ਦੀ ਗਤੀ ਦੀ ਦਿਸ਼ਾ ਦਾ ਸਾਂਝਾ ਮਾਪ।",
                    subjectTag: "ਭੌਤਿਕ ਵਿਗਿਆਨ"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "ਕੰਪਿਊਟਰ ਵਿਗਿਆਨ ਵਿੱਚ ਰਿਕਰਸ਼ਨ ਕੀ ਹੈ?",
                    backText: "ਅਜਿਹੀ ਵਿਧੀ ਜਿਸ ਵਿੱਚ ਇੱਕ ਫੰਕਸ਼ਨ ਉਸੇ ਸਮੱਸਿਆ ਦੇ ਛੋਟੇ ਰੂਪ ਹੱਲ ਕਰਨ ਲਈ ਆਪਣੇ ਆਪ ਨੂੰ ਸੱਦਦਾ ਹੈ।",
                    subjectTag: "ਕੰਪਿਊਟਰ ਵਿਗਿਆਨ"
                )
            ]
        ),
        MarketingScreenshotLocaleFixture(
            localizationCode: "pl",
            appleLanguage: "pl",
            appleLocale: "pl_PL",
            reviewCard: MarketingScreenshotCardFixture(
                frontText: "Czym jest koszt alternatywny w ekonomii?",
                backText: """
                Wartością najlepszej alternatywy, z której rezygnujesz, wybierając inną możliwość.

                Przykład egzaminacyjny: jeśli w sobotę uczysz się do egzaminu z mikroekonomii zamiast pracować na płatnej zmianie, utracone wynagrodzenie jest częścią kosztu alternatywnego.
                """,
                subjectTag: "ekonomia"
            ),
            reviewAiDraftMessage: "Utwórz 6 nowych fiszek na ten sam temat z ekonomii, obejmujących ściśle powiązane pojęcia, których jeszcze nie mamy.",
            conceptCards: [
                MarketingScreenshotCardFixture(
                    frontText: "Czym jest koszt alternatywny w ekonomii?",
                    backText: "Wartością najlepszej alternatywy, z której rezygnujesz, wybierając inną możliwość.",
                    subjectTag: "ekonomia"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Czym jest osmoza w biologii?",
                    backText: "Przemieszczaniem się wody przez błonę z obszaru o niższym stężeniu substancji rozpuszczonych do obszaru o wyższym stężeniu.",
                    subjectTag: "biologia"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Czym jest odchylenie standardowe w statystyce?",
                    backText: "Miarą rozproszenia wartości wokół średniej.",
                    subjectTag: "statystyka"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Czym jest katalizator w chemii?",
                    backText: "Substancją, która przyspiesza reakcję chemiczną, nie zużywając się w jej trakcie.",
                    subjectTag: "chemia"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Czym jest błąd poznawczy w psychologii?",
                    backText: "Systematycznym wzorcem myślenia, który może zniekształcać osąd i podejmowanie decyzji.",
                    subjectTag: "psychologia"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Czym jest prędkość wektorowa w fizyce?",
                    backText: "Wielkością opisującą szybkość ruchu obiektu wraz z jego kierunkiem i zwrotem.",
                    subjectTag: "fizyka"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Czym jest rekurencja w informatyce?",
                    backText: "Metodą, w której funkcja rozwiązuje problem, wywołując samą siebie dla mniejszych wersji tego samego problemu.",
                    subjectTag: "informatyka"
                )
            ]
        ),
        MarketingScreenshotLocaleFixture(
            localizationCode: "ro",
            appleLanguage: "ro",
            appleLocale: "ro_RO",
            reviewCard: MarketingScreenshotCardFixture(
                frontText: "În economie, ce este costul de oportunitate?",
                backText: """
                Valoarea celei mai bune alternative la care renunți când alegi o altă opțiune.

                Exemplu de examen: dacă îți petreci sâmbăta învățând pentru un examen de microeconomie în loc să lucrezi într-o tură plătită, salariul pierdut face parte din costul de oportunitate.
                """,
                subjectTag: "economie"
            ),
            reviewAiDraftMessage: "Creează 6 fișe noi pe aceeași temă de economie, cu idei strâns legate pe care nu le avem deja.",
            conceptCards: [
                MarketingScreenshotCardFixture(
                    frontText: "În economie, ce este costul de oportunitate?",
                    backText: "Valoarea celei mai bune alternative la care renunți când alegi o altă opțiune.",
                    subjectTag: "economie"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "În biologie, ce este osmoza?",
                    backText: "Deplasarea apei printr-o membrană de la o concentrație mai mică de substanțe dizolvate la una mai mare.",
                    subjectTag: "biologie"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "În statistică, ce este abaterea standard?",
                    backText: "O măsură a gradului de dispersie a valorilor în jurul mediei.",
                    subjectTag: "statistică"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "În chimie, ce este un catalizator?",
                    backText: "O substanță care accelerează o reacție chimică fără a fi consumată.",
                    subjectTag: "chimie"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "În psihologie, ce este o eroare cognitivă?",
                    backText: "Un tipar sistematic de gândire care poate distorsiona judecata și luarea deciziilor.",
                    subjectTag: "psihologie"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "În fizică, ce este viteza vectorială?",
                    backText: "O mărime care descrie cât de repede se mișcă un obiect, împreună cu direcția și sensul mișcării.",
                    subjectTag: "fizică"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "În informatică, ce este recursivitatea?",
                    backText: "O metodă prin care o funcție rezolvă o problemă apelându-se pe sine pentru versiuni mai mici ale aceleiași probleme.",
                    subjectTag: "informatică"
                )
            ]
        ),
        MarketingScreenshotLocaleFixture(
            localizationCode: "sk",
            appleLanguage: "sk",
            appleLocale: "sk_SK",
            reviewCard: MarketingScreenshotCardFixture(
                frontText: "Čo sú v ekonómii náklady obetovanej príležitosti?",
                backText: """
                Hodnota najlepšej alternatívy, ktorej sa vzdáte, keď si vyberiete inú možnosť.

                Príklad na skúšku: ak v sobotu namiesto platenej zmeny študujete na skúšku z mikroekonómie, ušlá mzda je súčasťou nákladov obetovanej príležitosti.
                """,
                subjectTag: "ekonómia"
            ),
            reviewAiDraftMessage: "Vytvor 6 nových kartičiek na rovnakú ekonomickú tému s úzko súvisiacimi pojmami, ktoré ešte nemáme.",
            conceptCards: [
                MarketingScreenshotCardFixture(
                    frontText: "Čo sú v ekonómii náklady obetovanej príležitosti?",
                    backText: "Hodnota najlepšej alternatívy, ktorej sa vzdáte, keď si vyberiete inú možnosť.",
                    subjectTag: "ekonómia"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Čo je v biológii osmóza?",
                    backText: "Pohyb vody cez membránu z oblasti s nižšou koncentráciou rozpustených látok do oblasti s vyššou koncentráciou.",
                    subjectTag: "biológia"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Čo je v štatistike smerodajná odchýlka?",
                    backText: "Miera toho, ako sú hodnoty rozptýlené okolo priemeru.",
                    subjectTag: "štatistika"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Čo je v chémii katalyzátor?",
                    backText: "Látka, ktorá urýchľuje chemickú reakciu bez toho, aby sa pri nej spotrebovala.",
                    subjectTag: "chémia"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Čo je v psychológii kognitívne skreslenie?",
                    backText: "Systematický vzorec myslenia, ktorý môže skresľovať úsudok a rozhodovanie.",
                    subjectTag: "psychológia"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Čo je vo fyzike vektor rýchlosti?",
                    backText: "Veličina, ktorá vyjadruje rýchlosť pohybu telesa aj jeho smer.",
                    subjectTag: "fyzika"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Čo je v informatike rekurzia?",
                    backText: "Metóda, pri ktorej funkcia rieši problém volaním samej seba pre menšie verzie toho istého problému.",
                    subjectTag: "informatika"
                )
            ]
        ),
        MarketingScreenshotLocaleFixture(
            localizationCode: "sl",
            appleLanguage: "sl",
            appleLocale: "sl_SI",
            reviewCard: MarketingScreenshotCardFixture(
                frontText: "Kaj so oportunitetni stroški v ekonomiji?",
                backText: """
                Vrednost najboljše alternative, ki se ji odpoveste, ko izberete drugo možnost.

                Primer za izpit: če soboto namesto plačanemu delu namenite učenju za izpit iz mikroekonomije, je izgubljeni zaslužek del oportunitetnih stroškov.
                """,
                subjectTag: "ekonomija"
            ),
            reviewAiDraftMessage: "Ustvari 6 novih učnih kartic na isto ekonomsko temo s tesno povezanimi pojmi, ki jih še nimamo.",
            conceptCards: [
                MarketingScreenshotCardFixture(
                    frontText: "Kaj so oportunitetni stroški v ekonomiji?",
                    backText: "Vrednost najboljše alternative, ki se ji odpoveste, ko izberete drugo možnost.",
                    subjectTag: "ekonomija"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Kaj je osmoza v biologiji?",
                    backText: "Prehajanje vode skozi membrano iz območja z nižjo koncentracijo raztopljenih snovi v območje z višjo koncentracijo.",
                    subjectTag: "biologija"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Kaj je standardni odklon v statistiki?",
                    backText: "Mera razpršenosti vrednosti okoli povprečja.",
                    subjectTag: "statistika"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Kaj je katalizator v kemiji?",
                    backText: "Snov, ki pospeši kemijsko reakcijo, ne da bi se pri tem porabljala.",
                    subjectTag: "kemija"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Kaj je kognitivna pristranskost v psihologiji?",
                    backText: "Sistematičen vzorec razmišljanja, ki lahko izkrivlja presojo in odločanje.",
                    subjectTag: "psihologija"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Kaj je vektor hitrosti v fiziki?",
                    backText: "Količina, ki opisuje hitrost gibanja telesa in njegovo smer.",
                    subjectTag: "fizika"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Kaj je rekurzija v računalništvu?",
                    backText: "Metoda, pri kateri funkcija rešuje problem tako, da kliče samo sebe za manjše različice istega problema.",
                    subjectTag: "računalništvo"
                )
            ]
        ),
        MarketingScreenshotLocaleFixture(
            localizationCode: "sv",
            appleLanguage: "sv",
            appleLocale: "sv_SE",
            reviewCard: MarketingScreenshotCardFixture(
                frontText: "Vad är alternativkostnad inom ekonomi?",
                backText: """
                Värdet av det bästa alternativet du avstår från när du väljer ett annat alternativ.

                Exempel inför tentamen: Om du ägnar lördagen åt att plugga till en tenta i mikroekonomi i stället för att arbeta ett betalt pass, är den förlorade lönen en del av alternativkostnaden.
                """,
                subjectTag: "ekonomi"
            ),
            reviewAiDraftMessage: "Skapa 6 nya pluggkort om samma ekonomiska ämne, med närliggande begrepp som vi inte redan har.",
            conceptCards: [
                MarketingScreenshotCardFixture(
                    frontText: "Vad är alternativkostnad inom ekonomi?",
                    backText: "Värdet av det bästa alternativet du avstår från när du väljer ett annat alternativ.",
                    subjectTag: "ekonomi"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Vad är osmos inom biologi?",
                    backText: "Vattnets rörelse genom ett membran från lägre till högre koncentration av lösta ämnen.",
                    subjectTag: "biologi"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Vad är standardavvikelse inom statistik?",
                    backText: "Ett mått på hur utspridda värdena är kring medelvärdet.",
                    subjectTag: "statistik"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Vad är en katalysator inom kemi?",
                    backText: "Ett ämne som påskyndar en kemisk reaktion utan att självt förbrukas.",
                    subjectTag: "kemi"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Vad är en kognitiv snedvridning inom psykologi?",
                    backText: "Ett systematiskt tankemönster som kan förvränga omdömet och beslutsfattandet.",
                    subjectTag: "psykologi"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Vad är hastighet som vektor inom fysik?",
                    backText: "Ett föremåls fart tillsammans med rörelsens riktning.",
                    subjectTag: "fysik"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Vad är rekursion inom datavetenskap?",
                    backText: "En metod där en funktion löser ett problem genom att anropa sig själv för mindre versioner av samma problem.",
                    subjectTag: "datavetenskap"
                )
            ]
        ),
        MarketingScreenshotLocaleFixture(
            localizationCode: "sw",
            appleLanguage: "sw",
            appleLocale: "sw_KE",
            reviewCard: MarketingScreenshotCardFixture(
                frontText: "Katika uchumi, gharama ya fursa ni nini?",
                backText: """
                Gharama ya fursa ni thamani ya chaguo bora unaloachana nalo unapochagua chaguo moja badala ya lingine.

                Mfano wa mtihani: ukitumia Jumamosi kusomea mtihani wa uchumi mdogo badala ya kufanya zamu inayolipwa, mshahara uliopotea ni sehemu ya gharama ya fursa.
                """,
                subjectTag: "uchumi"
            ),
            reviewAiDraftMessage: "Tengeneza kadi 6 mpya kuhusu mada hiyo hiyo ya uchumi, zikigusia dhana zinazohusiana kwa karibu ambazo bado hatuna.",
            conceptCards: [
                MarketingScreenshotCardFixture(
                    frontText: "Katika uchumi, gharama ya fursa ni nini?",
                    backText: "Thamani ya chaguo bora unaloachana nalo unapochagua chaguo moja badala ya lingine.",
                    subjectTag: "uchumi"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Katika biolojia, osmosisi ni nini?",
                    backText: "Msogeo wa maji kupitia utando kutoka mkusanyiko mdogo wa kiyeyushwa kwenda mkusanyiko mkubwa.",
                    subjectTag: "biolojia"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Katika takwimu, mkengeuko wa kawaida ni nini?",
                    backText: "Kipimo cha jinsi thamani zilivyotawanyika kuzunguka wastani.",
                    subjectTag: "takwimu"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Katika kemia, kichocheo ni nini?",
                    backText: "Kitu kinachoharakisha mmenyuko wa kemikali bila chenyewe kutumika ndani yake.",
                    subjectTag: "kemia"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Katika saikolojia, upendeleo wa kifikra ni nini?",
                    backText: "Mtindo wa kufikiri wa kimfumo unaoweza kupotosha tathmini na uamuzi.",
                    subjectTag: "saikolojia"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Katika fizikia, kasi yenye mwelekeo ni nini?",
                    backText: "Mwendo wa kitu pamoja na mwelekeo wa mwendo huo.",
                    subjectTag: "fizikia"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Katika sayansi ya kompyuta, urudiaji ni nini?",
                    backText: "Mbinu ambapo kazi hutatua tatizo kwa kujiita yenyewe kwa matoleo madogo ya tatizo hilo.",
                    subjectTag: "sayansi ya kompyuta"
                )
            ]
        ),
        MarketingScreenshotLocaleFixture(
            localizationCode: "ta",
            appleLanguage: "ta",
            appleLocale: "ta_IN",
            reviewCard: MarketingScreenshotCardFixture(
                frontText: "பொருளியலில் வாய்ப்புச் செலவு என்றால் என்ன?",
                backText: """
                ஒரு விருப்பத்தைத் தேர்ந்தெடுக்கும்போது கைவிடும் சிறந்த மாற்று விருப்பத்தின் மதிப்பு.

                தேர்வுக்கான எடுத்துக்காட்டு: சனிக்கிழமை ஊதியம் தரும் வேலைக்குச் செல்வதற்குப் பதிலாக நுண்பொருளியல் தேர்வுக்குப் படித்தால், இழந்த ஊதியம் வாய்ப்புச் செலவின் ஒரு பகுதியாகும்.
                """,
                subjectTag: "பொருளியல்"
            ),
            reviewAiDraftMessage: "இதே பொருளியல் தலைப்புடன் நெருங்கிய தொடர்புடைய, நம்மிடம் இன்னும் இல்லாத கருத்துகளை உள்ளடக்கிய 6 புதிய கற்றல் அட்டைகளை உருவாக்கு.",
            conceptCards: [
                MarketingScreenshotCardFixture(
                    frontText: "பொருளியலில் வாய்ப்புச் செலவு என்றால் என்ன?",
                    backText: "ஒரு விருப்பத்தைத் தேர்ந்தெடுக்கும்போது கைவிடும் சிறந்த மாற்று விருப்பத்தின் மதிப்பு.",
                    subjectTag: "பொருளியல்"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "உயிரியலில் சவ்வூடுபரவல் என்றால் என்ன?",
                    backText: "கரைபொருளின் செறிவு குறைந்த பகுதியிலிருந்து அதிகமான பகுதிக்கு ஒரு சவ்வின் வழியாக நீர் நகர்வது.",
                    subjectTag: "உயிரியல்"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "புள்ளியியலில் திட்ட விலக்கம் என்றால் என்ன?",
                    backText: "மதிப்புகள் சராசரியைச் சுற்றி எவ்வளவு பரவியுள்ளன என்பதற்கான அளவீடு.",
                    subjectTag: "புள்ளியியல்"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "வேதியியலில் வினையூக்கி என்றால் என்ன?",
                    backText: "தான் செலவாகாமல் ஒரு வேதிவினையின் வேகத்தை அதிகரிக்கும் பொருள்.",
                    subjectTag: "வேதியியல்"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "உளவியலில் அறிவுசார் சார்பு என்றால் என்ன?",
                    backText: "மதிப்பீட்டையும் முடிவெடுப்பதையும் திரிக்கக்கூடிய முறையான சிந்தனைப் பாங்கு.",
                    subjectTag: "உளவியல்"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "இயற்பியலில் திசைவேகம் என்றால் என்ன?",
                    backText: "ஒரு பொருளின் இயக்கத் திசையுடன் கூடிய அதன் வேகம்.",
                    subjectTag: "இயற்பியல்"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "கணினி அறிவியலில் தற்சுழற்சி என்றால் என்ன?",
                    backText: "ஒரு சிக்கலின் சிறிய வடிவங்களைத் தீர்க்க ஒரு செயல்கூறு தன்னைத்தானே அழைக்கும் முறை.",
                    subjectTag: "கணினி அறிவியல்"
                )
            ]
        ),
        MarketingScreenshotLocaleFixture(
            localizationCode: "te",
            appleLanguage: "te",
            appleLocale: "te_IN",
            reviewCard: MarketingScreenshotCardFixture(
                frontText: "ఆర్థికశాస్త్రంలో అవకాశ వ్యయం అంటే ఏమిటి?",
                backText: """
                ఒక ఎంపికను చేసుకున్నప్పుడు వదులుకునే ఉత్తమ ప్రత్యామ్నాయం విలువ.

                పరీక్ష ఉదాహరణ: శనివారం జీతం వచ్చే షిఫ్ట్‌లో పని చేయకుండా సూక్ష్మ ఆర్థికశాస్త్ర పరీక్ష కోసం చదివితే, కోల్పోయిన జీతం అవకాశ వ్యయంలో భాగం.
                """,
                subjectTag: "ఆర్థికశాస్త్రం"
            ),
            reviewAiDraftMessage: "ఇదే ఆర్థికశాస్త్ర అంశానికి దగ్గరగా సంబంధించిన, మన దగ్గర ఇంకా లేని భావనలపై 6 కొత్త అభ్యాస కార్డులను తయారు చేయి.",
            conceptCards: [
                MarketingScreenshotCardFixture(
                    frontText: "ఆర్థికశాస్త్రంలో అవకాశ వ్యయం అంటే ఏమిటి?",
                    backText: "ఒక ఎంపికను చేసుకున్నప్పుడు వదులుకునే ఉత్తమ ప్రత్యామ్నాయం విలువ.",
                    subjectTag: "ఆర్థికశాస్త్రం"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "జీవశాస్త్రంలో ద్రవాభిసరణం అంటే ఏమిటి?",
                    backText: "ద్రావిత పదార్థ సాంద్రత తక్కువగా ఉన్న ప్రాంతం నుంచి ఎక్కువగా ఉన్న ప్రాంతానికి పొర ద్వారా నీరు కదలడం.",
                    subjectTag: "జీవశాస్త్రం"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "గణాంకశాస్త్రంలో ప్రామాణిక విచలనం అంటే ఏమిటి?",
                    backText: "విలువలు సగటు చుట్టూ ఎంతగా విస్తరించి ఉన్నాయో తెలిపే కొలత.",
                    subjectTag: "గణాంకశాస్త్రం"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "రసాయనశాస్త్రంలో ఉత్ప్రేరకం అంటే ఏమిటి?",
                    backText: "తాను ఖర్చు కాకుండా రసాయన చర్య వేగాన్ని పెంచే పదార్థం.",
                    subjectTag: "రసాయనశాస్త్రం"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "మనోవిజ్ఞానశాస్త్రంలో అభిజ్ఞా పక్షపాతం అంటే ఏమిటి?",
                    backText: "అంచనాలను, నిర్ణయాలను వక్రీకరించగల క్రమబద్ధమైన ఆలోచనా ధోరణి.",
                    subjectTag: "మనోవిజ్ఞానశాస్త్రం"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "భౌతికశాస్త్రంలో వేగం అంటే ఏమిటి?",
                    backText: "వస్తువు గమన దిశతో కూడిన దాని వడి.",
                    subjectTag: "భౌతికశాస్త్రం"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "కంప్యూటర్ శాస్త్రంలో రికర్షన్ అంటే ఏమిటి?",
                    backText: "ఒక ఫంక్షన్ అదే సమస్యలోని చిన్న రూపాలను పరిష్కరించడానికి తనను తానే పిలుచుకునే పద్ధతి.",
                    subjectTag: "కంప్యూటర్ శాస్త్రం"
                )
            ]
        ),
        MarketingScreenshotLocaleFixture(
            localizationCode: "th",
            appleLanguage: "th",
            appleLocale: "th_TH",
            reviewCard: MarketingScreenshotCardFixture(
                frontText: "ในวิชาเศรษฐศาสตร์ ต้นทุนค่าเสียโอกาสคืออะไร?",
                backText: """
                มูลค่าของทางเลือกที่ดีที่สุดที่คุณสละไปเมื่อเลือกอีกทางหนึ่ง

                ตัวอย่างข้อสอบ: หากคุณใช้วันเสาร์อ่านหนังสือสอบเศรษฐศาสตร์จุลภาคแทนการทำงานเป็นกะที่ได้รับค่าจ้าง ค่าจ้างที่เสียไปเป็นส่วนหนึ่งของต้นทุนค่าเสียโอกาส
                """,
                subjectTag: "เศรษฐศาสตร์"
            ),
            reviewAiDraftMessage: "สร้างแฟลชการ์ดใหม่ 6 ใบในหัวข้อเศรษฐศาสตร์เดียวกัน โดยครอบคลุมแนวคิดที่เกี่ยวข้องกันอย่างใกล้ชิดและเรายังไม่มี",
            conceptCards: [
                MarketingScreenshotCardFixture(
                    frontText: "ในวิชาเศรษฐศาสตร์ ต้นทุนค่าเสียโอกาสคืออะไร?",
                    backText: "มูลค่าของทางเลือกที่ดีที่สุดที่คุณสละไปเมื่อเลือกอีกทางหนึ่ง",
                    subjectTag: "เศรษฐศาสตร์"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "ในวิชาชีววิทยา ออสโมซิสคืออะไร?",
                    backText: "การเคลื่อนที่ของน้ำผ่านเยื่อจากบริเวณที่มีความเข้มข้นของตัวถูกละลายต่ำไปยังบริเวณที่มีความเข้มข้นสูง",
                    subjectTag: "ชีววิทยา"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "ในวิชาสถิติ ส่วนเบี่ยงเบนมาตรฐานคืออะไร?",
                    backText: "ค่าที่วัดว่าข้อมูลกระจายตัวรอบค่าเฉลี่ยมากเพียงใด",
                    subjectTag: "สถิติ"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "ในวิชาเคมี ตัวเร่งปฏิกิริยาคืออะไร?",
                    backText: "สารที่เพิ่มอัตราการเกิดปฏิกิริยาเคมีโดยไม่ถูกใช้หมดไปในปฏิกิริยา",
                    subjectTag: "เคมี"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "ในวิชาจิตวิทยา อคติทางความคิดคืออะไร?",
                    backText: "รูปแบบการคิดอย่างเป็นระบบที่อาจบิดเบือนการใช้วิจารณญาณและการตัดสินใจ",
                    subjectTag: "จิตวิทยา"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "ในวิชาฟิสิกส์ ความเร็วคืออะไร?",
                    backText: "อัตราเร็วของวัตถุพร้อมทิศทางการเคลื่อนที่",
                    subjectTag: "ฟิสิกส์"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "ในวิชาวิทยาการคอมพิวเตอร์ การเรียกซ้ำคืออะไร?",
                    backText: "วิธีที่ฟังก์ชันแก้ปัญหาโดยเรียกตัวเองเพื่อแก้ปัญหาแบบเดียวกันที่มีขนาดเล็กลง",
                    subjectTag: "วิทยาการคอมพิวเตอร์"
                )
            ]
        ),
        MarketingScreenshotLocaleFixture(
            localizationCode: "tr",
            appleLanguage: "tr",
            appleLocale: "tr_TR",
            reviewCard: MarketingScreenshotCardFixture(
                frontText: "Ekonomide fırsat maliyeti nedir?",
                backText: """
                Bir seçeneği tercih ettiğinde vazgeçtiğin en iyi alternatifin değeridir.

                Sınav örneği: Cumartesiyi ücretli bir vardiyada çalışmak yerine mikroekonomi sınavına hazırlanarak geçirirsen, kazanamadığın ücret fırsat maliyetinin bir parçasıdır.
                """,
                subjectTag: "ekonomi"
            ),
            reviewAiDraftMessage: "Aynı ekonomi konusunda, yakından ilişkili ve elimizde henüz olmayan kavramları içeren 6 yeni bilgi kartı oluştur.",
            conceptCards: [
                MarketingScreenshotCardFixture(
                    frontText: "Ekonomide fırsat maliyeti nedir?",
                    backText: "Bir seçeneği tercih ettiğinde vazgeçtiğin en iyi alternatifin değeridir.",
                    subjectTag: "ekonomi"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Biyolojide ozmoz nedir?",
                    backText: "Suyun bir zardan, çözünen madde derişiminin düşük olduğu bölgeden yüksek olduğu bölgeye geçmesidir.",
                    subjectTag: "biyoloji"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "İstatistikte standart sapma nedir?",
                    backText: "Değerlerin ortalama etrafında ne kadar yayıldığını gösteren bir ölçüdür.",
                    subjectTag: "istatistik"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Kimyada katalizör nedir?",
                    backText: "Kendisi tüketilmeden kimyasal bir tepkimeyi hızlandıran maddedir.",
                    subjectTag: "kimya"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Psikolojide bilişsel yanlılık nedir?",
                    backText: "Yargıları ve karar vermeyi çarpıtabilecek sistematik bir düşünme örüntüsüdür.",
                    subjectTag: "psikoloji"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Fizikte hız nedir?",
                    backText: "Bir cismin süratini ve hareket yönünü birlikte ifade eden büyüklüktür.",
                    subjectTag: "fizik"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Bilgisayar biliminde özyineleme nedir?",
                    backText: "Bir fonksiyonun, aynı problemin daha küçük biçimleri için kendisini çağırarak çözüm üretmesidir.",
                    subjectTag: "bilgisayar bilimi"
                )
            ]
        ),
        MarketingScreenshotLocaleFixture(
            localizationCode: "uk",
            appleLanguage: "uk",
            appleLocale: "uk_UA",
            reviewCard: MarketingScreenshotCardFixture(
                frontText: "Що таке альтернативна вартість в економіці?",
                backText: """
                Цінність найкращого варіанта, від якого ви відмовляєтеся, обираючи інший.

                Приклад для іспиту: якщо ви витрачаєте суботу на підготовку до іспиту з мікроекономіки замість оплачуваної зміни, втрачена зарплата є частиною альтернативної вартості.
                """,
                subjectTag: "економіка"
            ),
            reviewAiDraftMessage: "Створи 6 нових карток на ту саму тему з економіки, охопивши тісно пов’язані поняття, яких у нас ще немає.",
            conceptCards: [
                MarketingScreenshotCardFixture(
                    frontText: "Що таке альтернативна вартість в економіці?",
                    backText: "Цінність найкращого варіанта, від якого ви відмовляєтеся, обираючи інший.",
                    subjectTag: "економіка"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Що таке осмос у біології?",
                    backText: "Рух води крізь мембрану з ділянки з нижчою концентрацією розчинених речовин до ділянки з вищою концентрацією.",
                    subjectTag: "біологія"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Що таке стандартне відхилення у статистиці?",
                    backText: "Міра того, наскільки значення розкидані навколо середнього.",
                    subjectTag: "статистика"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Що таке каталізатор у хімії?",
                    backText: "Речовина, яка прискорює хімічну реакцію і при цьому не витрачається.",
                    subjectTag: "хімія"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Що таке когнітивне упередження у психології?",
                    backText: "Систематичний шаблон мислення, який може спотворювати судження та ухвалення рішень.",
                    subjectTag: "психологія"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Що таке векторна швидкість у фізиці?",
                    backText: "Величина, що описує швидкість руху об’єкта разом із напрямком його руху.",
                    subjectTag: "фізика"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Що таке рекурсія в інформатиці?",
                    backText: "Метод, за якого функція розв’язує задачу, викликаючи саму себе для менших версій тієї самої задачі.",
                    subjectTag: "інформатика"
                )
            ]
        ),
        MarketingScreenshotLocaleFixture(
            localizationCode: "ur",
            appleLanguage: "ur",
            appleLocale: "ur_PK",
            reviewCard: MarketingScreenshotCardFixture(
                frontText: "معاشیات میں موقعی لاگت کیا ہے؟",
                backText: """
                وہ بہترین متبادل جسے آپ کسی دوسرے انتخاب کی خاطر چھوڑ دیتے ہیں، اس کی قدر۔

                امتحان کی مثال: اگر آپ ہفتے کے دن اجرت والی شفٹ میں کام کرنے کے بجائے خرد معاشیات کے امتحان کی تیاری کریں تو چھوٹ جانے والی اجرت موقعی لاگت کا حصہ ہے۔
                """,
                subjectTag: "معاشیات"
            ),
            reviewAiDraftMessage: "معاشیات کے اسی موضوع پر قریب سے متعلق ایسے تصورات کے بارے میں 6 نئے فلیش کارڈ بنائیں جو ہمارے پاس ابھی نہیں ہیں۔",
            conceptCards: [
                MarketingScreenshotCardFixture(
                    frontText: "معاشیات میں موقعی لاگت کیا ہے؟",
                    backText: "وہ بہترین متبادل جسے آپ کسی دوسرے انتخاب کی خاطر چھوڑ دیتے ہیں، اس کی قدر۔",
                    subjectTag: "معاشیات"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "حیاتیات میں اسموسس کیا ہے؟",
                    backText: "جھلی کے پار پانی کی حرکت، حل شدہ مادے کے کم ارتکاز والے حصے سے زیادہ ارتکاز والے حصے کی طرف۔",
                    subjectTag: "حیاتیات"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "شماریات میں معیاری انحراف کیا ہے؟",
                    backText: "اس بات کی پیمائش کہ قدریں اوسط کے گرد کتنی پھیلی ہوئی ہیں۔",
                    subjectTag: "شماریات"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "کیمیا میں عمل انگیز کیا ہے؟",
                    backText: "ایسا مادہ جو خود صرف ہوئے بغیر کیمیائی تعامل کی رفتار بڑھاتا ہے۔",
                    subjectTag: "کیمیا"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "نفسیات میں ادراکی تعصب کیا ہے؟",
                    backText: "سوچ کا ایک منظم انداز جو رائے قائم کرنے اور فیصلے کرنے میں بگاڑ پیدا کر سکتا ہے۔",
                    subjectTag: "نفسیات"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "طبیعیات میں سمتی رفتار کیا ہے؟",
                    backText: "کسی جسم کی حرکت کی سمت کے ساتھ اس کی تیزی۔",
                    subjectTag: "طبیعیات"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "کمپیوٹر سائنس میں ریکرشن کیا ہے؟",
                    backText: "ایک طریقہ جس میں کوئی فنکشن اسی مسئلے کی چھوٹی صورتیں حل کرنے کے لیے خود کو بلاتا ہے۔",
                    subjectTag: "کمپیوٹر سائنس"
                )
            ]
        ),
        MarketingScreenshotLocaleFixture(
            localizationCode: "vi",
            appleLanguage: "vi",
            appleLocale: "vi_VN",
            reviewCard: MarketingScreenshotCardFixture(
                frontText: "Trong kinh tế học, chi phí cơ hội là gì?",
                backText: """
                Giá trị của phương án tốt nhất mà bạn từ bỏ khi chọn một phương án khác.

                Ví dụ ôn thi: nếu bạn dành thứ Bảy để ôn thi kinh tế vi mô thay vì làm một ca có trả lương, khoản lương bị bỏ lỡ là một phần của chi phí cơ hội.
                """,
                subjectTag: "kinh tế học"
            ),
            reviewAiDraftMessage: "Tạo 6 thẻ ghi nhớ mới về cùng chủ đề kinh tế, bao quát những khái niệm liên quan chặt chẽ mà chúng ta chưa có.",
            conceptCards: [
                MarketingScreenshotCardFixture(
                    frontText: "Trong kinh tế học, chi phí cơ hội là gì?",
                    backText: "Giá trị của phương án tốt nhất mà bạn từ bỏ khi chọn một phương án khác.",
                    subjectTag: "kinh tế học"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Trong sinh học, thẩm thấu là gì?",
                    backText: "Sự di chuyển của nước qua màng từ nơi có nồng độ chất tan thấp đến nơi có nồng độ chất tan cao.",
                    subjectTag: "sinh học"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Trong thống kê, độ lệch chuẩn là gì?",
                    backText: "Thước đo mức độ phân tán của các giá trị quanh giá trị trung bình.",
                    subjectTag: "thống kê"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Trong hóa học, chất xúc tác là gì?",
                    backText: "Chất làm tăng tốc độ phản ứng hóa học mà không bị tiêu hao trong phản ứng.",
                    subjectTag: "hóa học"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Trong tâm lý học, thiên kiến nhận thức là gì?",
                    backText: "Một kiểu tư duy có hệ thống có thể làm sai lệch phán đoán và việc ra quyết định.",
                    subjectTag: "tâm lý học"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Trong vật lý, vận tốc là gì?",
                    backText: "Đại lượng mô tả tốc độ của một vật cùng với hướng chuyển động của vật đó.",
                    subjectTag: "vật lý"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Trong khoa học máy tính, đệ quy là gì?",
                    backText: "Phương pháp trong đó một hàm giải bài toán bằng cách tự gọi chính nó để giải các phiên bản nhỏ hơn của cùng bài toán.",
                    subjectTag: "khoa học máy tính"
                )
            ]
        ),
        MarketingScreenshotLocaleFixture(
            localizationCode: "zu",
            appleLanguage: "zu",
            appleLocale: "zu_ZA",
            reviewCard: MarketingScreenshotCardFixture(
                frontText: "Kwezomnotho, iyini indleko yethuba?",
                backText: """
                Indleko yethuba iyinani lenketho engcono kunazo zonke oyilahlayo lapho ukhetha enye inketho esikhundleni senye.

                Isibonelo sesivivinyo: uma uchitha uMgqibelo ufundela isivivinyo somnotho omncane esikhundleni sokusebenza ishifu ekhokhelwayo, iholo olilahlekelwe liyingxenye yendleko yethuba.
                """,
                subjectTag: "ezomnotho"
            ),
            reviewAiDraftMessage: "Dala amakhadi angu-6 amasha ngesihloko esifanayo sezomnotho, ahlanganisa imiqondo esondelene kakhulu esingakabi nayo.",
            conceptCards: [
                MarketingScreenshotCardFixture(
                    frontText: "Kwezomnotho, iyini indleko yethuba?",
                    backText: "Inani lenketho engcono kunazo zonke oyilahlayo lapho ukhetha enye inketho esikhundleni senye.",
                    subjectTag: "ezomnotho"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Kwibhayoloji, iyini i-osmosis?",
                    backText: "Ukunyakaza kwamanzi ngolwelwesi kusuka ekugxileni okuphansi kwesincibilikisiwe kuya kokuphakeme.",
                    subjectTag: "ibhayoloji"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Kwizibalo, iyini ukuchezuka okujwayelekile?",
                    backText: "Isilinganiso sokuthi amanani asakazeke kangakanani ngokuzungeza isilinganiso.",
                    subjectTag: "izibalo"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Kwikhemistri, iyini i-catalyst?",
                    backText: "Into esheshisa ukusabela kwamakhemikhali ngaphandle kokuthi isetshenziswe kukho.",
                    subjectTag: "ikhemistri"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Kwisayikholoji, iyini ukuchema kwengqondo?",
                    backText: "Iphethini yokucabanga ehlelekile engahlanekezela ukwahlulela nokuthatha izinqumo.",
                    subjectTag: "isayikholoji"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Kwifiziksi, iyini ijubane?",
                    backText: "Isivinini sento kanye nendlela eqonde kuyo ekunyakazeni kwayo.",
                    subjectTag: "ifiziksi"
                ),
                MarketingScreenshotCardFixture(
                    frontText: "Kwisayensi yamakhompiyutha, iyini i-recursion?",
                    backText: "Indlela lapho umsebenzi uxazulula inkinga ngokuzibiza wona ngokwawo ezinguqulweni ezincane zaleyo nkinga.",
                    subjectTag: "isayensi yamakhompiyutha"
                )
            ]
        )
    ]
}

enum MarketingScreenshotFixture {
    static let defaultLocalizationCode: String = "en-US"
    static let reviewFrontScreenshotSlug: String = "review-card-front-app-store-opportunity-cost"
    static let reviewResultScreenshotSlug: String = "review-card-result-app-store-opportunity-cost"
    static let progressScreenshotSlug: String = "progress-app-store-study-history"
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
        try self.waitForAiComposerValue(
            draftText,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )
        let localeFixture = try self.marketingLocaleFixture()

        let composer = self.aiComposerTextFieldElement()
        let attachmentChips = self.app.descendants(matching: .any)
            .matching(identifier: LiveSmokeIdentifier.aiComposerCardAttachmentChip)
        guard self.elementValue(element: composer) == draftText,
              attachmentChips.count == 1,
              attachmentChips.firstMatch.label.hasSuffix(" · \(localeFixture.reviewCard.frontText)")
                || attachmentChips.firstMatch.label.hasSuffix(" · \u{2068}\(localeFixture.reviewCard.frontText)\u{2069}"),
              composer.isHittable,
              attachmentChips.firstMatch.isHittable,
              self.softwareKeyboardIsVisible() == false,
              self.app.alerts.firstMatch.exists == false,
              self.app.sheets.firstMatch.exists == false,
              self.app.descendants(matching: .any)
                .matching(identifier: LiveSmokeIdentifier.aiMessageRow).firstMatch.exists == false else {
            throw LiveSmokeFailure.unexpectedAiConversationState(
                message: "Expected the exact unsent marketing AI draft with one review card attached, no messages, and no keyboard or overlays.",
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }
    }
}
