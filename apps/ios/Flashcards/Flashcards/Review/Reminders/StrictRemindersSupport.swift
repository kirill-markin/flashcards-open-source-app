import Foundation
import UserNotifications

let strictReminderSchedulingHorizonDays: Int = 7
let strictReminderPendingRequestsLimit: Int = 24
let strictRemindersSettingsUserDefaultsKey: String = "strict-reminders-settings"
let strictReminderScheduledPayloadsUserDefaultsKey: String = "strict-reminder-scheduled-payloads"
let strictReminderLastReviewedAtUserDefaultsKey: String = "strict-reminder-last-reviewed-at"
let strictReminderNotificationScopeUserDefaultsKey: String = "strict-reminder-notification-scope"
let strictReminderNotificationScopeUserInfoKey: String = "strictReminderNotificationScope"

struct StrictRemindersSettings: Codable, Hashable, Sendable {
    let isEnabled: Bool
}

enum StrictReminderOffset: Int, Codable, CaseIterable, Hashable, Sendable, Identifiable {
    case fourHours = 4
    case threeHours = 3
    case twoHours = 2

    var id: Int {
        self.rawValue
    }

    var identifierComponent: String {
        "\(self.rawValue)h"
    }

    var secondsBeforeEndOfDay: TimeInterval {
        TimeInterval(self.rawValue * 60 * 60)
    }

    var notificationBodyText: String {
        switch self {
        case .fourHours:
            return String(
                localized: "strict_reminder.body.4h",
                table: "Foundation",
                comment: "Streak reminder body sent 4 hours before the end of the local day"
            )
        case .threeHours:
            return String(
                localized: "strict_reminder.body.3h",
                table: "Foundation",
                comment: "Streak reminder body sent 3 hours before the end of the local day"
            )
        case .twoHours:
            return String(
                localized: "strict_reminder.body.2h",
                table: "Foundation",
                comment: "Streak reminder body sent 2 hours before the end of the local day"
            )
        }
    }
}

enum StrictRemindersReconcileTrigger: Hashable, Sendable {
    case appActive
    case appBackground
    case settingsChanged
    case permissionChanged
    case reviewRecorded
    case reviewHistoryImported
    case workspaceChanged

    var shouldClearDeliveredStrictReminders: Bool {
        switch self {
        case .appActive:
            return true
        case .appBackground, .settingsChanged, .permissionChanged, .reviewRecorded, .reviewHistoryImported, .workspaceChanged:
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
        case .reviewHistoryImported:
            return "review_history_imported"
        case .workspaceChanged:
            return "workspace_changed"
        }
    }
}

struct ScheduledStrictReminderPayload: Codable, Hashable, Sendable, Identifiable {
    let dayStartMillis: Int64
    let scheduledAtMillis: Int64
    let offset: StrictReminderOffset
    let requestId: String

    var id: String {
        self.requestId
    }

    var notificationBodyText: String {
        self.offset.notificationBodyText
    }
}

struct ScheduledStrictRemindersDiagnosticsRead: Hashable, Sendable {
    let payloads: [ScheduledStrictReminderPayload]
    let status: ScheduledNotificationPayloadReadStatus
}

struct StrictReminderSchedulingSnapshot: Sendable {
    let now: Date
    let calendar: Calendar
    let completedDayStartMillis: Set<Int64>
}

struct StrictReminderCompletedDayResolution: Sendable {
    let completedDayStartMillis: Set<Int64>
    let shouldPersistImportedCompletion: Bool
    let shouldClearPersistedCompletion: Bool
}

struct StrictRemindersReconcileRequest: Equatable, Sendable {
    let now: Date
    let triggers: [StrictRemindersReconcileTrigger]
    let shouldClearDeliveredStrictReminders: Bool
}

func makeDefaultStrictRemindersSettings() -> StrictRemindersSettings {
    // Internal reminder categories default to enabled. Delivery is still gated by
    // the current system notification permission state.
    StrictRemindersSettings(isEnabled: true)
}

func makeStrictRemindersReconcileRequest(
    trigger: StrictRemindersReconcileTrigger,
    now: Date
) -> StrictRemindersReconcileRequest {
    StrictRemindersReconcileRequest(
        now: now,
        triggers: [trigger],
        shouldClearDeliveredStrictReminders: trigger.shouldClearDeliveredStrictReminders
    )
}

func mergeStrictRemindersReconcileTriggers(
    pendingTriggers: [StrictRemindersReconcileTrigger],
    nextTriggers: [StrictRemindersReconcileTrigger]
) -> [StrictRemindersReconcileTrigger] {
    var mergedTriggers: [StrictRemindersReconcileTrigger] = []
    for trigger in pendingTriggers + nextTriggers where mergedTriggers.contains(trigger) == false {
        mergedTriggers.append(trigger)
    }
    return mergedTriggers
}

func strictRemindersReconcileTriggerDiagnosticValue(
    triggers: [StrictRemindersReconcileTrigger]
) -> String {
    let triggerValues: [String] = triggers.map(\.diagnosticValue)
    guard triggerValues.isEmpty == false else {
        return "unknown"
    }
    return triggerValues.joined(separator: "+")
}

func mergeStrictRemindersReconcileRequests(
    pendingRequest: StrictRemindersReconcileRequest?,
    nextRequest: StrictRemindersReconcileRequest
) -> StrictRemindersReconcileRequest {
    guard let pendingRequest else {
        return nextRequest
    }

    return StrictRemindersReconcileRequest(
        now: max(pendingRequest.now, nextRequest.now),
        triggers: mergeStrictRemindersReconcileTriggers(
            pendingTriggers: pendingRequest.triggers,
            nextTriggers: nextRequest.triggers
        ),
        shouldClearDeliveredStrictReminders: pendingRequest.shouldClearDeliveredStrictReminders
            || nextRequest.shouldClearDeliveredStrictReminders
    )
}

func loadStrictRemindersSettings(
    userDefaults: UserDefaults,
    decoder: JSONDecoder
) -> StrictRemindersSettings {
    guard let data = userDefaults.data(forKey: strictRemindersSettingsUserDefaultsKey) else {
        return makeDefaultStrictRemindersSettings()
    }

    do {
        return try decoder.decode(StrictRemindersSettings.self, from: data)
    } catch {
        captureStrictRemindersSilentFailure(
            error: error,
            action: "strict_reminders_settings_load",
            stage: "decode",
            cloudSettings: nil,
            workspaceId: nil,
            configurationMode: nil
        )
        userDefaults.removeObject(forKey: strictRemindersSettingsUserDefaultsKey)
        return makeDefaultStrictRemindersSettings()
    }
}

func loadScheduledStrictReminders(
    userDefaults: UserDefaults,
    decoder: JSONDecoder
) -> [ScheduledStrictReminderPayload] {
    guard let data = userDefaults.data(forKey: strictReminderScheduledPayloadsUserDefaultsKey) else {
        return []
    }

    do {
        return try decoder.decode([ScheduledStrictReminderPayload].self, from: data)
    } catch {
        captureStrictRemindersSilentFailure(
            error: error,
            action: "strict_reminders_scheduled_payloads_load",
            stage: "decode",
            cloudSettings: nil,
            workspaceId: nil,
            configurationMode: nil
        )
        userDefaults.removeObject(forKey: strictReminderScheduledPayloadsUserDefaultsKey)
        return []
    }
}

func readScheduledStrictRemindersForDiagnostics(
    userDefaults: UserDefaults,
    decoder: JSONDecoder
) -> ScheduledStrictRemindersDiagnosticsRead {
    guard let data = userDefaults.data(forKey: strictReminderScheduledPayloadsUserDefaultsKey) else {
        return ScheduledStrictRemindersDiagnosticsRead(payloads: [], status: .readable)
    }

    do {
        return ScheduledStrictRemindersDiagnosticsRead(
            payloads: try decoder.decode([ScheduledStrictReminderPayload].self, from: data),
            status: .readable
        )
    } catch {
        return ScheduledStrictRemindersDiagnosticsRead(payloads: [], status: .unreadable)
    }
}

func captureStrictRemindersSilentFailure(
    error: Error,
    action: String,
    stage: String,
    cloudSettings: CloudSettings?,
    workspaceId: String?,
    configurationMode: CloudServiceConfigurationMode?
) {
    FlashcardsObservability.captureSilentFailure(
        error: error,
        scope: IOSObservationScope(
            feature: .notifications,
            userId: cloudSettings?.linkedUserId,
            workspaceId: workspaceId,
            requestId: nil,
            clientRequestId: nil,
            sessionId: nil,
            runId: nil,
            cloudState: cloudSettings?.cloudState,
            configurationMode: configurationMode
        ),
        action: action,
        stage: stage,
        statusCode: nil,
        backendCode: nil,
        requestId: nil
    )
}

func strictReminderDayStartMillis(date: Date) -> Int64 {
    Int64(date.timeIntervalSince1970 * 1_000)
}

func loadStrictReminderCompletedDayStartMillis(
    userDefaults: UserDefaults,
    now: Date,
    calendar: Calendar
) -> Set<Int64> {
    guard let rawValue = userDefaults.object(forKey: strictReminderLastReviewedAtUserDefaultsKey) as? TimeInterval else {
        return []
    }

    let lastReviewedAt = Date(timeIntervalSince1970: rawValue)
    let startOfToday = calendar.startOfDay(for: now)
    guard let startOfTomorrow = calendar.date(byAdding: .day, value: 1, to: startOfToday) else {
        return []
    }
    guard lastReviewedAt >= startOfToday && lastReviewedAt < startOfTomorrow else {
        return []
    }

    return [strictReminderDayStartMillis(date: startOfToday)]
}

func persistStrictReminderLastReviewedAt(
    userDefaults: UserDefaults,
    reviewedAt: Date
) {
    userDefaults.set(reviewedAt.timeIntervalSince1970, forKey: strictReminderLastReviewedAtUserDefaultsKey)
}

func clearStrictReminderLastReviewedAt(userDefaults: UserDefaults) {
    userDefaults.removeObject(forKey: strictReminderLastReviewedAtUserDefaultsKey)
}

func clearStoredStrictReminders(userDefaults: UserDefaults) {
    clearStrictReminderLastReviewedAt(userDefaults: userDefaults)
    userDefaults.removeObject(forKey: strictReminderScheduledPayloadsUserDefaultsKey)
}

func storedStrictReminderNotificationScope(userDefaults: UserDefaults) -> String? {
    guard let storedScope = userDefaults.string(forKey: strictReminderNotificationScopeUserDefaultsKey),
          storedScope.isEmpty == false else {
        return nil
    }

    return storedScope
}

func loadStrictReminderNotificationScope(userDefaults: UserDefaults) -> String {
    if let storedScope = storedStrictReminderNotificationScope(userDefaults: userDefaults) {
        return storedScope
    }

    let createdScope = UUID().uuidString.lowercased()
    userDefaults.set(createdScope, forKey: strictReminderNotificationScopeUserDefaultsKey)
    return createdScope
}

@discardableResult
func rotateStrictReminderNotificationScope(userDefaults: UserDefaults) -> String {
    let nextScope = UUID().uuidString.lowercased()
    userDefaults.set(nextScope, forKey: strictReminderNotificationScopeUserDefaultsKey)
    return nextScope
}

func buildStrictReminderNotificationUserInfo(scope: String) -> [AnyHashable: Any] {
    [
        appNotificationTapTypeUserInfoKey: AppNotificationTapType.strictReminder.rawValue,
        strictReminderNotificationScopeUserInfoKey: scope
    ]
}

func shouldRemoveStrictReminderNotification(
    userInfo: [AnyHashable: Any],
    removalScope: String?
) -> Bool {
    guard parseAppNotificationTapRequest(userInfo: userInfo) == .openStrictReminder else {
        return false
    }

    guard let removalScope, removalScope.isEmpty == false else {
        return userInfo[strictReminderNotificationScopeUserInfoKey] == nil
    }

    guard let notificationScope = userInfo[strictReminderNotificationScopeUserInfoKey] as? String,
          notificationScope.isEmpty == false else {
        return true
    }

    return notificationScope == removalScope
}

func isCurrentStrictReminderNotification(userInfo: [AnyHashable: Any], userDefaults: UserDefaults) -> Bool {
    guard let notificationScope = userInfo[strictReminderNotificationScopeUserInfoKey] as? String,
          notificationScope.isEmpty == false else {
        return false
    }

    return notificationScope == loadStrictReminderNotificationScope(userDefaults: userDefaults)
}

func strictReminderRemovalScopes(currentScope: String?) -> [String?] {
    guard let currentScope, currentScope.isEmpty == false else {
        return [nil]
    }

    return [currentScope, nil]
}

func loadStrictReminderImportedCompletedDayStartMillis(
    databaseURL: URL?,
    now: Date,
    calendar: Calendar
) async throws -> Set<Int64> {
    guard let databaseURL else {
        return []
    }

    let startOfToday = calendar.startOfDay(for: now)
    guard let startOfTomorrow = calendar.date(byAdding: .day, value: 1, to: startOfToday) else {
        throw LocalStoreError.validation(
            "Strict reminder next day start could not be computed for \(formatIsoTimestamp(date: startOfToday))"
        )
    }

    return try await Task.detached(priority: .utility) {
        let database = try LocalDatabase(databaseURL: databaseURL)
        defer {
            try? database.close()
        }

        let hasImportedReviewEventToday = try database.hasAppWideReviewEvent(
            start: startOfToday,
            end: startOfTomorrow
        )
        guard hasImportedReviewEventToday else {
            return []
        }

        return [strictReminderDayStartMillis(date: startOfToday)]
    }.value
}

func resolveStrictReminderCompletedDayResolution(
    persistedCompletedDayStartMillis: Set<Int64>,
    importedCompletedDayStartMillis: Set<Int64>,
    prefersImportedCurrentDayCompletion: Bool
) -> StrictReminderCompletedDayResolution {
    if prefersImportedCurrentDayCompletion {
        let shouldPersistImportedCompletion = importedCompletedDayStartMillis.isEmpty == false
            && persistedCompletedDayStartMillis.isSuperset(of: importedCompletedDayStartMillis) == false

        return StrictReminderCompletedDayResolution(
            completedDayStartMillis: importedCompletedDayStartMillis,
            shouldPersistImportedCompletion: shouldPersistImportedCompletion,
            shouldClearPersistedCompletion: importedCompletedDayStartMillis.isEmpty
                && persistedCompletedDayStartMillis.isEmpty == false
        )
    }

    let combinedCompletedDayStartMillis = persistedCompletedDayStartMillis.union(importedCompletedDayStartMillis)
    let shouldPersistImportedCompletion = importedCompletedDayStartMillis.isEmpty == false
        && persistedCompletedDayStartMillis.isSuperset(of: importedCompletedDayStartMillis) == false

    return StrictReminderCompletedDayResolution(
        completedDayStartMillis: combinedCompletedDayStartMillis,
        shouldPersistImportedCompletion: shouldPersistImportedCompletion,
        shouldClearPersistedCompletion: false
    )
}

func makeStrictReminderRequestIdentifier(
    offset: StrictReminderOffset,
    scheduledAt: Date,
    calendar: Calendar
) -> String {
    "strict-reminder::\(offset.identifierComponent)::\(makeReviewNotificationRequestSuffix(scheduledAt: scheduledAt, calendar: calendar))"
}

func isStrictReminderRequestIdentifier(identifier: String) -> Bool {
    identifier.hasPrefix("strict-reminder::")
}

func filterStrictReminderRequestIdentifiers(identifiers: [String]) -> [String] {
    identifiers.filter(isStrictReminderRequestIdentifier)
}

func acceptedStrictReminderPayloads(
    payloads: [ScheduledStrictReminderPayload],
    pendingRequestIdentifiers: [String]
) -> [ScheduledStrictReminderPayload] {
    let pendingRequestIdentifierSet: Set<String> = Set(pendingRequestIdentifiers)
    return payloads.filter { payload in
        pendingRequestIdentifierSet.contains(payload.requestId)
    }
}

func strictReminderScheduledAtMillisRange(
    payloads: [ScheduledStrictReminderPayload]
) -> NotificationScheduledAtMillisRange {
    notificationScheduledAtMillisRange(
        scheduledAtMillisValues: payloads.map(\.scheduledAtMillis)
    )
}

func strictReminderSchedulingDelaySecondsRange(
    payloads: [ScheduledStrictReminderPayload],
    now: Date
) -> NotificationSchedulingDelaySecondsRange {
    notificationSchedulingDelaySecondsRange(
        scheduledAtMillisValues: payloads.map(\.scheduledAtMillis),
        now: now
    )
}

func pendingStrictReminderRequestIdentifiers(
    center: UNUserNotificationCenter
) async -> [String] {
    await withCheckedContinuation { continuation in
        center.getPendingNotificationRequests { requests in
            continuation.resume(
                returning: filterStrictReminderRequestIdentifiers(
                    identifiers: requests.map(\.identifier)
                )
            )
        }
    }
}

func removePendingStrictReminders(
    center: UNUserNotificationCenter
) async {
    await removePendingStrictReminders(center: center, userDefaults: .standard)
}

func removePendingStrictReminders(
    center: UNUserNotificationCenter,
    userDefaults: UserDefaults
) async {
    for removalScope in strictReminderRemovalScopes(
        currentScope: storedStrictReminderNotificationScope(userDefaults: userDefaults)
    ) {
        await removePendingStrictReminders(center: center, removalScope: removalScope)
    }
}

func removePendingStrictReminders(
    center: UNUserNotificationCenter,
    removalScope: String?
) async {
    let pendingRequestIdentifiers = await withCheckedContinuation { continuation in
        center.getPendingNotificationRequests { requests in
            let matchingIdentifiers: [String] = requests.compactMap { request -> String? in
                guard isStrictReminderRequestIdentifier(identifier: request.identifier) else {
                    return nil
                }
                guard shouldRemoveStrictReminderNotification(
                    userInfo: request.content.userInfo,
                    removalScope: removalScope
                ) else {
                    return nil
                }

                return request.identifier
            }
            continuation.resume(
                returning: matchingIdentifiers
            )
        }
    }
    guard pendingRequestIdentifiers.isEmpty == false else {
        return
    }

    center.removePendingNotificationRequests(withIdentifiers: pendingRequestIdentifiers)
}

func deliveredStrictReminderRequestIdentifiers(
    center: UNUserNotificationCenter
) async -> [String] {
    await withCheckedContinuation { continuation in
        center.getDeliveredNotifications { notifications in
            continuation.resume(
                returning: filterStrictReminderRequestIdentifiers(
                    identifiers: notifications.map(\.request.identifier)
                )
            )
        }
    }
}

func deliveredStrictReminderRequestIdentifiers(
    center: UNUserNotificationCenter,
    removalScope: String?
) async -> [String] {
    return await withCheckedContinuation { continuation in
        center.getDeliveredNotifications { notifications in
            let matchingIdentifiers: [String] = notifications.compactMap { notification -> String? in
                guard isStrictReminderRequestIdentifier(identifier: notification.request.identifier) else {
                    return nil
                }
                guard shouldRemoveStrictReminderNotification(
                    userInfo: notification.request.content.userInfo,
                    removalScope: removalScope
                ) else {
                    return nil
                }

                return notification.request.identifier
            }
            continuation.resume(
                returning: matchingIdentifiers
            )
        }
    }
}

func removeDeliveredStrictReminders(
    center: UNUserNotificationCenter
) async {
    await removeDeliveredStrictReminders(center: center, userDefaults: .standard)
}

func removeDeliveredStrictReminders(
    center: UNUserNotificationCenter,
    userDefaults: UserDefaults
) async {
    for removalScope in strictReminderRemovalScopes(
        currentScope: storedStrictReminderNotificationScope(userDefaults: userDefaults)
    ) {
        await removeDeliveredStrictReminders(center: center, removalScope: removalScope)
    }
}

func removeDeliveredStrictReminders(
    center: UNUserNotificationCenter,
    removalScope: String?
) async {
    let deliveredRequestIdentifiers = await deliveredStrictReminderRequestIdentifiers(
        center: center,
        removalScope: removalScope
    )
    guard deliveredRequestIdentifiers.isEmpty == false else {
        return
    }

    center.removeDeliveredNotifications(withIdentifiers: deliveredRequestIdentifiers)
}

func removePendingAndDeliveredStrictReminders(
    center: UNUserNotificationCenter
) async {
    await removePendingAndDeliveredStrictReminders(center: center, userDefaults: .standard)
}

func removePendingAndDeliveredStrictReminders(
    center: UNUserNotificationCenter,
    userDefaults: UserDefaults
) async {
    for removalScope in strictReminderRemovalScopes(
        currentScope: storedStrictReminderNotificationScope(userDefaults: userDefaults)
    ) {
        await removePendingAndDeliveredStrictReminders(center: center, removalScope: removalScope)
    }
}

func removePendingAndDeliveredStrictReminders(
    center: UNUserNotificationCenter,
    removalScope: String?
) async {
    await removePendingStrictReminders(center: center, removalScope: removalScope)
    await removeDeliveredStrictReminders(center: center, removalScope: removalScope)
}

func buildStrictReminderPayloads(
    now: Date,
    calendar: Calendar,
    completedDayStartMillis: Set<Int64>
) throws -> [ScheduledStrictReminderPayload] {
    let startOfToday = calendar.startOfDay(for: now)
    var payloads: [ScheduledStrictReminderPayload] = []

    for dayOffset in 0...strictReminderSchedulingHorizonDays {
        guard let dayStart = calendar.date(byAdding: .day, value: dayOffset, to: startOfToday) else {
            throw LocalStoreError.validation(
                "Strict reminder day start could not be computed for offset \(dayOffset)"
            )
        }
        let dayStartMillis = strictReminderDayStartMillis(date: dayStart)
        guard completedDayStartMillis.contains(dayStartMillis) == false else {
            continue
        }
        guard let startOfNextDay = calendar.date(byAdding: .day, value: 1, to: dayStart) else {
            throw LocalStoreError.validation(
                "Strict reminder next day start could not be computed for \(formatIsoTimestamp(date: dayStart))"
            )
        }

        payloads.append(
            contentsOf: buildStrictReminderPayloadsForIncompleteDay(
                dayStart: dayStart,
                startOfNextDay: startOfNextDay,
                now: now,
                calendar: calendar
            )
        )
    }

    return Array(payloads.prefix(strictReminderPendingRequestsLimit))
}

func loadScheduledStrictReminderPayloads(
    snapshot: StrictReminderSchedulingSnapshot
) throws -> [ScheduledStrictReminderPayload] {
    try buildStrictReminderPayloads(
        now: snapshot.now,
        calendar: snapshot.calendar,
        completedDayStartMillis: snapshot.completedDayStartMillis
    )
}

func buildStrictReminderPayloadsForIncompleteDay(
    dayStart: Date,
    startOfNextDay: Date,
    now: Date,
    calendar: Calendar
) -> [ScheduledStrictReminderPayload] {
    StrictReminderOffset.allCases.compactMap { offset in
        let scheduledAt = startOfNextDay.addingTimeInterval(-offset.secondsBeforeEndOfDay)
        guard scheduledAt > now else {
            return nil
        }

        return ScheduledStrictReminderPayload(
            dayStartMillis: strictReminderDayStartMillis(date: dayStart),
            scheduledAtMillis: Int64(scheduledAt.timeIntervalSince1970 * 1_000),
            offset: offset,
            requestId: makeStrictReminderRequestIdentifier(
                offset: offset,
                scheduledAt: scheduledAt,
                calendar: calendar
            )
        )
    }
}
