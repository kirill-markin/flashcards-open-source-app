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
}
