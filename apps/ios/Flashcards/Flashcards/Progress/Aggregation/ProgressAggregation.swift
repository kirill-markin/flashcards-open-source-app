import Foundation

struct ProgressReviewedAtClientSources: Hashable, Sendable {
    let canonicalReviewEvents: [ProgressReviewEventSource]
    let pendingReviewEvents: [ProgressReviewEventSource]
    /// Canonical review events rated Hard, Good, or Easy; Again is excluded.
    let canonicalQualifiedReviewEvents: [ProgressQualifiedReviewEventSource]
    /// Pending outbox review events rated Hard, Good, or Easy; Again is excluded.
    let pendingQualifiedReviewEvents: [ProgressQualifiedReviewEventSource]

    var pendingLocalOverlayState: ProgressPendingLocalOverlayState {
        if self.pendingReviewEvents.isEmpty {
            return .empty
        }

        return .present
    }
}

struct ProgressReviewEventSource: Hashable, Sendable {
    let reviewEventId: String
    let reviewedAtClient: String
    let reviewedTimeZone: String?
    let rating: ReviewRating
}

struct ProgressQualifiedReviewEventSource: Hashable, Sendable {
    let reviewEventId: String
    let reviewedAtClient: String
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
    /// Server-only facts, taken as they are from a server base of the same scope; nil for the local fallback.
    let insights: ProgressInsights?
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

func progressLeaderboardScopeKey(
    seriesScopeKey: ProgressScopeKey,
    localeIdentifier: String
) -> ProgressLeaderboardScopeKey {
    ProgressLeaderboardScopeKey(
        cloudState: seriesScopeKey.cloudState,
        linkedUserId: seriesScopeKey.linkedUserId,
        localeIdentifier: localeIdentifier
    )
}

/// Live viewer overlay input: distinct qualified review events inside each rolling
/// window anchored at the current device time. Canonical and pending events are
/// deduplicated by review event id because locally submitted events exist in both.
/// Every window is counted from one shared pass so each timestamp is parsed once.
func progressLeaderboardQualifiedReviewCounts(
    canonicalQualifiedReviewEvents: [ProgressQualifiedReviewEventSource],
    pendingQualifiedReviewEvents: [ProgressQualifiedReviewEventSource],
    now: Date
) throws -> [LeaderboardWindowKey: Int] {
    var reviewedAtDatesByReviewEventId: [String: Date] = [:]
    for qualifiedReviewEvent in canonicalQualifiedReviewEvents + pendingQualifiedReviewEvents {
        guard let reviewedAtDate = parseIsoTimestamp(value: qualifiedReviewEvent.reviewedAtClient) else {
            throw LocalStoreError.validation(
                "Leaderboard reviewedAtClient timestamp is invalid: \(qualifiedReviewEvent.reviewedAtClient)"
            )
        }

        reviewedAtDatesByReviewEventId[qualifiedReviewEvent.reviewEventId] = reviewedAtDate
    }

    var qualifiedReviewCounts: [LeaderboardWindowKey: Int] = [:]
    for windowKey in LeaderboardWindowKey.stableOrder {
        let windowStart: Date?
        if let rollingWindowHours = windowKey.rollingWindowHours {
            windowStart = now.addingTimeInterval(-Double(rollingWindowHours) * 3600)
        } else {
            windowStart = nil
        }

        qualifiedReviewCounts[windowKey] = reviewedAtDatesByReviewEventId.values.count { reviewedAtDate in
            guard let windowStart else {
                return true
            }

            return reviewedAtDate >= windowStart
        }
    }

    return qualifiedReviewCounts
}

func makeProgressRenderedSummary(
    serverBase: PersistedProgressSummaryServerBase?,
    scopeKey: ProgressSummaryScopeKey,
    localFallbackSummary: ProgressSummary,
    localFallbackActiveDates: Set<String>,
    pendingLocalOverlayState: ProgressPendingLocalOverlayState
) throws -> ProgressRenderedSummary {
    guard let persistedServerBase = serverBase,
          persistedServerBase.scopeKey == scopeKey else {
        return ProgressRenderedSummary(
            summary: localFallbackSummary,
            insights: nil,
            sourceState: .localOnly
        )
    }

    let serverBaseSummary = persistedServerBase.serverBase.summary
    let serverBaseInsights = persistedServerBase.serverBase.insights
    let renderedSummary = try mergeProgressSummary(
        serverBase: serverBaseSummary,
        localFallbackActiveDates: localFallbackActiveDates,
        referenceLocalDate: scopeKey.referenceLocalDate
    )

    switch pendingLocalOverlayState {
    case .present:
        return ProgressRenderedSummary(
            summary: renderedSummary,
            insights: serverBaseInsights,
            sourceState: .serverBaseWithPendingLocalOverlay
        )
    case .empty:
        guard renderedSummary != serverBaseSummary else {
            return ProgressRenderedSummary(
                summary: serverBaseSummary,
                insights: serverBaseInsights,
                sourceState: .serverBase
            )
        }

        return ProgressRenderedSummary(
            summary: renderedSummary,
            insights: serverBaseInsights,
            sourceState: .serverBaseWithPendingLocalOverlay
        )
    }
}

func makeProgressRenderedSeries(
    serverBase: PersistedProgressSeriesServerBase?,
    scopeKey: ProgressScopeKey,
    localFallbackSeries: UserProgressSeries,
    pendingLocalOverlaySeries: UserProgressSeries,
    mergedActiveReviewDates: Set<String>
) throws -> ProgressRenderedSeries {
    guard let serverBaseSeries = serverBase?.serverBase,
          serverBase?.scopeKey == scopeKey else {
        return ProgressRenderedSeries(
            series: localFallbackSeries,
            sourceState: .localOnly
        )
    }

    let renderedSeries = try mergeProgressSeries(
        serverBase: serverBaseSeries,
        pendingLocalOverlay: pendingLocalOverlaySeries,
        localFallback: localFallbackSeries,
        mergedActiveReviewDates: mergedActiveReviewDates
    )

    return ProgressRenderedSeries(
        series: renderedSeries,
        sourceState: progressSeriesSourceState(
            serverBase: serverBaseSeries,
            renderedSeries: renderedSeries
        )
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

func canReplaceServerReviewScheduleForPendingLocalChange(
    serverBaseSchedule: UserReviewSchedule,
    localFallbackSchedule: UserReviewSchedule,
    localFallbackCoverage: ReviewScheduleLocalCoverage,
    pendingLocalCardTotalDelta: Int
) -> Bool {
    guard localFallbackCoverage == .userWide else {
        return false
    }

    return localFallbackSchedule.totalCards - pendingLocalCardTotalDelta == serverBaseSchedule.totalCards
}

private func progressSeriesSourceState(
    serverBase: UserProgressSeries,
    renderedSeries: UserProgressSeries
) -> ProgressSourceState {
    if serverBase.dailyReviews == renderedSeries.dailyReviews,
       serverBase.streakDays == renderedSeries.streakDays {
        return .serverBase
    }

    return .serverBaseWithPendingLocalOverlay
}

private func mergeProgressSummary(
    serverBase: ProgressSummary,
    localFallbackActiveDates: Set<String>,
    referenceLocalDate: String
) throws -> ProgressSummary {
    try validateProgressSummaryStreakContract(summary: serverBase)
    guard localFallbackActiveDates.contains(referenceLocalDate),
          serverBase.hasReviewedToday == false else {
        return serverBase
    }

    return try progressSummaryByApplyingTodayReviewOverlay(
        serverBase: serverBase,
        referenceLocalDate: referenceLocalDate
    )
}

private func progressSummaryByApplyingTodayReviewOverlay(
    serverBase: ProgressSummary,
    referenceLocalDate: String
) throws -> ProgressSummary {
    guard serverBase.currentStreakDays < Int.max else {
        throw LocalStoreError.validation("Progress currentStreakDays is too large to increment")
    }
    guard serverBase.activeReviewDays < Int.max else {
        throw LocalStoreError.validation("Progress activeReviewDays is too large to increment")
    }

    let currentStreakDays = serverBase.currentStreakDays + 1
    return ProgressSummary(
        currentStreakDays: currentStreakDays,
        longestStreakDays: max(serverBase.longestStreakDays, currentStreakDays),
        hasReviewedToday: true,
        lastReviewedOn: referenceLocalDate,
        activeReviewDays: serverBase.activeReviewDays + 1,
        streakFreeze: try progressStreakFreezeAfterEarningStreakDay(streakFreeze: serverBase.streakFreeze)
    )
}

private func validateProgressSeriesMergeInputs(
    serverBase: UserProgressSeries,
    pendingLocalOverlay: UserProgressSeries,
    localFallback: UserProgressSeries
) throws {
    guard
        serverBase.timeZone == pendingLocalOverlay.timeZone,
        serverBase.from == pendingLocalOverlay.from,
        serverBase.to == pendingLocalOverlay.to,
        serverBase.timeZone == localFallback.timeZone,
        serverBase.from == localFallback.from,
        serverBase.to == localFallback.to
    else {
        throw LocalStoreError.validation(
            """
            Progress merge inputs must share the same time range. \
            serverBase=\(serverBase.timeZone) \(serverBase.from)...\(serverBase.to), \
            pendingLocalOverlay=\(pendingLocalOverlay.timeZone) \(pendingLocalOverlay.from)...\(pendingLocalOverlay.to), \
            localFallback=\(localFallback.timeZone) \(localFallback.from)...\(localFallback.to).
            """
        )
    }
}

private func progressReviewRatingCountsByLocalDate(
    series: UserProgressSeries,
    sourceName: String
) throws -> [String: ProgressReviewRatingCounts] {
    var countsByLocalDate: [String: ProgressReviewRatingCounts] = [:]
    for progressDay in series.dailyReviews {
        let ratingCounts = try progressReviewRatingCounts(
            progressDay: progressDay,
            sourceName: sourceName
        )

        guard countsByLocalDate.updateValue(ratingCounts, forKey: progressDay.date) == nil else {
            throw LocalStoreError.validation(
                "Progress merge \(sourceName) contained a duplicate local date. localDate=\(progressDay.date)."
            )
        }
    }

    return countsByLocalDate
}

private func progressReviewRatingCounts(
    progressDay: ProgressDay,
    sourceName: String
) throws -> ProgressReviewRatingCounts {
    guard progressDay.reviewCount >= 0 else {
        throw LocalStoreError.validation(
            """
            Progress merge \(sourceName) contained a negative review count. \
            localDate=\(progressDay.date), reviewCount=\(progressDay.reviewCount).
            """
        )
    }

    let ratingCounts = ProgressReviewRatingCounts(
        againCount: progressDay.againCount,
        hardCount: progressDay.hardCount,
        goodCount: progressDay.goodCount,
        easyCount: progressDay.easyCount
    )
    let values: [(rating: String, count: Int)] = [
        ("again", ratingCounts.againCount),
        ("hard", ratingCounts.hardCount),
        ("good", ratingCounts.goodCount),
        ("easy", ratingCounts.easyCount),
    ]
    for value in values {
        guard value.count >= 0 else {
            throw LocalStoreError.validation(
                """
                Progress merge \(sourceName) contained a negative \(value.rating) review count. \
                localDate=\(progressDay.date), count=\(value.count).
                """
            )
        }
    }

    guard progressDay.reviewCount == ratingCounts.reviewCount else {
        throw LocalStoreError.validation(
            """
            Progress merge \(sourceName) review count must equal its rating-count total. \
            localDate=\(progressDay.date), reviewCount=\(progressDay.reviewCount), ratingTotal=\(ratingCounts.reviewCount).
            """
        )
    }

    return ratingCounts
}

private func validateProgressCountsInRange(
    localDates: Dictionary<String, ProgressReviewRatingCounts>.Keys,
    rangeLocalDates: Set<String>,
    sourceName: String,
    rangeDescription: String
) throws {
    for localDate in localDates where rangeLocalDates.contains(localDate) == false {
        throw LocalStoreError.validation(
            """
            Progress merge \(sourceName) contained a local date outside the merge range. \
            localDate=\(localDate), range=\(rangeDescription).
            """
        )
    }
}

func makeProgressSeriesFromReviewEvents(
    reviewEvents: [ProgressReviewEventSource],
    requestRange: ProgressRequestRange
) throws -> UserProgressSeries {
    let ratingCountsByLocalDate = try progressReviewRatingCountsByLocalDate(
        reviewEvents: reviewEvents,
        requestRange: requestRange
    )
    let activeReviewLocalDates = try progressActiveDatesFromReviewEvents(
        reviewEvents: reviewEvents,
        timeZone: requestRange.timeZone
    )
    let zeroFilledDays = try makeZeroFilledProgressDays(requestRange: requestRange)
    let progressDays: [ProgressDay] = zeroFilledDays.map { progressDay in
        let ratingCounts = ratingCountsByLocalDate[progressDay.date] ?? zeroProgressReviewRatingCounts()
        return ProgressDay(
            date: progressDay.date,
            reviewCount: ratingCounts.reviewCount,
            againCount: ratingCounts.againCount,
            hardCount: ratingCounts.hardCount,
            goodCount: ratingCounts.goodCount,
            easyCount: ratingCounts.easyCount
        )
    }
    let streakFreezeEvaluation = try evaluateProgressStreakFreeze(
        sortedActiveReviewLocalDates: activeReviewLocalDates.sorted(),
        today: requestRange.to,
        policy: progressStreakFreezePolicy
    )

    return makeProgressSeries(
        timeZone: requestRange.timeZone,
        from: requestRange.from,
        to: requestRange.to,
        dailyReviews: progressDays,
        streakDays: makeProgressStreakDays(
            range: zeroFilledDays.map(\.date),
            activeReviewDates: activeReviewLocalDates,
            evaluatedStreakDays: streakFreezeEvaluation.streakDays,
            today: requestRange.to
        ),
        summary: nil,
        generatedAt: nil,
        reviewHistoryWatermarks: []
    )
}

private func progressReviewRatingCountsByLocalDate(
    reviewEvents: [ProgressReviewEventSource],
    requestRange: ProgressRequestRange
) throws -> [String: ProgressReviewRatingCounts] {
    var ratingCountsByLocalDate: [String: ProgressReviewRatingCounts] = [:]

    for reviewEvent in reviewEvents {
        let localDate = try progressReviewEventLocalDate(
            reviewEvent: reviewEvent,
            fallbackTimeZone: requestRange.timeZone
        )
        if localDate < requestRange.from || localDate > requestRange.to {
            continue
        }

        let currentCounts = ratingCountsByLocalDate[localDate] ?? zeroProgressReviewRatingCounts()
        ratingCountsByLocalDate[localDate] = progressReviewRatingCountsByAddingRating(
            counts: currentCounts,
            rating: reviewEvent.rating
        )
    }

    return ratingCountsByLocalDate
}

func progressActiveDatesFromReviewEvents(
    reviewEvents: [ProgressReviewEventSource],
    timeZone: String
) throws -> Set<String> {
    return try Set(reviewEvents.map { reviewEvent in
        try progressReviewEventLocalDate(reviewEvent: reviewEvent, fallbackTimeZone: timeZone)
    })
}

private func progressReviewEventLocalDate(
    reviewEvent: ProgressReviewEventSource,
    fallbackTimeZone: String
) throws -> String {
    guard let reviewedAtDate = parseIsoTimestamp(value: reviewEvent.reviewedAtClient) else {
        throw LocalStoreError.validation(
            "Progress reviewedAtClient timestamp is invalid: \(reviewEvent.reviewedAtClient)"
        )
    }

    let timeZone = try progressTimeZone(identifier: reviewEvent.reviewedTimeZone ?? fallbackTimeZone)
    let calendar = makeProgressStoreCalendar(timeZone: timeZone)
    return progressLocalDateStringForStore(date: reviewedAtDate, calendar: calendar)
}

private func zeroProgressReviewRatingCounts() -> ProgressReviewRatingCounts {
    ProgressReviewRatingCounts(
        againCount: 0,
        hardCount: 0,
        goodCount: 0,
        easyCount: 0
    )
}

private func progressReviewRatingCountsByAddingRating(
    counts: ProgressReviewRatingCounts,
    rating: ReviewRating
) -> ProgressReviewRatingCounts {
    switch rating {
    case .again:
        return ProgressReviewRatingCounts(
            againCount: counts.againCount + 1,
            hardCount: counts.hardCount,
            goodCount: counts.goodCount,
            easyCount: counts.easyCount
        )
    case .hard:
        return ProgressReviewRatingCounts(
            againCount: counts.againCount,
            hardCount: counts.hardCount + 1,
            goodCount: counts.goodCount,
            easyCount: counts.easyCount
        )
    case .good:
        return ProgressReviewRatingCounts(
            againCount: counts.againCount,
            hardCount: counts.hardCount,
            goodCount: counts.goodCount + 1,
            easyCount: counts.easyCount
        )
    case .easy:
        return ProgressReviewRatingCounts(
            againCount: counts.againCount,
            hardCount: counts.hardCount,
            goodCount: counts.goodCount,
            easyCount: counts.easyCount + 1
        )
    }
}

private func addProgressReviewRatingCounts(
    left: ProgressReviewRatingCounts,
    right: ProgressReviewRatingCounts
) -> ProgressReviewRatingCounts {
    ProgressReviewRatingCounts(
        againCount: left.againCount + right.againCount,
        hardCount: left.hardCount + right.hardCount,
        goodCount: left.goodCount + right.goodCount,
        easyCount: left.easyCount + right.easyCount
    )
}

func mergeProgressSeries(
    serverBase: UserProgressSeries,
    pendingLocalOverlay: UserProgressSeries,
    localFallback: UserProgressSeries,
    mergedActiveReviewDates: Set<String>
) throws -> UserProgressSeries {
    try validateProgressSeriesMergeInputs(
        serverBase: serverBase,
        pendingLocalOverlay: pendingLocalOverlay,
        localFallback: localFallback
    )

    let serverCounts = try progressReviewRatingCountsByLocalDate(series: serverBase, sourceName: "serverBase")
    let pendingCounts = try progressReviewRatingCountsByLocalDate(series: pendingLocalOverlay, sourceName: "pendingLocalOverlay")
    let localFallbackCounts = try progressReviewRatingCountsByLocalDate(series: localFallback, sourceName: "localFallback")
    let zeroFilledDays = try makeZeroFilledProgressDays(
        requestRange: ProgressRequestRange(
            timeZone: serverBase.timeZone,
            from: serverBase.from,
            to: serverBase.to
        )
    )
    let rangeLocalDates = Set(zeroFilledDays.map(\.date))
    let rangeDescription = "\(serverBase.from)...\(serverBase.to)"
    try validateProgressCountsInRange(
        localDates: serverCounts.keys,
        rangeLocalDates: rangeLocalDates,
        sourceName: "serverBase",
        rangeDescription: rangeDescription
    )
    try validateProgressCountsInRange(
        localDates: pendingCounts.keys,
        rangeLocalDates: rangeLocalDates,
        sourceName: "pendingLocalOverlay",
        rangeDescription: rangeDescription
    )
    try validateProgressCountsInRange(
        localDates: localFallbackCounts.keys,
        rangeLocalDates: rangeLocalDates,
        sourceName: "localFallback",
        rangeDescription: rangeDescription
    )
    let mergedDailyReviews: [ProgressDay] = zeroFilledDays.map { progressDay in
        let serverRatingCounts = serverCounts[progressDay.date] ?? zeroProgressReviewRatingCounts()
        let ratingCounts: ProgressReviewRatingCounts
        if progressDay.date == serverBase.to {
            let serverOverlayCounts = addProgressReviewRatingCounts(
                left: serverRatingCounts,
                right: pendingCounts[progressDay.date] ?? zeroProgressReviewRatingCounts()
            )
            let localFallbackRatingCounts = localFallbackCounts[progressDay.date] ?? zeroProgressReviewRatingCounts()
            ratingCounts = localFallbackRatingCounts.reviewCount > serverOverlayCounts.reviewCount
                ? localFallbackRatingCounts
                : serverOverlayCounts
        } else {
            ratingCounts = serverRatingCounts
        }

        return ProgressDay(
            date: progressDay.date,
            reviewCount: ratingCounts.reviewCount,
            againCount: ratingCounts.againCount,
            hardCount: ratingCounts.hardCount,
            goodCount: ratingCounts.goodCount,
            easyCount: ratingCounts.easyCount
        )
    }
    let hasLocalReviewOnToday = (pendingCounts[serverBase.to]?.reviewCount ?? 0) > 0
        || (localFallbackCounts[serverBase.to]?.reviewCount ?? 0) > 0
    let streakDays = makeMergedProgressSeriesStreakDays(
        serverBase: serverBase,
        hasLocalReviewOnToday: hasLocalReviewOnToday
    )

    return makeProgressSeries(
        timeZone: serverBase.timeZone,
        from: serverBase.from,
        to: serverBase.to,
        dailyReviews: mergedDailyReviews,
        streakDays: streakDays,
        summary: nil,
        generatedAt: serverBase.generatedAt,
        reviewHistoryWatermarks: serverBase.reviewHistoryWatermarks
    )
}

private func makeMergedProgressSeriesStreakDays(
    serverBase: UserProgressSeries,
    hasLocalReviewOnToday: Bool
) -> [ProgressStreakDay] {
    guard hasLocalReviewOnToday else {
        return serverBase.streakDays
    }

    return serverBase.streakDays.map { streakDay in
        if streakDay.date == serverBase.to {
            return ProgressStreakDay(date: streakDay.date, state: .reviewed)
        }

        return streakDay
    }
}

/// The first review of the day extends the streak, as the server will; the deferred refresh then
/// recomputes the exact summary. See docs/fsrs-scheduling-logic.md#non-blocking-review.
func progressSummaryAfterLocalRating(
    summary: ProgressSummary,
    scopeKey: ProgressScopeKey,
    reviewedAtClient: String,
    reviewedTimeZone: String?,
    rating: ReviewRating
) throws -> ProgressSummary {
    let reviewedLocalDate = try progressReviewEventLocalDate(
        reviewEvent: ProgressReviewEventSource(
            reviewEventId: "local-progress-mutation",
            reviewedAtClient: reviewedAtClient,
            reviewedTimeZone: reviewedTimeZone,
            rating: rating
        ),
        fallbackTimeZone: scopeKey.timeZone
    )
    guard reviewedLocalDate == scopeKey.to, summary.hasReviewedToday == false else {
        return summary
    }

    return try progressSummaryByApplyingTodayReviewOverlay(
        serverBase: summary,
        referenceLocalDate: scopeKey.to
    )
}
