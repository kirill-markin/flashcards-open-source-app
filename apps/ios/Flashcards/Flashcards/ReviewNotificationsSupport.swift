import Foundation
import UIKit
import UserNotifications

let reviewNotificationPermissionPromptThreshold: Int = 3
let defaultDailyReminderHour: Int = 10
let defaultDailyReminderMinute: Int = 0
let dailyReminderSchedulingHorizonDays: Int = 7
let reviewNotificationPendingRequestsLimit: Int = 64
let defaultInactivityReminderWindowEndHour: Int = 19
let defaultInactivityReminderWindowEndMinute: Int = 0

let reviewNotificationsSettingsUserDefaultsKeyPrefix: String = "review-notifications-settings::"
let reviewNotificationPromptStateUserDefaultsKey: String = "review-notification-prompt-state"
let reviewNotificationSuccessfulReviewCountUserDefaultsKey: String = "review-notification-successful-review-count"
let reviewNotificationScheduledPayloadsUserDefaultsKeyPrefix: String = "review-notification-scheduled-payloads::"
let reviewNotificationLastActiveAtUserDefaultsKey: String = "review-notification-last-active-at"
let appNotificationTapTypeUserInfoKey: String = "appNotificationTapType"
let pendingAppNotificationTapUserDefaultsKey: String = "pending-app-notification-tap"
let pendingAppNotificationTapSchemaVersion: Int = 1

enum ReviewNotificationMode: String, Codable, CaseIterable, Identifiable, Hashable, Sendable {
    case daily
    case inactivity

    var id: String {
        self.rawValue
    }

    var title: String {
        switch self {
        case .daily:
            return "Daily"
        case .inactivity:
            return "Inactivity"
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

    /// Only `appActive` clears delivered reminders because the user has already returned
    /// to the app and the old reminders have served their purpose.
    var shouldClearDeliveredReviewNotifications: Bool {
        switch self {
        case .appActive:
            return true
        case .appBackground, .settingsChanged, .permissionChanged, .reviewRecorded, .filterChanged, .workspaceChanged:
            return false
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

struct ReviewNotificationsSettings: Codable, Hashable, Sendable {
    let isEnabled: Bool
    let selectedMode: ReviewNotificationMode
    let daily: DailyReviewNotificationsSettings
    let inactivity: InactivityReviewNotificationsSettings
}

struct NotificationPermissionPromptState: Codable, Hashable, Sendable {
    let hasShownPrePrompt: Bool
    let hasRequestedSystemPermission: Bool
    let hasDismissedPrePrompt: Bool
}

struct ScheduledReviewNotificationPayload: Codable, Hashable, Sendable, Identifiable {
    let workspaceId: String
    let reviewFilter: PersistedReviewFilter
    let cardId: String
    let frontText: String
    let scheduledAtMillis: Int64
    let requestId: String

    var id: String {
        self.requestId
    }
}

struct CurrentReviewNotificationCard: Hashable, Sendable {
    let reviewFilter: PersistedReviewFilter
    let cardId: String
    let frontText: String
}

enum AppNotificationTapType: String, Codable, Hashable, Sendable {
    case reviewReminder
}

enum AppNotificationTapSource: String, Codable, Hashable, Sendable {
    case notificationResponse = "notification_response"
    case uiTestEnvironment = "ui_test_environment"
}

struct AppNotificationTapFallback: Codable, Hashable, Sendable {
    let stage: String
    let reason: String
    let notificationType: String?
    let details: String?
}

enum AppNotificationTapRequest: Codable, Hashable, Sendable {
    case openReviewReminder
    case fallback(AppNotificationTapFallback)
}

struct PendingAppNotificationTapEnvelope: Codable, Hashable, Sendable {
    let schemaVersion: Int
    let request: AppNotificationTapRequest
    let receivedAtMillis: Int64
    let source: AppNotificationTapSource
}

struct ReviewNotificationSchedulingSnapshot: Sendable {
    let databaseURL: URL?
    let workspaceId: String
    let reviewFilter: ReviewFilter
    let now: Date
    let settings: ReviewNotificationsSettings
    let lastActiveAt: Date?
}

enum ReviewNotificationPermissionStatus: Hashable, Sendable {
    case allowed
    case notRequested
    case blocked

    var title: String {
        switch self {
        case .allowed:
            return "Allowed"
        case .notRequested:
            return "Not requested"
        case .blocked:
            return "Blocked"
        }
    }

    var actionTitle: String {
        switch self {
        case .allowed, .blocked:
            return "Open Settings"
        case .notRequested:
            return "Allow Notifications"
        }
    }
}

func makeDefaultReviewNotificationsSettings() -> ReviewNotificationsSettings {
    ReviewNotificationsSettings(
        isEnabled: false,
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
        )
    )
}

func makeDefaultNotificationPermissionPromptState() -> NotificationPermissionPromptState {
    NotificationPermissionPromptState(
        hasShownPrePrompt: false,
        hasRequestedSystemPermission: false,
        hasDismissedPrePrompt: false
    )
}

func makeReviewNotificationsSettingsUserDefaultsKey(workspaceId: String) -> String {
    "\(reviewNotificationsSettingsUserDefaultsKeyPrefix)\(workspaceId)"
}

func makeScheduledReviewNotificationsUserDefaultsKey(workspaceId: String) -> String {
    "\(reviewNotificationScheduledPayloadsUserDefaultsKeyPrefix)\(workspaceId)"
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

func loadScheduledReviewNotifications(
    userDefaults: UserDefaults,
    decoder: JSONDecoder,
    workspaceId: String?
) -> [ScheduledReviewNotificationPayload] {
    guard
        let workspaceId,
        let data = userDefaults.data(forKey: makeScheduledReviewNotificationsUserDefaultsKey(workspaceId: workspaceId))
    else {
        return []
    }

    do {
        return try decoder.decode([ScheduledReviewNotificationPayload].self, from: data)
    } catch {
        userDefaults.removeObject(forKey: makeScheduledReviewNotificationsUserDefaultsKey(workspaceId: workspaceId))
        return []
    }
}

func makeReviewNotificationRequestIdentifier(workspaceId: String, kind: String, suffix: String) -> String {
    "review-notification::\(workspaceId)::\(kind)::\(suffix)"
}

/// Review reminders are identified by the shared `review-notification::` identifier prefix.
func isReviewNotificationRequestIdentifier(identifier: String) -> Bool {
    identifier.hasPrefix("review-notification::")
}

/// Keeps only identifiers that belong to review reminders.
func filterReviewNotificationRequestIdentifiers(identifiers: [String]) -> [String] {
    identifiers.filter(isReviewNotificationRequestIdentifier)
}

/// Returns the identifiers of pending review reminders queued by the app.
func pendingReviewNotificationRequestIdentifiers(
    center: UNUserNotificationCenter
) async -> [String] {
    await withCheckedContinuation { continuation in
        center.getPendingNotificationRequests { requests in
            continuation.resume(
                returning: filterReviewNotificationRequestIdentifiers(
                    identifiers: requests.map(\.identifier)
                )
            )
        }
    }
}

/// Returns the identifiers of delivered review reminders currently shown by Notification Center.
func deliveredReviewNotificationRequestIdentifiers(
    center: UNUserNotificationCenter
) async -> [String] {
    await withCheckedContinuation { continuation in
        center.getDeliveredNotifications { notifications in
            continuation.resume(
                returning: filterReviewNotificationRequestIdentifiers(
                    identifiers: notifications.map(\.request.identifier)
                )
            )
        }
    }
}

/// Removes delivered review reminders from Notification Center.
func removeDeliveredReviewNotifications(
    center: UNUserNotificationCenter
) async {
    let deliveredRequestIdentifiers = await deliveredReviewNotificationRequestIdentifiers(center: center)
    guard deliveredRequestIdentifiers.isEmpty == false else {
        return
    }

    center.removeDeliveredNotifications(withIdentifiers: deliveredRequestIdentifiers)
}

func makeReviewNotificationRequestSuffix(scheduledAt: Date, calendar: Calendar) -> String {
    let dateFormatter = DateFormatter()
    dateFormatter.calendar = calendar
    dateFormatter.locale = Locale(identifier: "en_US_POSIX")
    dateFormatter.dateFormat = "yyyy-MM-dd-HH-mm"
    return dateFormatter.string(from: scheduledAt)
}

func makeReviewNotificationRequestIdentifiers(
    workspaceId: String,
    scheduledPayloads: [ScheduledReviewNotificationPayload]
) -> [String] {
    scheduledPayloads.map(\.requestId)
}

func buildDailyReviewNotificationDates(
    now: Date,
    calendar: Calendar,
    settings: DailyReviewNotificationsSettings
) -> [Date] {
    let startOfToday = calendar.startOfDay(for: now)

    return (0..<dailyReminderSchedulingHorizonDays).compactMap { offset in
        guard let day = calendar.date(byAdding: .day, value: offset, to: startOfToday) else {
            return nil
        }

        let scheduledAt = calendar.date(
            bySettingHour: settings.hour,
            minute: settings.minute,
            second: 0,
            of: day
        )
        guard let scheduledAt, scheduledAt > now else {
            return nil
        }
        return scheduledAt
    }
}

func computeInactivityReminderDate(
    settings: InactivityReviewNotificationsSettings,
    lastActiveAt: Date,
    calendar: Calendar
) -> Date? {
    guard settings.idleMinutes > 0 else {
        return nil
    }

    let candidate = lastActiveAt.addingTimeInterval(TimeInterval(settings.idleMinutes * 60))
    let candidateDay = calendar.startOfDay(for: candidate)
    guard
        let windowStart = calendar.date(
            bySettingHour: settings.windowStartHour,
            minute: settings.windowStartMinute,
            second: 0,
            of: candidateDay
        ),
        let windowEnd = calendar.date(
            bySettingHour: settings.windowEndHour,
            minute: settings.windowEndMinute,
            second: 0,
            of: candidateDay
        ),
        windowStart < windowEnd
    else {
        return nil
    }

    if candidate < windowStart {
        return windowStart
    }
    if candidate <= windowEnd {
        return candidate
    }

    guard let nextDay = calendar.date(byAdding: .day, value: 1, to: candidateDay) else {
        return nil
    }

    return calendar.date(
        bySettingHour: settings.windowStartHour,
        minute: settings.windowStartMinute,
        second: 0,
        of: nextDay
    )
}

func buildInactivityReviewNotificationDates(
    lastActiveAt: Date,
    now: Date,
    calendar: Calendar,
    settings: InactivityReviewNotificationsSettings
) -> [Date] {
    guard let firstScheduledAt = computeInactivityReminderDate(
        settings: settings,
        lastActiveAt: lastActiveAt,
        calendar: calendar
    ) else {
        return []
    }

    let firstScheduledDay = calendar.startOfDay(for: firstScheduledAt)

    return (0..<dailyReminderSchedulingHorizonDays).flatMap { offset -> [Date] in
        let firstScheduledAtForDay: Date
        if offset == 0 {
            firstScheduledAtForDay = firstScheduledAt
        } else {
            guard
                let day = calendar.date(byAdding: .day, value: offset, to: firstScheduledDay),
                let nextScheduledAt = calendar.date(
                    bySettingHour: settings.windowStartHour,
                    minute: settings.windowStartMinute,
                    second: 0,
                    of: day
                )
            else {
                return [Date]()
            }
            firstScheduledAtForDay = nextScheduledAt
        }

        return buildRepeatedInactivityReviewNotificationDatesForDay(
            firstScheduledAt: firstScheduledAtForDay,
            now: now,
            calendar: calendar,
            settings: settings
        )
    }
}

func buildRepeatedReviewNotificationPayloads(
    workspaceId: String,
    currentCard: CurrentReviewNotificationCard,
    scheduledDates: [Date],
    calendar: Calendar,
    mode: ReviewNotificationMode
) -> [ScheduledReviewNotificationPayload] {
    return scheduledDates.map { scheduledAt in
        ScheduledReviewNotificationPayload(
            workspaceId: workspaceId,
            reviewFilter: currentCard.reviewFilter,
            cardId: currentCard.cardId,
            frontText: currentCard.frontText,
            scheduledAtMillis: Int64(scheduledAt.timeIntervalSince1970 * 1000),
            requestId: makeReviewNotificationRequestIdentifier(
                workspaceId: workspaceId,
                kind: mode.rawValue,
                suffix: makeReviewNotificationRequestSuffix(
                    scheduledAt: scheduledAt,
                    calendar: calendar
                )
            )
        )
    }
}

func loadScheduledReviewNotificationPayloads(
    snapshot: ReviewNotificationSchedulingSnapshot
) async throws -> [ScheduledReviewNotificationPayload] {
    guard let databaseURL = snapshot.databaseURL else {
        return []
    }

    return try await Task.detached(priority: .utility) {
        let database = try LocalDatabase(databaseURL: databaseURL)
        defer {
            try? database.close()
        }

        guard let currentCard = try database.loadCurrentReviewNotificationCard(
            workspaceId: snapshot.workspaceId,
            reviewFilter: snapshot.reviewFilter,
            now: snapshot.now
        ) else {
            return []
        }

        let calendar = Calendar.autoupdatingCurrent
        let scheduledDates: [Date]
        let mode = snapshot.settings.selectedMode
        switch mode {
        case .daily:
            scheduledDates = buildDailyReviewNotificationDates(
                now: snapshot.now,
                calendar: calendar,
                settings: snapshot.settings.daily
            )
        case .inactivity:
            guard let lastActiveAt = snapshot.lastActiveAt else {
                return []
            }
            scheduledDates = buildInactivityReviewNotificationDates(
                lastActiveAt: lastActiveAt,
                now: snapshot.now,
                calendar: calendar,
                settings: snapshot.settings.inactivity
            )
        }

        let limitedScheduledDates = Array(scheduledDates.prefix(reviewNotificationPendingRequestsLimit))
        return buildRepeatedReviewNotificationPayloads(
            workspaceId: snapshot.workspaceId,
            currentCard: currentCard,
            scheduledDates: limitedScheduledDates,
            calendar: calendar,
            mode: mode
        )
    }.value
}

private func buildRepeatedInactivityReviewNotificationDatesForDay(
    firstScheduledAt: Date,
    now: Date,
    calendar: Calendar,
    settings: InactivityReviewNotificationsSettings
) -> [Date] {
    guard settings.idleMinutes > 0 else {
        return []
    }
    guard
        let windowEnd = calendar.date(
            bySettingHour: settings.windowEndHour,
            minute: settings.windowEndMinute,
            second: 0,
            of: firstScheduledAt
        ),
        firstScheduledAt <= windowEnd
    else {
        return []
    }

    var scheduledDates: [Date] = []
    var nextScheduledAt: Date? = firstScheduledAt

    while let currentScheduledAt = nextScheduledAt, currentScheduledAt <= windowEnd {
        if currentScheduledAt > now {
            scheduledDates.append(currentScheduledAt)
        }

        nextScheduledAt = calendar.date(
            byAdding: .minute,
            value: settings.idleMinutes,
            to: currentScheduledAt
        )
    }

    return scheduledDates
}

func buildReviewNotificationUserInfo(notificationType: AppNotificationTapType) -> [AnyHashable: Any] {
    return [
        appNotificationTapTypeUserInfoKey: notificationType.rawValue
    ]
}

func appNotificationTapType(request: AppNotificationTapRequest) -> String {
    switch request {
    case .openReviewReminder:
        return AppNotificationTapType.reviewReminder.rawValue
    case .fallback(let fallback):
        return fallback.notificationType ?? "fallback"
    }
}

func savePendingAppNotificationTap(
    envelope: PendingAppNotificationTapEnvelope,
    userDefaults: UserDefaults,
    encoder: JSONEncoder
) throws {
    do {
        let data = try encoder.encode(envelope)
        userDefaults.set(data, forKey: pendingAppNotificationTapUserDefaultsKey)
    } catch {
        throw LocalStoreError.validation(
            "Pending app notification tap could not be saved: \(Flashcards.errorMessage(error: error))"
        )
    }
}

func loadPendingAppNotificationTap(
    userDefaults: UserDefaults,
    decoder: JSONDecoder
) throws -> PendingAppNotificationTapEnvelope? {
    guard let data = userDefaults.data(forKey: pendingAppNotificationTapUserDefaultsKey) else {
        return nil
    }

    do {
        let envelope = try decoder.decode(PendingAppNotificationTapEnvelope.self, from: data)
        guard envelope.schemaVersion == pendingAppNotificationTapSchemaVersion else {
            throw LocalStoreError.validation(
                "Pending app notification tap schema is unsupported: \(envelope.schemaVersion)"
            )
        }
        return envelope
    } catch {
        throw LocalStoreError.validation(
            "Pending app notification tap is invalid: \(Flashcards.errorMessage(error: error))"
        )
    }
}

func clearPendingAppNotificationTap(userDefaults: UserDefaults) {
    userDefaults.removeObject(forKey: pendingAppNotificationTapUserDefaultsKey)
}

func logAppNotificationTapEvent(action: String, metadata: [String: String]) {
    logFlashcardsError(
        domain: "ios_notifications",
        action: action,
        metadata: metadata
    )
}

func makeAppNotificationTapLogMetadata(
    request: AppNotificationTapRequest,
    source: AppNotificationTapSource?,
    appState: String?,
    scenePhase: String?,
    receivedAtMillis: Int64?,
    stage: String?,
    reason: String?,
    details: String?
) -> [String: String] {
    var metadata: [String: String] = [
        "build": appBuildNumber(),
        "notificationType": appNotificationTapType(request: request)
    ]
    if let source {
        metadata["source"] = source.rawValue
    }
    if let appState {
        metadata["appState"] = appState
    }
    if let scenePhase {
        metadata["scenePhaseAtConsume"] = scenePhase
    }
    if let receivedAtMillis {
        metadata["receivedAt"] = String(receivedAtMillis)
    }
    if let stage {
        metadata["stage"] = stage
    }
    if let reason {
        metadata["reason"] = reason
    }
    if let details {
        metadata["details"] = details
    }
    return metadata
}

func parseAppNotificationTapRequest(userInfo: [AnyHashable: Any]) -> AppNotificationTapRequest? {
    guard let rawNotificationType = userInfo[appNotificationTapTypeUserInfoKey] as? String else {
        return nil
    }
    guard let notificationType = AppNotificationTapType(rawValue: rawNotificationType) else {
        return .fallback(
            AppNotificationTapFallback(
                stage: "parse",
                reason: "unsupported_notification_type",
                notificationType: rawNotificationType,
                details: nil
            )
        )
    }

    switch notificationType {
    case .reviewReminder:
        return .openReviewReminder
    }
}

func logAppNotificationTapFallback(fallback: AppNotificationTapFallback) {
    let request = AppNotificationTapRequest.fallback(fallback)
    let metadata = makeAppNotificationTapLogMetadata(
        request: request,
        source: nil,
        appState: nil,
        scenePhase: nil,
        receivedAtMillis: nil,
        stage: fallback.stage,
        reason: fallback.reason,
        details: fallback.details
    )
    logAppNotificationTapEvent(action: "notification_tap_fallback", metadata: metadata)
}

func reviewNotificationPermissionStatus(authorizationStatus: UNAuthorizationStatus) -> ReviewNotificationPermissionStatus {
    switch authorizationStatus {
    case .authorized, .provisional, .ephemeral:
        return .allowed
    case .notDetermined:
        return .notRequested
    case .denied:
        return .blocked
    @unknown default:
        return .blocked
    }
}

func resolveReviewNotificationPermissionStatus() async -> ReviewNotificationPermissionStatus {
    let settings = await UNUserNotificationCenter.current().notificationSettings()
    return reviewNotificationPermissionStatus(authorizationStatus: settings.authorizationStatus)
}
