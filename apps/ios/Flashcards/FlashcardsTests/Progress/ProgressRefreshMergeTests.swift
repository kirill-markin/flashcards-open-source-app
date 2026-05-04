import Foundation
import XCTest
@testable import Flashcards

final class ProgressRefreshMergeTests: ProgressStoreTestCase {
    @MainActor
    func testRefreshProgressIfNeededMergesServerBaseWithPendingLocalOverlayWithoutSync() async throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        try self.addReviewedCard(
            database: database,
            workspaceId: workspace.workspaceId,
            reviewedAtClient: "2026-04-02T15:50:57.000Z"
        )

        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-18T12:00:00.000Z"))
        let requestRange = try makeTestProgressRequestRange(
            now: now,
            timeZone: TimeZone.current,
            dayCount: 140
        )
        let serverSeries = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [
                "2026-04-01": 2
            ],
            generatedAt: "2026-04-18T11:59:00.000Z"
        )
        let serverSummary = try makeTestProgressSummary(
            timeZone: requestRange.timeZone,
            reviewDates: ["2026-04-01"],
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
        await context.store.refreshProgressIfNeeded(now: now)

        let loadProgressSummaryRequest = try XCTUnwrap(context.cloudSyncService.lastLoadProgressSummaryRequest)
        XCTAssertEqual(context.apiBaseUrl, loadProgressSummaryRequest.apiBaseUrl)
        XCTAssertEqual("Guest guest-token-1", loadProgressSummaryRequest.authorizationHeader)
        XCTAssertEqual(TimeZone.current.identifier, loadProgressSummaryRequest.timeZone)
        let loadProgressSeriesRequest = try XCTUnwrap(context.cloudSyncService.lastLoadProgressSeriesRequest)
        XCTAssertEqual(context.apiBaseUrl, loadProgressSeriesRequest.apiBaseUrl)
        XCTAssertEqual("Guest guest-token-1", loadProgressSeriesRequest.authorizationHeader)
        XCTAssertEqual(TimeZone.current.identifier, loadProgressSeriesRequest.timeZone)
        XCTAssertEqual(requestRange.from, loadProgressSeriesRequest.from)
        XCTAssertEqual(requestRange.to, loadProgressSeriesRequest.to)
        XCTAssertEqual(3, context.cloudSyncService.recordedOperations.count)
        XCTAssertTrue(context.cloudSyncService.recordedOperations.contains(.loadProgressSummary))
        XCTAssertTrue(context.cloudSyncService.recordedOperations.contains(.loadProgressSeries))
        XCTAssertTrue(context.cloudSyncService.recordedOperations.contains(.loadProgressReviewSchedule))
        let progressSnapshot = try XCTUnwrap(context.store.progressSnapshot)
        XCTAssertEqual(.serverBaseWithPendingLocalOverlay, progressSnapshot.summarySourceState)
        XCTAssertEqual(.serverBaseWithPendingLocalOverlay, progressSnapshot.seriesSourceState)
        XCTAssertFalse(progressSnapshot.isApproximate)
        XCTAssertEqual(1, progressSnapshot.summary.activeReviewDays)
        XCTAssertFalse(progressSnapshot.summary.hasReviewedToday)
        XCTAssertEqual("2026-04-02", progressSnapshot.summary.lastReviewedOn)
        XCTAssertEqual(1, context.cloudSyncService.loadProgressSummaryCallCount)
        XCTAssertEqual(1, context.cloudSyncService.loadProgressSeriesCallCount)
    }

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
    func testInvalidateProgressSummaryAndSeriesRecomputesAggregateRefreshingState() async throws {
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

        let scopeKey = try context.store.prepareProgressScope(now: now)
        context.store.isProgressSummaryRefreshing = true
        context.store.isProgressSeriesRefreshing = true
        context.store.isProgressReviewScheduleRefreshing = false
        context.store.updateProgressRefreshingState()

        XCTAssertTrue(context.store.isProgressRefreshing)

        context.store.invalidateProgressSummaryAndSeries(
            scopeKey: scopeKey,
            summaryScopeKey: progressSummaryScopeKey(seriesScopeKey: scopeKey)
        )

        XCTAssertFalse(context.store.isProgressSummaryRefreshing)
        XCTAssertFalse(context.store.isProgressSeriesRefreshing)
        XCTAssertFalse(context.store.isProgressRefreshing)
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

    @MainActor
    func testLinkedReviewSchedulePendingOverlayUsesCompleteHydratedLocalCoverage() async throws {
        let database = try self.makeDatabase()
        let cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-18T12:00:00.000Z"))
        let dueToday = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-18T08:00:00.000Z"))
        for _ in 0..<4 {
            _ = try self.addDueReviewScheduleCard(
                database: database,
                workspaceId: workspace.workspaceId,
                dueAt: dueToday
            )
        }
        let outboxEntries = try database.loadOutboxEntries(
            workspaceId: workspace.workspaceId,
            limit: Int.max
        )
        try database.deleteOutboxEntries(operationIds: outboxEntries.map(\.operationId))
        try database.setHasHydratedHotState(
            workspaceId: workspace.workspaceId,
            hasHydratedHotState: true
        )

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
            cloudState: .linked
        )
        defer { context.tearDown() }
        context.cloudSyncService.serverReviewSchedule = serverReviewSchedule
        let linkedUserId = try XCTUnwrap(context.store.cloudSettings?.linkedUserId)
        context.store.cloudRuntime.setActiveCloudSession(
            linkedSession: CloudLinkedSession(
                userId: linkedUserId,
                workspaceId: workspace.workspaceId,
                email: nil,
                configurationMode: .official,
                apiBaseUrl: context.apiBaseUrl,
                authorization: .bearer("id-token-1")
            )
        )

        await context.store.refreshProgressIfNeeded(now: now)
        context.store.updateCurrentVisibleTab(tab: .progress)
        _ = try self.addNewReviewScheduleCard(
            database: database,
            workspaceId: workspace.workspaceId
        )

        context.store.handleReviewScheduleLocalCardStateDidChange(now: now)

        let reviewScheduleSnapshot = try XCTUnwrap(context.store.reviewScheduleSnapshot)
        XCTAssertEqual(.serverBaseWithPendingLocalOverlay, reviewScheduleSnapshot.sourceState)
        XCTAssertTrue(reviewScheduleSnapshot.isApproximate)
        XCTAssertEqual(5, reviewScheduleSnapshot.schedule.totalCards)
        XCTAssertEqual(1, reviewScheduleCount(snapshot: reviewScheduleSnapshot, key: .new))
        XCTAssertEqual(4, reviewScheduleCount(snapshot: reviewScheduleSnapshot, key: .today))
    }

    @MainActor
    func testLinkedReviewSchedulePendingOverlayKeepsServerBaseWhenLocalTotalDeltaDoesNotReconcile() async throws {
        let database = try self.makeDatabase()
        let cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-18T12:00:00.000Z"))
        try database.setHasHydratedHotState(
            workspaceId: workspace.workspaceId,
            hasHydratedHotState: true
        )

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
            cloudState: .linked
        )
        defer { context.tearDown() }
        context.cloudSyncService.serverReviewSchedule = serverReviewSchedule
        let linkedUserId = try XCTUnwrap(context.store.cloudSettings?.linkedUserId)
        context.store.cloudRuntime.setActiveCloudSession(
            linkedSession: CloudLinkedSession(
                userId: linkedUserId,
                workspaceId: workspace.workspaceId,
                email: nil,
                configurationMode: .official,
                apiBaseUrl: context.apiBaseUrl,
                authorization: .bearer("id-token-1")
            )
        )

        await context.store.refreshProgressIfNeeded(now: now)
        context.store.updateCurrentVisibleTab(tab: .progress)
        _ = try self.addNewReviewScheduleCard(
            database: database,
            workspaceId: workspace.workspaceId
        )

        context.store.handleReviewScheduleLocalCardStateDidChange(now: now)

        let reviewScheduleSnapshot = try XCTUnwrap(context.store.reviewScheduleSnapshot)
        XCTAssertEqual(.serverBaseWithPendingLocalOverlay, reviewScheduleSnapshot.sourceState)
        XCTAssertTrue(reviewScheduleSnapshot.isApproximate)
        XCTAssertEqual(4, reviewScheduleSnapshot.schedule.totalCards)
        XCTAssertEqual(0, reviewScheduleCount(snapshot: reviewScheduleSnapshot, key: .new))
        XCTAssertEqual(4, reviewScheduleCount(snapshot: reviewScheduleSnapshot, key: .today))
        XCTAssertTrue(context.store.progressErrorState.reviewScheduleRenderMessage.isEmpty)
    }

    @MainActor
    func testReviewSchedulePendingOverlayIgnoresTextOnlyCardEdits() async throws {
        let database = try self.makeDatabase()
        let cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let existingCard = try database.saveCard(
            workspaceId: workspace.workspaceId,
            input: CardEditorInput(
                frontText: "Question",
                backText: "Answer",
                tags: [],
                effortLevel: .medium
            ),
            cardId: nil
        )
        let initialOutboxEntries = try database.loadOutboxEntries(
            workspaceId: workspace.workspaceId,
            limit: Int.max
        )
        try database.deleteOutboxEntries(operationIds: initialOutboxEntries.map(\.operationId))

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
        _ = try database.saveCard(
            workspaceId: workspace.workspaceId,
            input: CardEditorInput(
                frontText: "Updated question",
                backText: "Updated answer",
                tags: ["edited"],
                effortLevel: .long
            ),
            cardId: existingCard.cardId
        )

        XCTAssertFalse(
            try database.hasPendingReviewScheduleImpactingCardOperation(
                workspaceId: workspace.workspaceId,
                installationId: cloudSettings.installationId
            )
        )
        try context.store.publishReviewScheduleSnapshot(scopeKey: scheduleScopeKey)

        let textOnlySnapshot = try XCTUnwrap(context.store.reviewScheduleSnapshot)
        XCTAssertEqual(.serverBase, textOnlySnapshot.sourceState)
        XCTAssertEqual(4, textOnlySnapshot.schedule.totalCards)
        XCTAssertEqual(4, reviewScheduleCount(snapshot: textOnlySnapshot, key: .today))

        let textEditOutboxEntries = try database.loadOutboxEntries(
            workspaceId: workspace.workspaceId,
            limit: Int.max
        )
        try database.deleteOutboxEntries(operationIds: textEditOutboxEntries.map(\.operationId))
        context.store.updateCurrentVisibleTab(tab: .progress)
        _ = try database.saveCard(
            workspaceId: workspace.workspaceId,
            input: CardEditorInput(
                frontText: "New question",
                backText: "New answer",
                tags: [],
                effortLevel: .fast
            ),
            cardId: nil
        )
        context.store.handleReviewScheduleLocalCardStateDidChange(now: now)

        let createSnapshot = try XCTUnwrap(context.store.reviewScheduleSnapshot)
        XCTAssertEqual(.serverBaseWithPendingLocalOverlay, createSnapshot.sourceState)
        XCTAssertTrue(createSnapshot.isApproximate)
        XCTAssertEqual(4, createSnapshot.schedule.totalCards)
        XCTAssertEqual(4, reviewScheduleCount(snapshot: createSnapshot, key: .today))
        XCTAssertEqual(0, reviewScheduleCount(snapshot: createSnapshot, key: .new))
    }

    @MainActor
    func testRefreshProgressIfNeededUpdatesRemoteSummaryWhenSeriesRefreshFails() async throws {
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
            reviewDates: ["2026-04-01", "2026-04-02", "2026-04-03", "2026-04-04", "2026-04-05"],
            generatedAt: "2026-04-18T11:59:00.000Z"
        )
        let context = try self.makeProgressStoreContext(
            database: database,
            workspaceId: workspace.workspaceId,
            installationId: cloudSettings.installationId,
            serverSummary: serverSummary,
            serverSeries: serverSeries,
            loadProgressSummaryError: nil,
            loadProgressSeriesError: LocalStoreError.validation("Series refresh failed"),
            cloudState: .guest
        )
        defer { context.tearDown() }

        await context.store.refreshProgressIfNeeded(now: now)

        let progressSnapshot = try XCTUnwrap(context.store.progressSnapshot)
        XCTAssertEqual(.serverBase, progressSnapshot.summarySourceState)
        XCTAssertEqual(.localOnly, progressSnapshot.seriesSourceState)
        XCTAssertTrue(progressSnapshot.isApproximate)
        XCTAssertEqual(5, progressSnapshot.summary.activeReviewDays)
        XCTAssertEqual("2026-04-05", progressSnapshot.summary.lastReviewedOn)
        XCTAssertFalse(context.store.progressErrorMessage.isEmpty)
        XCTAssertEqual(1, context.cloudSyncService.loadProgressSummaryCallCount)
        XCTAssertEqual(1, context.cloudSyncService.loadProgressSeriesCallCount)
    }

    @MainActor
    func testRefreshProgressIfNeededRejectsMismatchedServerSeriesWithoutPersistingCache() async throws {
        let database = try self.makeDatabase()
        let cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        try self.addReviewedCard(
            database: database,
            workspaceId: workspace.workspaceId,
            reviewedAtClient: "2026-04-02T15:50:57.000Z"
        )
        let outboxEntries = try database.loadOutboxEntries(workspaceId: workspace.workspaceId, limit: Int.max)
        try database.deleteOutboxEntries(operationIds: outboxEntries.map(\.operationId))

        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-18T12:00:00.000Z"))
        let requestRange = try makeTestProgressRequestRange(
            now: now,
            timeZone: TimeZone.current,
            dayCount: 140
        )
        let mismatchedServerSeries = makeProgressSeries(
            timeZone: requestRange.timeZone,
            from: "2026-04-01",
            to: requestRange.to,
            dailyReviews: [],
            summary: nil,
            generatedAt: "2026-04-18T11:59:00.000Z"
        )
        let serverSummary = try makeTestProgressSummary(
            timeZone: requestRange.timeZone,
            reviewDates: ["2026-04-01"],
            generatedAt: "2026-04-18T11:59:00.000Z"
        )
        let context = try self.makeProgressStoreContext(
            database: database,
            workspaceId: workspace.workspaceId,
            installationId: cloudSettings.installationId,
            serverSummary: serverSummary,
            serverSeries: mismatchedServerSeries,
            loadProgressSummaryError: nil,
            loadProgressSeriesError: nil,
            cloudState: .guest
        )
        defer { context.tearDown() }

        await context.store.refreshProgressIfNeeded(now: now)

        let progressSnapshot = try XCTUnwrap(context.store.progressSnapshot)
        XCTAssertEqual(.serverBase, progressSnapshot.summarySourceState)
        XCTAssertEqual(.localOnly, progressSnapshot.seriesSourceState)
        XCTAssertTrue(progressSnapshot.isApproximate)
        XCTAssertEqual(1, progressReviewCount(snapshot: progressSnapshot, localDate: "2026-04-02"))
        XCTAssertNil(context.store.progressSeriesServerBaseCache)
        let persistedSeriesCacheKeys = context.userDefaults.dictionaryRepresentation().keys.filter { key in
            key.hasPrefix("progress-series-server-base|")
        }
        XCTAssertTrue(persistedSeriesCacheKeys.isEmpty)
        XCTAssertTrue(context.store.progressErrorMessage.contains("Progress series metadata mismatched"))
        XCTAssertEqual(1, context.cloudSyncService.loadProgressSummaryCallCount)
        XCTAssertEqual(1, context.cloudSyncService.loadProgressSeriesCallCount)
    }

    @MainActor
    func testRefreshProgressIfNeededRejectsInvalidServerSeriesDailyReviewDateWithoutPersistingCache() async throws {
        let database = try self.makeDatabase()
        let cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        try self.addReviewedCard(
            database: database,
            workspaceId: workspace.workspaceId,
            reviewedAtClient: "2026-04-02T15:50:57.000Z"
        )
        let outboxEntries = try database.loadOutboxEntries(workspaceId: workspace.workspaceId, limit: Int.max)
        try database.deleteOutboxEntries(operationIds: outboxEntries.map(\.operationId))

        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-18T12:00:00.000Z"))
        let requestRange = try makeTestProgressRequestRange(
            now: now,
            timeZone: TimeZone.current,
            dayCount: 140
        )
        let invalidServerSeries = makeProgressSeries(
            timeZone: requestRange.timeZone,
            from: requestRange.from,
            to: requestRange.to,
            dailyReviews: [
                ProgressDay(
                    date: "2026-02-31",
                    reviewCount: 1
                )
            ],
            summary: nil,
            generatedAt: "2026-04-18T11:59:00.000Z"
        )
        let serverSummary = try makeTestProgressSummary(
            timeZone: requestRange.timeZone,
            reviewDates: ["2026-04-01"],
            generatedAt: "2026-04-18T11:59:00.000Z"
        )
        let context = try self.makeProgressStoreContext(
            database: database,
            workspaceId: workspace.workspaceId,
            installationId: cloudSettings.installationId,
            serverSummary: serverSummary,
            serverSeries: invalidServerSeries,
            loadProgressSummaryError: nil,
            loadProgressSeriesError: nil,
            cloudState: .guest
        )
        defer { context.tearDown() }

        await context.store.refreshProgressIfNeeded(now: now)

        let progressSnapshot = try XCTUnwrap(context.store.progressSnapshot)
        XCTAssertEqual(.serverBase, progressSnapshot.summarySourceState)
        XCTAssertEqual(.localOnly, progressSnapshot.seriesSourceState)
        XCTAssertTrue(progressSnapshot.isApproximate)
        XCTAssertEqual(1, progressReviewCount(snapshot: progressSnapshot, localDate: "2026-04-02"))
        XCTAssertNil(context.store.progressSeriesServerBaseCache)
        let persistedSeriesCacheKeys = context.userDefaults.dictionaryRepresentation().keys.filter { key in
            key.hasPrefix("progress-series-server-base|")
        }
        XCTAssertTrue(persistedSeriesCacheKeys.isEmpty)
        XCTAssertTrue(context.store.progressErrorMessage.contains("2026-02-31"))
        XCTAssertEqual(1, context.cloudSyncService.loadProgressSummaryCallCount)
        XCTAssertEqual(1, context.cloudSyncService.loadProgressSeriesCallCount)
    }

    @MainActor
    func testRefreshProgressIfNeededUsesLocalFallbackWhenDisconnected() async throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        try self.addReviewedCard(
            database: database,
            workspaceId: workspace.workspaceId,
            reviewedAtClient: "2026-04-02T15:50:57.000Z"
        )
        let secondWorkspace = try self.insertWorkspace(
            database: database,
            name: "Workspace 2",
            createdAt: "2026-04-02T00:00:00Z"
        )
        try self.addReviewedCard(
            database: database,
            workspaceId: secondWorkspace.workspaceId,
            reviewedAtClient: "2026-04-03T09:00:00.000Z"
        )

        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-18T12:00:00.000Z"))
        let requestRange = try makeTestProgressRequestRange(
            now: now,
            timeZone: TimeZone.current,
            dayCount: 140
        )
        let serverSeries = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [
                "2026-04-01": 5
            ],
            generatedAt: "2026-04-18T11:59:00.000Z"
        )
        let serverSummary = try makeTestProgressSummary(
            timeZone: requestRange.timeZone,
            reviewDates: ["2026-04-01"],
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
            cloudState: .disconnected
        )
        defer { context.tearDown() }

        await context.store.refreshProgressIfNeeded(now: now)

        XCTAssertTrue(context.cloudSyncService.recordedOperations.isEmpty)
        let progressSnapshot = try XCTUnwrap(context.store.progressSnapshot)
        XCTAssertEqual(.localOnly, progressSnapshot.summarySourceState)
        XCTAssertEqual(.localOnly, progressSnapshot.seriesSourceState)
        XCTAssertTrue(progressSnapshot.isApproximate)
        XCTAssertEqual(2, progressSnapshot.summary.activeReviewDays)
        XCTAssertEqual("2026-04-03", progressSnapshot.summary.lastReviewedOn)
    }

    @MainActor
    func testRefreshReviewProgressBadgeIfNeededLoadsBadgeSummaryWithoutBuildingSnapshot() async throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()

        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-18T12:00:00.000Z"))
        let requestRange = try makeTestProgressRequestRange(
            now: now,
            timeZone: TimeZone.current,
            dayCount: 140
        )
        let serverSeries = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [
                "2026-04-01": 2
            ],
            generatedAt: "2026-04-18T11:59:00.000Z"
        )
        let serverSummary = try makeTestProgressSummary(
            timeZone: requestRange.timeZone,
            reviewDates: [requestRange.to],
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

        await context.store.refreshReviewProgressBadgeIfNeeded(now: now)

        XCTAssertNil(context.store.progressSnapshot)
        XCTAssertEqual(
            ReviewProgressBadgeState(
                streakDays: 1,
                hasReviewedToday: true,
                isInteractive: true
            ),
            context.store.reviewProgressBadgeState
        )
        XCTAssertEqual(1, context.cloudSyncService.loadProgressSummaryCallCount)
        XCTAssertEqual(0, context.cloudSyncService.loadProgressSeriesCallCount)
    }

    @discardableResult
    private func addNewReviewScheduleCard(
        database: LocalDatabase,
        workspaceId: String
    ) throws -> Card {
        try database.saveCard(
            workspaceId: workspaceId,
            input: CardEditorInput(
                frontText: "Question",
                backText: "Answer",
                tags: [],
                effortLevel: .medium
            ),
            cardId: nil
        )
    }

    @discardableResult
    private func addDueReviewScheduleCard(
        database: LocalDatabase,
        workspaceId: String,
        dueAt: Date
    ) throws -> Card {
        let card = try self.addNewReviewScheduleCard(
            database: database,
            workspaceId: workspaceId
        )
        let dueAtText = formatIsoTimestamp(date: dueAt)
        try database.core.execute(
            sql: """
            UPDATE cards
            SET due_at = ?,
                due_at_millis = ?,
                reps = 1,
                fsrs_card_state = 'review',
                fsrs_stability = 1.0,
                fsrs_difficulty = 5.0,
                fsrs_last_reviewed_at = ?,
                fsrs_scheduled_days = 1
            WHERE workspace_id = ? AND card_id = ?
            """,
            values: [
                .text(dueAtText),
                .integer(epochMillis(date: dueAt)),
                .text(dueAtText),
                .text(workspaceId),
                .text(card.cardId),
            ]
        )
        return card
    }

    private func markReviewScheduleCardWithInvalidDueAt(
        database: LocalDatabase,
        workspaceId: String,
        cardId: String
    ) throws {
        try database.core.execute(
            sql: """
            UPDATE cards
            SET due_at = ?, due_at_millis = NULL
            WHERE workspace_id = ? AND card_id = ?
            """,
            values: [
                .text("2026-04-18T08:00:00.000Z"),
                .text(workspaceId),
                .text(cardId),
            ]
        )
    }
}
