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
    static let knownInterruptionButtonLabels: [String] = ["Not now", "Not Now", "OK", "Close", "Dismiss", "Cancel", "Allow"]
    static let knownBlockingAlertButtonLabels: [String] = ["OK", "Close", "Dismiss", "Cancel", "Not now", "Not Now", "Allow"]
}

struct LiveSmokeLaunchRequest {
    let resetState: LiveSmokeLaunchResetState?
    let selectedTab: LiveSmokeSelectedTab
    let appNotificationTapType: LiveSmokeAppNotificationTapType?
}

let smokeLogger = Logger(
    subsystem: uiTestBundleIdentifier(),
    category: "ui-smoke"
)
