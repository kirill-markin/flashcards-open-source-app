import Foundation
import UserNotifications

struct NotificationDiagnosticsSnapshot: Hashable, Sendable {
    let sections: [NotificationDiagnosticsSnapshotSection]
}

struct NotificationDiagnosticsSnapshotSection: Hashable, Identifiable, Sendable {
    let id: String
    let title: String
    let rows: [NotificationDiagnosticsSnapshotRow]
}

struct NotificationDiagnosticsSnapshotRow: Hashable, Identifiable, Sendable {
    let id: String
    let title: String
    let value: String
}

@MainActor
func loadNotificationDiagnosticsSnapshot(
    userDefaults: UserDefaults,
    decoder: JSONDecoder,
    workspaceId: String?,
    workspaceName: String?,
    reviewSettings: ReviewNotificationsSettings,
    strictRemindersSettings: StrictRemindersSettings
) async -> NotificationDiagnosticsSnapshot {
    let center: UNUserNotificationCenter = UNUserNotificationCenter.current()
    let notificationSettings: UNNotificationSettings = await center.notificationSettings()
    let permissionStatus: ReviewNotificationPermissionStatus = reviewNotificationPermissionStatus(
        authorizationStatus: notificationSettings.authorizationStatus
    )
    let pendingRequestIdentifiers: [String] = await pendingAppNotificationRequestIdentifiers(center: center)
    let deliveredRequestIdentifiers: [String] = await deliveredAppNotificationRequestIdentifiers(center: center)
    let pendingReviewRequestIdentifiers: [String] = filterReviewNotificationRequestIdentifiers(
        identifiers: pendingRequestIdentifiers
    )
    let deliveredReviewRequestIdentifiers: [String] = filterReviewNotificationRequestIdentifiers(
        identifiers: deliveredRequestIdentifiers
    )
    let pendingStrictRequestIdentifiers: [String] = filterStrictReminderRequestIdentifiers(
        identifiers: pendingRequestIdentifiers
    )
    let deliveredStrictRequestIdentifiers: [String] = filterStrictReminderRequestIdentifiers(
        identifiers: deliveredRequestIdentifiers
    )
    let pendingBreakdown: AppNotificationPendingRequestBreakdown = appNotificationRequestBreakdown(
        identifiers: pendingRequestIdentifiers
    )
    let deliveredBreakdown: AppNotificationPendingRequestBreakdown = appNotificationRequestBreakdown(
        identifiers: deliveredRequestIdentifiers
    )
    let scheduledReviewPayloadsRead: ScheduledReviewNotificationsDiagnosticsRead =
        readScheduledReviewNotificationsForDiagnostics(
            userDefaults: userDefaults,
            decoder: decoder,
            workspaceId: workspaceId
        )
    let scheduledStrictPayloadsRead: ScheduledStrictRemindersDiagnosticsRead = readScheduledStrictRemindersForDiagnostics(
        userDefaults: userDefaults,
        decoder: decoder
    )
    let scheduledReviewPayloads: [ScheduledReviewNotificationPayload] = scheduledReviewPayloadsRead.payloads
    let scheduledStrictPayloads: [ScheduledStrictReminderPayload] = scheduledStrictPayloadsRead.payloads
    let acceptedReviewPayloads: [ScheduledReviewNotificationPayload] = acceptedReviewNotificationPayloads(
        payloads: scheduledReviewPayloads,
        pendingRequestIdentifiers: pendingReviewRequestIdentifiers
    )
    let acceptedStrictPayloads: [ScheduledStrictReminderPayload] = acceptedStrictReminderPayloads(
        payloads: scheduledStrictPayloads,
        pendingRequestIdentifiers: pendingStrictRequestIdentifiers
    )
    let strictReminderScope: String = storedStrictReminderNotificationScope(userDefaults: userDefaults)
        ?? aiSettingsLocalized("common.unavailable", "Unavailable")

    let sections: [NotificationDiagnosticsSnapshotSection] = [
        makeNotificationDiagnosticsSystemStateSection(
            workspaceName: workspaceName,
            appState: currentAppNotificationApplicationStateDiagnosticValue(),
            authorizationStatus: notificationSettings.authorizationStatus,
            permissionStatus: permissionStatus,
            badgeSetting: notificationSettings.badgeSetting
        ),
        makeNotificationDiagnosticsCenterSection(
            pendingBreakdown: pendingBreakdown,
            deliveredBreakdown: deliveredBreakdown
        ),
        makeNotificationDiagnosticsReviewSettingsSection(
            settings: reviewSettings,
            scheduledPayloads: scheduledReviewPayloads,
            acceptedPayloads: acceptedReviewPayloads,
            payloadReadStatus: scheduledReviewPayloadsRead.status,
            pendingRequestIdentifiers: pendingReviewRequestIdentifiers,
            deliveredRequestIdentifiers: deliveredReviewRequestIdentifiers
        ),
        makeNotificationDiagnosticsStrictSettingsSection(
            settings: strictRemindersSettings,
            notificationScope: strictReminderScope,
            scheduledPayloads: scheduledStrictPayloads,
            acceptedPayloads: acceptedStrictPayloads,
            payloadReadStatus: scheduledStrictPayloadsRead.status,
            pendingRequestIdentifiers: pendingStrictRequestIdentifiers,
            deliveredRequestIdentifiers: deliveredStrictRequestIdentifiers
        ),
        makeNotificationDiagnosticsReviewPayloadsSection(
            payloads: scheduledReviewPayloads,
            payloadReadStatus: scheduledReviewPayloadsRead.status
        ),
        makeNotificationDiagnosticsStrictPayloadsSection(
            payloads: scheduledStrictPayloads,
            payloadReadStatus: scheduledStrictPayloadsRead.status
        )
    ]

    return NotificationDiagnosticsSnapshot(sections: sections)
}

private func makeNotificationDiagnosticsSystemStateSection(
    workspaceName: String?,
    appState: String,
    authorizationStatus: UNAuthorizationStatus,
    permissionStatus: ReviewNotificationPermissionStatus,
    badgeSetting: UNNotificationSetting
) -> NotificationDiagnosticsSnapshotSection {
    NotificationDiagnosticsSnapshotSection(
        id: "system-state",
        title: aiSettingsLocalized("settings.notificationDiagnostics.section.systemState", "System State"),
        rows: [
            NotificationDiagnosticsSnapshotRow(
                id: "workspace",
                title: aiSettingsLocalized("settings.notificationDiagnostics.workspace", "Workspace"),
                value: workspaceName ?? aiSettingsLocalized("common.unavailable", "Unavailable")
            ),
            NotificationDiagnosticsSnapshotRow(
                id: "app-state",
                title: aiSettingsLocalized("settings.notificationDiagnostics.appState", "App state"),
                value: appState
            ),
            NotificationDiagnosticsSnapshotRow(
                id: "authorization",
                title: aiSettingsLocalized("settings.notificationDiagnostics.authorization", "Authorization"),
                value: notificationDiagnosticsAuthorizationStatusValue(status: authorizationStatus)
            ),
            NotificationDiagnosticsSnapshotRow(
                id: "review-permission",
                title: aiSettingsLocalized("settings.notificationDiagnostics.reviewPermission", "Review permission"),
                value: reviewNotificationPermissionStatusDiagnosticValue(status: permissionStatus)
            ),
            NotificationDiagnosticsSnapshotRow(
                id: "badge-setting",
                title: aiSettingsLocalized("settings.notificationDiagnostics.badgeSetting", "Badge setting"),
                value: notificationDiagnosticsNotificationSettingValue(setting: badgeSetting)
            )
        ]
    )
}

private func makeNotificationDiagnosticsCenterSection(
    pendingBreakdown: AppNotificationPendingRequestBreakdown,
    deliveredBreakdown: AppNotificationPendingRequestBreakdown
) -> NotificationDiagnosticsSnapshotSection {
    NotificationDiagnosticsSnapshotSection(
        id: "notification-center",
        title: aiSettingsLocalized("settings.notificationDiagnostics.section.notificationCenter", "Notification Center"),
        rows: [
            makeNotificationDiagnosticsCountRow(
                id: "pending-total",
                title: aiSettingsLocalized("settings.notificationDiagnostics.pending.total", "Pending total"),
                count: pendingBreakdown.totalCount
            ),
            makeNotificationDiagnosticsCountRow(
                id: "pending-review",
                title: aiSettingsLocalized("settings.notificationDiagnostics.pending.review", "Pending review"),
                count: pendingBreakdown.reviewCount
            ),
            makeNotificationDiagnosticsCountRow(
                id: "pending-strict",
                title: aiSettingsLocalized("settings.notificationDiagnostics.pending.strict", "Pending streak"),
                count: pendingBreakdown.strictCount
            ),
            makeNotificationDiagnosticsCountRow(
                id: "pending-other",
                title: aiSettingsLocalized("settings.notificationDiagnostics.pending.other", "Pending other"),
                count: pendingBreakdown.otherCount
            ),
            makeNotificationDiagnosticsCountRow(
                id: "delivered-total",
                title: aiSettingsLocalized("settings.notificationDiagnostics.delivered.total", "Delivered total"),
                count: deliveredBreakdown.totalCount
            ),
            makeNotificationDiagnosticsCountRow(
                id: "delivered-review",
                title: aiSettingsLocalized("settings.notificationDiagnostics.delivered.review", "Delivered review"),
                count: deliveredBreakdown.reviewCount
            ),
            makeNotificationDiagnosticsCountRow(
                id: "delivered-strict",
                title: aiSettingsLocalized("settings.notificationDiagnostics.delivered.strict", "Delivered streak"),
                count: deliveredBreakdown.strictCount
            ),
            makeNotificationDiagnosticsCountRow(
                id: "delivered-other",
                title: aiSettingsLocalized("settings.notificationDiagnostics.delivered.other", "Delivered other"),
                count: deliveredBreakdown.otherCount
            )
        ]
    )
}

private func makeNotificationDiagnosticsReviewSettingsSection(
    settings: ReviewNotificationsSettings,
    scheduledPayloads: [ScheduledReviewNotificationPayload],
    acceptedPayloads: [ScheduledReviewNotificationPayload],
    payloadReadStatus: ScheduledNotificationPayloadReadStatus,
    pendingRequestIdentifiers: [String],
    deliveredRequestIdentifiers: [String]
) -> NotificationDiagnosticsSnapshotSection {
    NotificationDiagnosticsSnapshotSection(
        id: "review-reminders",
        title: aiSettingsLocalized("settings.notificationDiagnostics.section.reviewReminders", "Review Reminders"),
        rows: [
            NotificationDiagnosticsSnapshotRow(
                id: "enabled",
                title: aiSettingsLocalized("settings.notificationDiagnostics.enabled", "Enabled"),
                value: notificationDiagnosticsEnabledValue(isEnabled: settings.isEnabled)
            ),
            NotificationDiagnosticsSnapshotRow(
                id: "mode",
                title: aiSettingsLocalized("settings.notifications.mode", "Mode"),
                value: localizedReviewNotificationModeTitle(settings.selectedMode)
            ),
            NotificationDiagnosticsSnapshotRow(
                id: "app-icon-badge",
                title: aiSettingsLocalized("settings.notifications.section.appIconBadge", "App Icon Badge"),
                value: notificationDiagnosticsEnabledValue(isEnabled: settings.showAppIconBadge)
            ),
            NotificationDiagnosticsSnapshotRow(
                id: "daily-time",
                title: aiSettingsLocalized("settings.notificationDiagnostics.dailyTime", "Daily time"),
                value: notificationDiagnosticsClockTimeValue(
                    hour: settings.daily.hour,
                    minute: settings.daily.minute
                )
            ),
            NotificationDiagnosticsSnapshotRow(
                id: "inactivity-window",
                title: aiSettingsLocalized("settings.notificationDiagnostics.inactivityWindow", "Inactivity window"),
                value: notificationDiagnosticsInactivityWindowValue(settings: settings.inactivity)
            ),
            NotificationDiagnosticsSnapshotRow(
                id: "inactivity-idle-minutes",
                title: aiSettingsLocalized("settings.notifications.remindAfter", "Remind me after"),
                value: "\(settings.inactivity.idleMinutes)"
            ),
            makeNotificationDiagnosticsCountRow(
                id: "stored-review-payloads",
                title: aiSettingsLocalized("settings.notificationDiagnostics.storedReviewPayloads", "Stored review payloads"),
                count: scheduledPayloads.count
            ),
            NotificationDiagnosticsSnapshotRow(
                id: "stored-review-payloads-status",
                title: aiSettingsLocalized("settings.notificationDiagnostics.payloadReadStatus", "Stored payload status"),
                value: notificationDiagnosticsPayloadReadStatusValue(status: payloadReadStatus)
            ),
            makeNotificationDiagnosticsCountRow(
                id: "accepted-review-payloads",
                title: aiSettingsLocalized("settings.notificationDiagnostics.acceptedReviewPayloads", "Accepted review payloads"),
                count: acceptedPayloads.count
            ),
            NotificationDiagnosticsSnapshotRow(
                id: "pending-review-identifiers",
                title: aiSettingsLocalized("settings.notificationDiagnostics.pendingReviewIdentifiers", "Pending review identifiers"),
                value: notificationDiagnosticsIdentifierListValue(identifiers: pendingRequestIdentifiers)
            ),
            NotificationDiagnosticsSnapshotRow(
                id: "delivered-review-identifiers",
                title: aiSettingsLocalized("settings.notificationDiagnostics.deliveredReviewIdentifiers", "Delivered review identifiers"),
                value: notificationDiagnosticsIdentifierListValue(identifiers: deliveredRequestIdentifiers)
            )
        ]
    )
}

private func makeNotificationDiagnosticsStrictSettingsSection(
    settings: StrictRemindersSettings,
    notificationScope: String,
    scheduledPayloads: [ScheduledStrictReminderPayload],
    acceptedPayloads: [ScheduledStrictReminderPayload],
    payloadReadStatus: ScheduledNotificationPayloadReadStatus,
    pendingRequestIdentifiers: [String],
    deliveredRequestIdentifiers: [String]
) -> NotificationDiagnosticsSnapshotSection {
    NotificationDiagnosticsSnapshotSection(
        id: "strict-reminders",
        title: aiSettingsLocalized("settings.notificationDiagnostics.section.strictReminders", "Streak Reminders"),
        rows: [
            NotificationDiagnosticsSnapshotRow(
                id: "enabled",
                title: aiSettingsLocalized("settings.notificationDiagnostics.enabled", "Enabled"),
                value: notificationDiagnosticsEnabledValue(isEnabled: settings.isEnabled)
            ),
            NotificationDiagnosticsSnapshotRow(
                id: "notification-scope",
                title: aiSettingsLocalized("settings.notificationDiagnostics.strictScope", "Notification scope"),
                value: notificationScope
            ),
            makeNotificationDiagnosticsCountRow(
                id: "stored-strict-payloads",
                title: aiSettingsLocalized("settings.notificationDiagnostics.storedStrictPayloads", "Stored streak payloads"),
                count: scheduledPayloads.count
            ),
            NotificationDiagnosticsSnapshotRow(
                id: "stored-strict-payloads-status",
                title: aiSettingsLocalized("settings.notificationDiagnostics.payloadReadStatus", "Stored payload status"),
                value: notificationDiagnosticsPayloadReadStatusValue(status: payloadReadStatus)
            ),
            makeNotificationDiagnosticsCountRow(
                id: "accepted-strict-payloads",
                title: aiSettingsLocalized("settings.notificationDiagnostics.acceptedStrictPayloads", "Accepted streak payloads"),
                count: acceptedPayloads.count
            ),
            NotificationDiagnosticsSnapshotRow(
                id: "pending-strict-identifiers",
                title: aiSettingsLocalized("settings.notificationDiagnostics.pendingStrictIdentifiers", "Pending streak identifiers"),
                value: notificationDiagnosticsIdentifierListValue(identifiers: pendingRequestIdentifiers)
            ),
            NotificationDiagnosticsSnapshotRow(
                id: "delivered-strict-identifiers",
                title: aiSettingsLocalized("settings.notificationDiagnostics.deliveredStrictIdentifiers", "Delivered streak identifiers"),
                value: notificationDiagnosticsIdentifierListValue(identifiers: deliveredRequestIdentifiers)
            )
        ]
    )
}

private func makeNotificationDiagnosticsReviewPayloadsSection(
    payloads: [ScheduledReviewNotificationPayload],
    payloadReadStatus: ScheduledNotificationPayloadReadStatus
) -> NotificationDiagnosticsSnapshotSection {
    let rows: [NotificationDiagnosticsSnapshotRow]
    if payloadReadStatus == .unreadable {
        rows = [
            NotificationDiagnosticsSnapshotRow(
                id: "unreadable",
                title: aiSettingsLocalized("settings.notificationDiagnostics.payloads", "Payloads"),
                value: notificationDiagnosticsPayloadReadStatusValue(status: payloadReadStatus)
            )
        ]
    } else if payloads.isEmpty {
        rows = [
            NotificationDiagnosticsSnapshotRow(
                id: "empty",
                title: aiSettingsLocalized("settings.notificationDiagnostics.payloads", "Payloads"),
                value: aiSettingsLocalized("settings.notificationDiagnostics.none", "None")
            )
        ]
    } else {
        rows = payloads.enumerated().map { index, payload in
            NotificationDiagnosticsSnapshotRow(
                id: payload.requestId,
                title: aiSettingsLocalizedFormat(
                    "settings.notificationDiagnostics.reviewPayload",
                    "Review payload %d",
                    index + 1
                ),
                value: notificationDiagnosticsReviewPayloadValue(payload: payload)
            )
        }
    }

    return NotificationDiagnosticsSnapshotSection(
        id: "stored-review-payloads",
        title: aiSettingsLocalized("settings.notificationDiagnostics.section.storedReviewPayloads", "Stored Review Payloads"),
        rows: rows
    )
}

private func makeNotificationDiagnosticsStrictPayloadsSection(
    payloads: [ScheduledStrictReminderPayload],
    payloadReadStatus: ScheduledNotificationPayloadReadStatus
) -> NotificationDiagnosticsSnapshotSection {
    let rows: [NotificationDiagnosticsSnapshotRow]
    if payloadReadStatus == .unreadable {
        rows = [
            NotificationDiagnosticsSnapshotRow(
                id: "unreadable",
                title: aiSettingsLocalized("settings.notificationDiagnostics.payloads", "Payloads"),
                value: notificationDiagnosticsPayloadReadStatusValue(status: payloadReadStatus)
            )
        ]
    } else if payloads.isEmpty {
        rows = [
            NotificationDiagnosticsSnapshotRow(
                id: "empty",
                title: aiSettingsLocalized("settings.notificationDiagnostics.payloads", "Payloads"),
                value: aiSettingsLocalized("settings.notificationDiagnostics.none", "None")
            )
        ]
    } else {
        rows = payloads.enumerated().map { index, payload in
            NotificationDiagnosticsSnapshotRow(
                id: payload.requestId,
                title: aiSettingsLocalizedFormat(
                    "settings.notificationDiagnostics.strictPayload",
                    "Streak payload %d",
                    index + 1
                ),
                value: notificationDiagnosticsStrictPayloadValue(payload: payload)
            )
        }
    }

    return NotificationDiagnosticsSnapshotSection(
        id: "stored-strict-payloads",
        title: aiSettingsLocalized("settings.notificationDiagnostics.section.storedStrictPayloads", "Stored Streak Payloads"),
        rows: rows
    )
}

private func makeNotificationDiagnosticsCountRow(
    id: String,
    title: String,
    count: Int
) -> NotificationDiagnosticsSnapshotRow {
    NotificationDiagnosticsSnapshotRow(
        id: id,
        title: title,
        value: "\(count)"
    )
}

private func notificationDiagnosticsAuthorizationStatusValue(status: UNAuthorizationStatus) -> String {
    switch status {
    case .authorized:
        return "authorized"
    case .denied:
        return "denied"
    case .ephemeral:
        return "ephemeral"
    case .notDetermined:
        return "not_determined"
    case .provisional:
        return "provisional"
    @unknown default:
        return "unknown"
    }
}

private func notificationDiagnosticsNotificationSettingValue(setting: UNNotificationSetting) -> String {
    switch setting {
    case .enabled:
        return aiSettingsLocalized("settings.notificationDiagnostics.value.enabled", "Enabled")
    case .disabled:
        return aiSettingsLocalized("settings.notificationDiagnostics.value.disabled", "Disabled")
    case .notSupported:
        return aiSettingsLocalized("settings.notificationDiagnostics.value.notSupported", "Not supported")
    @unknown default:
        return "unknown"
    }
}

private func notificationDiagnosticsEnabledValue(isEnabled: Bool) -> String {
    if isEnabled {
        return aiSettingsLocalized("settings.notificationDiagnostics.value.enabled", "Enabled")
    }

    return aiSettingsLocalized("settings.notificationDiagnostics.value.disabled", "Disabled")
}

private func notificationDiagnosticsPayloadReadStatusValue(
    status: ScheduledNotificationPayloadReadStatus
) -> String {
    switch status {
    case .readable:
        return aiSettingsLocalized("settings.notificationDiagnostics.value.readable", "Readable")
    case .unreadable:
        return aiSettingsLocalized("settings.notificationDiagnostics.value.unreadable", "Unreadable")
    }
}

private func notificationDiagnosticsClockTimeValue(hour: Int, minute: Int) -> String {
    String(format: "%02d:%02d", hour, minute)
}

private func notificationDiagnosticsInactivityWindowValue(settings: InactivityReviewNotificationsSettings) -> String {
    let startTime: String = notificationDiagnosticsClockTimeValue(
        hour: settings.windowStartHour,
        minute: settings.windowStartMinute
    )
    let endTime: String = notificationDiagnosticsClockTimeValue(
        hour: settings.windowEndHour,
        minute: settings.windowEndMinute
    )
    return "\(startTime)-\(endTime)"
}

private func notificationDiagnosticsIdentifierListValue(identifiers: [String]) -> String {
    guard identifiers.isEmpty == false else {
        return aiSettingsLocalized("settings.notificationDiagnostics.none", "None")
    }

    return identifiers.sorted().joined(separator: "\n")
}

private func notificationDiagnosticsReviewPayloadValue(payload: ScheduledReviewNotificationPayload) -> String {
    [
        "id=\(payload.requestId)",
        "scheduledAt=\(notificationDiagnosticsTimestampValue(milliseconds: payload.scheduledAtMillis))",
        "content=\(notificationDiagnosticsReviewPayloadContentValue(content: payload.content))",
        "filter=\(notificationDiagnosticsReviewFilterValue(reviewFilter: payload.reviewFilter))"
    ].joined(separator: "\n")
}

private func notificationDiagnosticsStrictPayloadValue(payload: ScheduledStrictReminderPayload) -> String {
    [
        "id=\(payload.requestId)",
        "scheduledAt=\(notificationDiagnosticsTimestampValue(milliseconds: payload.scheduledAtMillis))",
        "dayStart=\(notificationDiagnosticsTimestampValue(milliseconds: payload.dayStartMillis))",
        "offset=\(payload.offset.identifierComponent)"
    ].joined(separator: "\n")
}

private func notificationDiagnosticsTimestampValue(milliseconds: Int64) -> String {
    formatIsoTimestamp(date: Date(timeIntervalSince1970: TimeInterval(milliseconds) / 1_000))
}

private func notificationDiagnosticsReviewPayloadContentValue(
    content: ScheduledReviewNotificationPayloadContent
) -> String {
    switch content {
    case .card(let cardId, _):
        return "card:\(cardId)"
    case .fallback:
        return "fallback"
    }
}

private func notificationDiagnosticsReviewFilterValue(reviewFilter: PersistedReviewFilter) -> String {
    switch reviewFilter.kind {
    case .allCards:
        return "all_cards"
    case .deck:
        return "deck:\(reviewFilter.deckId ?? "missing")"
    case .effort:
        return "legacy_effort:\(reviewFilter.effortLevel ?? "missing")"
    case .tag:
        return "tag:\(reviewFilter.tag ?? "missing")"
    }
}
