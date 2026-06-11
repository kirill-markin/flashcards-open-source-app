import Foundation

private let progressStreakWeekCount: Int = 5

func makeProgressSnapshot(
    summary: ProgressSummary,
    series: UserProgressSeries,
    scopeKey: ProgressScopeKey,
    summarySourceState: ProgressSourceState,
    seriesSourceState: ProgressSourceState,
    calendar: Calendar
) throws -> ProgressSnapshot {
    let timeline = try makeValidatedProgressTimeline(
        series: series,
        scopeKey: scopeKey,
        calendar: calendar
    )
    let todayLocalDate = series.to

    let chartDays = timeline.map { timelineDay in
        ProgressChartDay(
            date: timelineDay.date,
            localDate: timelineDay.localDate,
            reviewCount: timelineDay.reviewCount,
            isToday: timelineDay.localDate == todayLocalDate
        )
    }
    let chartData = ProgressChartData(
        chartDays: chartDays
    )

    return ProgressSnapshot(
        scopeKey: scopeKey,
        summary: summary,
        chartData: chartData,
        summarySourceState: summarySourceState,
        seriesSourceState: seriesSourceState,
        isApproximate: summarySourceState == .localOnly || seriesSourceState == .localOnly,
        generatedAt: series.generatedAt
    )
}

func makeReviewScheduleSnapshot(
    schedule: UserReviewSchedule,
    scopeKey: ReviewScheduleScopeKey,
    sourceState: ProgressSourceState
) throws -> ReviewScheduleSnapshot {
    try validateReviewSchedule(schedule: schedule, scopeKey: scopeKey)

    return ReviewScheduleSnapshot(
        scopeKey: scopeKey,
        schedule: schedule,
        sourceState: sourceState,
        isApproximate: sourceState != .serverBase,
        generatedAt: schedule.generatedAt
    )
}

func makeProgressLeaderboardPlaceholderSnapshot(
    scopeKey: ProgressLeaderboardScopeKey,
    state: ProgressLeaderboardSnapshotState
) -> ProgressLeaderboardSnapshot {
    ProgressLeaderboardSnapshot(
        scopeKey: scopeKey,
        state: state
    )
}

func makeProgressLeaderboardSnapshot(
    leaderboard: UserProgressLeaderboard,
    scopeKey: ProgressLeaderboardScopeKey,
    canonicalQualifiedReviewEvents: [ProgressQualifiedReviewEventSource],
    pendingQualifiedReviewEvents: [ProgressQualifiedReviewEventSource],
    now: Date
) throws -> ProgressLeaderboardSnapshot {
    try validateProgressLeaderboard(leaderboard: leaderboard)

    switch leaderboard.status {
    case .linkedAccountRequired:
        return makeProgressLeaderboardPlaceholderSnapshot(scopeKey: scopeKey, state: .signInRequired)
    case .participationDisabled:
        return makeProgressLeaderboardPlaceholderSnapshot(scopeKey: scopeKey, state: .participationDisabled)
    case .snapshotUnavailable:
        return makeProgressLeaderboardPlaceholderSnapshot(scopeKey: scopeKey, state: .snapshotUnavailable)
    case .ready:
        break
    }

    let localQualifiedReviewCounts = try progressLeaderboardQualifiedReviewCounts(
        canonicalQualifiedReviewEvents: canonicalQualifiedReviewEvents,
        pendingQualifiedReviewEvents: pendingQualifiedReviewEvents,
        now: now
    )
    let windowStates = try leaderboard.windows.map { window in
        try makeProgressLeaderboardWindowState(
            window: window,
            localQualifiedReviewCounts: localQualifiedReviewCounts
        )
    }

    return ProgressLeaderboardSnapshot(
        scopeKey: scopeKey,
        state: .ready(
            ProgressLeaderboardReadyState(
                defaultWindowKey: leaderboard.defaultWindowKey,
                windows: windowStates
            )
        )
    )
}

/// The live overlay only lifts the viewer's own count; other rows and every rank
/// stay exactly as the authoritative server snapshot reported them.
private func makeProgressLeaderboardWindowState(
    window: ProgressLeaderboardWindow,
    localQualifiedReviewCounts: [LeaderboardWindowKey: Int]
) throws -> ProgressLeaderboardWindowState {
    guard let localQualifiedReviewCount = localQualifiedReviewCounts[window.windowKey] else {
        throw LocalStoreError.validation(
            "Leaderboard local qualified review count is missing for window \(window.windowKey.rawValue)"
        )
    }

    let overlaidViewerCount = max(window.viewer.qualifiedReviewCount, localQualifiedReviewCount)
    let rows = window.rows.map { row -> ProgressLeaderboardRowState in
        switch row {
        case .gap:
            return .gap
        case .participant(let participantRow):
            return .participant(
                ProgressLeaderboardParticipantRowState(
                    kind: participantRow.kind,
                    publicProfileId: participantRow.publicProfileId,
                    anonymousDisplayName: participantRow.anonymousDisplayName,
                    qualifiedReviewCount: participantRow.kind == .viewer
                        ? overlaidViewerCount
                        : participantRow.qualifiedReviewCount,
                    rank: participantRow.rank
                )
            )
        }
    }

    return ProgressLeaderboardWindowState(
        windowKey: window.windowKey,
        snapshotGeneratedAt: window.snapshotGeneratedAt,
        participantCount: window.participantCount,
        viewerRank: window.viewer.rank,
        viewerQualifiedReviewCount: overlaidViewerCount,
        rows: rows
    )
}

private struct ProgressTimelineDay: Hashable, Sendable {
    let date: Date
    let localDate: String
    let reviewCount: Int
}

private func makeProgressTimeline(
    series: UserProgressSeries,
    calendar: Calendar
) throws -> [ProgressTimelineDay] {
    let startDate = try progressDate(localDate: series.from, calendar: calendar)
    let endDate = try progressDate(localDate: series.to, calendar: calendar)

    guard startDate <= endDate else {
        throw ProgressPresentationError.invalidRange(series.from, series.to)
    }

    var reviewCountsByLocalDate: [String: Int] = [:]
    for day in series.dailyReviews {
        _ = try progressDate(localDate: day.date, calendar: calendar)

        guard day.reviewCount >= 0 else {
            throw ProgressPresentationError.negativeReviewCount(day.date, day.reviewCount)
        }

        if reviewCountsByLocalDate.updateValue(day.reviewCount, forKey: day.date) != nil {
            throw ProgressPresentationError.duplicateDay(day.date)
        }
    }

    var timeline: [ProgressTimelineDay] = []
    var currentDate = startDate
    while currentDate <= endDate {
        let localDate = progressLocalDateString(date: currentDate, calendar: calendar)
        timeline.append(
            ProgressTimelineDay(
                date: currentDate,
                localDate: localDate,
                reviewCount: reviewCountsByLocalDate[localDate] ?? 0
            )
        )

        guard let nextDate = calendar.date(byAdding: .day, value: 1, to: currentDate) else {
            throw ProgressPresentationError.invalidRange(series.from, series.to)
        }
        currentDate = nextDate
    }

    return timeline
}

func validateProgressSeries(
    series: UserProgressSeries,
    scopeKey: ProgressScopeKey,
    calendar: Calendar
) throws {
    _ = try makeValidatedProgressTimeline(
        series: series,
        scopeKey: scopeKey,
        calendar: calendar
    )
}

func makeProgressPresentationCalendar(
    timeZoneIdentifier: String,
    userCalendar: Calendar
) throws -> Calendar {
    guard let timeZone = TimeZone(identifier: timeZoneIdentifier) else {
        throw ProgressPresentationError.invalidTimeZone(timeZoneIdentifier)
    }

    var calendar = Calendar(identifier: .gregorian)
    calendar.locale = Locale.autoupdatingCurrent
    calendar.timeZone = timeZone
    calendar.firstWeekday = userCalendar.firstWeekday
    calendar.minimumDaysInFirstWeek = userCalendar.minimumDaysInFirstWeek
    return calendar
}

func validateProgressSeriesMetadata(
    series: UserProgressSeries,
    scopeKey: ProgressScopeKey
) throws {
    guard
        series.timeZone == scopeKey.timeZone,
        series.from == scopeKey.from,
        series.to == scopeKey.to
    else {
        throw ProgressPresentationError.seriesMetadataMismatch(
            expected: scopeKey,
            actualTimeZone: series.timeZone,
            actualFrom: series.from,
            actualTo: series.to
        )
    }
}

private func makeValidatedProgressTimeline(
    series: UserProgressSeries,
    scopeKey: ProgressScopeKey,
    calendar: Calendar
) throws -> [ProgressTimelineDay] {
    try validateProgressSeriesMetadata(series: series, scopeKey: scopeKey)
    return try makeProgressTimeline(series: series, calendar: calendar)
}

func makeProgressStreakWeeks(
    chartDays: [ProgressChartDay],
    rangeStartLocalDate: String,
    todayLocalDate: String,
    calendar: Calendar
) throws -> [ProgressCalendarWeek] {
    let today = try progressDate(localDate: todayLocalDate, calendar: calendar)

    guard let currentWeekInterval = calendar.dateInterval(of: .weekOfYear, for: today) else {
        throw ProgressPresentationError.invalidRange(rangeStartLocalDate, todayLocalDate)
    }

    let currentWeekStart = calendar.startOfDay(for: currentWeekInterval.start)
    let streakDayCount = progressDaysPerWeek * progressStreakWeekCount

    guard let streakStart = calendar.date(byAdding: .day, value: -(streakDayCount - progressDaysPerWeek), to: currentWeekStart) else {
        throw ProgressPresentationError.invalidRange(rangeStartLocalDate, todayLocalDate)
    }

    let chartDaysByLocalDate = Dictionary(uniqueKeysWithValues: chartDays.map { ($0.localDate, $0) })
    let streakDays = try (0 ..< streakDayCount).map { offset in
        guard let rawDate = calendar.date(byAdding: .day, value: offset, to: streakStart) else {
            throw ProgressPresentationError.invalidRange(rangeStartLocalDate, todayLocalDate)
        }

        let date = calendar.startOfDay(for: rawDate)
        let localDate = progressLocalDateString(date: date, calendar: calendar)
        let isFuturePlaceholder = date > today
        let reviewCount: Int

        if isFuturePlaceholder == false {
            guard let chartDay = chartDaysByLocalDate[localDate] else {
                throw ProgressPresentationError.invalidRange(rangeStartLocalDate, todayLocalDate)
            }

            reviewCount = chartDay.reviewCount
        } else {
            reviewCount = 0
        }

        return ProgressCalendarDay(
            date: date,
            localDate: localDate,
            reviewCount: reviewCount,
            isToday: localDate == todayLocalDate,
            isFuturePlaceholder: isFuturePlaceholder,
            dayNumber: calendar.component(.day, from: date)
        )
    }

    return stride(from: 0, to: streakDays.count, by: progressDaysPerWeek).map { startIndex in
        ProgressCalendarWeek(days: Array(streakDays[startIndex ..< startIndex + progressDaysPerWeek]))
    }
}

func progressChartUpperBound(maximumReviewCount: Int) -> Int {
    guard maximumReviewCount > 0 else {
        return 1
    }

    return max(1, Int(ceil(Double(maximumReviewCount) * 1.1)))
}
