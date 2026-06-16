import Foundation
import XCTest
@testable import Flashcards

final class ProgressBadgeRefreshTests: ProgressStoreTestCase {
    @MainActor
    func testRefreshReviewLeaderboardBadgeReranksViewerFromCachedServerBaseWithoutNetworkRefresh() async throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()

        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-06-10T14:45:00.000Z"))
        try self.addReviewedCard(
            database: database,
            workspaceId: workspace.workspaceId,
            reviewedAtClient: "2026-06-10T14:30:00.000Z"
        )
        try self.addReviewedCard(
            database: database,
            workspaceId: workspace.workspaceId,
            reviewedAtClient: "2026-06-10T14:31:00.000Z"
        )

        let timeZone = try XCTUnwrap(TimeZone(identifier: "UTC"))
        let requestRange = try makeTestProgressRequestRange(
            now: now,
            timeZone: timeZone,
            dayCount: 140
        )
        let serverSeries = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [:],
            generatedAt: "2026-06-10T14:00:00.000Z"
        )
        let serverSummary = try makeTestProgressSummary(
            timeZone: requestRange.timeZone,
            reviewDates: [],
            generatedAt: "2026-06-10T14:00:00.000Z"
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

        let scopeKey = try context.store.prepareProgressScope(now: now)
        let leaderboardScopeKey = context.store.currentProgressLeaderboardScopeKey(seriesScopeKey: scopeKey)
        context.store.progressLeaderboardServerBaseCache = PersistedProgressLeaderboardServerBase(
            scopeKey: leaderboardScopeKey,
            serverBase: makeReadyProgressLeaderboardForTests(
                defaultWindowKey: .last24Hours,
                participantCount: 3,
                viewer: ProgressLeaderboardViewer(
                    publicProfileId: "profile-viewer",
                    displayName: "You",
                    rank: 3,
                    qualifiedReviewCount: 1
                ),
                rows: [
                    makeProgressLeaderboardParticipantRowForTests(
                        kind: .top,
                        publicProfileId: "profile-top-1",
                        anonymousDisplayName: "Silver Bright Harbor",
                        qualifiedReviewCount: 5,
                        rank: 1
                    ),
                    makeProgressLeaderboardParticipantRowForTests(
                        kind: .top,
                        publicProfileId: "profile-peer-2",
                        anonymousDisplayName: "Amber Calm Meadow",
                        qualifiedReviewCount: 1,
                        rank: 2
                    ),
                    makeProgressLeaderboardParticipantRowForTests(
                        kind: .viewer,
                        publicProfileId: "profile-viewer",
                        anonymousDisplayName: "Indigo Quiet Field",
                        qualifiedReviewCount: 1,
                        rank: 3
                    ),
                ],
                rankingRows: [
                    makeProgressLeaderboardRankingRowForTests(
                        kind: .participant,
                        publicProfileId: "profile-top-1",
                        anonymousDisplayName: "Silver Bright Harbor",
                        qualifiedReviewCount: 5,
                        rank: 1
                    ),
                    makeProgressLeaderboardRankingRowForTests(
                        kind: .participant,
                        publicProfileId: "profile-peer-2",
                        anonymousDisplayName: "Amber Calm Meadow",
                        qualifiedReviewCount: 1,
                        rank: 2
                    ),
                    makeProgressLeaderboardRankingRowForTests(
                        kind: .viewer,
                        publicProfileId: "profile-viewer",
                        anonymousDisplayName: "Indigo Quiet Field",
                        qualifiedReviewCount: 1,
                        rank: 3
                    ),
                ]
            ),
            storedAt: "2026-06-10T14:00:05.000Z"
        )

        await context.store.refreshReviewLeaderboardBadgeIfNeeded(now: now)

        XCTAssertEqual(
            ReviewLeaderboardBadgeState(
                rank: 2,
                windowKey: .last24Hours,
                isInteractive: true
            ),
            context.store.reviewLeaderboardBadgeState
        )
        XCTAssertEqual(0, context.cloudSyncService.loadProgressLeaderboardCallCount)
    }

    @MainActor
    func testRefreshReviewProgressBadgeKeepsLocalTodayReviewWhenServerSummaryIsStale() async throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()

        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-18T12:00:00.000Z"))
        let timeZone = try XCTUnwrap(TimeZone(identifier: "UTC"))
        let requestRange = try makeTestProgressRequestRange(
            now: now,
            timeZone: timeZone,
            dayCount: 140
        )
        try self.addReviewedCard(
            database: database,
            workspaceId: workspace.workspaceId,
            reviewedAtClient: try makeReviewedAtClientForTests(
                localDate: "2026-04-18",
                hour: 9,
                timeZoneIdentifier: requestRange.timeZone
            )
        )
        let outboxEntries = try database.loadOutboxEntries(workspaceId: workspace.workspaceId, limit: Int.max)
        try database.deleteOutboxEntries(operationIds: outboxEntries.map(\.operationId))

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

        await context.store.refreshReviewProgressBadgeIfNeeded(now: now)

        XCTAssertNil(context.store.progressSnapshot)
        XCTAssertEqual(
            ReviewProgressBadgeState(
                streakDays: 1,
                hasReviewedToday: true,
                streakFreezeAvailableCredits: 2,
                streakFreezeCapacity: 2,
                showsStreakFreezeBank: true,
                isInteractive: true
            ),
            context.store.reviewProgressBadgeState
        )
        XCTAssertEqual(1, context.cloudSyncService.loadProgressSummaryCallCount)
        XCTAssertEqual(0, context.cloudSyncService.loadProgressSeriesCallCount)
    }

    @MainActor
    func testRefreshReviewProgressBadgePatchesServerBaseWithPendingTodayReview() async throws {
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
        try self.addReviewedCard(
            database: database,
            workspaceId: workspace.workspaceId,
            reviewedAtClient: try makeReviewedAtClientForTests(
                localDate: "2026-04-18",
                hour: 9,
                timeZoneIdentifier: requestRange.timeZone
            )
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

        await context.store.refreshReviewProgressBadgeIfNeeded(now: now)

        XCTAssertNil(context.store.progressSnapshot)
        XCTAssertEqual(
            ReviewProgressBadgeState(
                streakDays: 201,
                hasReviewedToday: true,
                streakFreezeAvailableCredits: 2,
                streakFreezeCapacity: 2,
                showsStreakFreezeBank: true,
                isInteractive: true
            ),
            context.store.reviewProgressBadgeState
        )
        XCTAssertEqual(1, context.cloudSyncService.loadProgressSummaryCallCount)
        XCTAssertEqual(0, context.cloudSyncService.loadProgressSeriesCallCount)
    }

    @MainActor
    func testRefreshReviewProgressBadgeExtendsLongServerStreakWithLocalTodayReview() async throws {
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

        await context.store.refreshReviewProgressBadgeIfNeeded(now: now)

        XCTAssertNil(context.store.progressSnapshot)
        XCTAssertEqual(
            ReviewProgressBadgeState(
                streakDays: 201,
                hasReviewedToday: true,
                streakFreezeAvailableCredits: 2,
                streakFreezeCapacity: 2,
                showsStreakFreezeBank: true,
                isInteractive: true
            ),
            context.store.reviewProgressBadgeState
        )
        XCTAssertEqual(1, context.cloudSyncService.loadProgressSummaryCallCount)
        XCTAssertEqual(0, context.cloudSyncService.loadProgressSeriesCallCount)
    }

    @MainActor
    func testRefreshReviewProgressBadgeDoesNotExtendServerFrozenReplacementWithoutSeriesBase() async throws {
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
            summary: ProgressSummary(
                currentStreakDays: 2,
                longestStreakDays: 2,
                hasReviewedToday: false,
                lastReviewedOn: "2026-04-16",
                activeReviewDays: 1,
                streakFreeze: makeTestProgressStreakFreeze(availableCredits: 1, balanceUnits: 11)
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

        await context.store.refreshReviewProgressBadgeIfNeeded(now: now)

        XCTAssertNil(context.store.progressSnapshot)
        XCTAssertEqual(
            ReviewProgressBadgeState(
                streakDays: 2,
                hasReviewedToday: false,
                streakFreezeAvailableCredits: 1,
                streakFreezeCapacity: 2,
                showsStreakFreezeBank: true,
                isInteractive: true
            ),
            context.store.reviewProgressBadgeState
        )
        XCTAssertEqual(1, context.cloudSyncService.loadProgressSummaryCallCount)
        XCTAssertEqual(0, context.cloudSyncService.loadProgressSeriesCallCount)
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
                streakFreezeAvailableCredits: 2,
                streakFreezeCapacity: 2,
                showsStreakFreezeBank: true,
                isInteractive: true
            ),
            context.store.reviewProgressBadgeState
        )
        XCTAssertEqual(1, context.cloudSyncService.loadProgressSummaryCallCount)
        XCTAssertEqual(0, context.cloudSyncService.loadProgressSeriesCallCount)
    }
}
