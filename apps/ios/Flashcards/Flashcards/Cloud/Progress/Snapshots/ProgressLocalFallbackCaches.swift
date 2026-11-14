import Foundation

struct ProgressRenderedSummaryAndSeriesCacheKey: Equatable, Sendable {
    let scopeKey: ProgressScopeKey
    let reviewedAtClientKey: ProgressReviewedAtClientCacheKey
    let summaryServerBase: PersistedProgressSummaryServerBase?
    let seriesServerBase: PersistedProgressSeriesServerBase?
}

struct ProgressRenderedPresentationCache: Sendable {
    let storeCalendar: Calendar
    let snapshot: ProgressSnapshot
}

struct ProgressRenderedSummaryAndSeriesCacheEntry: Sendable {
    let key: ProgressRenderedSummaryAndSeriesCacheKey
    let renderedSummary: ProgressRenderedSummary
    let renderedSeries: ProgressRenderedSeries
    var presentation: ProgressRenderedPresentationCache? = nil
}

struct ProgressReviewedAtClientCacheKey: Hashable, Sendable {
    let workspaceMembershipKey: String
    let installationId: String?
    let revision: Int
}

struct ProgressReviewedAtClientCacheEntry: Sendable {
    let key: ProgressReviewedAtClientCacheKey
    let sources: ProgressReviewedAtClientSources
}

struct ProgressReviewScheduleLocalCacheKey: Hashable, Sendable {
    let workspaceMembershipKey: String
    let timeZone: String
    let referenceLocalDate: String
    let installationId: String?
    let revision: Int
}

struct ProgressReviewScheduleLocalCacheEntry: Sendable {
    let key: ProgressReviewScheduleLocalCacheKey
    let reviewSchedule: UserReviewSchedule
    let pendingOverlayState: ProgressPendingLocalOverlayState
    let pendingCardTotalDelta: Int
    let localCoverage: ReviewScheduleLocalCoverage
}

struct ProgressReviewScheduleRenderedServerBase: Sendable {
    let renderedSchedule: UserReviewSchedule
    let sourceState: ProgressSourceState
}
