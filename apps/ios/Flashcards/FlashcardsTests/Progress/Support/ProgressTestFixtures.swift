import Foundation
import XCTest
@testable import Flashcards

func makeReviewCardForReconcileTest(cardId: String, updatedAt: String) -> Card {
    FsrsSchedulerTestSupport.makeTestCard(
        cardId: cardId,
        tags: [],
        effortLevel: .fast,
        dueAt: "2026-04-18T07:00:00.000Z",
        updatedAt: updatedAt
    )
}

func makeTestProgressRequestRange(
    now: Date,
    timeZone: TimeZone,
    dayCount: Int
) throws -> ProgressSeriesLoadRequest {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timeZone
    let formatter = DateFormatter()
    formatter.calendar = calendar
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = timeZone
    formatter.dateFormat = "yyyy-MM-dd"

    let endDate = calendar.startOfDay(for: now)
    guard let startDate = calendar.date(byAdding: .day, value: -(dayCount - 1), to: endDate) else {
        throw LocalStoreError.validation("Test progress range could not be calculated")
    }

    return ProgressSeriesLoadRequest(
        apiBaseUrl: "",
        authorizationHeader: "",
        timeZone: timeZone.identifier,
        from: formatter.string(from: startDate),
        to: formatter.string(from: endDate)
    )
}

func makeReviewedAtClientForTests(
    localDate: String,
    hour: Int,
    timeZoneIdentifier: String
) throws -> String {
    guard let timeZone = TimeZone(identifier: timeZoneIdentifier) else {
        throw LocalStoreError.validation("Test reviewed-at-client timezone is invalid: \(timeZoneIdentifier)")
    }
    guard (0..<24).contains(hour) else {
        throw LocalStoreError.validation("Test reviewed-at-client hour is invalid: \(hour)")
    }

    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timeZone
    guard
        let startOfDay = progressDateForTests(localDate: localDate, calendar: calendar),
        let reviewedAt = calendar.date(byAdding: .hour, value: hour, to: startOfDay)
    else {
        throw LocalStoreError.validation("Test reviewed-at-client local date is invalid: \(localDate)")
    }

    return formatIsoTimestamp(date: reviewedAt)
}

func makeTestProgressSeries(
    requestRange: ProgressSeriesLoadRequest,
    reviewCountsByDate: [String: Int],
    generatedAt: String
) throws -> UserProgressSeries {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: requestRange.timeZone)!

    let startDate = try XCTUnwrap(progressDateForTests(localDate: requestRange.from, calendar: calendar))
    let endDate = try XCTUnwrap(progressDateForTests(localDate: requestRange.to, calendar: calendar))
    var dailyReviews: [ProgressDay] = []
    var currentDate = startDate
    while currentDate <= endDate {
        let localDate = progressLocalDateStringForTests(date: currentDate, calendar: calendar)
        dailyReviews.append(
            ProgressDay(
                date: localDate,
                reviewCount: reviewCountsByDate[localDate] ?? 0,
                againCount: 0,
                hardCount: 0,
                goodCount: reviewCountsByDate[localDate] ?? 0,
                easyCount: 0
            )
        )
        currentDate = calendar.date(byAdding: .day, value: 1, to: currentDate)!
    }
    let generatedAtDate = try XCTUnwrap(parseIsoTimestamp(value: generatedAt))
    let summary = try makeProgressSummary(
        reviewDates: Set(
            dailyReviews.compactMap { progressDay in
                progressDay.reviewCount > 0 ? progressDay.date : nil
            }
        ),
        timeZone: requestRange.timeZone,
        generatedAt: generatedAtDate
    )
    let activeReviewDates = Set(
        dailyReviews.compactMap { progressDay in
            progressDay.reviewCount > 0 ? progressDay.date : nil
        }
    )
    let streakFreezeEvaluation = try evaluateProgressStreakFreeze(
        sortedActiveReviewLocalDates: activeReviewDates.sorted(),
        today: requestRange.to,
        policy: progressStreakFreezePolicy
    )

    return makeProgressSeries(
        timeZone: requestRange.timeZone,
        from: requestRange.from,
        to: requestRange.to,
        dailyReviews: dailyReviews,
        streakDays: makeProgressStreakDays(
            range: dailyReviews.map(\.date),
            activeReviewDates: activeReviewDates,
            evaluatedStreakDays: streakFreezeEvaluation.streakDays,
            today: requestRange.to
        ),
        summary: summary,
        generatedAt: generatedAt,
        reviewHistoryWatermarks: makeTestProgressReviewHistoryWatermarks(reviewSequenceId: 42)
    )
}

func makeTestProgressSummary(
    timeZone: String,
    reviewDates: Set<String>,
    generatedAt: String
) throws -> UserProgressSummary {
    let generatedAtDate = try XCTUnwrap(parseIsoTimestamp(value: generatedAt))
    return UserProgressSummary(
        timeZone: timeZone,
        summary: try makeProgressSummary(
            reviewDates: reviewDates,
            timeZone: timeZone,
            generatedAt: generatedAtDate
        ),
        generatedAt: generatedAt,
        reviewHistoryWatermarks: makeTestProgressReviewHistoryWatermarks(reviewSequenceId: 42)
    )
}

func makeTestReviewSchedule(
    timeZone: String,
    countsByBucketKey: [ReviewScheduleBucketKey: Int],
    generatedAt: String
) -> UserReviewSchedule {
    let buckets = ReviewScheduleBucketKey.stableOrder.map { bucketKey in
        ReviewScheduleBucket(
            key: bucketKey,
            count: countsByBucketKey[bucketKey] ?? 0
        )
    }
    return makeReviewSchedule(
        timeZone: timeZone,
        generatedAt: generatedAt,
        reviewHistoryWatermarks: makeTestProgressReviewHistoryWatermarks(reviewSequenceId: 42),
        totalCards: buckets.reduce(0) { partialResult, bucket in
            partialResult + bucket.count
        },
        buckets: buckets
    )
}

func makeTestProgressReviewHistoryWatermarks(reviewSequenceId: Int64) -> [ProgressReviewHistoryWatermark] {
    [
        ProgressReviewHistoryWatermark(
            workspaceId: "workspace-1",
            reviewSequenceId: reviewSequenceId
        ),
    ]
}

func makeTestProgressStreakFreeze(
    availableCredits: Int,
    balanceUnits: Int
) -> ProgressStreakFreeze {
    let nextCreditProgressUnits: Int
    if availableCredits >= progressStreakFreezePolicy.maxCapacity {
        nextCreditProgressUnits = 0
    } else {
        nextCreditProgressUnits = balanceUnits % progressStreakFreezePolicy.unitsPerCredit
    }

    ProgressStreakFreeze(
        availableCredits: availableCredits,
        capacity: progressStreakFreezePolicy.maxCapacity,
        balanceUnits: balanceUnits,
        unitsPerCredit: progressStreakFreezePolicy.unitsPerCredit,
        nextCreditProgressUnits: nextCreditProgressUnits,
        nextCreditRequiredUnits: progressStreakFreezePolicy.unitsPerCredit
    )
}

func makeTestProgressSummaryValue(
    currentStreakDays: Int,
    hasReviewedToday: Bool,
    lastReviewedOn: String?,
    activeReviewDays: Int
) -> ProgressSummary {
    ProgressSummary(
        currentStreakDays: currentStreakDays,
        longestStreakDays: currentStreakDays,
        hasReviewedToday: hasReviewedToday,
        lastReviewedOn: lastReviewedOn,
        activeReviewDays: activeReviewDays,
        streakFreeze: makeTestProgressStreakFreeze(availableCredits: 2, balanceUnits: 20)
    )
}

func makeEmptyReviewScheduleForTests(timeZone: String) -> UserReviewSchedule {
    makeTestReviewSchedule(
        timeZone: timeZone,
        countsByBucketKey: [:],
        generatedAt: "2026-04-25T00:00:00.000Z"
    )
}

func makeTestProgressLeaderboardMetric() -> ProgressLeaderboardMetric {
    ProgressLeaderboardMetric(
        metricVersion: "qualified_reviews_v1",
        title: "Qualified reviews",
        description: "Hard, Good, and Easy reviews count toward your rank. Again does not."
    )
}

func makeNonReadyProgressLeaderboardForTests(
    status: ProgressLeaderboardStatus
) -> UserProgressLeaderboard {
    UserProgressLeaderboard(
        status: status,
        metric: makeTestProgressLeaderboardMetric(),
        defaultWindowKey: .last24Hours,
        windows: []
    )
}

/// Builds a ready leaderboard where every window carries the same viewer and rows.
func makeReadyProgressLeaderboardForTests(
    defaultWindowKey: LeaderboardWindowKey,
    participantCount: Int,
    viewer: ProgressLeaderboardViewer,
    rows: [ProgressLeaderboardRow],
    rankingRows: [ProgressLeaderboardRankingRow]
) -> UserProgressLeaderboard {
    let windows = LeaderboardWindowKey.stableOrder.map { windowKey in
        ProgressLeaderboardWindow(
            windowKey: windowKey,
            snapshotId: "0cc86d10-18cb-4d64-a2f2-a5fd960b45b2",
            snapshotGeneratedAt: "2026-06-10T14:00:05.000Z",
            asOfServerHour: "2026-06-10T14:00:00.000Z",
            nextRefreshAfter: "2026-06-10T15:00:00.000Z",
            participantCount: participantCount,
            viewer: viewer,
            rows: rows,
            rankingRows: rankingRows
        )
    }

    return UserProgressLeaderboard(
        status: .ready,
        metric: makeTestProgressLeaderboardMetric(),
        defaultWindowKey: defaultWindowKey,
        windows: windows
    )
}

func makeProgressLeaderboardScopeKeyForTests() -> ProgressLeaderboardScopeKey {
    ProgressLeaderboardScopeKey(
        cloudState: .linked,
        linkedUserId: "linked-user-1",
        localeIdentifier: "en"
    )
}

func makeProgressLeaderboardParticipantRowForTests(
    kind: ProgressLeaderboardParticipantKind,
    publicProfileId: String,
    anonymousDisplayName: String,
    qualifiedReviewCount: Int,
    rank: Int
) -> ProgressLeaderboardRow {
    .participant(
        ProgressLeaderboardParticipantRow(
            kind: kind,
            publicProfileId: publicProfileId,
            anonymousDisplayName: anonymousDisplayName,
            friendDisplayName: nil,
            qualifiedReviewCount: qualifiedReviewCount,
            rank: rank
        )
    )
}

func makeProgressLeaderboardRankingRowForTests(
    kind: ProgressLeaderboardRankingRowKind,
    publicProfileId: String,
    anonymousDisplayName: String,
    qualifiedReviewCount: Int,
    rank: Int
) -> ProgressLeaderboardRankingRow {
    ProgressLeaderboardRankingRow(
        kind: kind,
        publicProfileId: publicProfileId,
        anonymousDisplayName: anonymousDisplayName,
        friendDisplayName: nil,
        qualifiedReviewCount: qualifiedReviewCount,
        rank: rank
    )
}

func makeProgressScopeKeyForTests(
    timeZone: String,
    from: String,
    to: String
) -> ProgressScopeKey {
    ProgressScopeKey(
        cloudState: nil,
        linkedUserId: nil,
        workspaceMembershipKey: "test-workspace",
        timeZone: timeZone,
        from: from,
        to: to
    )
}

func makeEmptyProgressSummaryForTests() -> ProgressSummary {
    ProgressSummary(
        currentStreakDays: 0,
        longestStreakDays: 0,
        hasReviewedToday: false,
        lastReviewedOn: nil,
        activeReviewDays: 0,
        streakFreeze: makeTestProgressStreakFreeze(availableCredits: 2, balanceUnits: 20)
    )
}

func progressDateForTests(localDate: String, calendar: Calendar) -> Date? {
    let parts = localDate.split(separator: "-", omittingEmptySubsequences: false)
    guard
        parts.count == 3,
        let year = Int(parts[0]),
        let month = Int(parts[1]),
        let day = Int(parts[2])
    else {
        return nil
    }

    return calendar.date(from: DateComponents(year: year, month: month, day: day))
}

func progressLocalDateStringForTests(date: Date, calendar: Calendar) -> String {
    let components = calendar.dateComponents([.year, .month, .day], from: date)
    return String(
        format: "%04d-%02d-%02d",
        components.year ?? 0,
        components.month ?? 0,
        components.day ?? 0
    )
}

func progressReviewCount(
    snapshot: ProgressSnapshot,
    localDate: String
) -> Int {
    snapshot.chartData.chartDays.first { chartDay in
        chartDay.localDate == localDate
    }?.reviewCount ?? 0
}

func reviewScheduleCount(
    snapshot: ReviewScheduleSnapshot,
    key: ReviewScheduleBucketKey
) -> Int {
    snapshot.schedule.buckets.first { bucket in
        bucket.key == key
    }?.count ?? 0
}
