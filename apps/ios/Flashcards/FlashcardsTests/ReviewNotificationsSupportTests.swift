import XCTest
@testable import Flashcards

final class ReviewNotificationsSupportTests: XCTestCase {
    func testBuildRepeatedReviewNotificationPayloadsRepeatsSameCurrentCardForExplicitDailyDates() throws {
        let calendar = makeUTCGregorianCalendar()
        let scheduledDates = try makeDates(values: [
            "2026-03-29T10:00:00.000Z",
            "2026-03-30T10:00:00.000Z",
            "2026-03-31T10:00:00.000Z"
        ])
        let payloads = buildRepeatedReviewNotificationPayloads(
            workspaceId: "workspace-local",
            currentCard: makeCurrentReviewNotificationCard(),
            scheduledDates: scheduledDates,
            calendar: calendar,
            mode: .daily
        )

        XCTAssertEqual(payloads.count, scheduledDates.count)
        XCTAssertEqual(payloads.map(\.cardId), ["card-1", "card-1", "card-1"])
        XCTAssertEqual(payloads.map(\.frontText), ["Question", "Question", "Question"])
        XCTAssertEqual(
            payloads.map(\.scheduledAtMillis),
            scheduledDates.map { scheduledAt in
                Int64(scheduledAt.timeIntervalSince1970 * 1000)
            }
        )
        XCTAssertEqual(
            payloads.map(\.requestId),
            [
                "review-notification::workspace-local::daily::2026-03-29",
                "review-notification::workspace-local::daily::2026-03-30",
                "review-notification::workspace-local::daily::2026-03-31"
            ]
        )
    }

    func testBuildRepeatedReviewNotificationPayloadsRepeatsSameCurrentCardForExplicitInactivityDates() throws {
        let calendar = makeUTCGregorianCalendar()
        let scheduledDates = try makeDates(values: [
            "2026-03-28T13:00:00.000Z",
            "2026-03-29T10:00:00.000Z",
            "2026-03-30T10:00:00.000Z"
        ])
        let payloads = buildRepeatedReviewNotificationPayloads(
            workspaceId: "workspace-local",
            currentCard: makeCurrentReviewNotificationCard(),
            scheduledDates: scheduledDates,
            calendar: calendar,
            mode: .inactivity
        )

        XCTAssertEqual(payloads.count, scheduledDates.count)
        XCTAssertEqual(payloads.map(\.cardId), ["card-1", "card-1", "card-1"])
        XCTAssertEqual(payloads.map(\.frontText), ["Question", "Question", "Question"])
        XCTAssertEqual(
            payloads.map(\.scheduledAtMillis),
            scheduledDates.map { scheduledAt in
                Int64(scheduledAt.timeIntervalSince1970 * 1000)
            }
        )
        XCTAssertEqual(
            payloads.map(\.requestId),
            [
                "review-notification::workspace-local::inactivity::2026-03-28",
                "review-notification::workspace-local::inactivity::2026-03-29",
                "review-notification::workspace-local::inactivity::2026-03-30"
            ]
        )
    }

    func testBuildDailyReviewNotificationDatesExcludesPastReminderForCurrentUtcDay() throws {
        let calendar = makeUTCGregorianCalendar()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-28T11:05:00.000Z"))
        let scheduledDates = buildDailyReviewNotificationDates(
            now: now,
            calendar: calendar,
            settings: DailyReviewNotificationsSettings(
                hour: 10,
                minute: 0
            )
        )

        XCTAssertEqual(scheduledDates.count, 6)
        XCTAssertEqual(
            scheduledDates,
            try makeDates(values: [
                "2026-03-29T10:00:00.000Z",
                "2026-03-30T10:00:00.000Z",
                "2026-03-31T10:00:00.000Z",
                "2026-04-01T10:00:00.000Z",
                "2026-04-02T10:00:00.000Z",
                "2026-04-03T10:00:00.000Z"
            ])
        )
    }

    func testBuildInactivityReviewNotificationDatesStartsFromComputedUtcReminderAndKeepsHorizon() throws {
        let calendar = makeUTCGregorianCalendar()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-28T11:05:00.000Z"))
        let lastActiveAt = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-28T11:00:00.000Z"))
        let scheduledDates = buildInactivityReviewNotificationDates(
            lastActiveAt: lastActiveAt,
            now: now,
            calendar: calendar,
            settings: InactivityReviewNotificationsSettings(
                windowStartHour: 10,
                windowStartMinute: 0,
                windowEndHour: 19,
                windowEndMinute: 0,
                idleMinutes: 120
            )
        )

        XCTAssertEqual(scheduledDates.count, 7)
        XCTAssertEqual(
            scheduledDates,
            try makeDates(values: [
                "2026-03-28T13:00:00.000Z",
                "2026-03-29T10:00:00.000Z",
                "2026-03-30T10:00:00.000Z",
                "2026-03-31T10:00:00.000Z",
                "2026-04-01T10:00:00.000Z",
                "2026-04-02T10:00:00.000Z",
                "2026-04-03T10:00:00.000Z"
            ])
        )
    }

    private func makeUTCGregorianCalendar() -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        return calendar
    }

    private func makeCurrentReviewNotificationCard() -> CurrentReviewNotificationCard {
        CurrentReviewNotificationCard(
            reviewFilter: makePersistedReviewFilter(reviewFilter: .allCards),
            cardId: "card-1",
            frontText: "Question"
        )
    }

    private func makeDates(values: [String]) throws -> [Date] {
        try values.map { value in
            try XCTUnwrap(parseIsoTimestamp(value: value))
        }
    }
}
