import Foundation
import XCTest
@testable import Flashcards

final class ProgressMergeTests: XCTestCase {
    private var databaseURL: URL?
    private var database: LocalDatabase?

    override func tearDownWithError() throws {
        if let database {
            try database.close()
        }
        if let databaseURL {
            try? FileManager.default.removeItem(at: databaseURL)
        }

        self.database = nil
        self.databaseURL = nil
        try super.tearDownWithError()
    }

    func testLoadPendingReviewEventPayloadsReturnsOnlyUnsyncedReviewEvents() throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
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

        _ = try database.submitReview(
            workspaceId: workspace.workspaceId,
            reviewSubmission: ReviewSubmission(
                cardId: card.cardId,
                rating: .good,
                reviewedAtClient: "2026-04-02T15:50:57.000Z"
            )
        )

        let pendingBeforeDelete = try database.loadPendingReviewEventPayloads(
            workspaceId: workspace.workspaceId,
            installationId: cloudSettings.installationId
        )

        XCTAssertEqual(1, pendingBeforeDelete.count)
        XCTAssertEqual("2026-04-02T15:50:57.000Z", pendingBeforeDelete.first?.reviewedAtClient)

        let outboxEntries = try database.loadOutboxEntries(workspaceId: workspace.workspaceId, limit: Int.max)
        try database.deleteOutboxEntries(operationIds: outboxEntries.map(\.operationId))

        let pendingAfterDelete = try database.loadPendingReviewEventPayloads(
            workspaceId: workspace.workspaceId,
            installationId: cloudSettings.installationId
        )

        XCTAssertTrue(pendingAfterDelete.isEmpty)
        XCTAssertEqual(1, try database.loadReviewEvents(workspaceId: workspace.workspaceId).count)
    }

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
        XCTAssertEqual(2, context.cloudSyncService.recordedOperations.count)
        XCTAssertTrue(context.cloudSyncService.recordedOperations.contains(.loadProgressSummary))
        XCTAssertTrue(context.cloudSyncService.recordedOperations.contains(.loadProgressSeries))
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

    @MainActor
    func testHandleProgressSyncCompletionInvalidatesAndReloadsServerBase() async throws {
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
        let initialServerSeries = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [
                "2026-04-01": 2
            ],
            generatedAt: "2026-04-18T11:59:00.000Z"
        )
        let initialServerSummary = try makeTestProgressSummary(
            timeZone: requestRange.timeZone,
            reviewDates: ["2026-04-01"],
            generatedAt: "2026-04-18T11:59:00.000Z"
        )
        let context = try self.makeProgressStoreContext(
            database: database,
            workspaceId: workspace.workspaceId,
            installationId: cloudSettings.installationId,
            serverSummary: initialServerSummary,
            serverSeries: initialServerSeries,
            loadProgressSummaryError: nil,
            loadProgressSeriesError: nil,
            cloudState: .guest
        )
        defer { context.tearDown() }

        await context.store.refreshProgressIfNeeded(now: now)
        context.store.updateCurrentVisibleTab(tab: .progress)
        let initialSummaryCallCount = context.cloudSyncService.loadProgressSummaryCallCount
        let initialSeriesCallCount = context.cloudSyncService.loadProgressSeriesCallCount

        let outboxEntries = try database.loadOutboxEntries(workspaceId: workspace.workspaceId, limit: Int.max)
        try database.deleteOutboxEntries(operationIds: outboxEntries.map(\.operationId))
        context.cloudSyncService.serverSeries = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [
                "2026-04-01": 2,
                "2026-04-02": 1
            ],
            generatedAt: "2026-04-18T12:01:00.000Z"
        )
        context.cloudSyncService.serverSummary = try makeTestProgressSummary(
            timeZone: requestRange.timeZone,
            reviewDates: ["2026-04-01", "2026-04-02"],
            generatedAt: "2026-04-18T12:01:00.000Z"
        )

        await context.store.handleProgressSyncCompletion(
            now: now,
            syncResult: CloudSyncResult(
                appliedPullChangeCount: 1,
                changedEntityTypes: [.reviewEvent],
                acknowledgedOperationCount: 0,
                cleanedUpOperationCount: 0
            )
        )

        XCTAssertEqual(
            initialSummaryCallCount + 1,
            context.cloudSyncService.loadProgressSummaryCallCount
        )
        XCTAssertEqual(
            initialSeriesCallCount + 1,
            context.cloudSyncService.loadProgressSeriesCallCount
        )
        let progressSnapshot = try XCTUnwrap(context.store.progressSnapshot)
        XCTAssertEqual(.serverBase, progressSnapshot.summarySourceState)
        XCTAssertEqual(.serverBase, progressSnapshot.seriesSourceState)
        XCTAssertFalse(progressSnapshot.isApproximate)
        XCTAssertEqual(2, progressSnapshot.summary.activeReviewDays)
        XCTAssertEqual("2026-04-02", progressSnapshot.summary.lastReviewedOn)
    }

    @MainActor
    func testHandleProgressSyncCompletionRefreshesBadgeWithoutUpdatingSharedSnapshotWhenReviewIsVisible() async throws {
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
        let initialServerSeries = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [
                "2026-04-01": 2
            ],
            generatedAt: "2026-04-18T11:59:00.000Z"
        )
        let initialServerSummary = try makeTestProgressSummary(
            timeZone: requestRange.timeZone,
            reviewDates: ["2026-04-01"],
            generatedAt: "2026-04-18T11:59:00.000Z"
        )
        let context = try self.makeProgressStoreContext(
            database: database,
            workspaceId: workspace.workspaceId,
            installationId: cloudSettings.installationId,
            serverSummary: initialServerSummary,
            serverSeries: initialServerSeries,
            loadProgressSummaryError: nil,
            loadProgressSeriesError: nil,
            cloudState: .guest
        )
        defer { context.tearDown() }

        await context.store.refreshProgressIfNeeded(now: now)
        context.store.updateCurrentVisibleTab(tab: .review)
        let initialSnapshot = try XCTUnwrap(context.store.progressSnapshot)
        let initialSummaryCallCount = context.cloudSyncService.loadProgressSummaryCallCount
        let initialSeriesCallCount = context.cloudSyncService.loadProgressSeriesCallCount

        let outboxEntries = try database.loadOutboxEntries(workspaceId: workspace.workspaceId, limit: Int.max)
        try database.deleteOutboxEntries(operationIds: outboxEntries.map(\.operationId))
        context.cloudSyncService.serverSeries = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [
                requestRange.to: 1
            ],
            generatedAt: "2026-04-18T12:01:00.000Z"
        )
        context.cloudSyncService.serverSummary = try makeTestProgressSummary(
            timeZone: requestRange.timeZone,
            reviewDates: [requestRange.to],
            generatedAt: "2026-04-18T12:01:00.000Z"
        )

        await context.store.handleProgressSyncCompletion(
            now: now,
            syncResult: CloudSyncResult(
                appliedPullChangeCount: 1,
                changedEntityTypes: [.reviewEvent],
                acknowledgedOperationCount: 0,
                cleanedUpOperationCount: 0
            )
        )
        await self.waitForProgressRefreshCallCounts(
            cloudSyncService: context.cloudSyncService,
            summaryCount: initialSummaryCallCount + 1,
            seriesCount: initialSeriesCallCount
        )

        XCTAssertEqual(initialSnapshot, context.store.progressSnapshot)
        XCTAssertEqual(1, context.store.reviewProgressBadgeState.streakDays)
        XCTAssertTrue(context.store.reviewProgressBadgeState.hasReviewedToday)
        XCTAssertTrue(context.store.reviewProgressBadgeState.isInteractive)
    }

    @MainActor
    func testHandleProgressSyncCompletionSkipsReviewSummaryRefreshAfterNoOpSync() async throws {
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
        let initialServerSeries = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [
                "2026-04-01": 2
            ],
            generatedAt: "2026-04-18T11:59:00.000Z"
        )
        let initialServerSummary = try makeTestProgressSummary(
            timeZone: requestRange.timeZone,
            reviewDates: ["2026-04-01"],
            generatedAt: "2026-04-18T11:59:00.000Z"
        )
        let context = try self.makeProgressStoreContext(
            database: database,
            workspaceId: workspace.workspaceId,
            installationId: cloudSettings.installationId,
            serverSummary: initialServerSummary,
            serverSeries: initialServerSeries,
            loadProgressSummaryError: nil,
            loadProgressSeriesError: nil,
            cloudState: .guest
        )
        defer { context.tearDown() }

        await context.store.refreshProgressIfNeeded(now: now)
        context.store.updateCurrentVisibleTab(tab: .review)
        let initialSummaryCallCount = context.cloudSyncService.loadProgressSummaryCallCount
        let initialSeriesCallCount = context.cloudSyncService.loadProgressSeriesCallCount
        context.cloudSyncService.serverSummary = try makeTestProgressSummary(
            timeZone: requestRange.timeZone,
            reviewDates: ["2026-04-01", "2026-04-02"],
            generatedAt: "2026-04-18T12:01:00.000Z"
        )

        await context.store.handleProgressSyncCompletion(
            now: now,
            syncResult: .noChanges
        )

        XCTAssertEqual(initialSummaryCallCount, context.cloudSyncService.loadProgressSummaryCallCount)
        XCTAssertEqual(initialSeriesCallCount, context.cloudSyncService.loadProgressSeriesCallCount)
        let progressSnapshot = try XCTUnwrap(context.store.progressSnapshot)
        XCTAssertEqual(1, progressSnapshot.summary.activeReviewDays)
        XCTAssertEqual("2026-04-02", progressSnapshot.summary.lastReviewedOn)
    }

    @MainActor
    func testHandleProgressLocalMutationPatchesLoadedServerSnapshotWithoutReload() async throws {
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
                requestRange.to: 2
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

        await context.store.refreshProgressIfNeeded(now: now)
        let initialSnapshot = try XCTUnwrap(context.store.progressSnapshot)
        XCTAssertEqual(.serverBase, initialSnapshot.summarySourceState)
        XCTAssertEqual(.serverBase, initialSnapshot.seriesSourceState)
        XCTAssertEqual(2, progressReviewCount(snapshot: initialSnapshot, localDate: requestRange.to))

        context.store.handleProgressLocalMutation(
            now: now,
            reviewedAtClient: "2026-04-18T12:30:00.000Z"
        )

        XCTAssertEqual(1, context.cloudSyncService.loadProgressSummaryCallCount)
        XCTAssertEqual(1, context.cloudSyncService.loadProgressSeriesCallCount)
        let progressSnapshot = try XCTUnwrap(context.store.progressSnapshot)
        XCTAssertEqual(.serverBaseWithPendingLocalOverlay, progressSnapshot.summarySourceState)
        XCTAssertEqual(.serverBaseWithPendingLocalOverlay, progressSnapshot.seriesSourceState)
        XCTAssertFalse(progressSnapshot.isApproximate)
        XCTAssertEqual(3, progressReviewCount(snapshot: progressSnapshot, localDate: requestRange.to))
        XCTAssertTrue(progressSnapshot.summary.hasReviewedToday)
        XCTAssertEqual(1, progressSnapshot.summary.activeReviewDays)
        XCTAssertEqual(requestRange.to, progressSnapshot.summary.lastReviewedOn)
    }

    @MainActor
    func testHandleProgressLocalMutationDoesNotForceLoadSnapshotWhenMissing() async throws {
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
        context.store.progressSnapshot = nil
        context.store.progressObservedScopeKey = nil

        context.store.handleProgressLocalMutation(
            now: now,
            reviewedAtClient: "2026-04-18T12:30:00.000Z"
        )

        XCTAssertNil(context.store.progressSnapshot)
        XCTAssertTrue(context.cloudSyncService.recordedOperations.isEmpty)
        let scopeKey = try XCTUnwrap(context.store.progressObservedScopeKey)
        XCTAssertEqual(requestRange.to, scopeKey.to)
        XCTAssertTrue(
            context.store.progressSummaryInvalidatedScopeKeys.contains(
                ProgressSummaryScopeKey(
                    cloudState: scopeKey.cloudState,
                    linkedUserId: scopeKey.linkedUserId,
                    workspaceMembershipKey: scopeKey.workspaceMembershipKey,
                    timeZone: scopeKey.timeZone
                )
            )
        )
        XCTAssertTrue(context.store.progressSeriesInvalidatedScopeKeys.contains(scopeKey))
    }

    @MainActor
    func testHandleProgressLocalMutationPatchesYesterdayBucketFromLoadedSnapshot() async throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        let timeZone = TimeZone.current
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let now = try XCTUnwrap(
            calendar.date(from: DateComponents(year: 2026, month: 4, day: 18, hour: 12, minute: 0))
        )
        let yesterdayReviewDate = try XCTUnwrap(
            calendar.date(byAdding: .hour, value: -13, to: now)
        )
        let yesterdayLocalDate = progressLocalDateStringForTests(
            date: yesterdayReviewDate,
            calendar: calendar
        )
        let todayLocalDate = progressLocalDateStringForTests(
            date: now,
            calendar: calendar
        )
        let requestRange = try makeTestProgressRequestRange(
            now: now,
            timeZone: timeZone,
            dayCount: 140
        )
        let serverSeries = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [:],
            generatedAt: formatIsoTimestamp(date: now)
        )
        let serverSummary = try makeTestProgressSummary(
            timeZone: requestRange.timeZone,
            reviewDates: [],
            generatedAt: formatIsoTimestamp(date: now)
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

        context.store.handleProgressLocalMutation(
            now: now,
            reviewedAtClient: formatIsoTimestamp(date: yesterdayReviewDate)
        )

        let progressSnapshot = try XCTUnwrap(context.store.progressSnapshot)
        XCTAssertEqual(1, progressReviewCount(snapshot: progressSnapshot, localDate: yesterdayLocalDate))
        XCTAssertEqual(0, progressReviewCount(snapshot: progressSnapshot, localDate: todayLocalDate))
        XCTAssertFalse(progressSnapshot.summary.hasReviewedToday)
        XCTAssertEqual(yesterdayLocalDate, progressSnapshot.summary.lastReviewedOn)
        XCTAssertEqual(1, progressSnapshot.summary.activeReviewDays)
    }

    @MainActor
    func testHandleProgressContextDidChangeReloadsProgressWhenWorkspaceMembershipChanges() async throws {
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
        context.store.updateCurrentVisibleTab(tab: .progress)

        let initialScopeKey = try XCTUnwrap(context.store.progressObservedScopeKey)
        let initialSnapshot = try XCTUnwrap(context.store.progressSnapshot)
        XCTAssertEqual(1, initialSnapshot.summary.activeReviewDays)
        XCTAssertEqual("2026-04-02", initialSnapshot.summary.lastReviewedOn)
        XCTAssertEqual(1, context.cloudSyncService.loadProgressSummaryCallCount)
        XCTAssertEqual(1, context.cloudSyncService.loadProgressSeriesCallCount)

        let secondWorkspace = try self.insertWorkspace(
            database: database,
            name: "Workspace 2",
            createdAt: "2026-04-03T00:00:00Z"
        )
        try self.addReviewedCard(
            database: database,
            workspaceId: secondWorkspace.workspaceId,
            reviewedAtClient: "2026-04-03T09:00:00.000Z"
        )

        context.store.handleProgressContextDidChange(now: now)

        let updatedScopeKey = try XCTUnwrap(context.store.progressObservedScopeKey)
        let updatedSnapshot = try XCTUnwrap(context.store.progressSnapshot)
        XCTAssertNotEqual(initialScopeKey, updatedScopeKey)
        XCTAssertNotEqual(initialScopeKey.workspaceMembershipKey, updatedScopeKey.workspaceMembershipKey)
        XCTAssertEqual(2, updatedSnapshot.summary.activeReviewDays)
        XCTAssertEqual("2026-04-03", updatedSnapshot.summary.lastReviewedOn)

        await self.waitForProgressRefreshCallCounts(
            cloudSyncService: context.cloudSyncService,
            summaryCount: 2,
            seriesCount: 2
        )
    }

    @MainActor
    func testHandleProgressContextDidChangeRefreshesBadgeWithoutUpdatingSharedSnapshotWhenReviewIsVisible() async throws {
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
        context.store.updateCurrentVisibleTab(tab: .review)
        let initialSnapshot = try XCTUnwrap(context.store.progressSnapshot)

        let secondWorkspace = try self.insertWorkspace(
            database: database,
            name: "Workspace 2",
            createdAt: "2026-04-03T00:00:00Z"
        )
        try self.addReviewedCard(
            database: database,
            workspaceId: secondWorkspace.workspaceId,
            reviewedAtClient: "\(requestRange.to)T09:00:00.000Z"
        )
        context.cloudSyncService.serverSummary = try makeTestProgressSummary(
            timeZone: requestRange.timeZone,
            reviewDates: [requestRange.to],
            generatedAt: "2026-04-18T12:01:00.000Z"
        )

        context.store.handleProgressContextDidChange(now: now)
        await self.waitForProgressRefreshCallCounts(
            cloudSyncService: context.cloudSyncService,
            summaryCount: 2,
            seriesCount: 1
        )

        XCTAssertEqual(initialSnapshot, context.store.progressSnapshot)
        XCTAssertEqual(1, context.store.reviewProgressBadgeState.streakDays)
        XCTAssertTrue(context.store.reviewProgressBadgeState.hasReviewedToday)
        XCTAssertTrue(context.store.reviewProgressBadgeState.isInteractive)
    }

    @MainActor
    func testRefreshProgressIfNeededKeepsServerScopeStableAcrossWorkspaceSwitch() async throws {
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
        let firstSnapshot = try XCTUnwrap(context.store.progressSnapshot)
        let firstScopeKey = try XCTUnwrap(context.store.progressObservedScopeKey)
        XCTAssertEqual(2, firstSnapshot.summary.activeReviewDays)
        XCTAssertEqual("2026-04-03", firstSnapshot.summary.lastReviewedOn)
        XCTAssertEqual(1, context.cloudSyncService.loadProgressSummaryCallCount)
        XCTAssertEqual(1, context.cloudSyncService.loadProgressSeriesCallCount)

        context.store.workspace = secondWorkspace
        context.store.cloudSettings = CloudSettings(
            installationId: cloudSettings.installationId,
            cloudState: .guest,
            linkedUserId: "guest-user-1",
            linkedWorkspaceId: workspace.workspaceId,
            activeWorkspaceId: secondWorkspace.workspaceId,
            linkedEmail: nil,
            onboardingCompleted: true,
            updatedAt: "2026-04-02T00:00:00Z"
        )

        await context.store.refreshProgressIfNeeded(now: now)

        XCTAssertEqual(1, context.cloudSyncService.loadProgressSummaryCallCount)
        XCTAssertEqual(1, context.cloudSyncService.loadProgressSeriesCallCount)
        let secondSnapshot = try XCTUnwrap(context.store.progressSnapshot)
        let secondScopeKey = try XCTUnwrap(context.store.progressObservedScopeKey)
        XCTAssertEqual(firstSnapshot, secondSnapshot)
        XCTAssertEqual(firstScopeKey, secondScopeKey)
        XCTAssertEqual(firstScopeKey.workspaceMembershipKey, secondScopeKey.workspaceMembershipKey)
    }

    private func makeDatabase() throws -> LocalDatabase {
        let databaseURL = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString.lowercased(), isDirectory: true)
            .appendingPathComponent("flashcards.sqlite", isDirectory: false)
        let database = try LocalDatabase(databaseURL: databaseURL)
        self.databaseURL = databaseURL
        self.database = database
        return database
    }

    private func addReviewedCard(
        database: LocalDatabase,
        workspaceId: String,
        reviewedAtClient: String
    ) throws {
        let card = try database.saveCard(
            workspaceId: workspaceId,
            input: CardEditorInput(
                frontText: "Question",
                backText: "Answer",
                tags: [],
                effortLevel: .medium
            ),
            cardId: nil
        )
        _ = try database.submitReview(
            workspaceId: workspaceId,
            reviewSubmission: ReviewSubmission(
                cardId: card.cardId,
                rating: .good,
                reviewedAtClient: reviewedAtClient
            )
        )
    }

    private func insertWorkspace(
        database: LocalDatabase,
        name: String,
        createdAt: String
    ) throws -> Workspace {
        let workspaceId = UUID().uuidString.lowercased()
        let installationId = try database.workspaceSettingsStore.loadCloudSettings().installationId
        try database.core.inTransaction {
            try database.core.execute(
                sql: """
                INSERT INTO workspaces (
                    workspace_id,
                    name,
                    created_at,
                    fsrs_client_updated_at,
                    fsrs_last_modified_by_replica_id,
                    fsrs_last_operation_id,
                    fsrs_updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                values: [
                    .text(workspaceId),
                    .text(name),
                    .text(createdAt),
                    .text(createdAt),
                    .text(installationId),
                    .text(UUID().uuidString.lowercased()),
                    .text(createdAt)
                ]
            )
            try database.core.execute(
                sql: """
                INSERT INTO sync_state (
                    workspace_id,
                    last_applied_hot_change_id,
                    last_applied_review_sequence_id,
                    has_hydrated_hot_state,
                    has_hydrated_review_history,
                    updated_at
                )
                VALUES (?, 0, 0, 0, 0, ?)
                """,
                values: [
                    .text(workspaceId),
                    .text(createdAt)
                ]
            )
        }

        return Workspace(
            workspaceId: workspaceId,
            name: name,
            createdAt: createdAt
        )
    }

    @MainActor
    private func waitForProgressRefreshCallCounts(
        cloudSyncService: ProgressCloudSyncService,
        summaryCount: Int,
        seriesCount: Int
    ) async {
        for _ in 0..<20 {
            if cloudSyncService.loadProgressSummaryCallCount == summaryCount
                && cloudSyncService.loadProgressSeriesCallCount == seriesCount {
                return
            }

            await Task.yield()
        }

        XCTFail(
            """
            Timed out waiting for progress refresh calls. Expected summary=\(summaryCount), \
            series=\(seriesCount), received summary=\(cloudSyncService.loadProgressSummaryCallCount), \
            series=\(cloudSyncService.loadProgressSeriesCallCount).
            """
        )
    }

    @MainActor
    private func makeProgressStoreContext(
        database: LocalDatabase,
        workspaceId: String,
        installationId: String,
        serverSummary: UserProgressSummary,
        serverSeries: UserProgressSeries,
        loadProgressSummaryError: Error?,
        loadProgressSeriesError: Error?,
        cloudState: CloudAccountState
    ) throws -> ProgressStoreTestContext {
        let suiteName = "progress-merge-\(UUID().uuidString.lowercased())"
        let userDefaults = UserDefaults(suiteName: suiteName)!
        let cloudSyncService = ProgressCloudSyncService(
            serverSummary: serverSummary,
            serverSeries: serverSeries,
            loadProgressSummaryError: loadProgressSummaryError,
            loadProgressSeriesError: loadProgressSeriesError
        )
        let credentialStore = CloudCredentialStore(service: "tests-\(suiteName)-cloud-auth")
        let guestCredentialStore = GuestCloudCredentialStore(
            service: "tests-\(suiteName)-guest-auth",
            bundle: .main,
            userDefaults: userDefaults
        )
        let store = FlashcardsStore(
            userDefaults: userDefaults,
            encoder: JSONEncoder(),
            decoder: JSONDecoder(),
            database: database,
            cloudAuthService: CloudAuthService(),
            cloudSyncService: cloudSyncService,
            credentialStore: credentialStore,
            guestCloudAuthService: GuestCloudAuthService(),
            guestCredentialStore: guestCredentialStore,
            reviewSubmissionExecutor: nil,
            reviewHeadLoader: defaultReviewHeadLoader,
            reviewCountsLoader: defaultReviewCountsLoader,
            reviewQueueChunkLoader: defaultReviewQueueChunkLoader,
            reviewTimelinePageLoader: defaultReviewTimelinePageLoader,
            initialGlobalErrorMessage: ""
        )
        let configuration = try store.currentCloudServiceConfiguration()
        let guestSession = StoredGuestCloudSession(
            guestToken: "guest-token-1",
            userId: "guest-user-1",
            workspaceId: workspaceId,
            configurationMode: configuration.mode,
            apiBaseUrl: configuration.apiBaseUrl
        )
        try guestCredentialStore.saveGuestSession(session: guestSession)
        store.workspace = Workspace(
            workspaceId: workspaceId,
            name: "Workspace",
            createdAt: "2026-04-01T00:00:00Z"
        )
        store.cloudSettings = CloudSettings(
            installationId: installationId,
            cloudState: cloudState,
            linkedUserId: guestSession.userId,
            linkedWorkspaceId: guestSession.workspaceId,
            activeWorkspaceId: guestSession.workspaceId,
            linkedEmail: nil,
            onboardingCompleted: true,
            updatedAt: "2026-04-01T00:00:00Z"
        )
        if cloudState == .guest {
            store.cloudRuntime.setActiveCloudSession(
                linkedSession: CloudLinkedSession(
                    userId: guestSession.userId,
                    workspaceId: guestSession.workspaceId,
                    email: nil,
                    configurationMode: guestSession.configurationMode,
                    apiBaseUrl: guestSession.apiBaseUrl,
                    authorization: .guest(guestSession.guestToken)
                )
            )
        }

        return ProgressStoreTestContext(
            suiteName: suiteName,
            userDefaults: userDefaults,
            apiBaseUrl: configuration.apiBaseUrl,
            cloudSyncService: cloudSyncService,
            credentialStore: credentialStore,
            guestCredentialStore: guestCredentialStore,
            store: store
        )
    }
}

private struct ProgressSummaryLoadRequest: Equatable {
    let apiBaseUrl: String
    let authorizationHeader: String
    let timeZone: String
}

private struct ProgressSeriesLoadRequest: Equatable {
    let apiBaseUrl: String
    let authorizationHeader: String
    let timeZone: String
    let from: String
    let to: String
}

private enum ProgressCloudOperation: Equatable {
    case loadProgressSummary
    case loadProgressSeries
}

@MainActor
private final class ProgressCloudSyncService: CloudSyncServing {
    var serverSummary: UserProgressSummary
    var serverSeries: UserProgressSeries
    var loadProgressSummaryError: Error?
    var loadProgressSeriesError: Error?
    private(set) var lastLoadProgressSummaryRequest: ProgressSummaryLoadRequest?
    private(set) var lastLoadProgressSeriesRequest: ProgressSeriesLoadRequest?
    private(set) var recordedOperations: [ProgressCloudOperation]
    private(set) var loadProgressSummaryCallCount: Int
    private(set) var loadProgressSeriesCallCount: Int

    init(
        serverSummary: UserProgressSummary,
        serverSeries: UserProgressSeries,
        loadProgressSummaryError: Error?,
        loadProgressSeriesError: Error?
    ) {
        self.serverSummary = serverSummary
        self.serverSeries = serverSeries
        self.loadProgressSummaryError = loadProgressSummaryError
        self.loadProgressSeriesError = loadProgressSeriesError
        self.lastLoadProgressSummaryRequest = nil
        self.lastLoadProgressSeriesRequest = nil
        self.recordedOperations = []
        self.loadProgressSummaryCallCount = 0
        self.loadProgressSeriesCallCount = 0
    }

    func fetchCloudAccount(apiBaseUrl: String, bearerToken: String) async throws -> CloudAccountSnapshot {
        _ = apiBaseUrl
        _ = bearerToken
        fatalError("Not used in ProgressMergeTests.")
    }

    func loadProgressSummary(
        apiBaseUrl: String,
        authorizationHeader: String,
        timeZone: String
    ) async throws -> UserProgressSummary {
        self.recordedOperations.append(.loadProgressSummary)
        self.loadProgressSummaryCallCount += 1
        self.lastLoadProgressSummaryRequest = ProgressSummaryLoadRequest(
            apiBaseUrl: apiBaseUrl,
            authorizationHeader: authorizationHeader,
            timeZone: timeZone
        )
        if let loadProgressSummaryError {
            throw loadProgressSummaryError
        }

        return self.serverSummary
    }

    func loadProgressSeries(
        apiBaseUrl: String,
        authorizationHeader: String,
        timeZone: String,
        from: String,
        to: String
    ) async throws -> UserProgressSeries {
        self.recordedOperations.append(.loadProgressSeries)
        self.loadProgressSeriesCallCount += 1
        self.lastLoadProgressSeriesRequest = ProgressSeriesLoadRequest(
            apiBaseUrl: apiBaseUrl,
            authorizationHeader: authorizationHeader,
            timeZone: timeZone,
            from: from,
            to: to
        )
        if let loadProgressSeriesError {
            throw loadProgressSeriesError
        }

        return self.serverSeries
    }

    func createWorkspace(apiBaseUrl: String, bearerToken: String, name: String) async throws -> CloudWorkspaceSummary {
        _ = apiBaseUrl
        _ = bearerToken
        _ = name
        fatalError("Not used in ProgressMergeTests.")
    }

    func renameWorkspace(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String,
        name: String
    ) async throws -> CloudWorkspaceSummary {
        _ = apiBaseUrl
        _ = bearerToken
        _ = workspaceId
        _ = name
        fatalError("Not used in ProgressMergeTests.")
    }

    func loadWorkspaceDeletePreview(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String
    ) async throws -> CloudWorkspaceDeletePreview {
        _ = apiBaseUrl
        _ = bearerToken
        _ = workspaceId
        fatalError("Not used in ProgressMergeTests.")
    }

    func loadWorkspaceResetProgressPreview(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String
    ) async throws -> CloudWorkspaceResetProgressPreview {
        _ = apiBaseUrl
        _ = bearerToken
        _ = workspaceId
        fatalError("Not used in ProgressMergeTests.")
    }

    func deleteWorkspace(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String,
        confirmationText: String
    ) async throws -> CloudWorkspaceDeleteResult {
        _ = apiBaseUrl
        _ = bearerToken
        _ = workspaceId
        _ = confirmationText
        fatalError("Not used in ProgressMergeTests.")
    }

    func resetWorkspaceProgress(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String,
        confirmationText: String
    ) async throws -> CloudWorkspaceResetProgressResult {
        _ = apiBaseUrl
        _ = bearerToken
        _ = workspaceId
        _ = confirmationText
        fatalError("Not used in ProgressMergeTests.")
    }

    func selectWorkspace(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String
    ) async throws -> CloudWorkspaceSummary {
        _ = apiBaseUrl
        _ = bearerToken
        _ = workspaceId
        fatalError("Not used in ProgressMergeTests.")
    }

    func listAgentApiKeys(
        apiBaseUrl: String,
        bearerToken: String
    ) async throws -> ([AgentApiKeyConnection], String) {
        _ = apiBaseUrl
        _ = bearerToken
        fatalError("Not used in ProgressMergeTests.")
    }

    func revokeAgentApiKey(
        apiBaseUrl: String,
        bearerToken: String,
        connectionId: String
    ) async throws -> (AgentApiKeyConnection, String) {
        _ = apiBaseUrl
        _ = bearerToken
        _ = connectionId
        fatalError("Not used in ProgressMergeTests.")
    }

    func isWorkspaceEmptyForBootstrap(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        installationId: String
    ) async throws -> Bool {
        _ = apiBaseUrl
        _ = authorizationHeader
        _ = workspaceId
        _ = installationId
        fatalError("Not used in ProgressMergeTests.")
    }

    func deleteAccount(apiBaseUrl: String, bearerToken: String, confirmationText: String) async throws {
        _ = apiBaseUrl
        _ = bearerToken
        _ = confirmationText
        fatalError("Not used in ProgressMergeTests.")
    }

    func runLinkedSync(linkedSession: CloudLinkedSession) async throws -> CloudSyncResult {
        _ = linkedSession
        fatalError("Progress refresh should not trigger sync in ProgressMergeTests.")
    }
}

@MainActor
private struct ProgressStoreTestContext {
    let suiteName: String
    let userDefaults: UserDefaults
    let apiBaseUrl: String
    let cloudSyncService: ProgressCloudSyncService
    let credentialStore: CloudCredentialStore
    let guestCredentialStore: GuestCloudCredentialStore
    let store: FlashcardsStore

    func tearDown() {
        self.store.shutdownForTests()
        try? self.credentialStore.clearCredentials()
        try? self.guestCredentialStore.clearGuestSession()
        self.userDefaults.removePersistentDomain(forName: self.suiteName)
    }
}

private func makeTestProgressRequestRange(
    now: Date,
    timeZone: TimeZone,
    dayCount: Int
) throws -> ProgressSeriesLoadRequest {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timeZone
    let formatter = DateFormatter()
    formatter.calendar = calendar
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = timeZone
    formatter.dateFormat = "yyyy-MM-dd"

    let endDate = calendar.startOfDay(for: now)
    guard let startDate = calendar.date(byAdding: .day, value: -(dayCount - 1), to: endDate) else {
        throw LocalStoreError.validation("Test progress range could not be calculated")
    }

    return ProgressSeriesLoadRequest(
        apiBaseUrl: "",
        authorizationHeader: "",
        timeZone: timeZone.identifier,
        from: formatter.string(from: startDate),
        to: formatter.string(from: endDate)
    )
}

private func makeTestProgressSeries(
    requestRange: ProgressSeriesLoadRequest,
    reviewCountsByDate: [String: Int],
    generatedAt: String
) throws -> UserProgressSeries {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: requestRange.timeZone)!

    let startDate = try XCTUnwrap(progressDateForTests(localDate: requestRange.from, calendar: calendar))
    let endDate = try XCTUnwrap(progressDateForTests(localDate: requestRange.to, calendar: calendar))
    var dailyReviews: [ProgressDay] = []
    var currentDate = startDate
    while currentDate <= endDate {
        let localDate = progressLocalDateStringForTests(date: currentDate, calendar: calendar)
        dailyReviews.append(
            ProgressDay(
                date: localDate,
                reviewCount: reviewCountsByDate[localDate] ?? 0
            )
        )
        currentDate = calendar.date(byAdding: .day, value: 1, to: currentDate)!
    }
    let generatedAtDate = try XCTUnwrap(parseIsoTimestamp(value: generatedAt))
    let summary = try makeProgressSummary(
        reviewDates: Set(
            dailyReviews.compactMap { progressDay in
                progressDay.reviewCount > 0 ? progressDay.date : nil
            }
        ),
        timeZone: requestRange.timeZone,
        generatedAt: generatedAtDate
    )

    return makeProgressSeries(
        timeZone: requestRange.timeZone,
        from: requestRange.from,
        to: requestRange.to,
        dailyReviews: dailyReviews,
        summary: summary,
        generatedAt: generatedAt
    )
}

private func makeTestProgressSummary(
    timeZone: String,
    reviewDates: Set<String>,
    generatedAt: String
) throws -> UserProgressSummary {
    let generatedAtDate = try XCTUnwrap(parseIsoTimestamp(value: generatedAt))
    return UserProgressSummary(
        timeZone: timeZone,
        summary: try makeProgressSummary(
            reviewDates: reviewDates,
            timeZone: timeZone,
            generatedAt: generatedAtDate
        ),
        generatedAt: generatedAt
    )
}

private func progressDateForTests(localDate: String, calendar: Calendar) -> Date? {
    let parts = localDate.split(separator: "-", omittingEmptySubsequences: false)
    guard
        parts.count == 3,
        let year = Int(parts[0]),
        let month = Int(parts[1]),
        let day = Int(parts[2])
    else {
        return nil
    }

    return calendar.date(from: DateComponents(year: year, month: month, day: day))
}

private func progressLocalDateStringForTests(date: Date, calendar: Calendar) -> String {
    let components = calendar.dateComponents([.year, .month, .day], from: date)
    return String(
        format: "%04d-%02d-%02d",
        components.year ?? 0,
        components.month ?? 0,
        components.day ?? 0
    )
}

private func progressReviewCount(
    snapshot: ProgressSnapshot,
    localDate: String
) -> Int {
    snapshot.chartData.chartDays.first { chartDay in
        chartDay.localDate == localDate
    }?.reviewCount ?? 0
}
