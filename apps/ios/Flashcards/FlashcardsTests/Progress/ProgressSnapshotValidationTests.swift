import Foundation
import XCTest
@testable import Flashcards

final class ProgressSnapshotValidationTests: XCTestCase {
    func testProgressSnapshotRejectsInvalidDailyReviewDates() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try XCTUnwrap(TimeZone(identifier: "UTC"))
        let scopeKey = makeProgressScopeKeyForTests(
            timeZone: "UTC",
            from: "2026-02-01",
            to: "2026-03-05"
        )
        let invalidLocalDates: [String] = [
            "2026-2-03",
            "2026-02-3",
            "2026-+2-03",
            "2026--03",
            "2026-02-03T00:00:00Z",
            "2026-0a-03",
            "2026-02-31",
            "2026-13-01",
            " 2026-02-03",
            "2026-02-03 ",
            "2026-02-",
        ]

        for localDate in invalidLocalDates {
            let series = makeProgressSeries(
                timeZone: scopeKey.timeZone,
                from: scopeKey.from,
                to: scopeKey.to,
                dailyReviews: [
                    ProgressDay(
                        date: localDate,
                        reviewCount: 1
                    )
                ],
                summary: nil,
                generatedAt: nil
            )

            XCTAssertThrowsError(
                try makeProgressSnapshot(
                    summary: makeEmptyProgressSummaryForTests(),
                    series: series,
                    scopeKey: scopeKey,
                    summarySourceState: .serverBase,
                    seriesSourceState: .serverBase,
                    calendar: calendar
                )
            ) { error in
                guard case ProgressPresentationError.invalidLocalDate(let invalidLocalDate) = error else {
                    XCTFail("Expected ProgressPresentationError.invalidLocalDate, received \(error)")
                    return
                }

                XCTAssertEqual(localDate, invalidLocalDate)
            }
        }
    }

    func testProgressSnapshotStillRejectsValidDuplicateDailyReviewDates() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try XCTUnwrap(TimeZone(identifier: "UTC"))
        let scopeKey = makeProgressScopeKeyForTests(
            timeZone: "UTC",
            from: "2026-02-01",
            to: "2026-02-03"
        )
        let series = makeProgressSeries(
            timeZone: scopeKey.timeZone,
            from: scopeKey.from,
            to: scopeKey.to,
            dailyReviews: [
                ProgressDay(date: "2026-02-03", reviewCount: 1),
                ProgressDay(date: "2026-02-03", reviewCount: 2),
            ],
            summary: nil,
            generatedAt: nil
        )

        XCTAssertThrowsError(
            try makeProgressSnapshot(
                summary: makeEmptyProgressSummaryForTests(),
                series: series,
                scopeKey: scopeKey,
                summarySourceState: .serverBase,
                seriesSourceState: .serverBase,
                calendar: calendar
            )
        ) { error in
            guard case ProgressPresentationError.duplicateDay(let localDate) = error else {
                XCTFail("Expected ProgressPresentationError.duplicateDay, received \(error)")
                return
            }

            XCTAssertEqual("2026-02-03", localDate)
        }
    }

    func testProgressSnapshotStillRejectsNegativeDailyReviewCounts() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try XCTUnwrap(TimeZone(identifier: "UTC"))
        let scopeKey = makeProgressScopeKeyForTests(
            timeZone: "UTC",
            from: "2026-02-01",
            to: "2026-02-03"
        )
        let series = makeProgressSeries(
            timeZone: scopeKey.timeZone,
            from: scopeKey.from,
            to: scopeKey.to,
            dailyReviews: [
                ProgressDay(date: "2026-02-03", reviewCount: -1)
            ],
            summary: nil,
            generatedAt: nil
        )

        XCTAssertThrowsError(
            try makeProgressSnapshot(
                summary: makeEmptyProgressSummaryForTests(),
                series: series,
                scopeKey: scopeKey,
                summarySourceState: .serverBase,
                seriesSourceState: .serverBase,
                calendar: calendar
            )
        ) { error in
            guard case ProgressPresentationError.negativeReviewCount(let localDate, let reviewCount) = error else {
                XCTFail("Expected ProgressPresentationError.negativeReviewCount, received \(error)")
                return
            }

            XCTAssertEqual("2026-02-03", localDate)
            XCTAssertEqual(-1, reviewCount)
        }
    }
}
