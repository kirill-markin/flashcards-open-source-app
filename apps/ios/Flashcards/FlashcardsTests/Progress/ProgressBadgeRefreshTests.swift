import Foundation
import XCTest
@testable import Flashcards

final class ProgressBadgeRefreshTests: ProgressStoreTestCase {
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
