import Foundation
import XCTest
@testable import Flashcards

final class ReviewNotificationsSupportTests: XCTestCase {
    func testDefaultReviewNotificationsSettingsStartEnabled() {
        let settings = makeDefaultReviewNotificationsSettings()

        XCTAssertTrue(settings.isEnabled)
        XCTAssertEqual(settings.selectedMode, .daily)
        XCTAssertEqual(settings.daily.hour, defaultDailyReminderHour)
        XCTAssertEqual(settings.daily.minute, defaultDailyReminderMinute)
    }

    func testLoadReviewNotificationsSettingsDefaultsToEnabledWhenUnset() {
        let suiteName = "ReviewNotificationsSupportTests-\(UUID().uuidString)"
        guard let userDefaults = UserDefaults(suiteName: suiteName) else {
            XCTFail("Expected isolated UserDefaults suite")
            return
        }
        defer {
            userDefaults.removePersistentDomain(forName: suiteName)
        }

        let settings = loadReviewNotificationsSettings(
            userDefaults: userDefaults,
            decoder: JSONDecoder(),
            workspaceId: "workspace-1"
        )

        XCTAssertTrue(settings.isEnabled)
        XCTAssertEqual(settings.selectedMode, .daily)
    }

    func testLoadReviewNotificationsSettingsPreservesPersistedDisabledChoice() throws {
        let suiteName = "ReviewNotificationsSupportTests-\(UUID().uuidString)"
        guard let userDefaults = UserDefaults(suiteName: suiteName) else {
            XCTFail("Expected isolated UserDefaults suite")
            return
        }
        defer {
            userDefaults.removePersistentDomain(forName: suiteName)
        }

        let workspaceId = "workspace-1"
        let disabledSettings = ReviewNotificationsSettings(
            isEnabled: false,
            selectedMode: .inactivity,
            daily: DailyReviewNotificationsSettings(
                hour: defaultDailyReminderHour,
                minute: defaultDailyReminderMinute
            ),
            inactivity: InactivityReviewNotificationsSettings(
                windowStartHour: 9,
                windowStartMinute: 0,
                windowEndHour: 19,
                windowEndMinute: 0,
                idleMinutes: 60
            ),
            showAppIconBadge: true
        )

        let persistedData = try JSONEncoder().encode(disabledSettings)
        userDefaults.set(
            persistedData,
            forKey: makeReviewNotificationsSettingsUserDefaultsKey(workspaceId: workspaceId)
        )

        let loadedSettings = loadReviewNotificationsSettings(
            userDefaults: userDefaults,
            decoder: JSONDecoder(),
            workspaceId: workspaceId
        )

        XCTAssertEqual(loadedSettings, disabledSettings)
    }

    func testDefaultStrictRemindersSettingsStartEnabled() {
        let settings = makeDefaultStrictRemindersSettings()

        XCTAssertTrue(settings.isEnabled)
    }

    func testStrictReminderNotificationScopePersistsAndValidatesCurrentNotification() {
        let suiteName = "ReviewNotificationsSupportTests-\(UUID().uuidString)"
        guard let userDefaults = UserDefaults(suiteName: suiteName) else {
            XCTFail("Expected isolated UserDefaults suite")
            return
        }
        defer {
            userDefaults.removePersistentDomain(forName: suiteName)
        }

        let scope = loadStrictReminderNotificationScope(userDefaults: userDefaults)
        let userInfo = buildStrictReminderNotificationUserInfo(scope: scope)

        XCTAssertFalse(scope.isEmpty)
        XCTAssertEqual(loadStrictReminderNotificationScope(userDefaults: userDefaults), scope)
        XCTAssertTrue(isCurrentStrictReminderNotification(userInfo: userInfo, userDefaults: userDefaults))
    }

    func testStrictReminderNotificationScopeRejectsMissingOrRotatedScope() {
        let suiteName = "ReviewNotificationsSupportTests-\(UUID().uuidString)"
        guard let userDefaults = UserDefaults(suiteName: suiteName) else {
            XCTFail("Expected isolated UserDefaults suite")
            return
        }
        defer {
            userDefaults.removePersistentDomain(forName: suiteName)
        }

        let initialScope = loadStrictReminderNotificationScope(userDefaults: userDefaults)
        let initialUserInfo = buildStrictReminderNotificationUserInfo(scope: initialScope)

        XCTAssertFalse(
            isCurrentStrictReminderNotification(
                userInfo: [appNotificationTapTypeUserInfoKey: AppNotificationTapType.strictReminder.rawValue],
                userDefaults: userDefaults
            )
        )

        rotateStrictReminderNotificationScope(userDefaults: userDefaults)

        XCTAssertFalse(isCurrentStrictReminderNotification(userInfo: initialUserInfo, userDefaults: userDefaults))
    }

    func testShouldRemoveStrictReminderNotificationMatchesOnlyLegacyOrCapturedScope() {
        let oldScope = "old-scope"
        let newScope = "new-scope"

        XCTAssertTrue(
            shouldRemoveStrictReminderNotification(
                userInfo: buildStrictReminderNotificationUserInfo(scope: oldScope),
                removalScope: oldScope
            )
        )
        XCTAssertTrue(
            shouldRemoveStrictReminderNotification(
                userInfo: [appNotificationTapTypeUserInfoKey: AppNotificationTapType.strictReminder.rawValue],
                removalScope: oldScope
            )
        )
        XCTAssertFalse(
            shouldRemoveStrictReminderNotification(
                userInfo: buildStrictReminderNotificationUserInfo(scope: newScope),
                removalScope: oldScope
            )
        )
        XCTAssertFalse(
            shouldRemoveStrictReminderNotification(
                userInfo: [appNotificationTapTypeUserInfoKey: AppNotificationTapType.reviewReminder.rawValue],
                removalScope: oldScope
            )
        )
    }

    func testStrictReminderRemovalScopesRemoveCurrentScopeAndLegacyPayloads() {
        XCTAssertEqual(
            strictReminderRemovalScopes(currentScope: "current-scope"),
            ["current-scope", nil]
        )
        XCTAssertEqual(
            strictReminderRemovalScopes(currentScope: nil),
            [nil]
        )
        XCTAssertEqual(
            strictReminderRemovalScopes(currentScope: ""),
            [nil]
        )
    }

    func testMakeStrictRemindersReconcileRequestCarriesClearDeliveredFlagFromTrigger() throws {
        let calendar = makeCalendar()
        let now = try XCTUnwrap(makeDate(year: 2026, month: 4, day: 3, hour: 21, minute: 5, calendar: calendar))

        XCTAssertEqual(
            makeStrictRemindersReconcileRequest(trigger: .appActive, now: now),
            StrictRemindersReconcileRequest(
                now: now,
                shouldClearDeliveredStrictReminders: true
            )
        )
        XCTAssertEqual(
            makeStrictRemindersReconcileRequest(trigger: .reviewRecorded, now: now),
            StrictRemindersReconcileRequest(
                now: now,
                shouldClearDeliveredStrictReminders: false
            )
        )
    }

    func testMergeStrictRemindersReconcileRequestsKeepsLatestNowAndPendingDeliveredClear() throws {
        let calendar = makeCalendar()
        let earlierNow = try XCTUnwrap(makeDate(year: 2026, month: 4, day: 3, hour: 21, minute: 5, calendar: calendar))
        let laterNow = try XCTUnwrap(makeDate(year: 2026, month: 4, day: 3, hour: 21, minute: 6, calendar: calendar))

        let mergedRequest = mergeStrictRemindersReconcileRequests(
            pendingRequest: StrictRemindersReconcileRequest(
                now: earlierNow,
                shouldClearDeliveredStrictReminders: true
            ),
            nextRequest: StrictRemindersReconcileRequest(
                now: laterNow,
                shouldClearDeliveredStrictReminders: false
            )
        )

        XCTAssertEqual(
            mergedRequest,
            StrictRemindersReconcileRequest(
                now: laterNow,
                shouldClearDeliveredStrictReminders: true
            )
        )
    }

    func testResolveStrictReminderCompletedDayResolutionIncludesImportedCurrentDayReview() async throws {
        let suiteName = "ReviewNotificationsSupportTests-\(UUID().uuidString)"
        guard let userDefaults = UserDefaults(suiteName: suiteName) else {
            XCTFail("Expected isolated UserDefaults suite")
            return
        }
        let (database, databaseURL) = try makeTemporaryLocalDatabase()
        defer {
            userDefaults.removePersistentDomain(forName: suiteName)
            try? database.close()
            try? removeTemporaryDatabase(at: databaseURL)
        }

        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let card = try database.saveCard(
            workspaceId: workspace.workspaceId,
            input: CardEditorInput(
                frontText: "Question",
                backText: "Answer",
                tags: [],
                effortLevel: .medium
            ),
            cardId: nil
        )
        let calendar = makeCalendar()
        let reviewedAt = try XCTUnwrap(makeDate(year: 2026, month: 4, day: 3, hour: 10, minute: 15, calendar: calendar))
        let now = try XCTUnwrap(makeDate(year: 2026, month: 4, day: 3, hour: 21, minute: 5, calendar: calendar))

        _ = try database.submitReview(
            workspaceId: workspace.workspaceId,
            reviewSubmission: ReviewSubmission(
                cardId: card.cardId,
                rating: .good,
                reviewedAtClient: formatIsoTimestamp(date: reviewedAt)
            )
        )

        let resolution = resolveStrictReminderCompletedDayResolution(
            persistedCompletedDayStartMillis: loadStrictReminderCompletedDayStartMillis(
                userDefaults: userDefaults,
                now: now,
                calendar: calendar
            ),
            importedCompletedDayStartMillis: try await loadStrictReminderImportedCompletedDayStartMillis(
                databaseURL: databaseURL,
                now: now,
                calendar: calendar
            ),
            prefersImportedCurrentDayCompletion: true
        )

        XCTAssertEqual(
            resolution.completedDayStartMillis,
            [strictReminderDayStartMillis(date: calendar.startOfDay(for: now))]
        )
        XCTAssertTrue(resolution.shouldPersistImportedCompletion)
        XCTAssertFalse(resolution.shouldClearPersistedCompletion)
    }

    func testResolveStrictReminderCompletedDayResolutionDoesNotRePersistExistingCurrentDayCompletion() async throws {
        let suiteName = "ReviewNotificationsSupportTests-\(UUID().uuidString)"
        guard let userDefaults = UserDefaults(suiteName: suiteName) else {
            XCTFail("Expected isolated UserDefaults suite")
            return
        }
        let (database, databaseURL) = try makeTemporaryLocalDatabase()
        defer {
            userDefaults.removePersistentDomain(forName: suiteName)
            try? database.close()
            try? removeTemporaryDatabase(at: databaseURL)
        }

        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let card = try database.saveCard(
            workspaceId: workspace.workspaceId,
            input: CardEditorInput(
                frontText: "Question",
                backText: "Answer",
                tags: [],
                effortLevel: .medium
            ),
            cardId: nil
        )
        let calendar = makeCalendar()
        let reviewedAt = try XCTUnwrap(makeDate(year: 2026, month: 4, day: 3, hour: 10, minute: 15, calendar: calendar))
        let now = try XCTUnwrap(makeDate(year: 2026, month: 4, day: 3, hour: 21, minute: 5, calendar: calendar))

        persistStrictReminderLastReviewedAt(
            userDefaults: userDefaults,
            reviewedAt: reviewedAt
        )
        _ = try database.submitReview(
            workspaceId: workspace.workspaceId,
            reviewSubmission: ReviewSubmission(
                cardId: card.cardId,
                rating: .good,
                reviewedAtClient: formatIsoTimestamp(date: reviewedAt)
            )
        )

        let resolution = resolveStrictReminderCompletedDayResolution(
            persistedCompletedDayStartMillis: loadStrictReminderCompletedDayStartMillis(
                userDefaults: userDefaults,
                now: now,
                calendar: calendar
            ),
            importedCompletedDayStartMillis: try await loadStrictReminderImportedCompletedDayStartMillis(
                databaseURL: databaseURL,
                now: now,
                calendar: calendar
            ),
            prefersImportedCurrentDayCompletion: true
        )

        XCTAssertEqual(
            resolution.completedDayStartMillis,
            [strictReminderDayStartMillis(date: calendar.startOfDay(for: now))]
        )
        XCTAssertFalse(resolution.shouldPersistImportedCompletion)
        XCTAssertFalse(resolution.shouldClearPersistedCompletion)
    }

    func testResolveStrictReminderCompletedDayResolutionClearsStalePersistedCurrentDayCompletionWhenDatabaseHasNoReviewRows() async throws {
        let suiteName = "ReviewNotificationsSupportTests-\(UUID().uuidString)"
        guard let userDefaults = UserDefaults(suiteName: suiteName) else {
            XCTFail("Expected isolated UserDefaults suite")
            return
        }
        let (database, databaseURL) = try makeTemporaryLocalDatabase()
        defer {
            userDefaults.removePersistentDomain(forName: suiteName)
            try? database.close()
            try? removeTemporaryDatabase(at: databaseURL)
        }

        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let card = try database.saveCard(
            workspaceId: workspace.workspaceId,
            input: CardEditorInput(
                frontText: "Question",
                backText: "Answer",
                tags: [],
                effortLevel: .medium
            ),
            cardId: nil
        )
        let calendar = makeCalendar()
        let reviewedAt = try XCTUnwrap(makeDate(year: 2026, month: 4, day: 3, hour: 10, minute: 15, calendar: calendar))
        let now = try XCTUnwrap(makeDate(year: 2026, month: 4, day: 3, hour: 21, minute: 5, calendar: calendar))

        persistStrictReminderLastReviewedAt(
            userDefaults: userDefaults,
            reviewedAt: reviewedAt
        )
        _ = try database.submitReview(
            workspaceId: workspace.workspaceId,
            reviewSubmission: ReviewSubmission(
                cardId: card.cardId,
                rating: .good,
                reviewedAtClient: formatIsoTimestamp(date: reviewedAt)
            )
        )
        _ = try database.core.execute(
            sql: "DELETE FROM review_events WHERE workspace_id = ?",
            values: [.text(workspace.workspaceId)]
        )

        let resolution = resolveStrictReminderCompletedDayResolution(
            persistedCompletedDayStartMillis: loadStrictReminderCompletedDayStartMillis(
                userDefaults: userDefaults,
                now: now,
                calendar: calendar
            ),
            importedCompletedDayStartMillis: try await loadStrictReminderImportedCompletedDayStartMillis(
                databaseURL: databaseURL,
                now: now,
                calendar: calendar
            ),
            prefersImportedCurrentDayCompletion: true
        )

        XCTAssertEqual(resolution.completedDayStartMillis, [])
        XCTAssertFalse(resolution.shouldPersistImportedCompletion)
        XCTAssertTrue(resolution.shouldClearPersistedCompletion)
    }

    func testLoadStrictReminderCompletedDayStartMillisUsesPersistedReviewWithinCurrentLocalDay() throws {
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
        let expectedDayStart = try XCTUnwrap(makeDate(year: 2026, month: 4, day: 3, hour: 0, minute: 0, calendar: calendar))

        persistStrictReminderLastReviewedAt(
            userDefaults: userDefaults,
            reviewedAt: reviewedAt
        )

        XCTAssertEqual(
            loadStrictReminderCompletedDayStartMillis(
                userDefaults: userDefaults,
                now: now,
                calendar: calendar
            ),
            [strictReminderDayStartMillis(date: expectedDayStart)]
        )
    }

    func testLoadStrictReminderCompletedDayStartMillisIgnoresPersistedReviewOutsideCurrentLocalDay() throws {
        let suiteName = "ReviewNotificationsSupportTests-\(UUID().uuidString)"
        guard let userDefaults = UserDefaults(suiteName: suiteName) else {
            XCTFail("Expected isolated UserDefaults suite")
            return
        }
        defer {
            userDefaults.removePersistentDomain(forName: suiteName)
        }

        let calendar = makeCalendar()
        let reviewedAt = try XCTUnwrap(makeDate(year: 2026, month: 4, day: 2, hour: 23, minute: 30, calendar: calendar))
        let now = try XCTUnwrap(makeDate(year: 2026, month: 4, day: 3, hour: 21, minute: 5, calendar: calendar))

        persistStrictReminderLastReviewedAt(
            userDefaults: userDefaults,
            reviewedAt: reviewedAt
        )

        XCTAssertEqual(
            loadStrictReminderCompletedDayStartMillis(
                userDefaults: userDefaults,
                now: now,
                calendar: calendar
            ),
            []
        )
    }

    func testClearStoredStrictRemindersRemovesCompletionAndScheduledPayloads() throws {
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
        let payload = ScheduledStrictReminderPayload(
            dayStartMillis: strictReminderDayStartMillis(
                date: calendar.startOfDay(for: now)
            ),
            scheduledAtMillis: Int64(now.timeIntervalSince1970 * 1_000),
            offset: .twoHours,
            requestId: "strict-reminder::2h::2026-04-03-22-00"
        )

        persistStrictReminderLastReviewedAt(
            userDefaults: userDefaults,
            reviewedAt: reviewedAt
        )
        let payloadData = try JSONEncoder().encode([payload])
        userDefaults.set(payloadData, forKey: strictReminderScheduledPayloadsUserDefaultsKey)

        clearStoredStrictReminders(userDefaults: userDefaults)

        XCTAssertEqual(
            loadStrictReminderCompletedDayStartMillis(
                userDefaults: userDefaults,
                now: now,
                calendar: calendar
            ),
            []
        )
        XCTAssertEqual(
            loadScheduledStrictReminders(
                userDefaults: userDefaults,
                decoder: JSONDecoder()
            ),
            []
        )
        XCTAssertNil(userDefaults.object(forKey: strictReminderLastReviewedAtUserDefaultsKey))
        XCTAssertNil(userDefaults.object(forKey: strictReminderScheduledPayloadsUserDefaultsKey))
    }

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

    func testParseAppNotificationTapRequestRecognizesStrictReminder() {
        let request = parseAppNotificationTapRequest(
            userInfo: [appNotificationTapTypeUserInfoKey: AppNotificationTapType.strictReminder.rawValue]
        )

        XCTAssertEqual(request, .openStrictReminder)
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

private func makeTemporaryLocalDatabase() throws -> (database: LocalDatabase, databaseURL: URL) {
    let databaseDirectory = FileManager.default.temporaryDirectory
        .appendingPathComponent(UUID().uuidString.lowercased(), isDirectory: true)
    try FileManager.default.createDirectory(
        at: databaseDirectory,
        withIntermediateDirectories: true,
        attributes: nil
    )
    let databaseURL = databaseDirectory.appendingPathComponent("flashcards.sqlite", isDirectory: false)
    return (try LocalDatabase(databaseURL: databaseURL), databaseURL)
}

private func removeTemporaryDatabase(at databaseURL: URL) throws {
    try FileManager.default.removeItem(at: databaseURL.deletingLastPathComponent())
}

private extension PersistedReviewFilter {
    static let allCards = PersistedReviewFilter(kind: .allCards, deckId: nil, effortLevel: nil, tag: nil)
}
