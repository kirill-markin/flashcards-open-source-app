import Foundation
import XCTest
@testable import Flashcards

final class ProgressSyncCompletionTests: ProgressStoreTestCase {
    @MainActor
    func testHandleProgressSyncCompletionDoesNotRefreshProgressForNonReviewOutboxAcknowledgement() async throws {
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

        await context.store.handleProgressSyncCompletion(
            now: now,
            syncResult: CloudSyncResult(
                appliedPullChangeCount: 0,
                changedEntityTypes: [],
                localIdRepairEntityTypes: [],
                acknowledgedOperationCount: 1,
                acknowledgedReviewEventOperationCount: 0,
                cleanedUpOperationCount: 0,
                cleanedUpReviewEventOperationCount: 0
            )
        )

        XCTAssertEqual(
            initialSummaryCallCount,
            context.cloudSyncService.loadProgressSummaryCallCount
        )
        XCTAssertEqual(
            initialSeriesCallCount,
            context.cloudSyncService.loadProgressSeriesCallCount
        )
    }

    @MainActor
    func testHandleProgressSyncCompletionRefreshesProgressForReviewEventOutboxAcknowledgement() async throws {
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
                appliedPullChangeCount: 0,
                changedEntityTypes: [],
                localIdRepairEntityTypes: [],
                acknowledgedOperationCount: 1,
                acknowledgedReviewEventOperationCount: 1,
                cleanedUpOperationCount: 0,
                cleanedUpReviewEventOperationCount: 0
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
    }

    @MainActor
    func testHandleProgressSyncCompletionInvalidatesAndReloadsServerBaseForPulledRemoteReviewHistory() async throws {
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
                localIdRepairEntityTypes: [],
                acknowledgedOperationCount: 0,
                acknowledgedReviewEventOperationCount: 0,
                cleanedUpOperationCount: 0,
                cleanedUpReviewEventOperationCount: 0
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
    func testHandleProgressSyncCompletionRefreshesProgressForStaleReviewEventCleanup() async throws {
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
        context.cloudSyncService.serverSeries = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [
                "2026-04-01": 2,
                "2026-04-03": 1
            ],
            generatedAt: "2026-04-18T12:01:00.000Z"
        )
        context.cloudSyncService.serverSummary = try makeTestProgressSummary(
            timeZone: requestRange.timeZone,
            reviewDates: ["2026-04-01", "2026-04-03"],
            generatedAt: "2026-04-18T12:01:00.000Z"
        )

        await context.store.handleProgressSyncCompletion(
            now: now,
            syncResult: CloudSyncResult(
                appliedPullChangeCount: 0,
                changedEntityTypes: [],
                localIdRepairEntityTypes: [],
                acknowledgedOperationCount: 0,
                acknowledgedReviewEventOperationCount: 0,
                cleanedUpOperationCount: 1,
                cleanedUpReviewEventOperationCount: 1
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
                localIdRepairEntityTypes: [],
                acknowledgedOperationCount: 0,
                acknowledgedReviewEventOperationCount: 0,
                cleanedUpOperationCount: 0,
                cleanedUpReviewEventOperationCount: 0
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
}
