import Foundation
import XCTest
@testable import Flashcards

final class ReviewNotificationsSupportTests: XCTestCase {
    func testInactivityReminderDatesRepeatAcrossCurrentAndLaterDays() throws {
        let calendar = makeCalendar()
        let lastActiveAt = try XCTUnwrap(makeDate(year: 2026, month: 4, day: 3, hour: 10, minute: 15, calendar: calendar))
        let now = try XCTUnwrap(makeDate(year: 2026, month: 4, day: 3, hour: 10, minute: 16, calendar: calendar))

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

        XCTAssertEqual(
            scheduledDates.prefix(9).map { formatDate(date: $0, calendar: calendar) },
            [
                "2026-04-03 12:15",
                "2026-04-03 14:15",
                "2026-04-03 16:15",
                "2026-04-03 18:15",
                "2026-04-04 10:00",
                "2026-04-04 12:00",
                "2026-04-04 14:00",
                "2026-04-04 16:00",
                "2026-04-04 18:00"
            ]
        )
    }

    func testInactivityReminderDatesSnapToWindowStartBeforeWindow() throws {
        let calendar = makeCalendar()
        let lastActiveAt = try XCTUnwrap(makeDate(year: 2026, month: 4, day: 3, hour: 7, minute: 30, calendar: calendar))
        let now = try XCTUnwrap(makeDate(year: 2026, month: 4, day: 3, hour: 7, minute: 31, calendar: calendar))

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

        XCTAssertEqual(
            scheduledDates.prefix(5).map { formatDate(date: $0, calendar: calendar) },
            [
                "2026-04-03 10:00",
                "2026-04-03 12:00",
                "2026-04-03 14:00",
                "2026-04-03 16:00",
                "2026-04-03 18:00"
            ]
        )
    }

    func testRepeatedPayloadsUseReplacementCurrentCardAndUniqueIdentifiers() throws {
        let calendar = makeCalendar()
        let scheduledDates = [
            try XCTUnwrap(makeDate(year: 2026, month: 4, day: 3, hour: 12, minute: 15, calendar: calendar)),
            try XCTUnwrap(makeDate(year: 2026, month: 4, day: 3, hour: 14, minute: 15, calendar: calendar))
        ]

        let originalPayloads = buildRepeatedReviewNotificationPayloads(
            workspaceId: "workspace-1",
            currentCard: CurrentReviewNotificationCard(
                reviewFilter: PersistedReviewFilter.allCards,
                cardId: "card-a",
                frontText: "Front A"
            ),
            scheduledDates: scheduledDates,
            calendar: calendar,
            mode: .inactivity
        )
        let replacementPayloads = buildRepeatedReviewNotificationPayloads(
            workspaceId: "workspace-1",
            currentCard: CurrentReviewNotificationCard(
                reviewFilter: PersistedReviewFilter.allCards,
                cardId: "card-b",
                frontText: "Front B"
            ),
            scheduledDates: scheduledDates,
            calendar: calendar,
            mode: .inactivity
        )

        XCTAssertEqual(originalPayloads.map { $0.cardId }, ["card-a", "card-a"])
        XCTAssertEqual(replacementPayloads.map { $0.cardId }, ["card-b", "card-b"])
        XCTAssertEqual(replacementPayloads.map { $0.frontText }, ["Front B", "Front B"])
        XCTAssertEqual(Set(replacementPayloads.map { $0.requestId }).count, replacementPayloads.count)
    }

    func testFilterReviewNotificationRequestIdentifiersKeepsOnlyReviewNotifications() {
        let identifiers = [
            "review-notification::workspace-1::daily::2026-04-03-10-00",
            "other-notification::workspace-1::daily::2026-04-03-10-00",
            "review-notification::workspace-2::inactivity::2026-04-03-12-00"
        ]

        XCTAssertEqual(
            filterReviewNotificationRequestIdentifiers(identifiers: identifiers),
            [
                "review-notification::workspace-1::daily::2026-04-03-10-00",
                "review-notification::workspace-2::inactivity::2026-04-03-12-00"
            ]
        )
    }
}

private func makeCalendar() -> Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(secondsFromGMT: 0) ?? .gmt
    calendar.locale = Locale(identifier: "en_US_POSIX")
    return calendar
}

private func makeDate(
    year: Int,
    month: Int,
    day: Int,
    hour: Int,
    minute: Int,
    calendar: Calendar
) -> Date? {
    calendar.date(
        from: DateComponents(
            calendar: calendar,
            timeZone: calendar.timeZone,
            year: year,
            month: month,
            day: day,
            hour: hour,
            minute: minute
        )
    )
}

private func formatDate(date: Date, calendar: Calendar) -> String {
    let formatter = DateFormatter()
    formatter.calendar = calendar
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = calendar.timeZone
    formatter.dateFormat = "yyyy-MM-dd HH:mm"
    return formatter.string(from: date)
}

private extension PersistedReviewFilter {
    static let allCards = PersistedReviewFilter(kind: .allCards, deckId: nil, tag: nil)
}
