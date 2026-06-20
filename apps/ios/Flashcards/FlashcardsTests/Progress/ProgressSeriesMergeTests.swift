import Foundation
import XCTest
@testable import Flashcards

final class ProgressSeriesMergeTests: ProgressStoreTestCase {
    func testProgressSeriesUsesReviewEventTimezoneForLocalReviewDay() throws {
        let requestRange = ProgressRequestRange(
            timeZone: "UTC",
            from: "2026-04-01",
            to: "2026-04-02"
        )
        let series = try makeProgressSeriesFromReviewEvents(
            reviewEvents: [
                ProgressReviewEventSource(
                    reviewEventId: "review-event-1",
                    reviewedAtClient: "2026-04-02T01:30:00.000Z",
                    reviewedTimeZone: "America/Los_Angeles",
                    rating: .good
                )
            ],
            requestRange: requestRange
        )
        let reviewCountsByDate = Dictionary(uniqueKeysWithValues: series.dailyReviews.map { day in
            (day.date, day.reviewCount)
        })
        let streakStatesByDate = Dictionary(uniqueKeysWithValues: series.streakDays.map { day in
            (day.date, day.state)
        })

        XCTAssertEqual(1, reviewCountsByDate["2026-04-01"])
        XCTAssertEqual(0, reviewCountsByDate["2026-04-02"])
        XCTAssertEqual(.reviewed, streakStatesByDate["2026-04-01"])
        XCTAssertEqual(.pending, streakStatesByDate["2026-04-02"])
    }

    func testMergeProgressSeriesAppliesOnlyTodayLocalOverlay() throws {
        let requestRange = ProgressSeriesLoadRequest(
            apiBaseUrl: "",
            authorizationHeader: "",
            timeZone: "UTC",
            from: "2026-04-15",
            to: "2026-04-18"
        )
        let serverBase = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [
                "2026-04-16": 1,
                "2026-04-17": 2,
                "2026-04-18": 2,
            ],
            generatedAt: "2026-04-18T12:00:00.000Z"
        )
        let pendingLocalOverlay = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [
                "2026-04-17": 1
            ],
            generatedAt: "2026-04-18T12:00:00.000Z"
        )
        let localFallback = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [
                "2026-04-15": 1,
                "2026-04-16": 1,
                "2026-04-17": 2,
                "2026-04-18": 1,
            ],
            generatedAt: "2026-04-18T12:00:00.000Z"
        )

        let mergedSeries = try mergeProgressSeries(
            serverBase: serverBase,
            pendingLocalOverlay: pendingLocalOverlay,
            localFallback: localFallback,
            mergedActiveReviewDates: ["2026-04-15", "2026-04-16", "2026-04-17", "2026-04-18"]
        )
        let mergedCountsByDate = Dictionary(uniqueKeysWithValues: mergedSeries.dailyReviews.map { progressDay in
            (progressDay.date, progressDay.reviewCount)
        })

        XCTAssertEqual(0, mergedCountsByDate["2026-04-15"])
        XCTAssertEqual(1, mergedCountsByDate["2026-04-16"])
        XCTAssertEqual(2, mergedCountsByDate["2026-04-17"])
        XCTAssertEqual(2, mergedCountsByDate["2026-04-18"])
        XCTAssertEqual(serverBase.generatedAt, mergedSeries.generatedAt)
        XCTAssertEqual(serverBase.reviewHistoryWatermarks, mergedSeries.reviewHistoryWatermarks)

        let scopeKey = makeProgressScopeKeyForTests(
            timeZone: requestRange.timeZone,
            from: requestRange.from,
            to: requestRange.to
        )
        let persistedServerBase = PersistedProgressSeriesServerBase(
            scopeKey: scopeKey,
            serverBase: serverBase,
            storedAt: "2026-04-18T12:00:00.000Z"
        )
        let renderedOverlaySeries = try makeProgressRenderedSeries(
            serverBase: persistedServerBase,
            scopeKey: scopeKey,
            localFallbackSeries: localFallback,
            pendingLocalOverlaySeries: pendingLocalOverlay,
            mergedActiveReviewDates: ["2026-04-15", "2026-04-16", "2026-04-17", "2026-04-18"]
        )
        let emptyPendingLocalOverlay = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [:],
            generatedAt: "2026-04-18T12:00:00.000Z"
        )
        let renderedServerSeries = try makeProgressRenderedSeries(
            serverBase: persistedServerBase,
            scopeKey: scopeKey,
            localFallbackSeries: serverBase,
            pendingLocalOverlaySeries: emptyPendingLocalOverlay,
            mergedActiveReviewDates: ["2026-04-16", "2026-04-17", "2026-04-18"]
        )

        XCTAssertEqual(.serverBase, renderedOverlaySeries.sourceState)
        XCTAssertEqual(.serverBase, renderedServerSeries.sourceState)
    }

    func testMergeProgressSeriesPreservesServerFreezeStatesAfterLocalOverlayChangesEarlierDay() throws {
        let requestRange = ProgressSeriesLoadRequest(
            apiBaseUrl: "",
            authorizationHeader: "",
            timeZone: "UTC",
            from: "2026-04-16",
            to: "2026-04-20"
        )
        let serverBase = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [
                "2026-04-16": 1
            ],
            generatedAt: "2026-04-20T12:00:00.000Z"
        )
        let pendingLocalOverlay = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [:],
            generatedAt: "2026-04-20T12:00:00.000Z"
        )
        let localFallback = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [
                "2026-04-16": 1,
                "2026-04-17": 1,
            ],
            generatedAt: "2026-04-20T12:00:00.000Z"
        )

        let mergedSeries = try mergeProgressSeries(
            serverBase: serverBase,
            pendingLocalOverlay: pendingLocalOverlay,
            localFallback: localFallback,
            mergedActiveReviewDates: ["2026-04-16", "2026-04-17"]
        )
        let mergedStatesByDate = Dictionary(uniqueKeysWithValues: mergedSeries.streakDays.map { streakDay in
            (streakDay.date, streakDay.state)
        })

        XCTAssertEqual(.reviewed, try XCTUnwrap(mergedStatesByDate["2026-04-16"]))
        XCTAssertEqual(.frozen, try XCTUnwrap(mergedStatesByDate["2026-04-17"]))
        XCTAssertEqual(.frozen, try XCTUnwrap(mergedStatesByDate["2026-04-18"]))
        XCTAssertEqual(.missed, try XCTUnwrap(mergedStatesByDate["2026-04-19"]))
        XCTAssertEqual(.pending, try XCTUnwrap(mergedStatesByDate["2026-04-20"]))
    }

    func testMergeProgressSeriesIgnoresAllTimeActiveDatesOutsideRange() throws {
        let requestRange = ProgressSeriesLoadRequest(
            apiBaseUrl: "",
            authorizationHeader: "",
            timeZone: "UTC",
            from: "2026-04-18",
            to: "2026-04-20"
        )
        let serverBase = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [:],
            generatedAt: "2026-04-20T12:00:00.000Z"
        )
        let pendingLocalOverlay = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [:],
            generatedAt: "2026-04-20T12:00:00.000Z"
        )
        let localFallback = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [:],
            generatedAt: "2026-04-20T12:00:00.000Z"
        )

        let mergedSeries = try mergeProgressSeries(
            serverBase: serverBase,
            pendingLocalOverlay: pendingLocalOverlay,
            localFallback: localFallback,
            mergedActiveReviewDates: ["2026-04-16"]
        )
        let mergedStatesByDate = Dictionary(uniqueKeysWithValues: mergedSeries.streakDays.map { streakDay in
            (streakDay.date, streakDay.state)
        })

        XCTAssertEqual(.missed, try XCTUnwrap(mergedStatesByDate["2026-04-18"]))
        XCTAssertEqual(.missed, try XCTUnwrap(mergedStatesByDate["2026-04-19"]))
        XCTAssertEqual(.pending, try XCTUnwrap(mergedStatesByDate["2026-04-20"]))
    }

    func testMergeProgressSeriesPreservesServerStreakStatesBeforeLocalOverlayChange() throws {
        let requestRange = ProgressSeriesLoadRequest(
            apiBaseUrl: "",
            authorizationHeader: "",
            timeZone: "UTC",
            from: "2026-04-16",
            to: "2026-04-20"
        )
        let dailyReviews = try makeZeroFilledProgressDays(
            requestRange: ProgressRequestRange(
                timeZone: requestRange.timeZone,
                from: requestRange.from,
                to: requestRange.to
            )
        )
        let serverBase = makeProgressSeries(
            timeZone: requestRange.timeZone,
            from: requestRange.from,
            to: requestRange.to,
            dailyReviews: dailyReviews,
            streakDays: [
                ProgressStreakDay(date: "2026-04-16", state: .frozen),
                ProgressStreakDay(date: "2026-04-17", state: .frozen),
                ProgressStreakDay(date: "2026-04-18", state: .missed),
                ProgressStreakDay(date: "2026-04-19", state: .missed),
                ProgressStreakDay(date: "2026-04-20", state: .pending),
            ],
            summary: nil,
            generatedAt: "2026-04-20T12:00:00.000Z",
            reviewHistoryWatermarks: makeTestProgressReviewHistoryWatermarks(reviewSequenceId: 42)
        )
        let pendingLocalOverlay = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [
                "2026-04-20": 1
            ],
            generatedAt: "2026-04-20T12:00:00.000Z"
        )
        let localFallback = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [:],
            generatedAt: "2026-04-20T12:00:00.000Z"
        )

        let mergedSeries = try mergeProgressSeries(
            serverBase: serverBase,
            pendingLocalOverlay: pendingLocalOverlay,
            localFallback: localFallback,
            mergedActiveReviewDates: ["2026-04-20"]
        )
        let mergedStatesByDate = Dictionary(uniqueKeysWithValues: mergedSeries.streakDays.map { streakDay in
            (streakDay.date, streakDay.state)
        })

        XCTAssertEqual(.frozen, try XCTUnwrap(mergedStatesByDate["2026-04-16"]))
        XCTAssertEqual(.frozen, try XCTUnwrap(mergedStatesByDate["2026-04-17"]))
        XCTAssertEqual(.missed, try XCTUnwrap(mergedStatesByDate["2026-04-18"]))
        XCTAssertEqual(.missed, try XCTUnwrap(mergedStatesByDate["2026-04-19"]))
        XCTAssertEqual(.reviewed, try XCTUnwrap(mergedStatesByDate["2026-04-20"]))
    }

    func testMergeProgressSeriesPreservesServerFreezeHistoryForOlderLocalOverlayChange() throws {
        let requestRange = ProgressSeriesLoadRequest(
            apiBaseUrl: "",
            authorizationHeader: "",
            timeZone: "UTC",
            from: "2026-04-16",
            to: "2026-04-20"
        )
        let dailyReviews = try makeZeroFilledProgressDays(
            requestRange: ProgressRequestRange(
                timeZone: requestRange.timeZone,
                from: requestRange.from,
                to: requestRange.to
            )
        )
        let serverBase = makeProgressSeries(
            timeZone: requestRange.timeZone,
            from: requestRange.from,
            to: requestRange.to,
            dailyReviews: dailyReviews,
            streakDays: [
                ProgressStreakDay(date: "2026-04-16", state: .frozen),
                ProgressStreakDay(date: "2026-04-17", state: .frozen),
                ProgressStreakDay(date: "2026-04-18", state: .missed),
                ProgressStreakDay(date: "2026-04-19", state: .missed),
                ProgressStreakDay(date: "2026-04-20", state: .pending),
            ],
            summary: nil,
            generatedAt: "2026-04-20T12:00:00.000Z",
            reviewHistoryWatermarks: makeTestProgressReviewHistoryWatermarks(reviewSequenceId: 42)
        )
        let pendingLocalOverlay = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [:],
            generatedAt: "2026-04-20T12:00:00.000Z"
        )
        let localFallback = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [
                "2026-04-18": 1
            ],
            generatedAt: "2026-04-20T12:00:00.000Z"
        )

        let mergedSeries = try mergeProgressSeries(
            serverBase: serverBase,
            pendingLocalOverlay: pendingLocalOverlay,
            localFallback: localFallback,
            mergedActiveReviewDates: ["2026-04-18"]
        )
        let mergedStatesByDate = Dictionary(uniqueKeysWithValues: mergedSeries.streakDays.map { streakDay in
            (streakDay.date, streakDay.state)
        })

        XCTAssertEqual(.frozen, try XCTUnwrap(mergedStatesByDate["2026-04-16"]))
        XCTAssertEqual(.frozen, try XCTUnwrap(mergedStatesByDate["2026-04-17"]))
        XCTAssertEqual(.missed, try XCTUnwrap(mergedStatesByDate["2026-04-18"]))
        XCTAssertEqual(.missed, try XCTUnwrap(mergedStatesByDate["2026-04-19"]))
        XCTAssertEqual(.pending, try XCTUnwrap(mergedStatesByDate["2026-04-20"]))
    }
}
