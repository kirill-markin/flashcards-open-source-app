import Foundation
import XCTest
@testable import Flashcards

final class ProgressSummarySeriesRefreshTests: ProgressStoreTestCase {
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
}
