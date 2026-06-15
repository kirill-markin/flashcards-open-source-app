import Foundation
import XCTest
@testable import Flashcards

final class ProgressServerValidationRefreshTests: ProgressStoreTestCase {
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
            generatedAt: "2026-04-18T11:59:00.000Z",
            reviewHistoryWatermarks: []
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
        XCTAssertEqual(.serverBaseWithPendingLocalOverlay, progressSnapshot.summarySourceState)
        XCTAssertEqual(.localOnly, progressSnapshot.seriesSourceState)
        XCTAssertTrue(progressSnapshot.isApproximate)
        XCTAssertEqual(2, progressSnapshot.summary.activeReviewDays)
        XCTAssertEqual("2026-04-02", progressSnapshot.summary.lastReviewedOn)
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
                    reviewCount: 1,
                    againCount: 0,
                    hardCount: 0,
                    goodCount: 1,
                    easyCount: 0
                )
            ],
            summary: nil,
            generatedAt: "2026-04-18T11:59:00.000Z",
            reviewHistoryWatermarks: []
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
        XCTAssertEqual(.serverBaseWithPendingLocalOverlay, progressSnapshot.summarySourceState)
        XCTAssertEqual(.localOnly, progressSnapshot.seriesSourceState)
        XCTAssertTrue(progressSnapshot.isApproximate)
        XCTAssertEqual(2, progressSnapshot.summary.activeReviewDays)
        XCTAssertEqual("2026-04-02", progressSnapshot.summary.lastReviewedOn)
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
}
