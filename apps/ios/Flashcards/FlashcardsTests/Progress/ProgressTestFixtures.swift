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
                reviewCount: reviewCountsByDate[localDate] ?? 0
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

    return makeProgressSeries(
        timeZone: requestRange.timeZone,
        from: requestRange.from,
        to: requestRange.to,
        dailyReviews: dailyReviews,
        summary: summary,
        generatedAt: generatedAt
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
        generatedAt: generatedAt
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
        totalCards: buckets.reduce(0) { partialResult, bucket in
            partialResult + bucket.count
        },
        buckets: buckets
    )
}

func makeEmptyReviewScheduleForTests(timeZone: String) -> UserReviewSchedule {
    makeTestReviewSchedule(
        timeZone: timeZone,
        countsByBucketKey: [:],
        generatedAt: "2026-04-25T00:00:00.000Z"
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
        hasReviewedToday: false,
        lastReviewedOn: nil,
        activeReviewDays: 0
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
