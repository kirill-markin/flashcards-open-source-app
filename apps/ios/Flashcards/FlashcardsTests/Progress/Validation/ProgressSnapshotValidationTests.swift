import Foundation
import XCTest
@testable import Flashcards

final class ProgressSnapshotValidationTests: XCTestCase {
    func testProgressSummaryDecodesMissingReviewHistoryWatermarksAsEmpty() throws {
        let json = """
        {
          "timeZone": "Europe/Madrid",
          "generatedAt": "2026-04-18T09:15:00.000Z",
          "summary": {
            "currentStreakDays": 1,
            "hasReviewedToday": true,
            "lastReviewedOn": "2026-04-03",
            "activeReviewDays": 2
          }
        }
        """

        let summary = try JSONDecoder().decode(UserProgressSummary.self, from: Data(json.utf8))

        XCTAssertTrue(summary.reviewHistoryWatermarks.isEmpty)
    }

    func testProgressSeriesDecodesMissingReviewHistoryWatermarksAsEmpty() throws {
        let json = """
        {
          "timeZone": "Europe/Madrid",
          "from": "2026-04-01",
          "to": "2026-04-03",
          "dailyReviews": [
            {
              "date": "2026-04-01",
              "reviewCount": 3,
              "againCount": 1,
              "hardCount": 1,
              "goodCount": 1,
              "easyCount": 0
            }
          ],
          "generatedAt": "2026-04-18T09:15:00.000Z"
        }
        """

        let series = try JSONDecoder().decode(UserProgressSeries.self, from: Data(json.utf8))

        XCTAssertTrue(series.reviewHistoryWatermarks.isEmpty)
    }

    func testReviewScheduleDecodesMissingReviewHistoryWatermarksAsEmpty() throws {
        let json = """
        {
          "timeZone": "Europe/Madrid",
          "generatedAt": "2026-05-03T12:00:00.000Z",
          "totalCards": 1,
          "buckets": [
            {
              "key": "new",
              "count": 1
            }
          ]
        }
        """

        let schedule = try JSONDecoder().decode(UserReviewSchedule.self, from: Data(json.utf8))

        XCTAssertTrue(schedule.reviewHistoryWatermarks.isEmpty)
    }

    func testProgressSummaryDecodingRejectsNegativeReviewHistoryWatermarkSequenceId() throws {
        let json = """
        {
          "timeZone": "Europe/Madrid",
          "generatedAt": "2026-04-18T09:15:00.000Z",
          "reviewHistoryWatermarks": [
            {
              "workspaceId": "workspace-1",
              "reviewSequenceId": -1
            }
          ],
          "summary": {
            "currentStreakDays": 1,
            "hasReviewedToday": true,
            "lastReviewedOn": "2026-04-03",
            "activeReviewDays": 2
          }
        }
        """

        XCTAssertThrowsError(
            try JSONDecoder().decode(UserProgressSummary.self, from: Data(json.utf8))
        )
    }

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
                        reviewCount: 1,
                        againCount: 0,
                        hardCount: 0,
                        goodCount: 1,
                        easyCount: 0
                    )
                ],
                summary: nil,
                generatedAt: nil,
                reviewHistoryWatermarks: []
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
                ProgressDay(
                    date: "2026-02-03",
                    reviewCount: 1,
                    againCount: 0,
                    hardCount: 0,
                    goodCount: 1,
                    easyCount: 0
                ),
                ProgressDay(
                    date: "2026-02-03",
                    reviewCount: 2,
                    againCount: 0,
                    hardCount: 0,
                    goodCount: 2,
                    easyCount: 0
                ),
            ],
            summary: nil,
            generatedAt: nil,
            reviewHistoryWatermarks: []
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
                ProgressDay(
                    date: "2026-02-03",
                    reviewCount: -1,
                    againCount: 0,
                    hardCount: 0,
                    goodCount: 0,
                    easyCount: 0
                )
            ],
            summary: nil,
            generatedAt: nil,
            reviewHistoryWatermarks: []
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
