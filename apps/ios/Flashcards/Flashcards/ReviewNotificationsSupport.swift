import Foundation
import UIKit
import UserNotifications

let reviewNotificationPermissionPromptThreshold: Int = 3
let defaultDailyReminderHour: Int = 10
let defaultDailyReminderMinute: Int = 0
let dailyReminderSchedulingHorizonDays: Int = 7
let defaultInactivityReminderWindowEndHour: Int = 19
let defaultInactivityReminderWindowEndMinute: Int = 0

let reviewNotificationsSettingsUserDefaultsKeyPrefix: String = "review-notifications-settings::"
let reviewNotificationPromptStateUserDefaultsKey: String = "review-notification-prompt-state"
let reviewNotificationSuccessfulReviewCountUserDefaultsKey: String = "review-notification-successful-review-count"
let reviewNotificationScheduledPayloadsUserDefaultsKeyPrefix: String = "review-notification-scheduled-payloads::"
let reviewNotificationLastActiveAtUserDefaultsKey: String = "review-notification-last-active-at"
let reviewNotificationTapMarkerUserInfoKey: String = "reviewNotificationTapMarker"
let reviewNotificationTapMarkerValue: String = "review"
let reviewNotificationPayloadUserInfoKey: String = "reviewNotificationPayload"

let reviewNotificationTapRequestNotificationName = Notification.Name("review-notification-tap-request")
let reviewQueueUpdatedBannerMessage: String = "Review queue updated. Continuing with the latest due card."

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

struct ReviewNotificationTapFallback: Hashable, Sendable {
    let stage: String
    let reason: String
    let workspaceId: String?
    let currentWorkspaceId: String?
    let cardId: String?
    let requestId: String?
    let details: String?
}

enum ReviewNotificationTapRequest: Hashable, Sendable {
    case resolved(ScheduledReviewNotificationPayload)
    case fallback(ReviewNotificationTapFallback)
}

struct ReviewNotificationTapValidationSnapshot: Sendable {
    let databaseURL: URL?
    let activeWorkspaceId: String?
    let payload: ScheduledReviewNotificationPayload
    let now: Date
}

enum ReviewNotificationTapValidationResult: Sendable {
    case resolved(payload: ScheduledReviewNotificationPayload, reviewFilter: ReviewFilter)
    case fallback(ReviewNotificationTapFallback)
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

private enum ReviewNotificationRequestKind: String, Codable {
    case daily
    case inactivity
}

private struct ReviewNotificationRequestPayload: Codable {
    let workspaceId: String
    let reviewFilter: PersistedReviewFilter
    let cardId: String
    let frontText: String
    let scheduledAtMillis: Int64
    let requestId: String
    let kind: ReviewNotificationRequestKind
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

    return (0..<dailyReminderSchedulingHorizonDays).compactMap { offset in
        let scheduledAt: Date
        if offset == 0 {
            scheduledAt = firstScheduledAt
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
                return nil
            }
            scheduledAt = nextScheduledAt
        }

        guard scheduledAt > now else {
            return nil
        }
        return scheduledAt
    }
}

func buildRepeatedReviewNotificationPayloads(
    workspaceId: String,
    currentCard: CurrentReviewNotificationCard,
    scheduledDates: [Date],
    calendar: Calendar,
    mode: ReviewNotificationMode
) -> [ScheduledReviewNotificationPayload] {
    let dateFormatter = DateFormatter()
    dateFormatter.calendar = calendar
    dateFormatter.locale = Locale(identifier: "en_US_POSIX")
    dateFormatter.dateFormat = "yyyy-MM-dd"

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
                suffix: dateFormatter.string(from: scheduledAt)
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

        return buildRepeatedReviewNotificationPayloads(
            workspaceId: snapshot.workspaceId,
            currentCard: currentCard,
            scheduledDates: scheduledDates,
            calendar: calendar,
            mode: mode
        )
    }.value
}

func buildReviewNotificationUserInfo(payload: ScheduledReviewNotificationPayload, kind: ReviewNotificationMode) -> [AnyHashable: Any] {
    let requestPayload = ReviewNotificationRequestPayload(
        workspaceId: payload.workspaceId,
        reviewFilter: payload.reviewFilter,
        cardId: payload.cardId,
        frontText: payload.frontText,
        scheduledAtMillis: payload.scheduledAtMillis,
        requestId: payload.requestId,
        kind: kind == .daily ? .daily : .inactivity
    )
    let encoder = JSONEncoder()
    let data = try? encoder.encode(requestPayload)
    return [
        reviewNotificationTapMarkerUserInfoKey: reviewNotificationTapMarkerValue,
        reviewNotificationPayloadUserInfoKey: data ?? Data()
    ]
}

func parseReviewNotificationTapRequest(userInfo: [AnyHashable: Any]) -> ReviewNotificationTapRequest? {
    let hasMarker = (userInfo[reviewNotificationTapMarkerUserInfoKey] as? String) == reviewNotificationTapMarkerValue
    let hasLegacyPayload = userInfo[reviewNotificationPayloadUserInfoKey] != nil
    guard hasMarker || hasLegacyPayload else {
        return nil
    }
    guard let data = userInfo[reviewNotificationPayloadUserInfoKey] as? Data else {
        return .fallback(
            ReviewNotificationTapFallback(
                stage: "parse",
                reason: "missing_payload_data",
                workspaceId: nil,
                currentWorkspaceId: nil,
                cardId: nil,
                requestId: nil,
                details: nil
            )
        )
    }

    let decoder = JSONDecoder()
    guard let payload = try? decoder.decode(ReviewNotificationRequestPayload.self, from: data) else {
        return .fallback(
            ReviewNotificationTapFallback(
                stage: "parse",
                reason: "invalid_payload",
                workspaceId: nil,
                currentWorkspaceId: nil,
                cardId: nil,
                requestId: nil,
                details: nil
            )
        )
    }

    return .resolved(
        ScheduledReviewNotificationPayload(
            workspaceId: payload.workspaceId,
            reviewFilter: payload.reviewFilter,
            cardId: payload.cardId,
            frontText: payload.frontText,
            scheduledAtMillis: payload.scheduledAtMillis,
            requestId: payload.requestId
        )
    )
}

func resolveReviewNotificationTap(
    snapshot: ReviewNotificationTapValidationSnapshot
) async -> ReviewNotificationTapValidationResult {
    guard snapshot.activeWorkspaceId == snapshot.payload.workspaceId else {
        return .fallback(
            ReviewNotificationTapFallback(
                stage: "resolve",
                reason: "workspace_mismatch",
                workspaceId: snapshot.payload.workspaceId,
                currentWorkspaceId: snapshot.activeWorkspaceId,
                cardId: snapshot.payload.cardId,
                requestId: snapshot.payload.requestId,
                details: nil
            )
        )
    }
    guard let databaseURL = snapshot.databaseURL else {
        return .fallback(
            ReviewNotificationTapFallback(
                stage: "resolve",
                reason: "missing_database",
                workspaceId: snapshot.payload.workspaceId,
                currentWorkspaceId: snapshot.activeWorkspaceId,
                cardId: snapshot.payload.cardId,
                requestId: snapshot.payload.requestId,
                details: nil
            )
        )
    }

    return await Task.detached(priority: .utility) {
        do {
            let reviewFilter = try makeReviewFilter(persistedReviewFilter: snapshot.payload.reviewFilter)
            let database = try LocalDatabase(databaseURL: databaseURL)
            defer {
                try? database.close()
            }
            let currentCard = try database.loadCurrentReviewNotificationCard(
                workspaceId: snapshot.payload.workspaceId,
                reviewFilter: reviewFilter,
                now: snapshot.now
            )
            guard let currentCard else {
                return ReviewNotificationTapValidationResult.fallback(
                    ReviewNotificationTapFallback(
                        stage: "resolve",
                        reason: "missing_current_card",
                        workspaceId: snapshot.payload.workspaceId,
                        currentWorkspaceId: snapshot.activeWorkspaceId,
                        cardId: snapshot.payload.cardId,
                        requestId: snapshot.payload.requestId,
                        details: nil
                    )
                )
            }
            guard currentCard.cardId == snapshot.payload.cardId else {
                return ReviewNotificationTapValidationResult.fallback(
                    ReviewNotificationTapFallback(
                        stage: "resolve",
                        reason: "card_mismatch",
                        workspaceId: snapshot.payload.workspaceId,
                        currentWorkspaceId: snapshot.activeWorkspaceId,
                        cardId: snapshot.payload.cardId,
                        requestId: snapshot.payload.requestId,
                        details: "currentCardId=\(currentCard.cardId)"
                    )
                )
            }
            return .resolved(
                payload: snapshot.payload,
                reviewFilter: reviewFilter
            )
        } catch {
            return .fallback(
                ReviewNotificationTapFallback(
                    stage: "resolve",
                    reason: "resolution_failed",
                    workspaceId: snapshot.payload.workspaceId,
                    currentWorkspaceId: snapshot.activeWorkspaceId,
                    cardId: snapshot.payload.cardId,
                    requestId: snapshot.payload.requestId,
                    details: Flashcards.errorMessage(error: error)
                )
            )
        }
    }.value
}

func logReviewNotificationTapFallback(fallback: ReviewNotificationTapFallback) {
    var metadata: [String: String] = [
        "stage": fallback.stage,
        "reason": fallback.reason
    ]
    if let workspaceId = fallback.workspaceId {
        metadata["workspaceId"] = workspaceId
    }
    if let currentWorkspaceId = fallback.currentWorkspaceId {
        metadata["currentWorkspaceId"] = currentWorkspaceId
    }
    if let cardId = fallback.cardId {
        metadata["cardId"] = cardId
    }
    if let requestId = fallback.requestId {
        metadata["requestId"] = requestId
    }
    if let details = fallback.details {
        metadata["details"] = details
    }
    logFlashcardsError(
        domain: "ios_notifications",
        action: "notification_tap_fallback",
        metadata: metadata
    )
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
