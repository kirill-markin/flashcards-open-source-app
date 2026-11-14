import Foundation

/// The shared, immutable-input renderer for snapshots, badges and sync refreshes.
func renderProgressSummaryAndSeries(
    scopeKey: ProgressScopeKey,
    reviewedAtClientSources: ProgressReviewedAtClientSources,
    summaryServerBase: PersistedProgressSummaryServerBase?,
    seriesServerBase: PersistedProgressSeriesServerBase?
) throws -> (renderedSummary: ProgressRenderedSummary, renderedSeries: ProgressRenderedSeries) {
    let summaryScopeKey = progressSummaryScopeKey(seriesScopeKey: scopeKey)
    let localFallbackActiveDates = try progressActiveDatesFromReviewEvents(
        reviewEvents: reviewedAtClientSources.canonicalReviewEvents,
        timeZone: summaryScopeKey.timeZone
    )
    let pendingLocalOverlayActiveDates = try progressActiveDatesFromReviewEvents(
        reviewEvents: reviewedAtClientSources.pendingReviewEvents,
        timeZone: summaryScopeKey.timeZone
    )
    let mergedActiveReviewDates = localFallbackActiveDates.union(pendingLocalOverlayActiveDates)
    let localFallbackSummary = try makeProgressSummary(
        reviewDates: localFallbackActiveDates,
        timeZone: summaryScopeKey.timeZone,
        generatedAt: progressReferenceDate(
            localDate: scopeKey.to,
            timeZoneIdentifier: summaryScopeKey.timeZone
        )
    )
    let localFallbackSeries = try makeProgressSeriesFromReviewEvents(
        reviewEvents: reviewedAtClientSources.canonicalReviewEvents,
        requestRange: progressRequestRange(scopeKey: scopeKey)
    )
    let pendingLocalOverlaySeries = try makeProgressSeriesFromReviewEvents(
        reviewEvents: reviewedAtClientSources.pendingReviewEvents,
        requestRange: progressRequestRange(scopeKey: scopeKey)
    )
    let renderedSeries = try makeProgressRenderedSeries(
        serverBase: seriesServerBase,
        scopeKey: scopeKey,
        localFallbackSeries: localFallbackSeries,
        pendingLocalOverlaySeries: pendingLocalOverlaySeries,
        mergedActiveReviewDates: mergedActiveReviewDates
    )
    let renderedSummary = try makeProgressRenderedSummary(
        serverBase: summaryServerBase,
        scopeKey: summaryScopeKey,
        localFallbackSummary: localFallbackSummary,
        localFallbackActiveDates: mergedActiveReviewDates,
        pendingLocalOverlayState: reviewedAtClientSources.pendingLocalOverlayState
    )
    return (renderedSummary: renderedSummary, renderedSeries: renderedSeries)
}
