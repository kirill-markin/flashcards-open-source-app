import Foundation

struct ProgressReviewedAtClientSources: Hashable, Sendable {
    let canonicalReviewedAtClients: [String]
    let pendingReviewedAtClients: [String]

    var pendingLocalOverlayState: ProgressPendingLocalOverlayState {
        if self.pendingReviewedAtClients.isEmpty {
            return .empty
        }

        return .present
    }
}

enum ProgressPendingLocalOverlayState: Hashable, Sendable {
    case empty
    case present
}

enum ReviewScheduleLocalCoverage: Hashable, Sendable {
    case userWide
    case partialOrUnknown
}

struct ProgressRenderedSummary: Hashable, Sendable {
    let summary: ProgressSummary
    let sourceState: ProgressSourceState
}

struct ProgressRenderedSeries: Hashable, Sendable {
    let series: UserProgressSeries
    let sourceState: ProgressSourceState
}

struct ProgressRenderedReviewSchedule: Hashable, Sendable {
    let schedule: UserReviewSchedule
    let sourceState: ProgressSourceState
}

func progressSummaryScopeKey(seriesScopeKey: ProgressScopeKey) -> ProgressSummaryScopeKey {
    ProgressSummaryScopeKey(
        cloudState: seriesScopeKey.cloudState,
        linkedUserId: seriesScopeKey.linkedUserId,
        workspaceMembershipKey: seriesScopeKey.workspaceMembershipKey,
        timeZone: seriesScopeKey.timeZone,
        referenceLocalDate: seriesScopeKey.to
    )
}

func reviewScheduleScopeKey(seriesScopeKey: ProgressScopeKey) -> ReviewScheduleScopeKey {
    ReviewScheduleScopeKey(
        cloudState: seriesScopeKey.cloudState,
        linkedUserId: seriesScopeKey.linkedUserId,
        workspaceMembershipKey: seriesScopeKey.workspaceMembershipKey,
        timeZone: seriesScopeKey.timeZone,
        referenceLocalDate: seriesScopeKey.to
    )
}

func makeProgressRenderedSummary(
    serverBase: PersistedProgressSummaryServerBase?,
    scopeKey: ProgressSummaryScopeKey,
    localFallbackSummary: ProgressSummary,
    pendingLocalOverlayState: ProgressPendingLocalOverlayState
) -> ProgressRenderedSummary {
    guard let serverBaseSummary = serverBase?.serverBase.summary,
          serverBase?.scopeKey == scopeKey else {
        return ProgressRenderedSummary(
            summary: localFallbackSummary,
            sourceState: .localOnly
        )
    }

    switch pendingLocalOverlayState {
    case .present:
        return ProgressRenderedSummary(
            summary: localFallbackSummary,
            sourceState: .serverBaseWithPendingLocalOverlay
        )
    case .empty:
        return ProgressRenderedSummary(
            summary: serverBaseSummary,
            sourceState: .serverBase
        )
    }
}

func makeProgressRenderedSeries(
    serverBase: PersistedProgressSeriesServerBase?,
    scopeKey: ProgressScopeKey,
    localFallbackSeries: UserProgressSeries,
    pendingLocalOverlaySeries: UserProgressSeries,
    pendingLocalOverlayState: ProgressPendingLocalOverlayState
) throws -> ProgressRenderedSeries {
    guard let serverBaseSeries = serverBase?.serverBase,
          serverBase?.scopeKey == scopeKey else {
        return ProgressRenderedSeries(
            series: localFallbackSeries,
            sourceState: .localOnly
        )
    }

    return ProgressRenderedSeries(
        series: try mergeProgressSeries(
            serverBase: serverBaseSeries,
            pendingLocalOverlay: pendingLocalOverlaySeries
        ),
        sourceState: progressSeriesSourceState(pendingLocalOverlayState: pendingLocalOverlayState)
    )
}

func makeProgressRenderedReviewSchedule(
    serverBase: PersistedReviewScheduleServerBase?,
    scopeKey: ReviewScheduleScopeKey,
    localFallbackSchedule: UserReviewSchedule,
    localFallbackCoverage: ReviewScheduleLocalCoverage,
    pendingLocalOverlayState: ProgressPendingLocalOverlayState
) -> ProgressRenderedReviewSchedule {
    guard let serverBaseSchedule = serverBase?.serverBase,
          serverBase?.scopeKey == scopeKey else {
        return ProgressRenderedReviewSchedule(
            schedule: localFallbackSchedule,
            sourceState: .localOnly
        )
    }

    switch pendingLocalOverlayState {
    case .present:
        let schedule: UserReviewSchedule
        switch localFallbackCoverage {
        case .userWide:
            schedule = localFallbackSchedule
        case .partialOrUnknown:
            schedule = serverBaseSchedule
        }

        return ProgressRenderedReviewSchedule(
            schedule: schedule,
            sourceState: .serverBaseWithPendingLocalOverlay
        )
    case .empty:
        return ProgressRenderedReviewSchedule(
            schedule: serverBaseSchedule,
            sourceState: .serverBase
        )
    }
}

private func progressSeriesSourceState(
    pendingLocalOverlayState: ProgressPendingLocalOverlayState
) -> ProgressSourceState {
    switch pendingLocalOverlayState {
    case .empty:
        return .serverBase
    case .present:
        return .serverBaseWithPendingLocalOverlay
    }
}

func makeProgressSeriesFromReviewedAtClients(
    reviewedAtClients: [String],
    requestRange: ProgressRequestRange
) throws -> UserProgressSeries {
    let timeZone = try progressTimeZone(identifier: requestRange.timeZone)
    let calendar = makeProgressStoreCalendar(timeZone: timeZone)
    var reviewCountsByLocalDate: [String: Int] = [:]

    for reviewedAtClient in reviewedAtClients {
        guard let reviewedAtDate = parseIsoTimestamp(value: reviewedAtClient) else {
            throw LocalStoreError.validation("Progress reviewedAtClient timestamp is invalid: \(reviewedAtClient)")
        }

        let localDate = progressLocalDateStringForStore(date: reviewedAtDate, calendar: calendar)
        if localDate < requestRange.from || localDate > requestRange.to {
            continue
        }

        reviewCountsByLocalDate[localDate, default: 0] += 1
    }

    let zeroFilledDays = try makeZeroFilledProgressDays(requestRange: requestRange)
    let progressDays = zeroFilledDays.map { progressDay in
        ProgressDay(
            date: progressDay.date,
            reviewCount: reviewCountsByLocalDate[progressDay.date] ?? 0
        )
    }

    return makeProgressSeries(
        timeZone: requestRange.timeZone,
        from: requestRange.from,
        to: requestRange.to,
        dailyReviews: progressDays,
        summary: nil,
        generatedAt: nil
    )
}

func makeProgressSummaryFromReviewedAtClients(
    reviewedAtClients: [String],
    timeZone: String,
    referenceLocalDate: String
) throws -> ProgressSummary {
    let resolvedTimeZone = try progressTimeZone(identifier: timeZone)
    let calendar = makeProgressStoreCalendar(timeZone: resolvedTimeZone)
    let reviewDates = try Set(reviewedAtClients.map { reviewedAtClient in
        guard let reviewedAtDate = parseIsoTimestamp(value: reviewedAtClient) else {
            throw LocalStoreError.validation("Progress reviewedAtClient timestamp is invalid: \(reviewedAtClient)")
        }

        return progressLocalDateStringForStore(date: reviewedAtDate, calendar: calendar)
    })

    return try makeProgressSummary(
        reviewDates: reviewDates,
        timeZone: timeZone,
        generatedAt: progressReferenceDate(
            localDate: referenceLocalDate,
            timeZoneIdentifier: timeZone
        )
    )
}

func mergeProgressSeries(
    serverBase: UserProgressSeries,
    pendingLocalOverlay: UserProgressSeries
) throws -> UserProgressSeries {
    guard
        serverBase.timeZone == pendingLocalOverlay.timeZone,
        serverBase.from == pendingLocalOverlay.from,
        serverBase.to == pendingLocalOverlay.to
    else {
        throw LocalStoreError.validation("Progress merge inputs must share the same time range")
    }

    let overlayCounts = Dictionary(uniqueKeysWithValues: pendingLocalOverlay.dailyReviews.map { progressDay in
        (progressDay.date, progressDay.reviewCount)
    })
    let mergedDailyReviews = serverBase.dailyReviews.map { progressDay in
        ProgressDay(
            date: progressDay.date,
            reviewCount: progressDay.reviewCount + (overlayCounts[progressDay.date] ?? 0)
        )
    }

    return makeProgressSeries(
        timeZone: serverBase.timeZone,
        from: serverBase.from,
        to: serverBase.to,
        dailyReviews: mergedDailyReviews,
        summary: nil,
        generatedAt: serverBase.generatedAt
    )
}

func patchProgressSnapshot(
    snapshot: ProgressSnapshot,
    scopeKey: ProgressScopeKey,
    reviewedAtClient: String
) throws -> ProgressSnapshot {
    guard snapshot.scopeKey.timeZone == scopeKey.timeZone else {
        return snapshot
    }

    let timeZone = try progressTimeZone(identifier: scopeKey.timeZone)
    let calendar = makeProgressStoreCalendar(timeZone: timeZone)
    let reviewedAtDate = try reviewedAtDateForProgressMutation(reviewedAtClient: reviewedAtClient)
    let reviewedLocalDate = progressLocalDateStringForStore(date: reviewedAtDate, calendar: calendar)
    let previousRangeActiveDates = Set(
        snapshot.chartData.chartDays.compactMap { chartDay in
            chartDay.reviewCount > 0 ? chartDay.localDate : nil
        }
    )
    let previousRangeStreakDays = try progressCurrentStreakDays(
        reviewDates: previousRangeActiveDates,
        todayLocalDate: snapshot.scopeKey.to
    )
    let streakExtensionDays = max(0, snapshot.summary.currentStreakDays - previousRangeStreakDays)

    var dailyReviews = try makeSnapshotProgressDailyReviews(
        snapshot: snapshot,
        scopeKey: scopeKey,
        calendar: calendar
    )
    if let dayIndex = dailyReviews.firstIndex(where: { progressDay in
        progressDay.date == reviewedLocalDate
    }) {
        let progressDay = dailyReviews[dayIndex]
        dailyReviews[dayIndex] = ProgressDay(
            date: progressDay.date,
            reviewCount: progressDay.reviewCount + 1
        )
    }

    let nextRangeActiveDates = Set(
        dailyReviews.compactMap { progressDay in
            progressDay.reviewCount > 0 ? progressDay.date : nil
        }
    )
    let nextRangeStreakDays = try progressCurrentStreakDays(
        reviewDates: nextRangeActiveDates,
        todayLocalDate: scopeKey.to
    )
    let didAddActiveReviewDay = previousRangeActiveDates.contains(reviewedLocalDate) == false
        && nextRangeActiveDates.contains(reviewedLocalDate)
    let patchedSummary = ProgressSummary(
        currentStreakDays: nextRangeStreakDays + streakExtensionDays,
        hasReviewedToday: nextRangeActiveDates.contains(scopeKey.to),
        lastReviewedOn: maxProgressLocalDate(
            left: snapshot.summary.lastReviewedOn,
            right: nextRangeActiveDates.max()
        ),
        activeReviewDays: snapshot.summary.activeReviewDays + (didAddActiveReviewDay ? 1 : 0)
    )
    let patchedSeries = makeProgressSeries(
        timeZone: scopeKey.timeZone,
        from: scopeKey.from,
        to: scopeKey.to,
        dailyReviews: dailyReviews,
        summary: nil,
        generatedAt: snapshot.generatedAt
    )

    return try makeProgressSnapshot(
        summary: patchedSummary,
        series: patchedSeries,
        scopeKey: scopeKey,
        summarySourceState: patchedProgressSourceState(sourceState: snapshot.summarySourceState),
        seriesSourceState: patchedProgressSourceState(sourceState: snapshot.seriesSourceState),
        calendar: calendar
    )
}

private func makeSnapshotProgressDailyReviews(
    snapshot: ProgressSnapshot,
    scopeKey: ProgressScopeKey,
    calendar: Calendar
) throws -> [ProgressDay] {
    let reviewCountsByLocalDate = Dictionary(uniqueKeysWithValues: snapshot.chartData.chartDays.map { chartDay in
        (chartDay.localDate, chartDay.reviewCount)
    })
    let startDate = try progressDateForStore(localDate: scopeKey.from, calendar: calendar)
    let endDate = try progressDateForStore(localDate: scopeKey.to, calendar: calendar)
    var progressDays: [ProgressDay] = []
    var currentDate = startDate

    while currentDate <= endDate {
        let localDate = progressLocalDateStringForStore(date: currentDate, calendar: calendar)
        progressDays.append(
            ProgressDay(
                date: localDate,
                reviewCount: reviewCountsByLocalDate[localDate] ?? 0
            )
        )
        guard let nextDate = calendar.date(byAdding: .day, value: 1, to: currentDate) else {
            throw LocalStoreError.validation("Progress date range could not be advanced")
        }

        currentDate = nextDate
    }

    return progressDays
}

private func patchedProgressSourceState(sourceState: ProgressSourceState) -> ProgressSourceState {
    switch sourceState {
    case .localOnly:
        return .localOnly
    case .serverBase, .serverBaseWithPendingLocalOverlay:
        return .serverBaseWithPendingLocalOverlay
    }
}

private func reviewedAtDateForProgressMutation(reviewedAtClient: String) throws -> Date {
    guard let reviewedAtDate = parseIsoTimestamp(value: reviewedAtClient) else {
        throw LocalStoreError.validation("Progress reviewedAtClient timestamp is invalid: \(reviewedAtClient)")
    }

    return reviewedAtDate
}

private func progressCurrentStreakDays(
    reviewDates: Set<String>,
    todayLocalDate: String
) throws -> Int {
    var currentDate = reviewDates.contains(todayLocalDate)
        ? todayLocalDate
        : try progressShiftLocalDateForStore(value: todayLocalDate, offsetDays: -1)
    var streakDayCount = 0

    while reviewDates.contains(currentDate) {
        streakDayCount += 1
        currentDate = try progressShiftLocalDateForStore(value: currentDate, offsetDays: -1)
    }

    return streakDayCount
}

private func maxProgressLocalDate(left: String?, right: String?) -> String? {
    switch (left, right) {
    case (.none, .none):
        return nil
    case (.some(let leftValue), .none):
        return leftValue
    case (.none, .some(let rightValue)):
        return rightValue
    case (.some(let leftValue), .some(let rightValue)):
        return max(leftValue, rightValue)
    }
}
