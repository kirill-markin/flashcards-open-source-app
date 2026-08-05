import Foundation
import XCTest
@testable import Flashcards

final class ReviewNotificationPayloadTests: ReviewNotificationsTestCase {
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

    func testLoadScheduledReviewNotificationPayloadsRespectsExplicitLimit() async throws {
        let (database, databaseURL) = try makeTemporaryLocalDatabase()
        defer {
            try? database.close()
            try? removeTemporaryDatabase(at: databaseURL)
        }

        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        _ = try database.saveCard(
            workspaceId: workspace.workspaceId,
            input: CardEditorInput(
                frontText: "Question",
                backText: "Answer",
                tags: [],
            ),
            cardId: nil,
            mediaAssetIdsReadyForUpload: []
        )
        let calendar = makeCalendar()
        let now = try XCTUnwrap(makeDate(year: 2026, month: 4, day: 3, hour: 9, minute: 0, calendar: calendar))
        let settings = ReviewNotificationsSettings(
            isEnabled: true,
            selectedMode: .daily,
            daily: DailyReviewNotificationsSettings(
                hour: defaultDailyReminderHour,
                minute: defaultDailyReminderMinute
            ),
            inactivity: InactivityReviewNotificationsSettings(
                windowStartHour: defaultDailyReminderHour,
                windowStartMinute: defaultDailyReminderMinute,
                windowEndHour: defaultInactivityReminderWindowEndHour,
                windowEndMinute: defaultInactivityReminderWindowEndMinute,
                idleMinutes: 120
            ),
            showAppIconBadge: true
        )

        let result = try await loadScheduledReviewNotificationPayloads(
            snapshot: ReviewNotificationSchedulingSnapshot(
                databaseURL: databaseURL,
                workspaceId: workspace.workspaceId,
                reviewFilter: .allCards,
                now: now,
                settings: settings,
                lastActiveAt: nil,
                pendingRequestLimit: 3
            )
        )

        XCTAssertEqual(result.payloads.count, 3)
    }

    func testLoadScheduledReviewNotificationPayloadsSuppressesOnlyExplicitEmptyTagSelection() async throws {
        let (database, databaseURL) = try makeTemporaryLocalDatabase()
        defer {
            try? database.close()
            try? removeTemporaryDatabase(at: databaseURL)
        }

        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let calendar = makeCalendar()
        let now = try XCTUnwrap(makeDate(year: 2026, month: 4, day: 3, hour: 9, minute: 0, calendar: calendar))
        let settings = ReviewNotificationsSettings(
            isEnabled: true,
            selectedMode: .daily,
            daily: DailyReviewNotificationsSettings(
                hour: defaultDailyReminderHour,
                minute: defaultDailyReminderMinute
            ),
            inactivity: InactivityReviewNotificationsSettings(
                windowStartHour: defaultDailyReminderHour,
                windowStartMinute: defaultDailyReminderMinute,
                windowEndHour: defaultInactivityReminderWindowEndHour,
                windowEndMinute: defaultInactivityReminderWindowEndMinute,
                idleMinutes: 120
            ),
            showAppIconBadge: true
        )
        let allCardsResult = try await loadScheduledReviewNotificationPayloads(
            snapshot: ReviewNotificationSchedulingSnapshot(
                databaseURL: databaseURL,
                workspaceId: workspace.workspaceId,
                reviewFilter: .allCards,
                now: now,
                settings: settings,
                lastActiveAt: nil,
                pendingRequestLimit: 3
            )
        )
        let emptyTagsResult = try await loadScheduledReviewNotificationPayloads(
            snapshot: ReviewNotificationSchedulingSnapshot(
                databaseURL: databaseURL,
                workspaceId: workspace.workspaceId,
                reviewFilter: makeReviewTagsFilter(tags: []),
                now: now,
                settings: settings,
                lastActiveAt: nil,
                pendingRequestLimit: 3
            )
        )

        XCTAssertEqual(allCardsResult.payloads.count, 3)
        XCTAssertTrue(allCardsResult.payloads.allSatisfy { $0.content == .fallback })
        XCTAssertEqual(emptyTagsResult.payloads, [])
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

        XCTAssertEqual(originalPayloads.compactMap { $0.cardId }, ["card-a", "card-a"])
        XCTAssertEqual(replacementPayloads.compactMap { $0.cardId }, ["card-b", "card-b"])
        XCTAssertEqual(replacementPayloads.map { $0.notificationBodyText }, ["Front B", "Front B"])
        XCTAssertEqual(Set(replacementPayloads.map { $0.requestId }).count, replacementPayloads.count)
    }

    func testFallbackPayloadsUseGenericStudySessionText() throws {
        let calendar = makeCalendar()
        let scheduledDates = [
            try XCTUnwrap(makeDate(year: 2026, month: 4, day: 3, hour: 12, minute: 15, calendar: calendar)),
            try XCTUnwrap(makeDate(year: 2026, month: 4, day: 3, hour: 14, minute: 15, calendar: calendar))
        ]

        let fallbackPayloads = buildFallbackReviewNotificationPayloads(
            workspaceId: "workspace-1",
            reviewFilter: .allCards,
            scheduledDates: scheduledDates,
            calendar: calendar,
            mode: .daily
        )

        XCTAssertEqual(
            fallbackPayloads.map { $0.notificationBodyText },
            [
                reviewNotificationFallbackBodyText,
                reviewNotificationFallbackBodyText
            ]
        )
        XCTAssertEqual(fallbackPayloads.compactMap { $0.cardId }, [] as [String])
        XCTAssertEqual(Set(fallbackPayloads.map { $0.requestId }).count, fallbackPayloads.count)
    }

    func testFallbackPayloadsRoundTripThroughCodable() throws {
        let calendar = makeCalendar()
        let scheduledAt = try XCTUnwrap(makeDate(year: 2026, month: 4, day: 3, hour: 12, minute: 15, calendar: calendar))
        let payload = buildFallbackReviewNotificationPayloads(
            workspaceId: "workspace-1",
            reviewFilter: .allCards,
            scheduledDates: [scheduledAt],
            calendar: calendar,
            mode: .daily
        ).first

        let encodedPayload = try XCTUnwrap(payload)
        let data = try JSONEncoder().encode(encodedPayload)
        let decodedPayload = try JSONDecoder().decode(ScheduledReviewNotificationPayload.self, from: data)

        XCTAssertEqual(decodedPayload.notificationBodyText, reviewNotificationFallbackBodyText)
        XCTAssertNil(decodedPayload.cardId)
        XCTAssertEqual(decodedPayload.requestId, encodedPayload.requestId)
    }

    func testPersistedReviewFiltersDecodeLegacyKindsAndRoundTripMultipleTags() throws {
        let decoder = JSONDecoder()
        let legacyTag = try decoder.decode(
            PersistedReviewFilter.self,
            from: Data(#"{"kind":"tag","tag":"Biology"}"#.utf8)
        )
        let legacyDeck = try decoder.decode(
            PersistedReviewFilter.self,
            from: Data(#"{"kind":"deck","deckId":"deck-1"}"#.utf8)
        )
        let legacyEffort = try decoder.decode(
            PersistedReviewFilter.self,
            from: Data(#"{"kind":"effort","effortLevel":"medium"}"#.utf8)
        )
        let multiTagFilter = makeReviewTagsFilter(tags: [" chemistry ", "Biology", "biology"])
        let persistedMultiTagFilter = makePersistedReviewFilter(reviewFilter: multiTagFilter)
        let decodedMultiTagFilter = try decoder.decode(
            PersistedReviewFilter.self,
            from: JSONEncoder().encode(persistedMultiTagFilter)
        )

        XCTAssertEqual(try makeReviewFilter(persistedReviewFilter: legacyTag), makeReviewTagsFilter(tags: ["Biology"]))
        XCTAssertEqual(try makeReviewFilter(persistedReviewFilter: legacyDeck), .deck(deckId: "deck-1"))
        XCTAssertEqual(try makeReviewFilter(persistedReviewFilter: legacyEffort), makeReviewTagsFilter(tags: ["medium"]))
        XCTAssertEqual(try makeReviewFilter(persistedReviewFilter: decodedMultiTagFilter), multiTagFilter)
    }

    @MainActor
    func testSelectedMultipleTagFilterPersistsPerWorkspace() throws {
        let suiteName = "ReviewFilterPersistenceTests-\(UUID().uuidString)"
        guard let userDefaults = UserDefaults(suiteName: suiteName) else {
            XCTFail("Expected isolated UserDefaults suite")
            return
        }
        defer {
            userDefaults.removePersistentDomain(forName: suiteName)
        }
        let reviewFilter = makeReviewTagsFilter(tags: ["Chemistry", "Biology"])
        userDefaults.set(
            try JSONEncoder().encode(makePersistedReviewFilter(reviewFilter: reviewFilter)),
            forKey: makeSelectedReviewFilterUserDefaultsKey(workspaceId: "workspace-1")
        )

        XCTAssertEqual(
            FlashcardsStore.loadSelectedReviewFilter(
                userDefaults: userDefaults,
                decoder: JSONDecoder(),
                workspaceId: "workspace-1"
            ),
            reviewFilter
        )
        XCTAssertEqual(
            FlashcardsStore.loadSelectedReviewFilter(
                userDefaults: userDefaults,
                decoder: JSONDecoder(),
                workspaceId: "workspace-2"
            ),
            .allCards
        )
    }

    func testReviewNotificationUserInfoCarriesMultipleTagFilterAndLegacyPayloadRemainsReadable() {
        let persistedFilter = makePersistedReviewFilter(
            reviewFilter: makeReviewTagsFilter(tags: ["Biology", "Chemistry"])
        )
        let requestIdentifier = makeReviewNotificationRequestIdentifier(
            workspaceId: "workspace-1",
            kind: "daily",
            suffix: "2026-04-03-10-00"
        )

        XCTAssertEqual(
            parseAppNotificationTapRequest(
                userInfo: buildReviewNotificationUserInfo(reviewFilter: persistedFilter),
                requestIdentifier: requestIdentifier
            ),
            .openFilteredReviewReminder(workspaceId: "workspace-1", reviewFilter: persistedFilter)
        )
        XCTAssertEqual(
            parseAppNotificationTapRequest(
                userInfo: buildAppNotificationUserInfo(notificationType: .reviewReminder),
                requestIdentifier: requestIdentifier
            ),
            .openReviewReminder(workspaceId: "workspace-1")
        )
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

    func testAppNotificationPendingRequestBreakdownClassifiesReviewStrictAndOtherRequests() {
        let breakdown: AppNotificationPendingRequestBreakdown = appNotificationPendingRequestBreakdown(
            identifiers: [
                "review-notification::workspace-1::daily::2026-04-03-10-00",
                "strict-reminder::4h::2026-04-03-20-00",
                "external-notification::news",
                "strict-reminder::2h::2026-04-04-22-00",
                "review-notification::workspace-2::inactivity::2026-04-03-12-00"
            ]
        )

        XCTAssertEqual(breakdown.totalCount, 5)
        XCTAssertEqual(breakdown.reviewCount, 2)
        XCTAssertEqual(breakdown.strictCount, 2)
        XCTAssertEqual(breakdown.otherCount, 1)
    }

    func testNotificationSchedulingDelaySecondsRangeRoundsUpAndFloorsAtOneSecond() {
        let now: Date = Date(timeIntervalSince1970: 1_000)
        let range: NotificationSchedulingDelaySecondsRange = notificationSchedulingDelaySecondsRange(
            scheduledAtMillisValues: [
                999_000,
                1_060_000,
                1_360_500
            ],
            now: now
        )

        XCTAssertEqual(range.minDelaySeconds, 1)
        XCTAssertEqual(range.maxDelaySeconds, 361)
    }

    func testAcceptedNotificationPayloadFiltersKeepOnlyPendingReadbackIdentifiers() throws {
        let calendar = makeCalendar()
        let scheduledDates = [
            try XCTUnwrap(makeDate(year: 2026, month: 4, day: 3, hour: 12, minute: 15, calendar: calendar)),
            try XCTUnwrap(makeDate(year: 2026, month: 4, day: 3, hour: 14, minute: 15, calendar: calendar)),
            try XCTUnwrap(makeDate(year: 2026, month: 4, day: 3, hour: 16, minute: 15, calendar: calendar))
        ]
        let reviewPayloads = buildFallbackReviewNotificationPayloads(
            workspaceId: "workspace-1",
            reviewFilter: .allCards,
            scheduledDates: scheduledDates,
            calendar: calendar,
            mode: .daily
        )
        let strictPayloads = buildStrictReminderPayloadsForIncompleteDay(
            dayStart: try XCTUnwrap(makeDate(year: 2026, month: 4, day: 3, hour: 0, minute: 0, calendar: calendar)),
            startOfNextDay: try XCTUnwrap(makeDate(year: 2026, month: 4, day: 4, hour: 0, minute: 0, calendar: calendar)),
            now: try XCTUnwrap(makeDate(year: 2026, month: 4, day: 3, hour: 9, minute: 0, calendar: calendar)),
            calendar: calendar
        )

        XCTAssertEqual(
            acceptedReviewNotificationPayloads(
                payloads: reviewPayloads,
                pendingRequestIdentifiers: [
                    reviewPayloads[0].requestId,
                    "unrelated-request",
                    reviewPayloads[2].requestId
                ]
            )
            .map(\.requestId),
            [
                reviewPayloads[0].requestId,
                reviewPayloads[2].requestId
            ]
        )
        XCTAssertEqual(
            acceptedStrictReminderPayloads(
                payloads: strictPayloads,
                pendingRequestIdentifiers: [
                    strictPayloads[1].requestId,
                    "review-notification::workspace-1::daily::2026-04-03-10-00"
                ]
            )
            .map(\.requestId),
            [
                strictPayloads[1].requestId
            ]
        )
    }
}
