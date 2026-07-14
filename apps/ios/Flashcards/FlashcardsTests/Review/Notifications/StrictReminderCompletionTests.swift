import Foundation
import XCTest
@testable import Flashcards

final class StrictReminderCompletionTests: ReviewNotificationsTestCase {
    func testMakeStrictRemindersReconcileRequestCarriesClearDeliveredFlagFromTrigger() throws {
        let calendar = makeCalendar()
        let now = try XCTUnwrap(makeDate(year: 2026, month: 4, day: 3, hour: 21, minute: 5, calendar: calendar))

        XCTAssertEqual(
            makeStrictRemindersReconcileRequest(
                trigger: .appActive,
                now: now,
                shouldClearDeliveredStrictReminders: false
            ),
            StrictRemindersReconcileRequest(
                now: now,
                triggers: [.appActive],
                shouldClearDeliveredStrictReminders: true
            )
        )
        XCTAssertEqual(
            makeStrictRemindersReconcileRequest(
                trigger: .reviewRecorded,
                now: now,
                shouldClearDeliveredStrictReminders: false
            ),
            StrictRemindersReconcileRequest(
                now: now,
                triggers: [.reviewRecorded],
                shouldClearDeliveredStrictReminders: false
            )
        )
        XCTAssertEqual(
            makeStrictRemindersReconcileRequest(
                trigger: .workspaceChanged,
                now: now,
                shouldClearDeliveredStrictReminders: false
            ),
            StrictRemindersReconcileRequest(
                now: now,
                triggers: [.workspaceChanged],
                shouldClearDeliveredStrictReminders: true
            )
        )
        XCTAssertTrue(
            makeStrictRemindersReconcileRequest(
                trigger: .settingsChanged,
                now: now,
                shouldClearDeliveredStrictReminders: true
            ).shouldClearDeliveredStrictReminders
        )
    }

    func testMergeStrictRemindersReconcileRequestsKeepsLatestNowAndPendingDeliveredClear() throws {
        let calendar = makeCalendar()
        let earlierNow = try XCTUnwrap(makeDate(year: 2026, month: 4, day: 3, hour: 21, minute: 5, calendar: calendar))
        let laterNow = try XCTUnwrap(makeDate(year: 2026, month: 4, day: 3, hour: 21, minute: 6, calendar: calendar))

        let mergedRequest = mergeStrictRemindersReconcileRequests(
            pendingRequest: StrictRemindersReconcileRequest(
                now: earlierNow,
                triggers: [.appActive],
                shouldClearDeliveredStrictReminders: true
            ),
            nextRequest: StrictRemindersReconcileRequest(
                now: laterNow,
                triggers: [.reviewRecorded],
                shouldClearDeliveredStrictReminders: false
            )
        )

        XCTAssertEqual(
            mergedRequest,
            StrictRemindersReconcileRequest(
                now: laterNow,
                triggers: [.appActive, .reviewRecorded],
                shouldClearDeliveredStrictReminders: true
            )
        )
        XCTAssertEqual(
            strictRemindersReconcileTriggerDiagnosticValue(triggers: mergedRequest.triggers),
            "app_active+review_recorded"
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
            ),
            cardId: nil,
            mediaAssetIdsReadyForUpload: []
        )
        let calendar = makeCalendar()
        let reviewedAt = try XCTUnwrap(makeDate(year: 2026, month: 4, day: 3, hour: 10, minute: 15, calendar: calendar))
        let now = try XCTUnwrap(makeDate(year: 2026, month: 4, day: 3, hour: 21, minute: 5, calendar: calendar))

        _ = try database.submitReview(
            workspaceId: workspace.workspaceId,
            reviewSubmission: ReviewSubmission(
                cardId: card.cardId,
                rating: .good,
                reviewedAtClient: formatIsoTimestamp(date: reviewedAt),
                reviewedTimeZone: "UTC"
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
                workspaceId: workspace.workspaceId,
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
        XCTAssertEqual(
            try await loadStrictReminderImportedCompletedDayStartMillis(
                databaseURL: databaseURL,
                workspaceId: "workspace-without-review",
                now: now,
                calendar: calendar
            ),
            []
        )
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
            ),
            cardId: nil,
            mediaAssetIdsReadyForUpload: []
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
                reviewedAtClient: formatIsoTimestamp(date: reviewedAt),
                reviewedTimeZone: "UTC"
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
                workspaceId: workspace.workspaceId,
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
            ),
            cardId: nil,
            mediaAssetIdsReadyForUpload: []
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
                reviewedAtClient: formatIsoTimestamp(date: reviewedAt),
                reviewedTimeZone: "UTC"
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
                workspaceId: workspace.workspaceId,
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
}
