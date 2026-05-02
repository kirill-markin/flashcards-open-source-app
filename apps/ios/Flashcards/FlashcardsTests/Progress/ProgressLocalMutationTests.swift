import Foundation
import XCTest
@testable import Flashcards

final class ProgressLocalMutationTests: ProgressStoreTestCase {
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
                    timeZone: scopeKey.timeZone,
                    referenceLocalDate: scopeKey.to
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
}
