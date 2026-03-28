import XCTest
@testable import Flashcards

final class ReviewNotificationsSupportTests: XCTestCase {
    func testBuildRepeatedReviewNotificationPayloadsRepeatsSameCurrentCardForDailyDates() throws {
        let calendar = Calendar(identifier: .gregorian)
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-28T11:05:00.000Z"))
        let scheduledDates = buildDailyReviewNotificationDates(
            now: now,
            calendar: calendar,
            settings: DailyReviewNotificationsSettings(
                hour: 10,
                minute: 0
            )
        )

        let payloads = buildRepeatedReviewNotificationPayloads(
            workspaceId: "workspace-local",
            currentCard: CurrentReviewNotificationCard(
                reviewFilter: makePersistedReviewFilter(reviewFilter: .allCards),
                cardId: "card-1",
                frontText: "Question"
            ),
            scheduledDates: scheduledDates,
            calendar: calendar,
            mode: .daily
        )

        XCTAssertEqual(payloads.count, 6)
        XCTAssertEqual(Set(payloads.map(\.cardId)), ["card-1"])
        XCTAssertEqual(Set(payloads.map(\.frontText)), ["Question"])
    }

    func testBuildRepeatedReviewNotificationPayloadsRepeatsSameCurrentCardForInactivityDates() throws {
        let calendar = Calendar(identifier: .gregorian)
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

        let payloads = buildRepeatedReviewNotificationPayloads(
            workspaceId: "workspace-local",
            currentCard: CurrentReviewNotificationCard(
                reviewFilter: makePersistedReviewFilter(reviewFilter: .allCards),
                cardId: "card-1",
                frontText: "Question"
            ),
            scheduledDates: scheduledDates,
            calendar: calendar,
            mode: .inactivity
        )

        XCTAssertEqual(payloads.count, 7)
        XCTAssertEqual(Set(payloads.map(\.cardId)), ["card-1"])
        XCTAssertEqual(Set(payloads.map(\.frontText)), ["Question"])
    }
}
