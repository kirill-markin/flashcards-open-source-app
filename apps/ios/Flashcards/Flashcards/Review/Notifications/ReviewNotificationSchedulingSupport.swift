import Foundation

let dailyReminderSchedulingHorizonDays: Int = 7

let reviewNotificationLastActiveAtUserDefaultsKey: String = "review-notification-last-active-at"

struct ReviewNotificationSchedulingSnapshot: Sendable {
    let databaseURL: URL?
    let workspaceId: String
    let reviewFilter: ReviewFilter
    let now: Date
    let settings: ReviewNotificationsSettings
    let lastActiveAt: Date?
    let pendingRequestLimit: Int
}

struct ScheduledReviewNotificationLoadResult: Sendable {
    let payloads: [ScheduledReviewNotificationPayload]
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
    return buildRepeatedReviewNotificationPayloads(
        workspaceId: workspaceId,
        reviewFilter: currentCard.reviewFilter,
        content: .card(cardId: currentCard.cardId, frontText: currentCard.frontText),
        scheduledDates: scheduledDates,
        calendar: calendar,
        mode: mode
    )
}

func buildFallbackReviewNotificationPayloads(
    workspaceId: String,
    reviewFilter: PersistedReviewFilter,
    scheduledDates: [Date],
    calendar: Calendar,
    mode: ReviewNotificationMode
) -> [ScheduledReviewNotificationPayload] {
    return buildRepeatedReviewNotificationPayloads(
        workspaceId: workspaceId,
        reviewFilter: reviewFilter,
        content: .fallback,
        scheduledDates: scheduledDates,
        calendar: calendar,
        mode: mode
    )
}

private func buildRepeatedReviewNotificationPayloads(
    workspaceId: String,
    reviewFilter: PersistedReviewFilter,
    content: ScheduledReviewNotificationPayloadContent,
    scheduledDates: [Date],
    calendar: Calendar,
    mode: ReviewNotificationMode
) -> [ScheduledReviewNotificationPayload] {
    return scheduledDates.map { scheduledAt in
        ScheduledReviewNotificationPayload(
            workspaceId: workspaceId,
            reviewFilter: reviewFilter,
            content: content,
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
) async throws -> ScheduledReviewNotificationLoadResult {
    guard let databaseURL = snapshot.databaseURL else {
        return ScheduledReviewNotificationLoadResult(payloads: [])
    }

    return try await Task.detached(priority: .utility) {
        let database = try LocalDatabase(databaseURL: databaseURL)
        defer {
            try? database.close()
        }

        let currentCard = try database.loadCurrentReviewNotificationCard(
            workspaceId: snapshot.workspaceId,
            reviewFilter: snapshot.reviewFilter,
            now: snapshot.now
        )

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
                return ScheduledReviewNotificationLoadResult(payloads: [])
            }
            scheduledDates = buildInactivityReviewNotificationDates(
                lastActiveAt: lastActiveAt,
                now: snapshot.now,
                calendar: calendar,
                settings: snapshot.settings.inactivity
            )
        }

        let limitedScheduledDates = Array(scheduledDates.prefix(max(0, snapshot.pendingRequestLimit)))
        let payloads: [ScheduledReviewNotificationPayload]
        if let currentCard {
            payloads = buildRepeatedReviewNotificationPayloads(
                workspaceId: snapshot.workspaceId,
                currentCard: currentCard,
                scheduledDates: limitedScheduledDates,
                calendar: calendar,
                mode: mode
            )
        } else {
            payloads = buildFallbackReviewNotificationPayloads(
                workspaceId: snapshot.workspaceId,
                reviewFilter: makePersistedReviewFilter(reviewFilter: snapshot.reviewFilter),
                scheduledDates: limitedScheduledDates,
                calendar: calendar,
                mode: mode
            )
        }

        return ScheduledReviewNotificationLoadResult(payloads: payloads)
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
