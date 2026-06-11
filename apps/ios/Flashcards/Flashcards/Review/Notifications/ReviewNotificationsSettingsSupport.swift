import Foundation

let reviewNotificationPermissionPromptThreshold: Int = 6
let defaultDailyReminderHour: Int = 10
let defaultDailyReminderMinute: Int = 0

let defaultInactivityReminderWindowEndHour: Int = 19
let defaultInactivityReminderWindowEndMinute: Int = 0

let reviewNotificationsSettingsUserDefaultsKeyPrefix: String = "review-notifications-settings::"
let reviewNotificationPromptStateUserDefaultsKey: String = "review-notification-prompt-state"
let reviewNotificationSuccessfulReviewCountUserDefaultsKey: String = "review-notification-successful-review-count"

enum ReviewNotificationMode: String, Codable, CaseIterable, Identifiable, Hashable, Sendable {
    case daily
    case inactivity

    var id: String {
        self.rawValue
    }

    var title: String {
        switch self {
        case .daily:
            return String(
                localized: "review_notification.mode.daily",
                table: "Foundation",
                comment: "Daily review notification mode title"
            )
        case .inactivity:
            return String(
                localized: "review_notification.mode.inactivity",
                table: "Foundation",
                comment: "Cards review notification mode title"
            )
        }
    }
}

enum ReviewNotificationsReconcileTrigger: Hashable, Sendable {
    case appActive
    case appBackground
    case settingsChanged
    case permissionChanged
    case reviewRecorded
    case filterChanged
    case workspaceChanged

    /// `appActive` clears delivered reminders because the user has returned to the
    /// app and the old reminders have served their purpose. `reviewRecorded` also
    /// clears them because the moment a card is reviewed, any "review reminder"
    /// notification (and the icon badge it carries) is no longer relevant.
    var shouldClearDeliveredReviewNotifications: Bool {
        switch self {
        case .appActive, .reviewRecorded:
            return true
        case .appBackground, .settingsChanged, .permissionChanged, .filterChanged, .workspaceChanged:
            return false
        }
    }

    var diagnosticValue: String {
        switch self {
        case .appActive:
            return "app_active"
        case .appBackground:
            return "app_background"
        case .settingsChanged:
            return "settings_changed"
        case .permissionChanged:
            return "permission_changed"
        case .reviewRecorded:
            return "review_recorded"
        case .filterChanged:
            return "filter_changed"
        case .workspaceChanged:
            return "workspace_changed"
        }
    }
}

struct DailyReviewNotificationsSettings: Codable, Hashable, Sendable {
    let hour: Int
    let minute: Int
}

struct InactivityReviewNotificationsSettings: Codable, Hashable, Sendable {
    let windowStartHour: Int
    let windowStartMinute: Int
    let windowEndHour: Int
    let windowEndMinute: Int
    let idleMinutes: Int
}

struct ReviewNotificationsSettings: Hashable, Sendable {
    let isEnabled: Bool
    let selectedMode: ReviewNotificationMode
    let daily: DailyReviewNotificationsSettings
    let inactivity: InactivityReviewNotificationsSettings
    let showAppIconBadge: Bool
}

extension ReviewNotificationsSettings: Codable {
    private enum CodingKeys: String, CodingKey {
        case isEnabled
        case selectedMode
        case daily
        case inactivity
        case showAppIconBadge
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.isEnabled = try container.decode(Bool.self, forKey: .isEnabled)
        self.selectedMode = try container.decode(ReviewNotificationMode.self, forKey: .selectedMode)
        self.daily = try container.decode(DailyReviewNotificationsSettings.self, forKey: .daily)
        self.inactivity = try container.decode(InactivityReviewNotificationsSettings.self, forKey: .inactivity)
        // Missing key defaults to ON so existing users get the badge automatically.
        self.showAppIconBadge = try container.decodeIfPresent(Bool.self, forKey: .showAppIconBadge) ?? true
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(self.isEnabled, forKey: .isEnabled)
        try container.encode(self.selectedMode, forKey: .selectedMode)
        try container.encode(self.daily, forKey: .daily)
        try container.encode(self.inactivity, forKey: .inactivity)
        try container.encode(self.showAppIconBadge, forKey: .showAppIconBadge)
    }
}

struct NotificationPermissionPromptState: Codable, Hashable, Sendable {
    let hasShownPrePrompt: Bool
    let hasRequestedSystemPermission: Bool
    let hasDismissedPrePrompt: Bool
}

func makeDefaultReviewNotificationsSettings() -> ReviewNotificationsSettings {
    // Internal reminder categories default to enabled. Delivery is still gated by
    // the current system notification permission state.
    ReviewNotificationsSettings(
        isEnabled: true,
        selectedMode: .daily,
        daily: DailyReviewNotificationsSettings(
            hour: defaultDailyReminderHour,
            minute: defaultDailyReminderMinute
        ),
        inactivity: InactivityReviewNotificationsSettings(
            windowStartHour: defaultDailyReminderHour,
            windowStartMinute: defaultDailyReminderMinute,
            windowEndHour: defaultInactivityReminderWindowEndHour,
            windowEndMinute: defaultInactivityReminderWindowEndMinute,
            idleMinutes: 120
        ),
        showAppIconBadge: true
    )
}

func makeDefaultNotificationPermissionPromptState() -> NotificationPermissionPromptState {
    NotificationPermissionPromptState(
        hasShownPrePrompt: false,
        hasRequestedSystemPermission: false,
        hasDismissedPrePrompt: false
    )
}

func hasEnoughReviewHistoryForNotificationPrompt(reviewCount: Int) -> Bool {
    reviewCount >= reviewNotificationPermissionPromptThreshold
}

func reviewNotificationPendingRequestsLimit(strictRemindersSettings: StrictRemindersSettings) -> Int {
    guard strictRemindersSettings.isEnabled else {
        return appNotificationPendingRequestsLimit
    }

    return max(0, appNotificationPendingRequestsLimit - strictReminderPendingRequestsLimit)
}

func makeReviewNotificationsSettingsUserDefaultsKey(workspaceId: String) -> String {
    "\(reviewNotificationsSettingsUserDefaultsKeyPrefix)\(workspaceId)"
}

func loadReviewNotificationsSettings(
    userDefaults: UserDefaults,
    decoder: JSONDecoder,
    workspaceId: String?
) -> ReviewNotificationsSettings {
    guard
        let workspaceId,
        let data = userDefaults.data(forKey: makeReviewNotificationsSettingsUserDefaultsKey(workspaceId: workspaceId))
    else {
        return makeDefaultReviewNotificationsSettings()
    }

    do {
        return try decoder.decode(ReviewNotificationsSettings.self, from: data)
    } catch {
        userDefaults.removeObject(forKey: makeReviewNotificationsSettingsUserDefaultsKey(workspaceId: workspaceId))
        return makeDefaultReviewNotificationsSettings()
    }
}

func loadNotificationPermissionPromptState(
    userDefaults: UserDefaults,
    decoder: JSONDecoder
) -> NotificationPermissionPromptState {
    guard let data = userDefaults.data(forKey: reviewNotificationPromptStateUserDefaultsKey) else {
        return makeDefaultNotificationPermissionPromptState()
    }

    do {
        return try decoder.decode(NotificationPermissionPromptState.self, from: data)
    } catch {
        userDefaults.removeObject(forKey: reviewNotificationPromptStateUserDefaultsKey)
        return makeDefaultNotificationPermissionPromptState()
    }
}
