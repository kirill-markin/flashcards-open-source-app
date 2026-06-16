import Foundation

struct ProgressReviewedAtClientSources: Hashable, Sendable {
    let canonicalReviewedAtClients: [String]
    let pendingReviewedAtClients: [String]
    /// Canonical review events rated Hard, Good, or Easy; Again is excluded.
    let canonicalQualifiedReviewEvents: [ProgressQualifiedReviewEventSource]
    /// Pending outbox review events rated Hard, Good, or Easy; Again is excluded.
    let pendingQualifiedReviewEvents: [ProgressQualifiedReviewEventSource]

    var pendingLocalOverlayState: ProgressPendingLocalOverlayState {
        if self.pendingReviewedAtClients.isEmpty {
            return .empty
        }

        return .present
    }
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

struct ProgressRenderedSeriesSummaryContext: Hashable, Sendable {
    let lowerBoundSummary: ProgressSummary
    let activeDates: Set<String>
    let activeDatesMissingFromServerBase: Set<String>
    let serverBaseStreakDays: [ProgressStreakDay]
    let serverBaseReviewHistoryWatermarks: [ProgressReviewHistoryWatermark]?
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
    renderedSeriesContext: ProgressRenderedSeriesSummaryContext?,
    pendingLocalOverlayState: ProgressPendingLocalOverlayState
) throws -> ProgressRenderedSummary {
    guard let persistedServerBase = serverBase,
          persistedServerBase.scopeKey == scopeKey else {
        return ProgressRenderedSummary(
            summary: localFallbackSummary,
            sourceState: .localOnly
        )
    }

    let serverBaseSummary = persistedServerBase.serverBase.summary
    let renderedSummary = try mergeProgressSummary(
        serverBase: serverBaseSummary,
        serverBaseReviewHistoryWatermarks: persistedServerBase.serverBase.reviewHistoryWatermarks,
        localFallback: localFallbackSummary,
        localFallbackActiveDates: localFallbackActiveDates,
        renderedSeriesContext: renderedSeriesContext,
        referenceLocalDate: scopeKey.referenceLocalDate
    )

    switch pendingLocalOverlayState {
    case .present:
        return ProgressRenderedSummary(
            summary: renderedSummary,
            sourceState: .serverBaseWithPendingLocalOverlay
        )
    case .empty:
        guard renderedSummary != serverBaseSummary else {
            return ProgressRenderedSummary(
                summary: serverBaseSummary,
                sourceState: .serverBase
            )
        }

        return ProgressRenderedSummary(
            summary: renderedSummary,
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
    serverBaseReviewHistoryWatermarks: [ProgressReviewHistoryWatermark],
    localFallback: ProgressSummary,
    localFallbackActiveDates: Set<String>,
    renderedSeriesContext: ProgressRenderedSeriesSummaryContext?,
    referenceLocalDate: String
) throws -> ProgressSummary {
    let renderedSeriesLowerBound = renderedSeriesContext?.lowerBoundSummary
    let serverAndSeriesShareReviewHistoryBase = progressServerAndSeriesShareReviewHistoryBase(
        serverBaseReviewHistoryWatermarks: serverBaseReviewHistoryWatermarks,
        renderedSeriesContext: renderedSeriesContext
    )
    let serverActiveReviewDaysWithRenderedDelta = serverBase.activeReviewDays
        + progressActiveReviewDayDelta(
            activeReviewDayDeltaCandidates: progressActiveReviewDayDeltaCandidates(
                renderedSeriesContext: renderedSeriesContext,
                localFallbackActiveDates: localFallbackActiveDates,
                serverBase: serverBase,
                serverAndSeriesShareReviewHistoryBase: serverAndSeriesShareReviewHistoryBase
            ),
            serverBase: serverBase,
            serverAndSeriesShareReviewHistoryBase: serverAndSeriesShareReviewHistoryBase,
            referenceLocalDate: referenceLocalDate
        )
    let allServerSummaryDeltaActiveDates = localFallbackActiveDates.union(renderedSeriesContext?.activeDates ?? Set<String>())
    let serverBaseStreakDaysForRenderedDelta: [ProgressStreakDay]
    let serverSummaryDeltaActiveDates: Set<String>
    if serverAndSeriesShareReviewHistoryBase,
       let renderedSeriesContext,
       renderedSeriesContext.serverBaseStreakDays.isEmpty == false {
        serverBaseStreakDaysForRenderedDelta = renderedSeriesContext.serverBaseStreakDays
        serverSummaryDeltaActiveDates = allServerSummaryDeltaActiveDates
    } else {
        serverBaseStreakDaysForRenderedDelta = []
        serverSummaryDeltaActiveDates = allServerSummaryDeltaActiveDates.contains(referenceLocalDate)
            ? Set([referenceLocalDate])
            : Set<String>()
    }
    let serverSummaryWithRenderedDelta = try progressSummaryWithRenderedDelta(
        serverBase: serverBase,
        serverBaseStreakDays: serverBaseStreakDaysForRenderedDelta,
        activeDates: serverSummaryDeltaActiveDates,
        activeReviewDays: serverActiveReviewDaysWithRenderedDelta,
        referenceLocalDate: referenceLocalDate
    )

    let renderedSeriesCandidates = [renderedSeriesLowerBound].compactMap { summary in
        summary
    }
    let dominantSummary = progressDominantProgressSummary(
        first: serverSummaryWithRenderedDelta,
        rest: [localFallback] + renderedSeriesCandidates
    )
    let mergedCurrentStreakDays = max(
        serverSummaryWithRenderedDelta.currentStreakDays,
        localFallback.currentStreakDays,
        renderedSeriesLowerBound?.currentStreakDays ?? 0
    )
    let mergedLongestStreakDays = max(
        serverSummaryWithRenderedDelta.longestStreakDays,
        localFallback.longestStreakDays,
        renderedSeriesLowerBound?.longestStreakDays ?? 0
    )

    return ProgressSummary(
        currentStreakDays: mergedCurrentStreakDays,
        longestStreakDays: mergedLongestStreakDays,
        hasReviewedToday: serverBase.hasReviewedToday
            || localFallback.hasReviewedToday
            || (renderedSeriesLowerBound?.hasReviewedToday ?? false),
        lastReviewedOn: maxProgressLocalDate(
            left: maxProgressLocalDate(
                left: serverBase.lastReviewedOn,
                right: localFallback.lastReviewedOn
            ),
            right: renderedSeriesLowerBound?.lastReviewedOn
        ),
        activeReviewDays: max(
            serverActiveReviewDaysWithRenderedDelta,
            localFallback.activeReviewDays,
            renderedSeriesLowerBound?.activeReviewDays ?? 0
        ),
        streakFreeze: dominantSummary.streakFreeze
    )
}

private func progressDominantProgressSummary(
    first: ProgressSummary,
    rest: [ProgressSummary]
) -> ProgressSummary {
    rest.reduce(first) { current, candidate in
        if candidate.currentStreakDays != current.currentStreakDays {
            return candidate.currentStreakDays > current.currentStreakDays ? candidate : current
        }

        if candidate.streakFreeze.balanceUnits != current.streakFreeze.balanceUnits {
            return candidate.streakFreeze.balanceUnits > current.streakFreeze.balanceUnits ? candidate : current
        }

        if candidate.longestStreakDays != current.longestStreakDays {
            return candidate.longestStreakDays > current.longestStreakDays ? candidate : current
        }

        return current
    }
}

private func progressServerAndSeriesShareReviewHistoryBase(
    serverBaseReviewHistoryWatermarks: [ProgressReviewHistoryWatermark],
    renderedSeriesContext: ProgressRenderedSeriesSummaryContext?
) -> Bool {
    guard let seriesBaseReviewHistoryWatermarks = renderedSeriesContext?.serverBaseReviewHistoryWatermarks else {
        return false
    }

    return seriesBaseReviewHistoryWatermarks == serverBaseReviewHistoryWatermarks
}

private func progressActiveReviewDayDeltaCandidates(
    renderedSeriesContext: ProgressRenderedSeriesSummaryContext?,
    localFallbackActiveDates: Set<String>,
    serverBase: ProgressSummary,
    serverAndSeriesShareReviewHistoryBase: Bool
) -> Set<String> {
    let renderedSeriesCandidates: Set<String>
    if let renderedSeriesContext {
        if serverAndSeriesShareReviewHistoryBase {
            renderedSeriesCandidates = renderedSeriesContext.activeDatesMissingFromServerBase
        } else {
            renderedSeriesCandidates = renderedSeriesContext.activeDates
        }
    } else {
        renderedSeriesCandidates = []
    }

    return renderedSeriesCandidates.union(
        progressLocalFallbackActiveReviewDayDeltaCandidates(
            localFallbackActiveDates: localFallbackActiveDates,
            serverBase: serverBase
        )
    )
}

private func progressLocalFallbackActiveReviewDayDeltaCandidates(
    localFallbackActiveDates: Set<String>,
    serverBase: ProgressSummary
) -> Set<String> {
    guard let lastReviewedOn = serverBase.lastReviewedOn else {
        return localFallbackActiveDates
    }

    return Set(localFallbackActiveDates.filter { localDate in
        localDate > lastReviewedOn
    })
}

private func progressActiveReviewDayDelta(
    activeReviewDayDeltaCandidates: Set<String>,
    serverBase: ProgressSummary,
    serverAndSeriesShareReviewHistoryBase: Bool,
    referenceLocalDate: String
) -> Int {
    activeReviewDayDeltaCandidates.filter { localDate in
        progressShouldApplyActiveReviewDayDelta(
            localDate: localDate,
            serverBase: serverBase,
            serverAndSeriesShareReviewHistoryBase: serverAndSeriesShareReviewHistoryBase,
            referenceLocalDate: referenceLocalDate
        )
    }.count
}

private func progressShouldApplyActiveReviewDayDelta(
    localDate: String,
    serverBase: ProgressSummary,
    serverAndSeriesShareReviewHistoryBase: Bool,
    referenceLocalDate: String
) -> Bool {
    if localDate == referenceLocalDate,
       serverBase.hasReviewedToday {
        return false
    }

    if serverAndSeriesShareReviewHistoryBase {
        return true
    }

    guard let lastReviewedOn = serverBase.lastReviewedOn else {
        return true
    }

    return localDate > lastReviewedOn
}

private func progressSummaryWithRenderedDelta(
    serverBase: ProgressSummary,
    serverBaseStreakDays: [ProgressStreakDay],
    activeDates: Set<String>,
    activeReviewDays: Int,
    referenceLocalDate: String
) throws -> ProgressSummary {
    let streakFreezeEvaluation = try evaluateProgressStreakFreeze(
        baseSummary: serverBase,
        baseStreakDays: serverBaseStreakDays,
        activeReviewLocalDates: activeDates,
        today: referenceLocalDate,
        policy: progressStreakFreezePolicy
    )

    return ProgressSummary(
        currentStreakDays: streakFreezeEvaluation.currentStreakDays,
        longestStreakDays: streakFreezeEvaluation.longestStreakDays,
        hasReviewedToday: serverBase.hasReviewedToday || activeDates.contains(referenceLocalDate),
        lastReviewedOn: maxProgressLocalDate(
            left: serverBase.lastReviewedOn,
            right: activeDates.max()
        ),
        activeReviewDays: activeReviewDays,
        streakFreeze: streakFreezeEvaluation.streakFreeze
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

private func validateProgressSeriesPairInputs(
    serverBase: UserProgressSeries,
    renderedSeries: UserProgressSeries
) throws {
    guard
        serverBase.timeZone == renderedSeries.timeZone,
        serverBase.from == renderedSeries.from,
        serverBase.to == renderedSeries.to
    else {
        throw LocalStoreError.validation(
            """
            Progress series comparison inputs must share the same time range. \
            serverBase=\(serverBase.timeZone) \(serverBase.from)...\(serverBase.to), \
            renderedSeries=\(renderedSeries.timeZone) \(renderedSeries.from)...\(renderedSeries.to).
            """
        )
    }
}

private func progressCountsByLocalDate(
    series: UserProgressSeries,
    sourceName: String
) throws -> [String: Int] {
    var countsByLocalDate: [String: Int] = [:]
    for progressDay in series.dailyReviews {
        guard progressDay.reviewCount >= 0 else {
            throw LocalStoreError.validation(
                """
                Progress merge \(sourceName) contained a negative review count. \
                localDate=\(progressDay.date), reviewCount=\(progressDay.reviewCount).
                """
            )
        }

        guard countsByLocalDate.updateValue(progressDay.reviewCount, forKey: progressDay.date) == nil else {
            throw LocalStoreError.validation(
                "Progress merge \(sourceName) contained a duplicate local date. localDate=\(progressDay.date)."
            )
        }
    }

    return countsByLocalDate
}

private func validateProgressCountsInRange(
    countsByLocalDate: [String: Int],
    rangeLocalDates: Set<String>,
    sourceName: String,
    rangeDescription: String
) throws {
    for localDate in countsByLocalDate.keys where rangeLocalDates.contains(localDate) == false {
        throw LocalStoreError.validation(
            """
            Progress merge \(sourceName) contained a local date outside the merge range. \
            localDate=\(localDate), range=\(rangeDescription).
            """
        )
    }
}

func makeProgressRenderedSeriesSummaryContext(
    serverBase: PersistedProgressSeriesServerBase?,
    scopeKey: ProgressScopeKey,
    series: UserProgressSeries
) throws -> ProgressRenderedSeriesSummaryContext {
    let activeDates = try progressActiveDatesFromSeries(series: series)
    let activeDatesMissingFromServerBase: Set<String>
    let serverBaseStreakDays: [ProgressStreakDay]
    let serverBaseReviewHistoryWatermarks: [ProgressReviewHistoryWatermark]?
    if let serverBaseSeries = serverBase?.serverBase,
       serverBase?.scopeKey == scopeKey {
        activeDatesMissingFromServerBase = try progressActiveDatesMissingFromServerBase(
            serverBase: serverBaseSeries,
            renderedSeries: series
        )
        serverBaseStreakDays = serverBaseSeries.streakDays
        serverBaseReviewHistoryWatermarks = serverBaseSeries.reviewHistoryWatermarks
    } else {
        activeDatesMissingFromServerBase = []
        serverBaseStreakDays = []
        serverBaseReviewHistoryWatermarks = nil
    }

    return ProgressRenderedSeriesSummaryContext(
        lowerBoundSummary: try makeProgressSummaryLowerBoundFromSeries(series: series, activeDates: activeDates),
        activeDates: activeDates,
        activeDatesMissingFromServerBase: activeDatesMissingFromServerBase,
        serverBaseStreakDays: serverBaseStreakDays,
        serverBaseReviewHistoryWatermarks: serverBaseReviewHistoryWatermarks
    )
}

private func makeProgressSummaryLowerBoundFromSeries(
    series: UserProgressSeries,
    activeDates: Set<String>
) throws -> ProgressSummary {
    try makeProgressSummary(
        reviewDates: activeDates,
        timeZone: series.timeZone,
        generatedAt: progressReferenceDate(
            localDate: series.to,
            timeZoneIdentifier: series.timeZone
        )
    )
}

private func progressActiveDatesFromSeries(series: UserProgressSeries) throws -> Set<String> {
    let countsByLocalDate = try progressCountsByLocalDate(series: series, sourceName: "renderedSeries")
    return Set(countsByLocalDate.compactMap { localDate, reviewCount in
        reviewCount > 0 ? localDate : nil
    })
}

private func progressActiveDatesMissingFromServerBase(
    serverBase: UserProgressSeries,
    renderedSeries: UserProgressSeries
) throws -> Set<String> {
    try validateProgressSeriesPairInputs(
        serverBase: serverBase,
        renderedSeries: renderedSeries
    )

    let serverCounts = try progressCountsByLocalDate(series: serverBase, sourceName: "serverBase")
    let renderedCounts = try progressCountsByLocalDate(series: renderedSeries, sourceName: "renderedSeries")
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
        countsByLocalDate: serverCounts,
        rangeLocalDates: rangeLocalDates,
        sourceName: "serverBase",
        rangeDescription: rangeDescription
    )
    try validateProgressCountsInRange(
        countsByLocalDate: renderedCounts,
        rangeLocalDates: rangeLocalDates,
        sourceName: "renderedSeries",
        rangeDescription: rangeDescription
    )

    return Set(zeroFilledDays.compactMap { progressDay in
        let serverCount = serverCounts[progressDay.date] ?? 0
        let renderedCount = renderedCounts[progressDay.date] ?? 0
        return renderedCount > 0 && serverCount == 0 ? progressDay.date : nil
    })
}

func makeProgressSeriesFromReviewedAtClients(
    reviewedAtClients: [String],
    requestRange: ProgressRequestRange
) throws -> UserProgressSeries {
    let timeZone = try progressTimeZone(identifier: requestRange.timeZone)
    let calendar = makeProgressStoreCalendar(timeZone: timeZone)
    var reviewCountsByLocalDate: [String: Int] = [:]
    var activeReviewLocalDates: Set<String> = []

    for reviewedAtClient in reviewedAtClients {
        guard let reviewedAtDate = parseIsoTimestamp(value: reviewedAtClient) else {
            throw LocalStoreError.validation("Progress reviewedAtClient timestamp is invalid: \(reviewedAtClient)")
        }

        let localDate = progressLocalDateStringForStore(date: reviewedAtDate, calendar: calendar)
        activeReviewLocalDates.insert(localDate)
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

func progressActiveDatesFromReviewedAtClients(
    reviewedAtClients: [String],
    timeZone: String
) throws -> Set<String> {
    let resolvedTimeZone = try progressTimeZone(identifier: timeZone)
    let calendar = makeProgressStoreCalendar(timeZone: resolvedTimeZone)
    return try Set(reviewedAtClients.map { reviewedAtClient in
        guard let reviewedAtDate = parseIsoTimestamp(value: reviewedAtClient) else {
            throw LocalStoreError.validation("Progress reviewedAtClient timestamp is invalid: \(reviewedAtClient)")
        }

        return progressLocalDateStringForStore(date: reviewedAtDate, calendar: calendar)
    })
}

func makeProgressSummaryFromReviewedAtClients(
    reviewedAtClients: [String],
    timeZone: String,
    referenceLocalDate: String
) throws -> ProgressSummary {
    return try makeProgressSummary(
        reviewDates: progressActiveDatesFromReviewedAtClients(
            reviewedAtClients: reviewedAtClients,
            timeZone: timeZone
        ),
        timeZone: timeZone,
        generatedAt: progressReferenceDate(
            localDate: referenceLocalDate,
            timeZoneIdentifier: timeZone
        )
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

    let serverCounts = try progressCountsByLocalDate(series: serverBase, sourceName: "serverBase")
    let pendingCounts = try progressCountsByLocalDate(series: pendingLocalOverlay, sourceName: "pendingLocalOverlay")
    let localFallbackCounts = try progressCountsByLocalDate(series: localFallback, sourceName: "localFallback")
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
        countsByLocalDate: serverCounts,
        rangeLocalDates: rangeLocalDates,
        sourceName: "serverBase",
        rangeDescription: rangeDescription
    )
    try validateProgressCountsInRange(
        countsByLocalDate: pendingCounts,
        rangeLocalDates: rangeLocalDates,
        sourceName: "pendingLocalOverlay",
        rangeDescription: rangeDescription
    )
    try validateProgressCountsInRange(
        countsByLocalDate: localFallbackCounts,
        rangeLocalDates: rangeLocalDates,
        sourceName: "localFallback",
        rangeDescription: rangeDescription
    )
    let mergedDailyReviews: [ProgressDay] = zeroFilledDays.map { progressDay in
        let serverOverlayCount = (serverCounts[progressDay.date] ?? 0) + (pendingCounts[progressDay.date] ?? 0)
        let localFallbackCount = localFallbackCounts[progressDay.date] ?? 0
        return ProgressDay(
            date: progressDay.date,
            reviewCount: max(serverOverlayCount, localFallbackCount)
        )
    }
    let rangeActiveReviewDates: Set<String> = Set(
        mergedDailyReviews.compactMap { progressDay in
            progressDay.reviewCount > 0 ? progressDay.date : nil
        }
    )
    let activeReviewDates = mergedActiveReviewDates.union(rangeActiveReviewDates)
    let streakDays = try makeMergedProgressSeriesStreakDays(
        serverBase: serverBase,
        zeroFilledDays: zeroFilledDays,
        mergedDailyReviews: mergedDailyReviews,
        activeReviewDates: activeReviewDates,
        rangeActiveReviewDates: rangeActiveReviewDates
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
    zeroFilledDays: [ProgressDay],
    mergedDailyReviews: [ProgressDay],
    activeReviewDates: Set<String>,
    rangeActiveReviewDates: Set<String>
) throws -> [ProgressStreakDay] {
    let serverCounts = try progressCountsByLocalDate(series: serverBase, sourceName: "serverBase")
    let mergedCounts = Dictionary(uniqueKeysWithValues: mergedDailyReviews.map { progressDay in
        (progressDay.date, progressDay.reviewCount)
    })
    let firstChangedLocalDate = zeroFilledDays.compactMap { progressDay in
        ((serverCounts[progressDay.date] ?? 0) > 0) == ((mergedCounts[progressDay.date] ?? 0) > 0)
            ? nil
            : progressDay.date
    }.min()

    guard let recomputeFromLocalDate = firstChangedLocalDate ?? zeroFilledDays.first?.date else {
        return serverBase.streakDays
    }

    if firstChangedLocalDate == nil,
       activeReviewDates.isSubset(of: rangeActiveReviewDates) {
        return serverBase.streakDays
    }

    let evaluatedStreakDays: [ProgressStreakDay]
    if let firstChangedLocalDate {
        evaluatedStreakDays = try evaluateProgressStreakDaysFromServerBasePrefix(
            serverBaseStreakDays: serverBase.streakDays,
            activeReviewLocalDates: activeReviewDates,
            today: serverBase.to,
            recomputeFromLocalDate: firstChangedLocalDate,
            policy: progressStreakFreezePolicy
        )
    } else {
        let streakFreezeEvaluation = try evaluateProgressStreakFreeze(
            sortedActiveReviewLocalDates: activeReviewDates.sorted(),
            today: serverBase.to,
            policy: progressStreakFreezePolicy
        )
        evaluatedStreakDays = streakFreezeEvaluation.streakDays
    }
    let recomputedStreakDays = makeProgressStreakDays(
        range: zeroFilledDays.map(\.date),
        activeReviewDates: activeReviewDates,
        evaluatedStreakDays: evaluatedStreakDays,
        today: serverBase.to
    )
    let serverStatesByDate = Dictionary(uniqueKeysWithValues: serverBase.streakDays.map { streakDay in
        (streakDay.date, streakDay.state)
    })

    return recomputedStreakDays.map { streakDay in
        guard streakDay.date < recomputeFromLocalDate,
              let serverState = serverStatesByDate[streakDay.date] else {
            return streakDay
        }

        return ProgressStreakDay(date: streakDay.date, state: serverState)
    }
}

func patchProgressSnapshot(
    snapshot: ProgressSnapshot,
    scopeKey: ProgressScopeKey,
    reviewedAtClient: String
) throws -> ProgressSnapshot {
    guard snapshot.scopeKey == scopeKey else {
        throw LocalStoreError.validation(
            """
            Progress snapshot patch scope mismatched. \
            expected=\(scopeKey.storageKey), actual=\(snapshot.scopeKey.storageKey).
            """
        )
    }

    let timeZone = try progressTimeZone(identifier: scopeKey.timeZone)
    let calendar = makeProgressStoreCalendar(timeZone: timeZone)
    let reviewedAtDate = try reviewedAtDateForProgressMutation(reviewedAtClient: reviewedAtClient)
    let reviewedLocalDate = progressLocalDateStringForStore(date: reviewedAtDate, calendar: calendar)
    let previousRangeActiveDates: Set<String> = Set(
        snapshot.chartData.chartDays.compactMap { chartDay in
            chartDay.reviewCount > 0 ? chartDay.localDate : nil
        }
    )

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

    let nextRangeActiveDates: Set<String> = Set(
        dailyReviews.compactMap { progressDay in
            progressDay.reviewCount > 0 ? progressDay.date : nil
        }
    )
    let streakFreezeEvaluation = try evaluateProgressStreakFreeze(
        baseSummary: snapshot.summary,
        baseStreakDays: snapshot.chartData.chartDays.map { chartDay in
            ProgressStreakDay(date: chartDay.localDate, state: chartDay.streakState)
        },
        activeReviewLocalDates: nextRangeActiveDates,
        today: scopeKey.to,
        policy: progressStreakFreezePolicy
    )
    let localLowerBoundSummary = try makeProgressSummary(
        reviewDates: nextRangeActiveDates,
        timeZone: scopeKey.timeZone,
        generatedAt: progressReferenceDate(
            localDate: scopeKey.to,
            timeZoneIdentifier: scopeKey.timeZone
        )
    )
    let projectedSummary = ProgressSummary(
        currentStreakDays: streakFreezeEvaluation.currentStreakDays,
        longestStreakDays: streakFreezeEvaluation.longestStreakDays,
        hasReviewedToday: snapshot.summary.hasReviewedToday || nextRangeActiveDates.contains(scopeKey.to),
        lastReviewedOn: maxProgressLocalDate(
            left: snapshot.summary.lastReviewedOn,
            right: nextRangeActiveDates.max()
        ),
        activeReviewDays: snapshot.summary.activeReviewDays,
        streakFreeze: streakFreezeEvaluation.streakFreeze
    )
    let dominantSummary = progressDominantProgressSummary(
        first: projectedSummary,
        rest: [localLowerBoundSummary]
    )
    let didAddActiveReviewDay = previousRangeActiveDates.contains(reviewedLocalDate) == false
        && nextRangeActiveDates.contains(reviewedLocalDate)
    let patchedSummary = ProgressSummary(
        currentStreakDays: dominantSummary.currentStreakDays,
        longestStreakDays: max(projectedSummary.longestStreakDays, localLowerBoundSummary.longestStreakDays),
        hasReviewedToday: projectedSummary.hasReviewedToday || localLowerBoundSummary.hasReviewedToday,
        lastReviewedOn: maxProgressLocalDate(
            left: projectedSummary.lastReviewedOn,
            right: localLowerBoundSummary.lastReviewedOn
        ),
        activeReviewDays: snapshot.summary.activeReviewDays + (didAddActiveReviewDay ? 1 : 0),
        streakFreeze: dominantSummary.streakFreeze
    )
    let patchedSeries = makeProgressSeries(
        timeZone: scopeKey.timeZone,
        from: scopeKey.from,
        to: scopeKey.to,
        dailyReviews: dailyReviews,
        streakDays: makePatchedSnapshotProgressStreakDays(
            snapshot: snapshot,
            dailyReviews: dailyReviews,
            evaluatedStreakDays: streakFreezeEvaluation.streakDays,
            today: scopeKey.to
        ),
        summary: nil,
        generatedAt: snapshot.generatedAt,
        reviewHistoryWatermarks: []
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

private func makePatchedSnapshotProgressStreakDays(
    snapshot: ProgressSnapshot,
    dailyReviews: [ProgressDay],
    evaluatedStreakDays: [ProgressStreakDay],
    today: String
) -> [ProgressStreakDay] {
    let existingStatesByLocalDate = Dictionary(uniqueKeysWithValues: snapshot.chartData.chartDays.map { chartDay in
        (chartDay.localDate, chartDay.streakState)
    })
    let evaluatedStatesByLocalDate = Dictionary(uniqueKeysWithValues: evaluatedStreakDays.map { streakDay in
        (streakDay.date, streakDay.state)
    })

    return dailyReviews.map { progressDay in
        let state: ProgressStreakDayState
        if progressDay.reviewCount > 0 {
            state = .reviewed
        } else if let evaluatedState = evaluatedStatesByLocalDate[progressDay.date] {
            state = evaluatedState
        } else if let existingState = existingStatesByLocalDate[progressDay.date] {
            state = existingState
        } else if progressDay.date >= today {
            state = .pending
        } else {
            state = .missed
        }

        return ProgressStreakDay(date: progressDay.date, state: state)
    }
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
