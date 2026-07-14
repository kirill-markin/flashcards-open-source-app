import Foundation
import XCTest
@testable import Flashcards

final class StrictReminderPayloadAndOwnershipTests: ReviewNotificationsTestCase {
    func testStrictReminderPayloadsSkipCompletedDaysAndKeepOnlyFutureCandidates() throws {
        let calendar = makeCalendar()
        let now = try XCTUnwrap(makeDate(year: 2026, month: 4, day: 3, hour: 21, minute: 5, calendar: calendar))
        let completedDayStart = try XCTUnwrap(makeDate(year: 2026, month: 4, day: 4, hour: 0, minute: 0, calendar: calendar))

        let payloads = try buildStrictReminderPayloads(
            now: now,
            calendar: calendar,
            completedDayStartMillis: [strictReminderDayStartMillis(date: completedDayStart)]
        )

        XCTAssertEqual(
            payloads.prefix(4).map { formatDate(date: Date(timeIntervalSince1970: TimeInterval($0.scheduledAtMillis) / 1_000), calendar: calendar) },
            [
                "2026-04-03 22:00",
                "2026-04-05 20:00",
                "2026-04-05 21:00",
                "2026-04-05 22:00"
            ]
        )
        XCTAssertEqual(payloads.first?.offset, .twoHours)
        XCTAssertTrue(payloads.allSatisfy { $0.requestId.hasPrefix("strict-reminder::") })
    }

    func testStrictReminderPayloadsStayWithinPendingRequestLimit() throws {
        let calendar = makeCalendar()
        let now = try XCTUnwrap(makeDate(year: 2026, month: 4, day: 3, hour: 9, minute: 0, calendar: calendar))

        let payloads = try buildStrictReminderPayloads(
            now: now,
            calendar: calendar,
            completedDayStartMillis: []
        )

        XCTAssertEqual(payloads.count, strictReminderPendingRequestsLimit)
        XCTAssertLessThanOrEqual(payloads.count, appNotificationPendingRequestsLimit)
    }

    func testLoadScheduledStrictReminderPayloadsSkipsTodayAfterAppWideReview() throws {
        let suiteName = "ReviewNotificationsSupportTests-\(UUID().uuidString)"
        guard let userDefaults = UserDefaults(suiteName: suiteName) else {
            XCTFail("Expected isolated UserDefaults suite")
            return
        }
        defer {
            userDefaults.removePersistentDomain(forName: suiteName)
        }

        let calendar = makeCalendar()
        let reviewedAt = try XCTUnwrap(makeDate(year: 2026, month: 4, day: 3, hour: 10, minute: 15, calendar: calendar))
        let now = try XCTUnwrap(makeDate(year: 2026, month: 4, day: 3, hour: 21, minute: 5, calendar: calendar))

        persistStrictReminderLastReviewedAt(
            userDefaults: userDefaults,
            reviewedAt: reviewedAt
        )

        let payloads = try loadScheduledStrictReminderPayloads(
            snapshot: StrictReminderSchedulingSnapshot(
                now: now,
                calendar: calendar,
                completedDayStartMillis: loadStrictReminderCompletedDayStartMillis(
                    userDefaults: userDefaults,
                    now: now,
                    calendar: calendar
                )
            )
        )

        XCTAssertEqual(
            payloads.prefix(3).map { formatDate(date: Date(timeIntervalSince1970: TimeInterval($0.scheduledAtMillis) / 1_000), calendar: calendar) },
            [
                "2026-04-04 20:00",
                "2026-04-04 21:00",
                "2026-04-04 22:00"
            ]
        )
    }

    func testStrictReminderPayloadsForIncompleteDayUseSeparateBodiesAndIdentifiers() throws {
        let calendar = makeCalendar()
        let dayStart = try XCTUnwrap(makeDate(year: 2026, month: 4, day: 3, hour: 0, minute: 0, calendar: calendar))
        let startOfNextDay = try XCTUnwrap(makeDate(year: 2026, month: 4, day: 4, hour: 0, minute: 0, calendar: calendar))
        let now = try XCTUnwrap(makeDate(year: 2026, month: 4, day: 3, hour: 9, minute: 0, calendar: calendar))

        let payloads = buildStrictReminderPayloadsForIncompleteDay(
            dayStart: dayStart,
            startOfNextDay: startOfNextDay,
            now: now,
            calendar: calendar
        )

        XCTAssertEqual(payloads.map(\.offset), [.fourHours, .threeHours, .twoHours])
        XCTAssertEqual(
            payloads.map(\.notificationBodyText),
            [
                String(localized: "strict_reminder.body.4h", table: "Foundation"),
                String(localized: "strict_reminder.body.3h", table: "Foundation"),
                String(localized: "strict_reminder.body.2h", table: "Foundation")
            ]
        )
        XCTAssertEqual(Set(payloads.map(\.requestId)).count, payloads.count)
    }

    func testFilterStrictReminderRequestIdentifiersKeepsOnlyStrictReminders() {
        let identifiers = [
            "strict-reminder::4h::2026-04-03-20-00",
            "review-notification::workspace-1::daily::2026-04-03-10-00",
            "strict-reminder::2h::2026-04-04-22-00"
        ]

        XCTAssertEqual(
            filterStrictReminderRequestIdentifiers(identifiers: identifiers),
            [
                "strict-reminder::4h::2026-04-03-20-00",
                "strict-reminder::2h::2026-04-04-22-00"
            ]
        )
    }

    func testParseAppNotificationTapRequestPreservesWorkspaceOwnership() {
        let strictRequest = parseAppNotificationTapRequest(
            userInfo: [appNotificationTapTypeUserInfoKey: AppNotificationTapType.strictReminder.rawValue],
            requestIdentifier: nil
        )

        XCTAssertEqual(strictRequest, .openStrictReminder)

        let reviewRequest = parseAppNotificationTapRequest(
            userInfo: [appNotificationTapTypeUserInfoKey: AppNotificationTapType.reviewReminder.rawValue],
            requestIdentifier: makeReviewNotificationRequestIdentifier(
                workspaceId: "workspace-1",
                kind: "daily",
                suffix: "2026-04-03-10-00"
            )
        )

        XCTAssertEqual(reviewRequest, .openReviewReminder(workspaceId: "workspace-1"))
        XCTAssertNil(
            appNotificationTapWorkspaceOwnershipFallback(
                request: .openReviewReminder(workspaceId: "workspace-1"),
                currentWorkspaceId: "workspace-1"
            )
        )
        XCTAssertEqual(
            appNotificationTapWorkspaceOwnershipFallback(
                request: .openReviewReminder(workspaceId: "workspace-1"),
                currentWorkspaceId: "workspace-2"
            )?.reason,
            "stale_review_reminder_workspace"
        )

        let malformedReviewRequest = parseAppNotificationTapRequest(
            userInfo: [appNotificationTapTypeUserInfoKey: AppNotificationTapType.reviewReminder.rawValue],
            requestIdentifier: "invalid-review-reminder"
        )
        guard let malformedReviewRequest,
              case .fallback(let malformedFallback) = malformedReviewRequest else {
            XCTFail("Expected malformed review reminder identifier to be rejected")
            return
        }
        XCTAssertEqual(malformedFallback.reason, "invalid_review_reminder_identifier")
    }

    func testResolveAppNotificationOwnershipPreservesUnrelatedAndRejectsStaleRequests() throws {
        let suiteName = "ReviewNotificationsSupportTests-\(UUID().uuidString)"
        guard let userDefaults = UserDefaults(suiteName: suiteName) else {
            XCTFail("Expected isolated UserDefaults suite")
            return
        }
        defer {
            userDefaults.removePersistentDomain(forName: suiteName)
        }

        try saveAppNotificationPresentationOwnership(
            ownership: AppNotificationPresentationOwnership(
                schemaVersion: appNotificationPresentationOwnershipSchemaVersion,
                isMasterEnabled: true,
                workspaceId: "workspace-1",
                isStrictReminderEnabled: true,
                strictReminderScope: "strict-scope-1"
            ),
            userDefaults: userDefaults,
            encoder: JSONEncoder()
        )

        XCTAssertEqual(
            try resolveAppNotificationOwnership(
                userInfo: [:],
                requestIdentifier: "unrelated-notification",
                userDefaults: userDefaults,
                decoder: JSONDecoder()
            ),
            .unrelated
        )
        XCTAssertEqual(
            try resolveAppNotificationOwnership(
                userInfo: buildAppNotificationUserInfo(notificationType: .reviewReminder),
                requestIdentifier: makeReviewNotificationRequestIdentifier(
                    workspaceId: "workspace-1",
                    kind: "daily",
                    suffix: "2026-04-03-10-00"
                ),
                userDefaults: userDefaults,
                decoder: JSONDecoder()
            ),
            .owned(.openReviewReminder(workspaceId: "workspace-1"))
        )

        let staleReviewDecision = try resolveAppNotificationOwnership(
            userInfo: buildAppNotificationUserInfo(notificationType: .reviewReminder),
            requestIdentifier: makeReviewNotificationRequestIdentifier(
                workspaceId: "workspace-2",
                kind: "daily",
                suffix: "2026-04-03-10-00"
            ),
            userDefaults: userDefaults,
            decoder: JSONDecoder()
        )
        guard case .suppressed(let staleReviewFallback) = staleReviewDecision else {
            XCTFail("Expected stale review notification to be suppressed")
            return
        }
        XCTAssertEqual(staleReviewFallback.reason, "stale_review_reminder_workspace")

        let calendar = makeCalendar()
        let scheduledAt = try XCTUnwrap(
            makeDate(year: 2026, month: 4, day: 3, hour: 20, minute: 0, calendar: calendar)
        )
        XCTAssertEqual(
            try resolveAppNotificationOwnership(
                userInfo: buildStrictReminderNotificationUserInfo(scope: "strict-scope-1"),
                requestIdentifier: makeStrictReminderRequestIdentifier(
                    offset: .fourHours,
                    scheduledAt: scheduledAt,
                    calendar: calendar
                ),
                userDefaults: userDefaults,
                decoder: JSONDecoder()
            ),
            .owned(.openStrictReminder)
        )
    }
}
