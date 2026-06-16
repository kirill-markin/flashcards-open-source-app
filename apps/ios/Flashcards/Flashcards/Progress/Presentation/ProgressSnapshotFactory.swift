import Foundation

private let progressStreakWeekCount: Int = 5
private let progressLeaderboardTopRowCount: Int = 3

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
            streakState: timelineDay.streakState,
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
    let defaultWindowKey = try resolveProgressLeaderboardDefaultWindowKey(windowStates: windowStates)

    return ProgressLeaderboardSnapshot(
        scopeKey: scopeKey,
        state: .ready(
            ProgressLeaderboardReadyState(
                defaultWindowKey: defaultWindowKey,
                windows: windowStates
            )
        )
    )
}

/// The live overlay only reranks the current viewer against the frozen server
/// ranking; other participants stay in the server-provided order.
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
    let projectedRankingRows = try makeProjectedProgressLeaderboardRankingRows(
        window: window,
        viewerQualifiedReviewCount: overlaidViewerCount
    )
    let projectedViewerRank = try progressLeaderboardViewerRank(rankingRows: projectedRankingRows)
    let rows = try makeCompactProgressLeaderboardRowStates(
        rankingRows: projectedRankingRows,
        viewerRank: projectedViewerRank
    )

    return ProgressLeaderboardWindowState(
        windowKey: window.windowKey,
        snapshotGeneratedAt: window.snapshotGeneratedAt,
        participantCount: window.participantCount,
        viewerRank: projectedViewerRank,
        viewerQualifiedReviewCount: overlaidViewerCount,
        rows: rows
    )
}

private func makeProjectedProgressLeaderboardRankingRows(
    window: ProgressLeaderboardWindow,
    viewerQualifiedReviewCount: Int
) throws -> [ProgressLeaderboardRankingRow] {
    guard let serverViewerRow = window.rankingRows.first(where: { rankingRow in
        rankingRow.kind == .viewer
    }) else {
        throw LocalStoreError.validation(
            "Leaderboard ranking rows are missing the viewer for window \(window.windowKey.rawValue)"
        )
    }

    let participantRows = window.rankingRows.filter { rankingRow in
        rankingRow.kind == .participant
    }
    let projectedViewerRow = ProgressLeaderboardRankingRow(
        kind: .viewer,
        publicProfileId: serverViewerRow.publicProfileId,
        anonymousDisplayName: serverViewerRow.anonymousDisplayName,
        qualifiedReviewCount: viewerQualifiedReviewCount,
        rank: serverViewerRow.rank
    )
    let insertionIndex = participantRows.firstIndex { rankingRow in
        rankingRow.qualifiedReviewCount < viewerQualifiedReviewCount
    } ?? participantRows.count
    let projectedRows = Array(participantRows.prefix(insertionIndex))
        + [projectedViewerRow]
        + Array(participantRows.suffix(participantRows.count - insertionIndex))

    return projectedRows.enumerated().map { index, rankingRow in
        ProgressLeaderboardRankingRow(
            kind: rankingRow.kind,
            publicProfileId: rankingRow.publicProfileId,
            anonymousDisplayName: rankingRow.anonymousDisplayName,
            qualifiedReviewCount: rankingRow.qualifiedReviewCount,
            rank: index + 1
        )
    }
}

private func progressLeaderboardViewerRank(
    rankingRows: [ProgressLeaderboardRankingRow]
) throws -> Int {
    guard let viewerRow = rankingRows.first(where: { rankingRow in
        rankingRow.kind == .viewer
    }) else {
        throw LocalStoreError.validation("Projected leaderboard ranking rows are missing the viewer")
    }

    return viewerRow.rank
}

private func makeCompactProgressLeaderboardRowStates(
    rankingRows: [ProgressLeaderboardRankingRow],
    viewerRank: Int
) throws -> [ProgressLeaderboardRowState] {
    let participantCount = rankingRows.count
    let topRowCount = min(progressLeaderboardTopRowCount, participantCount)
    var shownRanks: Set<Int> = []

    if topRowCount > 0 {
        for rank in 1...topRowCount {
            shownRanks.insert(rank)
        }
    }

    if viewerRank > topRowCount {
        for rank in [viewerRank - 1, viewerRank, viewerRank + 1] {
            guard rank >= 1, rank <= participantCount else {
                continue
            }

            shownRanks.insert(rank)
        }
    } else if viewerRank == topRowCount && viewerRank < participantCount {
        shownRanks.insert(viewerRank + 1)
    }

    if participantCount > topRowCount {
        shownRanks.insert(participantCount)
    }

    var rows: [ProgressLeaderboardRowState] = []
    var previousRank: Int = 0
    for rank in shownRanks.sorted() {
        if previousRank != 0, rank > previousRank + 1 {
            rows.append(.gap(ProgressLeaderboardGapRowState(id: "gap-\(rows.count)")))
        }

        let rankingRowIndex = rank - 1
        guard rankingRows.indices.contains(rankingRowIndex) else {
            throw LocalStoreError.validation("Projected leaderboard ranking rows are missing rank \(rank)")
        }

        rows.append(
            .participant(
                makeProgressLeaderboardParticipantRowState(
                    rankingRow: rankingRows[rankingRowIndex],
                    topRowCount: topRowCount
                )
            )
        )
        previousRank = rank
    }

    if previousRank < participantCount {
        rows.append(.gap(ProgressLeaderboardGapRowState(id: "gap-\(rows.count)")))
    }

    return rows
}

private func makeProgressLeaderboardParticipantRowState(
    rankingRow: ProgressLeaderboardRankingRow,
    topRowCount: Int
) -> ProgressLeaderboardParticipantRowState {
    ProgressLeaderboardParticipantRowState(
        kind: progressLeaderboardParticipantKind(
            rankingRow: rankingRow,
            topRowCount: topRowCount
        ),
        publicProfileId: rankingRow.publicProfileId,
        anonymousDisplayName: rankingRow.anonymousDisplayName,
        qualifiedReviewCount: rankingRow.qualifiedReviewCount,
        rank: rankingRow.rank
    )
}

private func progressLeaderboardParticipantKind(
    rankingRow: ProgressLeaderboardRankingRow,
    topRowCount: Int
) -> ProgressLeaderboardParticipantKind {
    if rankingRow.kind == .viewer {
        return .viewer
    }

    if rankingRow.rank <= topRowCount {
        return .top
    }

    return .neighbor
}

private func resolveProgressLeaderboardDefaultWindowKey(
    windowStates: [ProgressLeaderboardWindowState]
) throws -> LeaderboardWindowKey {
    var bestWindowKey: LeaderboardWindowKey?
    var bestRank: Int?

    for windowKey in LeaderboardWindowKey.stableOrder {
        guard let window = windowStates.first(where: { candidate in
            candidate.windowKey == windowKey
        }) else {
            continue
        }

        if let currentBestRank = bestRank,
           window.viewerRank >= currentBestRank {
            continue
        }

        bestWindowKey = window.windowKey
        bestRank = window.viewerRank
    }

    guard let bestWindowKey else {
        throw LocalStoreError.validation("Projected leaderboard windows are missing a default window")
    }

    return bestWindowKey
}

private struct ProgressTimelineDay: Hashable, Sendable {
    let date: Date
    let localDate: String
    let reviewCount: Int
    let streakState: ProgressStreakDayState
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
    var streakStatesByLocalDate: [String: ProgressStreakDayState] = [:]
    for day in series.streakDays {
        _ = try progressDate(localDate: day.date, calendar: calendar)

        if streakStatesByLocalDate.updateValue(day.state, forKey: day.date) != nil {
            throw ProgressPresentationError.duplicateStreakDay(day.date)
        }
    }

    var timeline: [ProgressTimelineDay] = []
    var currentDate = startDate
    while currentDate <= endDate {
        let localDate = progressLocalDateString(date: currentDate, calendar: calendar)
        let reviewCount = reviewCountsByLocalDate[localDate] ?? 0
        guard let streakState = streakStatesByLocalDate[localDate] else {
            throw ProgressPresentationError.missingStreakDay(localDate)
        }
        guard (reviewCount > 0) == (streakState == .reviewed) else {
            throw ProgressPresentationError.inconsistentStreakDay(
                localDate: localDate,
                reviewCount: reviewCount,
                streakState: streakState
            )
        }

        timeline.append(
            ProgressTimelineDay(
                date: currentDate,
                localDate: localDate,
                reviewCount: reviewCount,
                streakState: streakState
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
        let streakState: ProgressStreakDayState

        if isFuturePlaceholder == false {
            guard let chartDay = chartDaysByLocalDate[localDate] else {
                throw ProgressPresentationError.invalidRange(rangeStartLocalDate, todayLocalDate)
            }

            reviewCount = chartDay.reviewCount
            streakState = chartDay.streakState
        } else {
            reviewCount = 0
            streakState = .pending
        }

        return ProgressCalendarDay(
            date: date,
            localDate: localDate,
            reviewCount: reviewCount,
            streakState: streakState,
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
