import Foundation
import XCTest
@testable import Flashcards

final class ProgressReviewScheduleRefreshTests: ProgressStoreTestCase {
    @MainActor
    func testRefreshProgressIfNeededPublishesServerReviewScheduleWhenNoPendingCardOverlay() async throws {
        let database = try self.makeDatabase()
        let cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()

        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-18T12:00:00.000Z"))
        let requestRange = try makeTestProgressRequestRange(
            now: now,
            timeZone: TimeZone.current,
            dayCount: 140
        )
        let serverSeries = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [:],
            generatedAt: "2026-04-18T11:59:00.000Z"
        )
        let serverSummary = try makeTestProgressSummary(
            timeZone: requestRange.timeZone,
            reviewDates: [],
            generatedAt: "2026-04-18T11:59:00.000Z"
        )
        let serverReviewSchedule = makeTestReviewSchedule(
            timeZone: requestRange.timeZone,
            countsByBucketKey: [
                .today: 4
            ],
            generatedAt: "2026-04-18T11:59:00.000Z"
        )
        let context = try self.makeProgressStoreContext(
            database: database,
            workspaceId: workspace.workspaceId,
            installationId: cloudSettings.installationId,
            serverSummary: serverSummary,
            serverSeries: serverSeries,
            loadProgressSummaryError: nil,
            loadProgressSeriesError: nil,
            cloudState: .guest
        )
        context.cloudSyncService.serverReviewSchedule = serverReviewSchedule
        defer { context.tearDown() }

        await context.store.refreshProgressIfNeeded(now: now)

        let loadProgressReviewScheduleRequest = try XCTUnwrap(context.cloudSyncService.lastLoadProgressReviewScheduleRequest)
        XCTAssertEqual(context.apiBaseUrl, loadProgressReviewScheduleRequest.apiBaseUrl)
        XCTAssertEqual("Guest guest-token-1", loadProgressReviewScheduleRequest.authorizationHeader)
        XCTAssertEqual(TimeZone.current.identifier, loadProgressReviewScheduleRequest.timeZone)
        let reviewScheduleSnapshot = try XCTUnwrap(context.store.reviewScheduleSnapshot)
        XCTAssertEqual(.serverBase, reviewScheduleSnapshot.sourceState)
        XCTAssertFalse(reviewScheduleSnapshot.isApproximate)
        XCTAssertEqual(4, reviewScheduleSnapshot.schedule.totalCards)
        XCTAssertEqual(4, reviewScheduleCount(snapshot: reviewScheduleSnapshot, key: .today))
        XCTAssertEqual(1, context.cloudSyncService.loadProgressReviewScheduleCallCount)
    }

    @MainActor
    func testReviewScheduleServerRefreshErrorSurvivesSuccessfulLocalRenderUntilServerRefreshSucceeds() async throws {
        let database = try self.makeDatabase()
        let cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()

        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-18T12:00:00.000Z"))
        let requestRange = try makeTestProgressRequestRange(
            now: now,
            timeZone: TimeZone.current,
            dayCount: 140
        )
        let serverSeries = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [:],
            generatedAt: "2026-04-18T11:59:00.000Z"
        )
        let serverSummary = try makeTestProgressSummary(
            timeZone: requestRange.timeZone,
            reviewDates: [],
            generatedAt: "2026-04-18T11:59:00.000Z"
        )
        let context = try self.makeProgressStoreContext(
            database: database,
            workspaceId: workspace.workspaceId,
            installationId: cloudSettings.installationId,
            serverSummary: serverSummary,
            serverSeries: serverSeries,
            loadProgressSummaryError: nil,
            loadProgressSeriesError: nil,
            cloudState: .guest
        )
        defer { context.tearDown() }
        context.cloudSyncService.loadProgressReviewScheduleError = LocalStoreError.validation(
            "Review schedule server refresh failed"
        )

        await context.store.refreshProgressIfNeeded(now: now)

        let localReviewScheduleSnapshot = try XCTUnwrap(context.store.reviewScheduleSnapshot)
        XCTAssertEqual(.localOnly, localReviewScheduleSnapshot.sourceState)
        XCTAssertTrue(
            context.store.progressErrorState.reviewScheduleRefreshMessage.contains(
                "Review schedule server refresh failed"
            )
        )
        XCTAssertTrue(context.store.progressErrorState.reviewScheduleRenderMessage.isEmpty)

        context.cloudSyncService.loadProgressReviewScheduleError = nil
        context.cloudSyncService.serverReviewSchedule = makeTestReviewSchedule(
            timeZone: requestRange.timeZone,
            countsByBucketKey: [
                .today: 4
            ],
            generatedAt: "2026-04-18T12:01:00.000Z"
        )

        await context.store.refreshProgressIfNeeded(now: now)

        let serverReviewScheduleSnapshot = try XCTUnwrap(context.store.reviewScheduleSnapshot)
        XCTAssertEqual(.serverBase, serverReviewScheduleSnapshot.sourceState)
        XCTAssertEqual(4, reviewScheduleCount(snapshot: serverReviewScheduleSnapshot, key: .today))
        XCTAssertTrue(context.store.progressErrorState.reviewScheduleRefreshMessage.isEmpty)
        XCTAssertTrue(context.store.progressErrorState.reviewScheduleRenderMessage.isEmpty)
    }

    @MainActor
    func testRefreshProgressIfNeededRefreshesOnlyReviewScheduleWhenOnlyScheduleIsStale() async throws {
        let database = try self.makeDatabase()
        let cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()

        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-18T12:00:00.000Z"))
        let requestRange = try makeTestProgressRequestRange(
            now: now,
            timeZone: TimeZone.current,
            dayCount: 140
        )
        let serverSeries = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [:],
            generatedAt: "2026-04-18T11:59:00.000Z"
        )
        let serverSummary = try makeTestProgressSummary(
            timeZone: requestRange.timeZone,
            reviewDates: [],
            generatedAt: "2026-04-18T11:59:00.000Z"
        )
        let context = try self.makeProgressStoreContext(
            database: database,
            workspaceId: workspace.workspaceId,
            installationId: cloudSettings.installationId,
            serverSummary: serverSummary,
            serverSeries: serverSeries,
            loadProgressSummaryError: nil,
            loadProgressSeriesError: nil,
            cloudState: .guest
        )
        defer { context.tearDown() }

        await context.store.refreshProgressIfNeeded(now: now)
        XCTAssertEqual(1, context.cloudSyncService.loadProgressSummaryCallCount)
        XCTAssertEqual(1, context.cloudSyncService.loadProgressSeriesCallCount)
        XCTAssertEqual(1, context.cloudSyncService.loadProgressReviewScheduleCallCount)
        let operationCountAfterInitialRefresh = context.cloudSyncService.recordedOperations.count
        let scopeKey = try XCTUnwrap(context.store.progressObservedScopeKey)
        let scheduleScopeKey = reviewScheduleScopeKey(seriesScopeKey: scopeKey)
        context.cloudSyncService.serverReviewSchedule = makeTestReviewSchedule(
            timeZone: requestRange.timeZone,
            countsByBucketKey: [
                .days1To7: 2
            ],
            generatedAt: "2026-04-18T12:00:00.000Z"
        )

        context.store.invalidateProgressReviewSchedule(scopeKey: scheduleScopeKey)
        await context.store.refreshProgressIfNeeded(now: now)

        XCTAssertEqual(1, context.cloudSyncService.loadProgressSummaryCallCount)
        XCTAssertEqual(1, context.cloudSyncService.loadProgressSeriesCallCount)
        XCTAssertEqual(2, context.cloudSyncService.loadProgressReviewScheduleCallCount)
        XCTAssertEqual(operationCountAfterInitialRefresh + 1, context.cloudSyncService.recordedOperations.count)
        let lastOperation = try XCTUnwrap(context.cloudSyncService.recordedOperations.last)
        XCTAssertEqual(.loadProgressReviewSchedule, lastOperation)
        let reviewScheduleSnapshot = try XCTUnwrap(context.store.reviewScheduleSnapshot)
        XCTAssertEqual(.serverBase, reviewScheduleSnapshot.sourceState)
        XCTAssertEqual(2, reviewScheduleCount(snapshot: reviewScheduleSnapshot, key: .days1To7))
    }

    @MainActor
    func testInvalidateProgressReviewScheduleClearsPersistedCacheAcrossRelaunch() async throws {
        let database = try self.makeDatabase()
        let cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()

        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-18T12:00:00.000Z"))
        let requestRange = try makeTestProgressRequestRange(
            now: now,
            timeZone: TimeZone.current,
            dayCount: 140
        )
        let serverSeries = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [:],
            generatedAt: "2026-04-18T11:59:00.000Z"
        )
        let serverSummary = try makeTestProgressSummary(
            timeZone: requestRange.timeZone,
            reviewDates: [],
            generatedAt: "2026-04-18T11:59:00.000Z"
        )
        let serverReviewSchedule = makeTestReviewSchedule(
            timeZone: requestRange.timeZone,
            countsByBucketKey: [
                .today: 4
            ],
            generatedAt: "2026-04-18T11:59:00.000Z"
        )
        let context = try self.makeProgressStoreContext(
            database: database,
            workspaceId: workspace.workspaceId,
            installationId: cloudSettings.installationId,
            serverSummary: serverSummary,
            serverSeries: serverSeries,
            loadProgressSummaryError: nil,
            loadProgressSeriesError: nil,
            cloudState: .guest
        )
        var relaunchedContext: ProgressStoreTestContext?
        defer {
            relaunchedContext?.tearDown()
            context.tearDown()
        }
        context.cloudSyncService.serverReviewSchedule = serverReviewSchedule

        await context.store.refreshProgressIfNeeded(now: now)
        let scopeKey = try XCTUnwrap(context.store.progressObservedScopeKey)
        let scheduleScopeKey = reviewScheduleScopeKey(seriesScopeKey: scopeKey)
        XCTAssertNotNil(context.store.progressReviewScheduleServerBaseCache)
        XCTAssertNotNil(context.store.loadPersistedReviewScheduleServerBase(scopeKey: scheduleScopeKey))

        context.store.invalidateProgressReviewSchedule(scopeKey: scheduleScopeKey)
        XCTAssertNil(context.store.progressReviewScheduleServerBaseCache)
        XCTAssertNil(context.store.loadPersistedReviewScheduleServerBase(scopeKey: scheduleScopeKey))
        context.store.shutdownForTests()

        let reloadedContext = try self.makeProgressStoreContext(
            database: database,
            workspaceId: workspace.workspaceId,
            installationId: cloudSettings.installationId,
            serverSummary: serverSummary,
            serverSeries: serverSeries,
            loadProgressSummaryError: nil,
            loadProgressSeriesError: nil,
            cloudState: .guest,
            suiteName: context.suiteName,
            userDefaults: context.userDefaults
        )
        relaunchedContext = reloadedContext

        _ = try reloadedContext.store.prepareProgressSnapshot(now: now)

        XCTAssertNil(reloadedContext.store.progressReviewScheduleServerBaseCache)
        let reviewScheduleSnapshot = try XCTUnwrap(reloadedContext.store.reviewScheduleSnapshot)
        XCTAssertEqual(.localOnly, reviewScheduleSnapshot.sourceState)
        XCTAssertEqual(0, reviewScheduleSnapshot.schedule.totalCards)
    }

    @MainActor
    func testPrepareProgressSnapshotKeepsProgressWhenReviewSchedulePublishFails() async throws {
        let database = try self.makeDatabase()
        let cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()

        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-18T12:00:00.000Z"))
        let requestRange = try makeTestProgressRequestRange(
            now: now,
            timeZone: TimeZone.current,
            dayCount: 140
        )
        let serverSeries = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [
                "2026-04-17": 2
            ],
            generatedAt: "2026-04-18T11:59:00.000Z"
        )
        let serverSummary = try makeTestProgressSummary(
            timeZone: requestRange.timeZone,
            reviewDates: ["2026-04-17"],
            generatedAt: "2026-04-18T11:59:00.000Z"
        )
        let context = try self.makeProgressStoreContext(
            database: database,
            workspaceId: workspace.workspaceId,
            installationId: cloudSettings.installationId,
            serverSummary: serverSummary,
            serverSeries: serverSeries,
            loadProgressSummaryError: nil,
            loadProgressSeriesError: nil,
            cloudState: .guest
        )
        defer { context.tearDown() }

        await context.store.refreshProgressIfNeeded(now: now)
        let initialProgressSnapshot = try XCTUnwrap(context.store.progressSnapshot)
        let scheduleScopeKey = reviewScheduleScopeKey(seriesScopeKey: initialProgressSnapshot.scopeKey)
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
        try database.core.execute(
            sql: """
            UPDATE cards
            SET due_at = ?, due_at_millis = NULL
            WHERE workspace_id = ? AND card_id = ?
            """,
            values: [
                .text("2026-04-18T08:00:00.000Z"),
                .text(workspace.workspaceId),
                .text(card.cardId),
            ]
        )

        // Two caches need to be invalidated to force a fresh local-fallback
        // evaluation:
        //   1. handleReviewScheduleLocalCardStateDidChange bumps the local
        //      revision so the local-fallback cache key (keyed on
        //      progressReviewScheduleLocalRevision) misses. Direct SQL
        //      bypasses saveCard, which is the production path that fires
        //      this hook; we mirror it explicitly here.
        //   2. invalidateProgressReviewSchedule drops the server-base cache
        //      and persisted server snapshot for this scope, ensuring the
        //      next prepare falls back to the local computation we want to
        //      surface as an error.
        context.store.handleReviewScheduleLocalCardStateDidChange(now: now)
        context.store.invalidateProgressReviewSchedule(scopeKey: scheduleScopeKey)
        XCTAssertNoThrow(try context.store.prepareProgressSnapshot(now: now))

        let progressSnapshot = try XCTUnwrap(context.store.progressSnapshot)
        XCTAssertEqual(initialProgressSnapshot.scopeKey, progressSnapshot.scopeKey)
        XCTAssertEqual(2, progressReviewCount(snapshot: progressSnapshot, localDate: "2026-04-17"))
        XCTAssertNil(context.store.reviewScheduleSnapshot)
        XCTAssertTrue(context.store.progressErrorState.generalMessage.isEmpty)
        XCTAssertTrue(context.store.progressErrorState.summaryRefreshMessage.isEmpty)
        XCTAssertTrue(context.store.progressErrorState.seriesRefreshMessage.isEmpty)
        XCTAssertTrue(context.store.progressErrorState.reviewScheduleRefreshMessage.isEmpty)
        XCTAssertTrue(
            context.store.progressErrorState.reviewScheduleRenderMessage.contains(
                "Review schedule cannot bucket 1 active cards"
            )
        )
    }

    @MainActor
    func testReviewScheduleServerBaseRenderDoesNotLoadBrokenLocalFallbackWithoutPendingOverlay() async throws {
        let database = try self.makeDatabase()
        let cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()

        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-18T12:00:00.000Z"))
        let requestRange = try makeTestProgressRequestRange(
            now: now,
            timeZone: TimeZone.current,
            dayCount: 140
        )
        let serverSeries = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [:],
            generatedAt: "2026-04-18T11:59:00.000Z"
        )
        let serverSummary = try makeTestProgressSummary(
            timeZone: requestRange.timeZone,
            reviewDates: [],
            generatedAt: "2026-04-18T11:59:00.000Z"
        )
        let serverReviewSchedule = makeTestReviewSchedule(
            timeZone: requestRange.timeZone,
            countsByBucketKey: [
                .today: 4
            ],
            generatedAt: "2026-04-18T11:59:00.000Z"
        )
        let context = try self.makeProgressStoreContext(
            database: database,
            workspaceId: workspace.workspaceId,
            installationId: cloudSettings.installationId,
            serverSummary: serverSummary,
            serverSeries: serverSeries,
            loadProgressSummaryError: nil,
            loadProgressSeriesError: nil,
            cloudState: .guest
        )
        defer { context.tearDown() }
        context.cloudSyncService.serverReviewSchedule = serverReviewSchedule

        await context.store.refreshProgressIfNeeded(now: now)
        let scopeKey = try XCTUnwrap(context.store.progressObservedScopeKey)
        let scheduleScopeKey = reviewScheduleScopeKey(seriesScopeKey: scopeKey)
        let card = try self.addNewReviewScheduleCard(
            database: database,
            workspaceId: workspace.workspaceId
        )
        try self.markReviewScheduleCardWithInvalidDueAt(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: card.cardId
        )
        let outboxEntries = try database.loadOutboxEntries(
            workspaceId: workspace.workspaceId,
            limit: Int.max
        )
        try database.deleteOutboxEntries(operationIds: outboxEntries.map(\.operationId))

        XCTAssertNoThrow(try context.store.publishReviewScheduleSnapshot(scopeKey: scheduleScopeKey))

        let reviewScheduleSnapshot = try XCTUnwrap(context.store.reviewScheduleSnapshot)
        XCTAssertEqual(.serverBase, reviewScheduleSnapshot.sourceState)
        XCTAssertFalse(reviewScheduleSnapshot.isApproximate)
        XCTAssertEqual(4, reviewScheduleSnapshot.schedule.totalCards)
        XCTAssertEqual(4, reviewScheduleCount(snapshot: reviewScheduleSnapshot, key: .today))
        XCTAssertTrue(context.store.progressErrorState.reviewScheduleRenderMessage.isEmpty)
    }
}
