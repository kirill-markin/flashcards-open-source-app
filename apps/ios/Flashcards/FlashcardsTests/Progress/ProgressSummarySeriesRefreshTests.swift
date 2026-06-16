import Foundation
import XCTest
@testable import Flashcards

final class ProgressSummarySeriesRefreshTests: ProgressStoreTestCase {
    @MainActor
    func testRefreshProgressIfNeededExtendsLongServerSummaryWhenRenderedSeriesAddsToday() async throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        let timeZone = try XCTUnwrap(TimeZone(identifier: "UTC"))
        try self.addReviewedCard(
            database: database,
            workspaceId: workspace.workspaceId,
            reviewedAtClient: try makeReviewedAtClientForTests(
                localDate: "2026-04-18",
                hour: 9,
                timeZoneIdentifier: timeZone.identifier
            )
        )
        let outboxEntries = try database.loadOutboxEntries(workspaceId: workspace.workspaceId, limit: Int.max)
        try database.deleteOutboxEntries(operationIds: outboxEntries.map(\.operationId))

        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-18T12:00:00.000Z"))
        let requestRange = try makeTestProgressRequestRange(
            now: now,
            timeZone: timeZone,
            dayCount: 140
        )
        let serverSeries = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [
                "2026-04-17": 1
            ],
            generatedAt: "2026-04-18T11:59:00.000Z"
        )
        let serverSummary = UserProgressSummary(
            timeZone: requestRange.timeZone,
            summary: makeTestProgressSummaryValue(
                currentStreakDays: 200,
                hasReviewedToday: false,
                lastReviewedOn: "2026-04-17",
                activeReviewDays: 200
            ),
            generatedAt: "2026-04-18T11:59:00.000Z",
            reviewHistoryWatermarks: makeTestProgressReviewHistoryWatermarks(reviewSequenceId: 42)
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

        let progressSnapshot = try XCTUnwrap(context.store.progressSnapshot)
        XCTAssertEqual(.serverBaseWithPendingLocalOverlay, progressSnapshot.summarySourceState)
        XCTAssertEqual(.serverBaseWithPendingLocalOverlay, progressSnapshot.seriesSourceState)
        XCTAssertEqual(201, progressSnapshot.summary.currentStreakDays)
        XCTAssertTrue(progressSnapshot.summary.hasReviewedToday)
        XCTAssertEqual("2026-04-18", progressSnapshot.summary.lastReviewedOn)
        XCTAssertEqual(201, progressSnapshot.summary.activeReviewDays)
    }

    @MainActor
    func testRefreshProgressIfNeededReplacesFrozenDayAndExtendsLongServerSummary() async throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        let timeZone = try XCTUnwrap(TimeZone(identifier: "UTC"))
        try self.addReviewedCard(
            database: database,
            workspaceId: workspace.workspaceId,
            reviewedAtClient: try makeReviewedAtClientForTests(
                localDate: "2026-04-17",
                hour: 9,
                timeZoneIdentifier: timeZone.identifier
            )
        )
        try self.addReviewedCard(
            database: database,
            workspaceId: workspace.workspaceId,
            reviewedAtClient: try makeReviewedAtClientForTests(
                localDate: "2026-04-18",
                hour: 9,
                timeZoneIdentifier: timeZone.identifier
            )
        )
        let outboxEntries = try database.loadOutboxEntries(workspaceId: workspace.workspaceId, limit: Int.max)
        try database.deleteOutboxEntries(operationIds: outboxEntries.map(\.operationId))

        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-18T12:00:00.000Z"))
        let requestRange = try makeTestProgressRequestRange(
            now: now,
            timeZone: timeZone,
            dayCount: 140
        )
        let serverSeries = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [
                "2026-04-16": 1
            ],
            generatedAt: "2026-04-18T11:59:00.000Z"
        )
        let serverSummary = UserProgressSummary(
            timeZone: requestRange.timeZone,
            summary: makeTestProgressSummaryValue(
                currentStreakDays: 200,
                hasReviewedToday: false,
                lastReviewedOn: "2026-04-16",
                activeReviewDays: 200
            ),
            generatedAt: "2026-04-18T11:59:00.000Z",
            reviewHistoryWatermarks: makeTestProgressReviewHistoryWatermarks(reviewSequenceId: 42)
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

        let progressSnapshot = try XCTUnwrap(context.store.progressSnapshot)
        XCTAssertEqual(.serverBaseWithPendingLocalOverlay, progressSnapshot.summarySourceState)
        XCTAssertEqual(.serverBaseWithPendingLocalOverlay, progressSnapshot.seriesSourceState)
        XCTAssertEqual(201, progressSnapshot.summary.currentStreakDays)
        XCTAssertTrue(progressSnapshot.summary.hasReviewedToday)
        XCTAssertEqual("2026-04-18", progressSnapshot.summary.lastReviewedOn)
        XCTAssertEqual(202, progressSnapshot.summary.activeReviewDays)
        XCTAssertEqual(1, progressReviewCount(snapshot: progressSnapshot, localDate: "2026-04-16"))
        XCTAssertEqual(1, progressReviewCount(snapshot: progressSnapshot, localDate: "2026-04-17"))
        XCTAssertEqual(1, progressReviewCount(snapshot: progressSnapshot, localDate: "2026-04-18"))
    }

    @MainActor
    func testRefreshProgressIfNeededExtendsLongServerSummaryThroughYesterdayWhenTodayIsInactive() async throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        let timeZone = try XCTUnwrap(TimeZone(identifier: "UTC"))
        try self.addReviewedCard(
            database: database,
            workspaceId: workspace.workspaceId,
            reviewedAtClient: try makeReviewedAtClientForTests(
                localDate: "2026-04-19",
                hour: 9,
                timeZoneIdentifier: timeZone.identifier
            )
        )
        let outboxEntries = try database.loadOutboxEntries(workspaceId: workspace.workspaceId, limit: Int.max)
        try database.deleteOutboxEntries(operationIds: outboxEntries.map(\.operationId))

        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-20T12:00:00.000Z"))
        let requestRange = try makeTestProgressRequestRange(
            now: now,
            timeZone: timeZone,
            dayCount: 140
        )
        let serverSeries = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [
                "2026-04-18": 1
            ],
            generatedAt: "2026-04-20T11:59:00.000Z"
        )
        let serverSummary = UserProgressSummary(
            timeZone: requestRange.timeZone,
            summary: makeTestProgressSummaryValue(
                currentStreakDays: 200,
                hasReviewedToday: false,
                lastReviewedOn: "2026-04-18",
                activeReviewDays: 200
            ),
            generatedAt: "2026-04-20T11:59:00.000Z",
            reviewHistoryWatermarks: makeTestProgressReviewHistoryWatermarks(reviewSequenceId: 42)
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

        let progressSnapshot = try XCTUnwrap(context.store.progressSnapshot)
        XCTAssertEqual(.serverBaseWithPendingLocalOverlay, progressSnapshot.summarySourceState)
        XCTAssertEqual(.serverBaseWithPendingLocalOverlay, progressSnapshot.seriesSourceState)
        XCTAssertEqual(201, progressSnapshot.summary.currentStreakDays)
        XCTAssertFalse(progressSnapshot.summary.hasReviewedToday)
        XCTAssertEqual("2026-04-19", progressSnapshot.summary.lastReviewedOn)
        XCTAssertEqual(201, progressSnapshot.summary.activeReviewDays)
        XCTAssertEqual(1, progressReviewCount(snapshot: progressSnapshot, localDate: "2026-04-18"))
        XCTAssertEqual(1, progressReviewCount(snapshot: progressSnapshot, localDate: "2026-04-19"))
        XCTAssertEqual(0, progressReviewCount(snapshot: progressSnapshot, localDate: "2026-04-20"))
    }

    @MainActor
    func testRefreshProgressIfNeededExtendsStaleSummaryActiveDaysWhenServerSeriesIsFresher() async throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        let timeZone = try XCTUnwrap(TimeZone(identifier: "UTC"))

        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-18T12:00:00.000Z"))
        let requestRange = try makeTestProgressRequestRange(
            now: now,
            timeZone: timeZone,
            dayCount: 140
        )
        let serverSeries = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [
                "2026-04-17": 1,
                "2026-04-18": 1,
            ],
            generatedAt: "2026-04-18T12:00:00.000Z"
        )
        let serverSummary = UserProgressSummary(
            timeZone: requestRange.timeZone,
            summary: makeTestProgressSummaryValue(
                currentStreakDays: 200,
                hasReviewedToday: false,
                lastReviewedOn: "2026-04-17",
                activeReviewDays: 200
            ),
            generatedAt: "2026-04-18T11:59:00.000Z",
            reviewHistoryWatermarks: makeTestProgressReviewHistoryWatermarks(reviewSequenceId: 41)
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

        let progressSnapshot = try XCTUnwrap(context.store.progressSnapshot)
        XCTAssertEqual(.serverBaseWithPendingLocalOverlay, progressSnapshot.summarySourceState)
        XCTAssertEqual(.serverBase, progressSnapshot.seriesSourceState)
        XCTAssertEqual(201, progressSnapshot.summary.currentStreakDays)
        XCTAssertTrue(progressSnapshot.summary.hasReviewedToday)
        XCTAssertEqual("2026-04-18", progressSnapshot.summary.lastReviewedOn)
        XCTAssertEqual(201, progressSnapshot.summary.activeReviewDays)
        XCTAssertEqual(1, progressReviewCount(snapshot: progressSnapshot, localDate: "2026-04-17"))
        XCTAssertEqual(1, progressReviewCount(snapshot: progressSnapshot, localDate: "2026-04-18"))
    }

    @MainActor
    func testRefreshProgressIfNeededExtendsActiveDaysForLocalDateOutsideRenderedSeriesRange() async throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        let timeZone = try XCTUnwrap(TimeZone(identifier: "UTC"))
        try self.addReviewedCard(
            database: database,
            workspaceId: workspace.workspaceId,
            reviewedAtClient: try makeReviewedAtClientForTests(
                localDate: "2025-11-15",
                hour: 9,
                timeZoneIdentifier: timeZone.identifier
            )
        )
        let outboxEntries = try database.loadOutboxEntries(workspaceId: workspace.workspaceId, limit: Int.max)
        try database.deleteOutboxEntries(operationIds: outboxEntries.map(\.operationId))

        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-18T12:00:00.000Z"))
        let requestRange = try makeTestProgressRequestRange(
            now: now,
            timeZone: timeZone,
            dayCount: 140
        )
        let serverSeries = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [:],
            generatedAt: "2026-04-18T11:59:00.000Z"
        )
        let serverSummary = UserProgressSummary(
            timeZone: requestRange.timeZone,
            summary: makeTestProgressSummaryValue(
                currentStreakDays: 0,
                hasReviewedToday: false,
                lastReviewedOn: "2025-11-14",
                activeReviewDays: 200
            ),
            generatedAt: "2026-04-18T11:59:00.000Z",
            reviewHistoryWatermarks: makeTestProgressReviewHistoryWatermarks(reviewSequenceId: 42)
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

        let progressSnapshot = try XCTUnwrap(context.store.progressSnapshot)
        XCTAssertEqual(.serverBaseWithPendingLocalOverlay, progressSnapshot.summarySourceState)
        XCTAssertEqual(.serverBase, progressSnapshot.seriesSourceState)
        XCTAssertEqual(0, progressSnapshot.summary.currentStreakDays)
        XCTAssertFalse(progressSnapshot.summary.hasReviewedToday)
        XCTAssertEqual("2025-11-15", progressSnapshot.summary.lastReviewedOn)
        XCTAssertEqual(201, progressSnapshot.summary.activeReviewDays)
    }

    @MainActor
    func testRefreshProgressIfNeededUsesRenderedSeriesLowerBoundWhenStaleServerSummaryAddsYesterday() async throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        let timeZone = try XCTUnwrap(TimeZone(identifier: "UTC"))
        try self.addReviewedCard(
            database: database,
            workspaceId: workspace.workspaceId,
            reviewedAtClient: try makeReviewedAtClientForTests(
                localDate: "2026-04-17",
                hour: 9,
                timeZoneIdentifier: timeZone.identifier
            )
        )
        let outboxEntries = try database.loadOutboxEntries(workspaceId: workspace.workspaceId, limit: Int.max)
        try database.deleteOutboxEntries(operationIds: outboxEntries.map(\.operationId))

        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-18T12:00:00.000Z"))
        let requestRange = try makeTestProgressRequestRange(
            now: now,
            timeZone: timeZone,
            dayCount: 140
        )
        let serverSeries = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [
                "2026-04-16": 1
            ],
            generatedAt: "2026-04-18T11:59:00.000Z"
        )
        let serverSummary = UserProgressSummary(
            timeZone: requestRange.timeZone,
            summary: makeTestProgressSummaryValue(
                currentStreakDays: 0,
                hasReviewedToday: false,
                lastReviewedOn: "2026-04-16",
                activeReviewDays: 200
            ),
            generatedAt: "2026-04-18T11:59:00.000Z",
            reviewHistoryWatermarks: makeTestProgressReviewHistoryWatermarks(reviewSequenceId: 42)
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

        let progressSnapshot = try XCTUnwrap(context.store.progressSnapshot)
        XCTAssertEqual(.serverBaseWithPendingLocalOverlay, progressSnapshot.summarySourceState)
        XCTAssertEqual(.serverBaseWithPendingLocalOverlay, progressSnapshot.seriesSourceState)
        XCTAssertEqual(2, progressSnapshot.summary.currentStreakDays)
        XCTAssertFalse(progressSnapshot.summary.hasReviewedToday)
        XCTAssertEqual("2026-04-17", progressSnapshot.summary.lastReviewedOn)
        XCTAssertEqual(201, progressSnapshot.summary.activeReviewDays)
    }

    @MainActor
    func testRefreshProgressIfNeededDoesNotDoubleApplyTodayWhenServerAlreadyIncludesToday() async throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        let timeZone = try XCTUnwrap(TimeZone(identifier: "UTC"))
        try self.addReviewedCard(
            database: database,
            workspaceId: workspace.workspaceId,
            reviewedAtClient: try makeReviewedAtClientForTests(
                localDate: "2026-04-18",
                hour: 9,
                timeZoneIdentifier: timeZone.identifier
            )
        )
        let outboxEntries = try database.loadOutboxEntries(workspaceId: workspace.workspaceId, limit: Int.max)
        try database.deleteOutboxEntries(operationIds: outboxEntries.map(\.operationId))

        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-18T12:00:00.000Z"))
        let requestRange = try makeTestProgressRequestRange(
            now: now,
            timeZone: timeZone,
            dayCount: 140
        )
        let serverSeries = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [
                "2026-04-18": 1
            ],
            generatedAt: "2026-04-18T11:59:00.000Z"
        )
        let serverSummary = UserProgressSummary(
            timeZone: requestRange.timeZone,
            summary: makeTestProgressSummaryValue(
                currentStreakDays: 200,
                hasReviewedToday: true,
                lastReviewedOn: "2026-04-18",
                activeReviewDays: 200
            ),
            generatedAt: "2026-04-18T11:59:00.000Z",
            reviewHistoryWatermarks: makeTestProgressReviewHistoryWatermarks(reviewSequenceId: 42)
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

        let progressSnapshot = try XCTUnwrap(context.store.progressSnapshot)
        XCTAssertEqual(.serverBase, progressSnapshot.summarySourceState)
        XCTAssertEqual(.serverBase, progressSnapshot.seriesSourceState)
        XCTAssertEqual(200, progressSnapshot.summary.currentStreakDays)
        XCTAssertTrue(progressSnapshot.summary.hasReviewedToday)
        XCTAssertEqual("2026-04-18", progressSnapshot.summary.lastReviewedOn)
        XCTAssertEqual(200, progressSnapshot.summary.activeReviewDays)
    }

    @MainActor
    func testRefreshProgressIfNeededDoesNotDoubleApplyPastDateWhenSummaryIsFresherThanSeries() async throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        let timeZone = try XCTUnwrap(TimeZone(identifier: "UTC"))
        try self.addReviewedCard(
            database: database,
            workspaceId: workspace.workspaceId,
            reviewedAtClient: try makeReviewedAtClientForTests(
                localDate: "2026-04-17",
                hour: 9,
                timeZoneIdentifier: timeZone.identifier
            )
        )
        let outboxEntries = try database.loadOutboxEntries(workspaceId: workspace.workspaceId, limit: Int.max)
        try database.deleteOutboxEntries(operationIds: outboxEntries.map(\.operationId))

        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-18T12:00:00.000Z"))
        let requestRange = try makeTestProgressRequestRange(
            now: now,
            timeZone: timeZone,
            dayCount: 140
        )
        let staleServerSeries = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [:],
            generatedAt: "2026-04-18T11:58:00.000Z"
        )
        let serverSeries = makeProgressSeries(
            timeZone: staleServerSeries.timeZone,
            from: staleServerSeries.from,
            to: staleServerSeries.to,
            dailyReviews: staleServerSeries.dailyReviews,
            streakDays: staleServerSeries.streakDays,
            summary: staleServerSeries.summary,
            generatedAt: staleServerSeries.generatedAt,
            reviewHistoryWatermarks: makeTestProgressReviewHistoryWatermarks(reviewSequenceId: 41)
        )
        let serverSummary = UserProgressSummary(
            timeZone: requestRange.timeZone,
            summary: makeTestProgressSummaryValue(
                currentStreakDays: 1,
                hasReviewedToday: false,
                lastReviewedOn: "2026-04-17",
                activeReviewDays: 200
            ),
            generatedAt: "2026-04-18T11:59:00.000Z",
            reviewHistoryWatermarks: makeTestProgressReviewHistoryWatermarks(reviewSequenceId: 42)
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

        let progressSnapshot = try XCTUnwrap(context.store.progressSnapshot)
        XCTAssertEqual(.serverBase, progressSnapshot.summarySourceState)
        XCTAssertEqual(.serverBaseWithPendingLocalOverlay, progressSnapshot.seriesSourceState)
        XCTAssertEqual(1, progressSnapshot.summary.currentStreakDays)
        XCTAssertFalse(progressSnapshot.summary.hasReviewedToday)
        XCTAssertEqual("2026-04-17", progressSnapshot.summary.lastReviewedOn)
        XCTAssertEqual(200, progressSnapshot.summary.activeReviewDays)
        XCTAssertEqual(1, progressReviewCount(snapshot: progressSnapshot, localDate: "2026-04-17"))
    }

    @MainActor
    func testRefreshProgressIfNeededMergesStaleServerSummaryWithLocalFallbackAfterPendingClears() async throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        let timeZone = try XCTUnwrap(TimeZone(identifier: "UTC"))
        try self.addReviewedCard(
            database: database,
            workspaceId: workspace.workspaceId,
            reviewedAtClient: try makeReviewedAtClientForTests(
                localDate: "2026-04-17",
                hour: 9,
                timeZoneIdentifier: timeZone.identifier
            )
        )
        try self.addReviewedCard(
            database: database,
            workspaceId: workspace.workspaceId,
            reviewedAtClient: try makeReviewedAtClientForTests(
                localDate: "2026-04-18",
                hour: 9,
                timeZoneIdentifier: timeZone.identifier
            )
        )
        let outboxEntries = try database.loadOutboxEntries(workspaceId: workspace.workspaceId, limit: Int.max)
        try database.deleteOutboxEntries(operationIds: outboxEntries.map(\.operationId))

        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-18T12:00:00.000Z"))
        let requestRange = try makeTestProgressRequestRange(
            now: now,
            timeZone: timeZone,
            dayCount: 140
        )
        let serverSeries = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [
                "2026-04-16": 1
            ],
            generatedAt: "2026-04-18T11:59:00.000Z"
        )
        let serverSummary = try makeTestProgressSummary(
            timeZone: requestRange.timeZone,
            reviewDates: ["2026-04-16"],
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

        let progressSnapshot = try XCTUnwrap(context.store.progressSnapshot)
        XCTAssertEqual(.serverBaseWithPendingLocalOverlay, progressSnapshot.summarySourceState)
        XCTAssertEqual(.serverBaseWithPendingLocalOverlay, progressSnapshot.seriesSourceState)
        XCTAssertFalse(progressSnapshot.isApproximate)
        XCTAssertEqual(3, progressSnapshot.summary.currentStreakDays)
        XCTAssertTrue(progressSnapshot.summary.hasReviewedToday)
        XCTAssertEqual("2026-04-18", progressSnapshot.summary.lastReviewedOn)
        XCTAssertEqual(3, progressSnapshot.summary.activeReviewDays)
        XCTAssertEqual(1, progressReviewCount(snapshot: progressSnapshot, localDate: "2026-04-16"))
        XCTAssertEqual(1, progressReviewCount(snapshot: progressSnapshot, localDate: "2026-04-17"))
        XCTAssertEqual(1, progressReviewCount(snapshot: progressSnapshot, localDate: "2026-04-18"))
        XCTAssertEqual(1, context.cloudSyncService.loadProgressSummaryCallCount)
        XCTAssertEqual(1, context.cloudSyncService.loadProgressSeriesCallCount)
    }

    func testMergeProgressSeriesUsesLocalFallbackAsFloorWithoutDoubleCounting() throws {
        let requestRange = ProgressSeriesLoadRequest(
            apiBaseUrl: "",
            authorizationHeader: "",
            timeZone: "UTC",
            from: "2026-04-15",
            to: "2026-04-18"
        )
        let serverBase = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [
                "2026-04-16": 1,
                "2026-04-17": 2,
                "2026-04-18": 2,
            ],
            generatedAt: "2026-04-18T12:00:00.000Z"
        )
        let pendingLocalOverlay = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [
                "2026-04-17": 1
            ],
            generatedAt: "2026-04-18T12:00:00.000Z"
        )
        let localFallback = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [
                "2026-04-15": 1,
                "2026-04-16": 1,
                "2026-04-17": 2,
                "2026-04-18": 1,
            ],
            generatedAt: "2026-04-18T12:00:00.000Z"
        )

        let mergedSeries = try mergeProgressSeries(
            serverBase: serverBase,
            pendingLocalOverlay: pendingLocalOverlay,
            localFallback: localFallback,
            mergedActiveReviewDates: ["2026-04-15", "2026-04-16", "2026-04-17", "2026-04-18"]
        )
        let mergedCountsByDate = Dictionary(uniqueKeysWithValues: mergedSeries.dailyReviews.map { progressDay in
            (progressDay.date, progressDay.reviewCount)
        })

        XCTAssertEqual(1, mergedCountsByDate["2026-04-15"])
        XCTAssertEqual(1, mergedCountsByDate["2026-04-16"])
        XCTAssertEqual(3, mergedCountsByDate["2026-04-17"])
        XCTAssertEqual(2, mergedCountsByDate["2026-04-18"])
        XCTAssertEqual(serverBase.generatedAt, mergedSeries.generatedAt)
        XCTAssertEqual(serverBase.reviewHistoryWatermarks, mergedSeries.reviewHistoryWatermarks)

        let scopeKey = makeProgressScopeKeyForTests(
            timeZone: requestRange.timeZone,
            from: requestRange.from,
            to: requestRange.to
        )
        let persistedServerBase = PersistedProgressSeriesServerBase(
            scopeKey: scopeKey,
            serverBase: serverBase,
            storedAt: "2026-04-18T12:00:00.000Z"
        )
        let renderedOverlaySeries = try makeProgressRenderedSeries(
            serverBase: persistedServerBase,
            scopeKey: scopeKey,
            localFallbackSeries: localFallback,
            pendingLocalOverlaySeries: pendingLocalOverlay,
            mergedActiveReviewDates: ["2026-04-15", "2026-04-16", "2026-04-17", "2026-04-18"]
        )
        let emptyPendingLocalOverlay = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [:],
            generatedAt: "2026-04-18T12:00:00.000Z"
        )
        let renderedServerSeries = try makeProgressRenderedSeries(
            serverBase: persistedServerBase,
            scopeKey: scopeKey,
            localFallbackSeries: serverBase,
            pendingLocalOverlaySeries: emptyPendingLocalOverlay,
            mergedActiveReviewDates: ["2026-04-16", "2026-04-17", "2026-04-18"]
        )

        XCTAssertEqual(.serverBaseWithPendingLocalOverlay, renderedOverlaySeries.sourceState)
        XCTAssertEqual(.serverBase, renderedServerSeries.sourceState)
    }

    func testMergeProgressSeriesRecomputesFreezeStatesAfterLocalOverlayChangesEarlierDay() throws {
        let requestRange = ProgressSeriesLoadRequest(
            apiBaseUrl: "",
            authorizationHeader: "",
            timeZone: "UTC",
            from: "2026-04-16",
            to: "2026-04-20"
        )
        let serverBase = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [
                "2026-04-16": 1
            ],
            generatedAt: "2026-04-20T12:00:00.000Z"
        )
        let pendingLocalOverlay = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [:],
            generatedAt: "2026-04-20T12:00:00.000Z"
        )
        let localFallback = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [
                "2026-04-16": 1,
                "2026-04-17": 1,
            ],
            generatedAt: "2026-04-20T12:00:00.000Z"
        )

        let mergedSeries = try mergeProgressSeries(
            serverBase: serverBase,
            pendingLocalOverlay: pendingLocalOverlay,
            localFallback: localFallback,
            mergedActiveReviewDates: ["2026-04-16", "2026-04-17"]
        )
        let mergedStatesByDate = Dictionary(uniqueKeysWithValues: mergedSeries.streakDays.map { streakDay in
            (streakDay.date, streakDay.state)
        })

        XCTAssertEqual(.reviewed, try XCTUnwrap(mergedStatesByDate["2026-04-16"]))
        XCTAssertEqual(.reviewed, try XCTUnwrap(mergedStatesByDate["2026-04-17"]))
        XCTAssertEqual(.frozen, try XCTUnwrap(mergedStatesByDate["2026-04-18"]))
        XCTAssertEqual(.frozen, try XCTUnwrap(mergedStatesByDate["2026-04-19"]))
        XCTAssertEqual(.pending, try XCTUnwrap(mergedStatesByDate["2026-04-20"]))
    }

    func testMergeProgressSeriesRecomputesFreezeStatesFromAllTimeActiveDatesOutsideRange() throws {
        let requestRange = ProgressSeriesLoadRequest(
            apiBaseUrl: "",
            authorizationHeader: "",
            timeZone: "UTC",
            from: "2026-04-18",
            to: "2026-04-20"
        )
        let serverBase = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [:],
            generatedAt: "2026-04-20T12:00:00.000Z"
        )
        let pendingLocalOverlay = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [:],
            generatedAt: "2026-04-20T12:00:00.000Z"
        )
        let localFallback = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [:],
            generatedAt: "2026-04-20T12:00:00.000Z"
        )

        let mergedSeries = try mergeProgressSeries(
            serverBase: serverBase,
            pendingLocalOverlay: pendingLocalOverlay,
            localFallback: localFallback,
            mergedActiveReviewDates: ["2026-04-16"]
        )
        let mergedStatesByDate = Dictionary(uniqueKeysWithValues: mergedSeries.streakDays.map { streakDay in
            (streakDay.date, streakDay.state)
        })

        XCTAssertEqual(.frozen, try XCTUnwrap(mergedStatesByDate["2026-04-18"]))
        XCTAssertEqual(.missed, try XCTUnwrap(mergedStatesByDate["2026-04-19"]))
        XCTAssertEqual(.pending, try XCTUnwrap(mergedStatesByDate["2026-04-20"]))
    }

    func testMergeProgressSeriesPreservesServerStreakStatesBeforeLocalOverlayChange() throws {
        let requestRange = ProgressSeriesLoadRequest(
            apiBaseUrl: "",
            authorizationHeader: "",
            timeZone: "UTC",
            from: "2026-04-16",
            to: "2026-04-20"
        )
        let dailyReviews = try makeZeroFilledProgressDays(
            requestRange: ProgressRequestRange(
                timeZone: requestRange.timeZone,
                from: requestRange.from,
                to: requestRange.to
            )
        )
        let serverBase = makeProgressSeries(
            timeZone: requestRange.timeZone,
            from: requestRange.from,
            to: requestRange.to,
            dailyReviews: dailyReviews,
            streakDays: [
                ProgressStreakDay(date: "2026-04-16", state: .frozen),
                ProgressStreakDay(date: "2026-04-17", state: .frozen),
                ProgressStreakDay(date: "2026-04-18", state: .missed),
                ProgressStreakDay(date: "2026-04-19", state: .missed),
                ProgressStreakDay(date: "2026-04-20", state: .pending),
            ],
            summary: nil,
            generatedAt: "2026-04-20T12:00:00.000Z",
            reviewHistoryWatermarks: makeTestProgressReviewHistoryWatermarks(reviewSequenceId: 42)
        )
        let pendingLocalOverlay = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [
                "2026-04-20": 1
            ],
            generatedAt: "2026-04-20T12:00:00.000Z"
        )
        let localFallback = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [:],
            generatedAt: "2026-04-20T12:00:00.000Z"
        )

        let mergedSeries = try mergeProgressSeries(
            serverBase: serverBase,
            pendingLocalOverlay: pendingLocalOverlay,
            localFallback: localFallback,
            mergedActiveReviewDates: ["2026-04-20"]
        )
        let mergedStatesByDate = Dictionary(uniqueKeysWithValues: mergedSeries.streakDays.map { streakDay in
            (streakDay.date, streakDay.state)
        })

        XCTAssertEqual(.frozen, try XCTUnwrap(mergedStatesByDate["2026-04-16"]))
        XCTAssertEqual(.frozen, try XCTUnwrap(mergedStatesByDate["2026-04-17"]))
        XCTAssertEqual(.missed, try XCTUnwrap(mergedStatesByDate["2026-04-18"]))
        XCTAssertEqual(.missed, try XCTUnwrap(mergedStatesByDate["2026-04-19"]))
        XCTAssertEqual(.reviewed, try XCTUnwrap(mergedStatesByDate["2026-04-20"]))
    }

    func testMergeProgressSeriesRecomputesSuffixFromServerFreezeBalanceAfterLocalOverlayChange() throws {
        let requestRange = ProgressSeriesLoadRequest(
            apiBaseUrl: "",
            authorizationHeader: "",
            timeZone: "UTC",
            from: "2026-04-16",
            to: "2026-04-20"
        )
        let dailyReviews = try makeZeroFilledProgressDays(
            requestRange: ProgressRequestRange(
                timeZone: requestRange.timeZone,
                from: requestRange.from,
                to: requestRange.to
            )
        )
        let serverBase = makeProgressSeries(
            timeZone: requestRange.timeZone,
            from: requestRange.from,
            to: requestRange.to,
            dailyReviews: dailyReviews,
            streakDays: [
                ProgressStreakDay(date: "2026-04-16", state: .frozen),
                ProgressStreakDay(date: "2026-04-17", state: .frozen),
                ProgressStreakDay(date: "2026-04-18", state: .missed),
                ProgressStreakDay(date: "2026-04-19", state: .missed),
                ProgressStreakDay(date: "2026-04-20", state: .pending),
            ],
            summary: nil,
            generatedAt: "2026-04-20T12:00:00.000Z",
            reviewHistoryWatermarks: makeTestProgressReviewHistoryWatermarks(reviewSequenceId: 42)
        )
        let pendingLocalOverlay = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [:],
            generatedAt: "2026-04-20T12:00:00.000Z"
        )
        let localFallback = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [
                "2026-04-18": 1
            ],
            generatedAt: "2026-04-20T12:00:00.000Z"
        )

        let mergedSeries = try mergeProgressSeries(
            serverBase: serverBase,
            pendingLocalOverlay: pendingLocalOverlay,
            localFallback: localFallback,
            mergedActiveReviewDates: ["2026-04-18"]
        )
        let mergedStatesByDate = Dictionary(uniqueKeysWithValues: mergedSeries.streakDays.map { streakDay in
            (streakDay.date, streakDay.state)
        })

        XCTAssertEqual(.frozen, try XCTUnwrap(mergedStatesByDate["2026-04-16"]))
        XCTAssertEqual(.frozen, try XCTUnwrap(mergedStatesByDate["2026-04-17"]))
        XCTAssertEqual(.reviewed, try XCTUnwrap(mergedStatesByDate["2026-04-18"]))
        XCTAssertEqual(.missed, try XCTUnwrap(mergedStatesByDate["2026-04-19"]))
        XCTAssertEqual(.pending, try XCTUnwrap(mergedStatesByDate["2026-04-20"]))
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
        XCTAssertEqual(3, context.cloudSyncService.recordedOperations.count)
        XCTAssertTrue(context.cloudSyncService.recordedOperations.contains(.loadProgressSummary))
        XCTAssertTrue(context.cloudSyncService.recordedOperations.contains(.loadProgressSeries))
        XCTAssertTrue(context.cloudSyncService.recordedOperations.contains(.loadProgressReviewSchedule))
        let progressSnapshot = try XCTUnwrap(context.store.progressSnapshot)
        XCTAssertEqual(.serverBaseWithPendingLocalOverlay, progressSnapshot.summarySourceState)
        XCTAssertEqual(.serverBaseWithPendingLocalOverlay, progressSnapshot.seriesSourceState)
        XCTAssertFalse(progressSnapshot.isApproximate)
        XCTAssertEqual(2, progressSnapshot.summary.activeReviewDays)
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
