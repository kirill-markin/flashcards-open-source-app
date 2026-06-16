import Foundation
import XCTest
@testable import Flashcards

final class ProgressServerValidationRefreshTests: ProgressStoreTestCase {
    @MainActor
    func testRefreshProgressIfNeededInvalidatesLegacySummaryCacheMissingFreezeContract() async throws {
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
                requestRange.to: 1
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

        let seriesScopeKey = ProgressScopeKey(
            cloudState: .guest,
            linkedUserId: "guest-user-1",
            workspaceMembershipKey: workspace.workspaceId,
            timeZone: requestRange.timeZone,
            from: requestRange.from,
            to: requestRange.to
        )
        let summaryScopeKey = progressSummaryScopeKey(seriesScopeKey: seriesScopeKey)
        let cacheKey = "progress-summary-server-base|\(summaryScopeKey.storageKey)"
        let legacyCache = LegacyProgressSummaryServerBaseForTests(
            scopeKey: summaryScopeKey,
            serverBase: LegacyUserProgressSummaryForTests(
                timeZone: requestRange.timeZone,
                summary: LegacyProgressSummaryForTests(
                    currentStreakDays: 0,
                    hasReviewedToday: false,
                    lastReviewedOn: nil,
                    activeReviewDays: 0
                ),
                generatedAt: "2026-04-18T10:00:00.000Z",
                reviewHistoryWatermarks: []
            ),
            storedAt: "2026-04-18T10:00:00.000Z"
        )
        context.userDefaults.set(try JSONEncoder().encode(legacyCache), forKey: cacheKey)

        await context.store.refreshProgressIfNeeded(now: now)

        XCTAssertEqual(1, context.cloudSyncService.loadProgressSummaryCallCount)
        XCTAssertNotNil(context.store.progressSummaryServerBaseCache)
        XCTAssertNotNil(context.userDefaults.data(forKey: cacheKey))
        XCTAssertEqual(2, context.store.progressSnapshot?.summary.streakFreeze.availableCredits)
    }

    @MainActor
    func testRefreshProgressIfNeededInvalidatesLegacySeriesCacheMissingStreakDays() async throws {
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
                requestRange.to: 1
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

        let seriesScopeKey = ProgressScopeKey(
            cloudState: .guest,
            linkedUserId: "guest-user-1",
            workspaceMembershipKey: workspace.workspaceId,
            timeZone: requestRange.timeZone,
            from: requestRange.from,
            to: requestRange.to
        )
        let summaryScopeKey = progressSummaryScopeKey(seriesScopeKey: seriesScopeKey)
        let summaryCacheKey = "progress-summary-server-base|\(summaryScopeKey.storageKey)"
        let seriesCacheKey = "progress-series-server-base|\(seriesScopeKey.storageKey)"
        let summaryCache = PersistedProgressSummaryServerBase(
            scopeKey: summaryScopeKey,
            serverBase: serverSummary,
            storedAt: "2026-04-18T10:00:00.000Z"
        )
        let legacySeriesCache = LegacyProgressSeriesServerBaseForTests(
            scopeKey: seriesScopeKey,
            serverBase: LegacyUserProgressSeriesForTests(
                timeZone: requestRange.timeZone,
                from: requestRange.from,
                to: requestRange.to,
                dailyReviews: [
                    ProgressDay(date: requestRange.to, reviewCount: 1)
                ],
                summary: nil,
                generatedAt: "2026-04-18T10:00:00.000Z",
                reviewHistoryWatermarks: []
            ),
            storedAt: "2026-04-18T10:00:00.000Z"
        )
        context.userDefaults.set(try JSONEncoder().encode(summaryCache), forKey: summaryCacheKey)
        context.userDefaults.set(try JSONEncoder().encode(legacySeriesCache), forKey: seriesCacheKey)

        await context.store.refreshProgressIfNeeded(now: now)

        XCTAssertEqual(0, context.cloudSyncService.loadProgressSummaryCallCount)
        XCTAssertEqual(1, context.cloudSyncService.loadProgressSeriesCallCount)
        XCTAssertNotNil(context.store.progressSeriesServerBaseCache)
        XCTAssertNotNil(context.userDefaults.data(forKey: seriesCacheKey))
        XCTAssertEqual(.serverBase, context.store.progressSnapshot?.seriesSourceState)
        XCTAssertEqual(2, context.store.progressSnapshot?.summary.streakFreeze.availableCredits)
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
            streakDays: [],
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
                    reviewCount: 1
                )
            ],
            streakDays: [],
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

private struct LegacyProgressSummaryServerBaseForTests: Codable {
    let scopeKey: ProgressSummaryScopeKey
    let serverBase: LegacyUserProgressSummaryForTests
    let storedAt: String
}

private struct LegacyUserProgressSummaryForTests: Codable {
    let timeZone: String?
    let summary: LegacyProgressSummaryForTests
    let generatedAt: String?
    let reviewHistoryWatermarks: [ProgressReviewHistoryWatermark]
}

private struct LegacyProgressSummaryForTests: Codable {
    let currentStreakDays: Int
    let hasReviewedToday: Bool
    let lastReviewedOn: String?
    let activeReviewDays: Int
}

private struct LegacyProgressSeriesServerBaseForTests: Codable {
    let scopeKey: ProgressScopeKey
    let serverBase: LegacyUserProgressSeriesForTests
    let storedAt: String
}

private struct LegacyUserProgressSeriesForTests: Codable {
    let timeZone: String
    let from: String
    let to: String
    let dailyReviews: [ProgressDay]
    let summary: ProgressSummary?
    let generatedAt: String?
    let reviewHistoryWatermarks: [ProgressReviewHistoryWatermark]
}
