import Foundation
import OSLog

enum LiveSmokeConfiguration {
    static let shortUiTimeoutSeconds: TimeInterval = 10
    static let longUiTimeoutSeconds: TimeInterval = 30
    static let optionalProbeTimeoutSeconds: TimeInterval = 3
    static let reviewInitialProbeTimeoutSeconds: TimeInterval = 15
    static let reviewInteractionTimeoutSeconds: TimeInterval = 10
    static let reviewEmailEnvironmentKey: String = "FLASHCARDS_LIVE_REVIEW_EMAIL"
    static let resetStateEnvironmentKey: String = "FLASHCARDS_UI_TEST_RESET_STATE"
    static let selectedTabEnvironmentKey: String = "FLASHCARDS_UI_TEST_SELECTED_TAB"
    static let appNotificationTapTypeEnvironmentKey: String = "FLASHCARDS_UI_TEST_APP_NOTIFICATION_TAP_TYPE"
    static let maximumStoredBreadcrumbCount: Int = 30
}

struct LiveSmokeLaunchRequest {
    let resetState: LiveSmokeLaunchResetState?
    let selectedTab: LiveSmokeSelectedTab
    let launchLocalization: LiveSmokeLaunchLocalization
    let appNotificationTapType: LiveSmokeAppNotificationTapType?
}

enum LiveSmokeLaunchLocalization: String, CaseIterable {
    case english = "en"
    case arabic = "ar"
    case chineseSimplified = "zh-Hans"
    case german = "de"
    case hindi = "hi"
    case japanese = "ja"
    case russian = "ru"
    case spanishMexico = "es-MX"
    case spanishSpain = "es-ES"

    static var supportedLocalizationCodes: [String] {
        Self.allCases.map { localization in
            localization.rawValue
        }
    }

    var appleLanguage: String {
        self.rawValue
    }

    var appleLocale: String {
        switch self {
        case .english:
            return "en_US"
        case .arabic:
            return "ar_SA"
        case .chineseSimplified:
            return "zh_CN"
        case .german:
            return "de_DE"
        case .hindi:
            return "hi_IN"
        case .japanese:
            return "ja_JP"
        case .russian:
            return "ru_RU"
        case .spanishMexico:
            return "es_MX"
        case .spanishSpain:
            return "es_ES"
        }
    }

    var launchArguments: [String] {
        [
            "-AppleLanguages",
            "(\(self.appleLanguage))",
            "-AppleLocale",
            self.appleLocale
        ]
    }
}

let smokeLogger = Logger(
    subsystem: uiTestBundleIdentifier(),
    category: "ui-smoke"
)
