import Foundation
import XCTest

struct MarketingScreenshotLocaleFixture {
    let localizationCode: String
    let appleLanguage: String
    let appleLocale: String
    let reviewCard: MarketingScreenshotCardFixture
    let reviewAiDraftMessage: String

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

enum MarketingScreenshotFixture {
    static let defaultLocalizationCode: String = "en-US"
    static let reviewFrontScreenshotSlug: String = "review-card-front-app-store-opportunity-cost"
    static let reviewResultScreenshotSlug: String = "review-card-result-app-store-opportunity-cost"
    static let progressScreenshotSlug: String = "progress-app-store-study-history"
    static let cardsScreenshotSlug: String = "cards-list-app-store-vocabulary"
    static let reviewAiDraftScreenshotSlug: String = "review-card-ai-draft-app-store-opportunity-cost"
    static let supportedLocalizationCodes: [String] = MarketingScreenshotFixtureCatalog.supportedLocalizationCodes

    static func localeFixture(localizationCode: String) -> MarketingScreenshotLocaleFixture? {
        guard let cards = MarketingScreenshotFixtureCatalog.localeFixture(localizationCode: localizationCode),
              let launchFixture = Self.launchFixturesByLocalizationCode[cards.localizationCode] else {
            return nil
        }

        return MarketingScreenshotLocaleFixture(
            localizationCode: cards.localizationCode,
            appleLanguage: launchFixture.appleLanguage,
            appleLocale: launchFixture.appleLocale,
            reviewCard: cards.reviewCard,
            reviewAiDraftMessage: launchFixture.reviewAiDraftMessage
        )
    }

    private struct LaunchFixture {
        let appleLanguage: String
        let appleLocale: String
        let reviewAiDraftMessage: String
    }

    private static let launchFixturesByLocalizationCode: [String: LaunchFixture] = [
        "en-US": LaunchFixture(
            appleLanguage: "en",
            appleLocale: "en_US",
            reviewAiDraftMessage: "Create 6 new flashcards on the same economics topic, covering closely related ideas that we do not already have."
        ),
        "ar": LaunchFixture(
            appleLanguage: "ar",
            appleLocale: "ar_SA",
            reviewAiDraftMessage: "أنشئ 6 بطاقات تعليمية جديدة حول الموضوع الاقتصادي نفسه، تغطي أفكارًا مرتبطة به ارتباطًا وثيقًا ولا نملكها بعد."
        ),
        "zh-Hans": LaunchFixture(
            appleLanguage: "zh-Hans",
            appleLocale: "zh_CN",
            reviewAiDraftMessage: "请围绕同一经济学主题再创建 6 张新卡片，覆盖与之密切相关且我们目前还没有的概念。"
        ),
        "zh-Hant": LaunchFixture(
            appleLanguage: "zh-Hant",
            appleLocale: "zh_TW",
            reviewAiDraftMessage: "請針對同一個經濟學主題新增 6 張卡片，涵蓋與這個主題密切相關、目前還沒收錄的概念。"
        ),
        "fr": LaunchFixture(
            appleLanguage: "fr",
            appleLocale: "fr_FR",
            reviewAiDraftMessage: "Crée 6 nouvelles cartes sur le même sujet d'économie, couvrant des notions étroitement liées que nous n'avons pas encore."
        ),
        "de": LaunchFixture(
            appleLanguage: "de",
            appleLocale: "de_DE",
            reviewAiDraftMessage: "Erstelle 6 neue Lernkarten zum selben volkswirtschaftlichen Thema, die eng verwandte Ideen abdecken und die wir noch nicht haben."
        ),
        "hi": LaunchFixture(
            appleLanguage: "hi",
            appleLocale: "hi_IN",
            reviewAiDraftMessage: "इसी अर्थशास्त्र विषय पर 6 नई फ्लैशकार्ड बनाओ, जो इससे करीबी रूप से जुड़े विचारों को कवर करें और जो हमारे पास पहले से मौजूद न हों।"
        ),
        "ja": LaunchFixture(
            appleLanguage: "ja",
            appleLocale: "ja_JP",
            reviewAiDraftMessage: "同じ経済学のテーマについて、関連性が高く、まだ私たちが持っていない内容の新しいフラッシュカードを 6 枚作ってください。"
        ),
        "pt-BR": LaunchFixture(
            appleLanguage: "pt-BR",
            appleLocale: "pt_BR",
            reviewAiDraftMessage: "Crie 6 novos cartões sobre o mesmo tema de economia, cobrindo ideias bem relacionadas que ainda não temos."
        ),
        "pt-PT": LaunchFixture(
            appleLanguage: "pt-PT",
            appleLocale: "pt_PT",
            reviewAiDraftMessage: "Cria 6 cartões novos sobre o mesmo tema de economia, com conceitos relacionados que ainda não temos."
        ),
        "ru": LaunchFixture(
            appleLanguage: "ru",
            appleLocale: "ru_RU",
            reviewAiDraftMessage: "Создай 6 новых карточек по той же теме экономики, которые охватывают тесно связанные идеи и которых у нас ещё нет."
        ),
        "es-MX": LaunchFixture(
            appleLanguage: "es-MX",
            appleLocale: "es_MX",
            reviewAiDraftMessage: "Crea 6 tarjetas nuevas sobre el mismo tema de economía, que cubran ideas estrechamente relacionadas y que todavía no tengamos."
        ),
        "es-ES": LaunchFixture(
            appleLanguage: "es-ES",
            appleLocale: "es_ES",
            reviewAiDraftMessage: "Crea 6 tarjetas nuevas sobre el mismo tema de economía, que cubran ideas estrechamente relacionadas y que todavía no tengamos."
        ),
        "bg": LaunchFixture(
            appleLanguage: "bg",
            appleLocale: "bg_BG",
            reviewAiDraftMessage: "Създай 6 нови карти по същата икономическа тема, които покриват тясно свързани идеи, каквито още нямаме."
        ),
        "bn": LaunchFixture(
            appleLanguage: "bn",
            appleLocale: "bn_BD",
            reviewAiDraftMessage: "একই অর্থনীতির বিষয়ে ঘনিষ্ঠভাবে সম্পর্কিত এমন ধারণা নিয়ে ৬টি নতুন ফ্ল্যাশকার্ড তৈরি করো, যা আমাদের কাছে এখনও নেই।"
        ),
        "ca": LaunchFixture(
            appleLanguage: "ca",
            appleLocale: "ca_ES",
            reviewAiDraftMessage: "Crea 6 fitxes noves sobre el mateix tema d'economia, amb idees estretament relacionades que encara no tinguem."
        ),
        "cs": LaunchFixture(
            appleLanguage: "cs",
            appleLocale: "cs_CZ",
            reviewAiDraftMessage: "Vytvoř 6 nových kartiček na stejné ekonomické téma s úzce souvisejícími pojmy, které ještě nemáme."
        ),
        "da": LaunchFixture(
            appleLanguage: "da",
            appleLocale: "da_DK",
            reviewAiDraftMessage: "Lav 6 nye huskekort om det samme økonomiske emne med nært beslægtede begreber, som vi ikke allerede har."
        ),
        "el": LaunchFixture(
            appleLanguage: "el",
            appleLocale: "el_GR",
            reviewAiDraftMessage: "Δημιούργησε 6 νέες κάρτες για το ίδιο θέμα οικονομικών, με στενά συνδεδεμένες έννοιες που δεν έχουμε ήδη."
        ),
        "et": LaunchFixture(
            appleLanguage: "et",
            appleLocale: "et_EE",
            reviewAiDraftMessage: "Loo 6 uut kaarti sama majandusteema kohta, mis katavad tihedalt seotud mõisteid, mida meil veel ei ole."
        ),
        "fa": LaunchFixture(
            appleLanguage: "fa",
            appleLocale: "fa_IR",
            reviewAiDraftMessage: "6 کارت جدید درباره همان موضوع اقتصادی بساز که مفاهیم نزدیک به آن را پوشش دهد و هنوز آن‌ها را نداریم."
        ),
        "fi": LaunchFixture(
            appleLanguage: "fi",
            appleLocale: "fi_FI",
            reviewAiDraftMessage: "Luo 6 uutta muistikorttia samasta taloustieteen aiheesta. Käsittele läheisesti liittyviä käsitteitä, joista meillä ei vielä ole kortteja."
        ),
        "gu": LaunchFixture(
            appleLanguage: "gu",
            appleLocale: "gu_IN",
            reviewAiDraftMessage: "અર્થશાસ્ત્રના આ જ વિષય પર નજીકથી સંબંધિત એવા વિચારો આવરી લેતાં ૬ નવા ફ્લૅશકાર્ડ બનાવો, જે આપણી પાસે હજી નથી."
        ),
        "he": LaunchFixture(
            appleLanguage: "he",
            appleLocale: "he_IL",
            reviewAiDraftMessage: "צור 6 כרטיסיות חדשות באותו נושא בכלכלה, שעוסקות ברעיונות קרובים שעדיין אין לנו."
        ),
        "hr": LaunchFixture(
            appleLanguage: "hr",
            appleLocale: "hr_HR",
            reviewAiDraftMessage: "Izradi 6 novih kartica na istu ekonomsku temu s usko povezanim pojmovima koje još nemamo."
        ),
        "hu": LaunchFixture(
            appleLanguage: "hu",
            appleLocale: "hu_HU",
            reviewAiDraftMessage: "Készíts 6 új tanulókártyát ugyanerről a közgazdasági témáról, szorosan kapcsolódó fogalmakkal, amelyekről még nincs kártyánk."
        ),
        "id": LaunchFixture(
            appleLanguage: "id",
            appleLocale: "id_ID",
            reviewAiDraftMessage: "Buat 6 kartu belajar baru tentang topik ekonomi yang sama, mencakup konsep yang berkaitan erat dan belum kita miliki."
        ),
        "is": LaunchFixture(
            appleLanguage: "is",
            appleLocale: "is_IS",
            reviewAiDraftMessage: "Búðu til 6 ný spjöld um sama hagfræðiefni sem fjalla um náskyld hugtök sem við eigum ekki þegar."
        ),
        "it": LaunchFixture(
            appleLanguage: "it",
            appleLocale: "it_IT",
            reviewAiDraftMessage: "Crea 6 nuove schede sullo stesso argomento di economia, con concetti strettamente correlati che non abbiamo ancora."
        ),
        "kn": LaunchFixture(
            appleLanguage: "kn",
            appleLocale: "kn_IN",
            reviewAiDraftMessage: "ಇದೇ ಅರ್ಥಶಾಸ್ತ್ರದ ವಿಷಯಕ್ಕೆ ನಿಕಟವಾಗಿ ಸಂಬಂಧಿಸಿದ, ನಮ್ಮ ಬಳಿ ಇನ್ನೂ ಇಲ್ಲದ ಪರಿಕಲ್ಪನೆಗಳ ಕುರಿತು 6 ಹೊಸ ಕಲಿಕಾ ಕಾರ್ಡ್‌ಗಳನ್ನು ರಚಿಸಿ."
        ),
        "ko": LaunchFixture(
            appleLanguage: "ko",
            appleLocale: "ko_KR",
            reviewAiDraftMessage: "같은 경제학 주제에서 밀접하게 관련된 개념 중 아직 없는 내용을 다루는 새 플래시카드 6개를 만들어 주세요."
        ),
        "lt": LaunchFixture(
            appleLanguage: "lt",
            appleLocale: "lt_LT",
            reviewAiDraftMessage: "Sukurk 6 naujas korteles ta pačia ekonomikos tema, apimančias glaudžiai susijusias sąvokas, kurių dar neturime."
        ),
        "lv": LaunchFixture(
            appleLanguage: "lv",
            appleLocale: "lv_LV",
            reviewAiDraftMessage: "Izveido 6 jaunas kartītes par to pašu ekonomikas tēmu, aptverot cieši saistītas idejas, kādu mums vēl nav."
        ),
        "ml": LaunchFixture(
            appleLanguage: "ml",
            appleLocale: "ml_IN",
            reviewAiDraftMessage: "ഇതേ സാമ്പത്തികശാസ്ത്ര വിഷയവുമായി അടുത്ത ബന്ധമുള്ള, നമ്മുടെ പക്കൽ ഇതുവരെ ഇല്ലാത്ത ആശയങ്ങളെക്കുറിച്ച് 6 പുതിയ പഠന കാർഡുകൾ ഉണ്ടാക്കൂ."
        ),
        "mr": LaunchFixture(
            appleLanguage: "mr",
            appleLocale: "mr_IN",
            reviewAiDraftMessage: "याच अर्थशास्त्राच्या विषयाशी जवळून संबंधित आणि आपल्याकडे अजून नसलेल्या संकल्पनांवर ६ नवीन अभ्यास कार्डे तयार कर."
        ),
        "ms": LaunchFixture(
            appleLanguage: "ms",
            appleLocale: "ms_MY",
            reviewAiDraftMessage: "Cipta 6 kad imbas baharu tentang topik ekonomi yang sama, dengan konsep berkait rapat yang belum ada dalam kad kita."
        ),
        "nb": LaunchFixture(
            appleLanguage: "nb",
            appleLocale: "nb_NO",
            reviewAiDraftMessage: "Lag 6 nye læringskort om det samme økonomiske emnet, med nært beslektede begreper som vi ikke allerede har."
        ),
        "nl": LaunchFixture(
            appleLanguage: "nl",
            appleLocale: "nl_NL",
            reviewAiDraftMessage: "Maak 6 nieuwe leerkaarten over hetzelfde economische onderwerp, met nauw verwante begrippen die we nog niet hebben."
        ),
        "or": LaunchFixture(
            appleLanguage: "or",
            appleLocale: "or_IN",
            reviewAiDraftMessage: "ଅର୍ଥଶାସ୍ତ୍ରର ଏହି ବିଷୟ ସହ ଘନିଷ୍ଠ ଭାବେ ଜଡ଼ିତ ଏବଂ ଆମ କାର୍ଡରେ ଏଯାଏଁ ନଥିବା ଧାରଣାଗୁଡ଼ିକ ଉପରେ ୬ଟି ନୂଆ ପଢ଼ା କାର୍ଡ ତିଆରି କର।"
        ),
        "pa": LaunchFixture(
            appleLanguage: "pa",
            appleLocale: "pa_IN",
            reviewAiDraftMessage: "ਅਰਥਸ਼ਾਸਤਰ ਦੇ ਇਸੇ ਵਿਸ਼ੇ ਨਾਲ ਨੇੜਿਓਂ ਜੁੜੇ ਅਜਿਹੇ ਵਿਚਾਰਾਂ ਬਾਰੇ 6 ਨਵੇਂ ਫਲੈਸ਼ਕਾਰਡ ਬਣਾਓ ਜੋ ਸਾਡੇ ਕੋਲ ਅਜੇ ਨਹੀਂ ਹਨ।"
        ),
        "pl": LaunchFixture(
            appleLanguage: "pl",
            appleLocale: "pl_PL",
            reviewAiDraftMessage: "Utwórz 6 nowych fiszek na ten sam temat z ekonomii, obejmujących ściśle powiązane pojęcia, których jeszcze nie mamy."
        ),
        "ro": LaunchFixture(
            appleLanguage: "ro",
            appleLocale: "ro_RO",
            reviewAiDraftMessage: "Creează 6 fișe noi pe aceeași temă de economie, cu idei strâns legate pe care nu le avem deja."
        ),
        "sk": LaunchFixture(
            appleLanguage: "sk",
            appleLocale: "sk_SK",
            reviewAiDraftMessage: "Vytvor 6 nových kartičiek na rovnakú ekonomickú tému s úzko súvisiacimi pojmami, ktoré ešte nemáme."
        ),
        "sl": LaunchFixture(
            appleLanguage: "sl",
            appleLocale: "sl_SI",
            reviewAiDraftMessage: "Ustvari 6 novih učnih kartic na isto ekonomsko temo s tesno povezanimi pojmi, ki jih še nimamo."
        ),
        "sv": LaunchFixture(
            appleLanguage: "sv",
            appleLocale: "sv_SE",
            reviewAiDraftMessage: "Skapa 6 nya pluggkort om samma ekonomiska ämne, med närliggande begrepp som vi inte redan har."
        ),
        "sw": LaunchFixture(
            appleLanguage: "sw",
            appleLocale: "sw_KE",
            reviewAiDraftMessage: "Tengeneza kadi 6 mpya kuhusu mada hiyo hiyo ya uchumi, zikigusia dhana zinazohusiana kwa karibu ambazo bado hatuna."
        ),
        "ta": LaunchFixture(
            appleLanguage: "ta",
            appleLocale: "ta_IN",
            reviewAiDraftMessage: "இதே பொருளியல் தலைப்புடன் நெருங்கிய தொடர்புடைய, நம்மிடம் இன்னும் இல்லாத கருத்துகளை உள்ளடக்கிய 6 புதிய கற்றல் அட்டைகளை உருவாக்கு."
        ),
        "te": LaunchFixture(
            appleLanguage: "te",
            appleLocale: "te_IN",
            reviewAiDraftMessage: "ఇదే ఆర్థికశాస్త్ర అంశానికి దగ్గరగా సంబంధించిన, మన దగ్గర ఇంకా లేని భావనలపై 6 కొత్త అభ్యాస కార్డులను తయారు చేయి."
        ),
        "th": LaunchFixture(
            appleLanguage: "th",
            appleLocale: "th_TH",
            reviewAiDraftMessage: "สร้างแฟลชการ์ดใหม่ 6 ใบในหัวข้อเศรษฐศาสตร์เดียวกัน โดยครอบคลุมแนวคิดที่เกี่ยวข้องกันอย่างใกล้ชิดและเรายังไม่มี"
        ),
        "tr": LaunchFixture(
            appleLanguage: "tr",
            appleLocale: "tr_TR",
            reviewAiDraftMessage: "Aynı ekonomi konusunda, yakından ilişkili ve elimizde henüz olmayan kavramları içeren 6 yeni bilgi kartı oluştur."
        ),
        "uk": LaunchFixture(
            appleLanguage: "uk",
            appleLocale: "uk_UA",
            reviewAiDraftMessage: "Створи 6 нових карток на ту саму тему з економіки, охопивши тісно пов’язані поняття, яких у нас ще немає."
        ),
        "ur": LaunchFixture(
            appleLanguage: "ur",
            appleLocale: "ur_PK",
            reviewAiDraftMessage: "معاشیات کے اسی موضوع پر قریب سے متعلق ایسے تصورات کے بارے میں 6 نئے فلیش کارڈ بنائیں جو ہمارے پاس ابھی نہیں ہیں۔"
        ),
        "vi": LaunchFixture(
            appleLanguage: "vi",
            appleLocale: "vi_VN",
            reviewAiDraftMessage: "Tạo 6 thẻ ghi nhớ mới về cùng chủ đề kinh tế, bao quát những khái niệm liên quan chặt chẽ mà chúng ta chưa có."
        ),
        "zu": LaunchFixture(
            appleLanguage: "zu",
            appleLocale: "zu_ZA",
            reviewAiDraftMessage: "Dala amakhadi angu-6 amasha ngesihloko esifanayo sezomnotho, ahlanganisa imiqondo esondelene kakhulu esingakabi nayo."
        )
    ]
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
