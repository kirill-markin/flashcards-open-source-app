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
    func testProgressStreakLeaderboardRefreshCachesSeparatelyAndUsesNextRefreshAfter() async throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()

        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-06-10T12:30:00.000Z"))
        let beforeNextRefresh = try XCTUnwrap(parseIsoTimestamp(value: "2026-06-10T13:30:00.000Z"))
        let timeZone = try XCTUnwrap(TimeZone(identifier: "UTC"))
        let requestRange = try makeTestProgressRequestRange(
            now: now,
            timeZone: timeZone,
            dayCount: 140
        )
        let serverSeries = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [:],
            generatedAt: "2026-06-10T12:00:00.000Z"
        )
        let serverSummary = try makeTestProgressSummary(
            timeZone: requestRange.timeZone,
            reviewDates: [],
            generatedAt: "2026-06-10T12:00:00.000Z"
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
        context.cloudSyncService.serverProgressStreakLeaderboard = makeReadyProgressStreakLeaderboardForTests(
            participantCount: 2,
            viewer: ProgressStreakLeaderboardViewer(
                publicProfileId: "profile-viewer",
                displayName: "You",
                rank: 2,
                streakDays: 0
            ),
            rows: [
                makeProgressStreakLeaderboardParticipantRowForTests(
                    kind: .top,
                    publicProfileId: "profile-top",
                    anonymousDisplayName: "Silver Bright Harbor",
                    streakDays: 3,
                    rank: 1
                ),
                makeProgressStreakLeaderboardParticipantRowForTests(
                    kind: .viewer,
                    publicProfileId: "profile-viewer",
                    anonymousDisplayName: "Indigo Quiet Field",
                    streakDays: 0,
                    rank: 2
                ),
            ],
            rankingRows: [
                makeProgressStreakLeaderboardRankingRowForTests(
                    kind: .participant,
                    publicProfileId: "profile-top",
                    anonymousDisplayName: "Silver Bright Harbor",
                    streakDays: 3,
                    rank: 1
                ),
                makeProgressStreakLeaderboardRankingRowForTests(
                    kind: .viewer,
                    publicProfileId: "profile-viewer",
                    anonymousDisplayName: "Indigo Quiet Field",
                    streakDays: 0,
                    rank: 2
                ),
            ],
            snapshotGeneratedAt: "2026-06-10T12:00:05.000Z",
            nextRefreshAfter: "2026-06-11T12:00:00.000Z"
        )

        await context.store.refreshProgressIfNeeded(now: now)

        XCTAssertEqual(1, context.cloudSyncService.loadProgressStreakLeaderboardCallCount)
        XCTAssertEqual(.snapshotUnavailable, context.store.progressLeaderboardServerBaseCache?.serverBase.status)
        XCTAssertEqual(.ready, context.store.progressStreakLeaderboardServerBaseCache?.serverBase.status)

        await context.store.refreshProgressIfNeeded(now: beforeNextRefresh)

        XCTAssertEqual(1, context.cloudSyncService.loadProgressStreakLeaderboardCallCount)
    }

    @MainActor
    func testManualProgressRefreshReprojectsStreakLeaderboardAfterFreshProgress() async throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()

        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-06-10T12:30:00.000Z"))
        let timeZone = try XCTUnwrap(TimeZone(identifier: "UTC"))
        let requestRange = try makeTestProgressRequestRange(
            now: now,
            timeZone: timeZone,
            dayCount: 140
        )
        let initialServerSeries = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [:],
            generatedAt: "2026-06-10T12:00:00.000Z"
        )
        let initialServerSummary = try makeTestProgressSummary(
            timeZone: requestRange.timeZone,
            reviewDates: [],
            generatedAt: "2026-06-10T12:00:00.000Z"
        )
        let context = try self.makeProgressStoreContext(
            database: database,
            workspaceId: workspace.workspaceId,
            installationId: cloudSettings.installationId,
            serverSummary: initialServerSummary,
            serverSeries: initialServerSeries,
            loadProgressSummaryError: nil,
            loadProgressSeriesError: nil,
            cloudState: .linked
        )
        defer { context.tearDown() }

        let linkedUserId = try XCTUnwrap(context.store.cloudSettings?.linkedUserId)
        context.store.cloudRuntime.setActiveCloudSession(
            linkedSession: makeProgressLinkedSessionForBadgeTests(
                userId: linkedUserId,
                workspaceId: workspace.workspaceId,
                apiBaseUrl: context.apiBaseUrl
            )
        )
        context.cloudSyncService.serverProgressStreakLeaderboard = makeReadyProgressStreakLeaderboardForTests(
            participantCount: 2,
            viewer: ProgressStreakLeaderboardViewer(
                publicProfileId: "profile-viewer",
                displayName: "You",
                rank: 2,
                streakDays: 0
            ),
            rows: [
                makeProgressStreakLeaderboardParticipantRowForTests(
                    kind: .top,
                    publicProfileId: "profile-peer",
                    anonymousDisplayName: "Amber Calm Meadow",
                    streakDays: 1,
                    rank: 1
                ),
                makeProgressStreakLeaderboardParticipantRowForTests(
                    kind: .viewer,
                    publicProfileId: "profile-viewer",
                    anonymousDisplayName: "Indigo Quiet Field",
                    streakDays: 0,
                    rank: 2
                ),
            ],
            rankingRows: [
                makeProgressStreakLeaderboardRankingRowForTests(
                    kind: .participant,
                    publicProfileId: "profile-peer",
                    anonymousDisplayName: "Amber Calm Meadow",
                    streakDays: 1,
                    rank: 1
                ),
                makeProgressStreakLeaderboardRankingRowForTests(
                    kind: .viewer,
                    publicProfileId: "profile-viewer",
                    anonymousDisplayName: "Indigo Quiet Field",
                    streakDays: 0,
                    rank: 2
                ),
            ],
            snapshotGeneratedAt: "2026-06-10T00:00:05.000Z",
            nextRefreshAfter: "2026-06-11T00:00:00.000Z"
        )

        await context.store.refreshProgressIfNeeded(now: now)
        let initialReadyState = try progressStreakLeaderboardReadyStateForBadgeTests(
            snapshot: try XCTUnwrap(context.store.progressStreakLeaderboardSnapshot)
        )
        XCTAssertEqual(2, initialReadyState.viewerRank)
        XCTAssertEqual(0, initialReadyState.viewerStreakDays)

        context.cloudSyncService.serverSeries = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [
                requestRange.to: 1
            ],
            generatedAt: "2026-06-10T12:20:00.000Z"
        )
        context.cloudSyncService.serverSummary = try makeTestProgressSummary(
            timeZone: requestRange.timeZone,
            reviewDates: [requestRange.to],
            generatedAt: "2026-06-10T12:20:00.000Z"
        )

        await context.store.refreshProgressManually(now: now)

        let progressSnapshot = try XCTUnwrap(context.store.progressSnapshot)
        XCTAssertEqual(1, progressSnapshot.summary.currentStreakDays)
        let readyState = try progressStreakLeaderboardReadyStateForBadgeTests(
            snapshot: try XCTUnwrap(context.store.progressStreakLeaderboardSnapshot)
        )
        XCTAssertEqual(1, readyState.viewerRank)
        XCTAssertEqual(1, readyState.viewerStreakDays)
    }

    @MainActor
    func testProgressLeaderboardRefreshErrorsAreSeparatedByMetric() async throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()

        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-06-10T12:30:00.000Z"))
        let timeZone = try XCTUnwrap(TimeZone(identifier: "UTC"))
        let requestRange = try makeTestProgressRequestRange(
            now: now,
            timeZone: timeZone,
            dayCount: 140
        )
        let serverSeries = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [:],
            generatedAt: "2026-06-10T12:00:00.000Z"
        )
        let serverSummary = try makeTestProgressSummary(
            timeZone: requestRange.timeZone,
            reviewDates: [],
            generatedAt: "2026-06-10T12:00:00.000Z"
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
        let linkedSession = makeProgressLinkedSessionForBadgeTests(
            userId: linkedUserId,
            workspaceId: workspace.workspaceId,
            apiBaseUrl: context.apiBaseUrl
        )
        let scopeKey = try context.store.prepareProgressScope(now: now)
        let leaderboardScopeKey = context.store.currentProgressLeaderboardScopeKey(seriesScopeKey: scopeKey)

        context.cloudSyncService.loadProgressLeaderboardError = LocalStoreError.validation(
            "Rating leaderboard refresh failed"
        )
        await context.store.refreshProgressLeaderboardServerBase(
            scopeKey: leaderboardScopeKey,
            linkedSession: linkedSession
        )
        XCTAssertFalse(context.store.progressErrorState.leaderboardRefreshMessage.isEmpty)
        XCTAssertTrue(context.store.progressErrorState.streakLeaderboardRefreshMessage.isEmpty)

        await context.store.refreshProgressStreakLeaderboardServerBase(
            scopeKey: leaderboardScopeKey,
            linkedSession: linkedSession
        )
        XCTAssertFalse(context.store.progressErrorState.leaderboardRefreshMessage.isEmpty)
        XCTAssertTrue(context.store.progressErrorState.streakLeaderboardRefreshMessage.isEmpty)

        context.store.clearProgressLeaderboardRefreshErrorMessage()
        context.cloudSyncService.loadProgressLeaderboardError = nil
        context.cloudSyncService.loadProgressStreakLeaderboardError = LocalStoreError.validation(
            "Streak leaderboard refresh failed"
        )
        await context.store.refreshProgressStreakLeaderboardServerBase(
            scopeKey: leaderboardScopeKey,
            linkedSession: linkedSession
        )
        XCTAssertTrue(context.store.progressErrorState.leaderboardRefreshMessage.isEmpty)
        XCTAssertFalse(context.store.progressErrorState.streakLeaderboardRefreshMessage.isEmpty)

        await context.store.refreshProgressLeaderboardServerBase(
            scopeKey: leaderboardScopeKey,
            linkedSession: linkedSession
        )
        XCTAssertTrue(context.store.progressErrorState.leaderboardRefreshMessage.isEmpty)
        XCTAssertFalse(context.store.progressErrorState.streakLeaderboardRefreshMessage.isEmpty)
    }

    @MainActor
    func testLeaderboardParticipationChangeClearsRatingAndStreakCaches() async throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()

        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-06-10T12:30:00.000Z"))
        let timeZone = try XCTUnwrap(TimeZone(identifier: "UTC"))
        let requestRange = try makeTestProgressRequestRange(
            now: now,
            timeZone: timeZone,
            dayCount: 140
        )
        let serverSeries = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [:],
            generatedAt: "2026-06-10T12:00:00.000Z"
        )
        let serverSummary = try makeTestProgressSummary(
            timeZone: requestRange.timeZone,
            reviewDates: [],
            generatedAt: "2026-06-10T12:00:00.000Z"
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
            linkedSession: makeProgressLinkedSessionForBadgeTests(
                userId: linkedUserId,
                workspaceId: workspace.workspaceId,
                apiBaseUrl: context.apiBaseUrl
            )
        )
        let scopeKey = try context.store.prepareProgressSnapshot(now: now)
        let leaderboardScopeKey = context.store.currentProgressLeaderboardScopeKey(seriesScopeKey: scopeKey)
        let ratingServerBase = PersistedProgressLeaderboardServerBase(
            scopeKey: leaderboardScopeKey,
            serverBase: makeNonReadyProgressLeaderboardForTests(status: .snapshotUnavailable),
            storedAt: "2026-06-10T12:00:05.000Z"
        )
        let streakServerBase = PersistedProgressStreakLeaderboardServerBase(
            scopeKey: leaderboardScopeKey,
            serverBase: makeReadyProgressStreakLeaderboardForTests(
                participantCount: 1,
                viewer: ProgressStreakLeaderboardViewer(
                    publicProfileId: "profile-viewer",
                    displayName: "You",
                    rank: 1,
                    streakDays: 4
                ),
                rows: [
                    makeProgressStreakLeaderboardParticipantRowForTests(
                        kind: .viewer,
                        publicProfileId: "profile-viewer",
                        anonymousDisplayName: "Indigo Quiet Field",
                        streakDays: 4,
                        rank: 1
                    ),
                ],
                rankingRows: [
                    makeProgressStreakLeaderboardRankingRowForTests(
                        kind: .viewer,
                        publicProfileId: "profile-viewer",
                        anonymousDisplayName: "Indigo Quiet Field",
                        streakDays: 4,
                        rank: 1
                    ),
                ],
                snapshotGeneratedAt: "2026-06-10T00:00:05.000Z",
                nextRefreshAfter: "2026-06-11T00:00:00.000Z"
            ),
            storedAt: "2026-06-10T00:00:05.000Z"
        )
        try context.store.persistProgressLeaderboardServerBase(serverBase: ratingServerBase)
        try context.store.persistProgressStreakLeaderboardServerBase(serverBase: streakServerBase)
        context.store.progressLeaderboardServerBaseCache = ratingServerBase
        context.store.progressStreakLeaderboardServerBaseCache = streakServerBase
        context.store.communityPublicProfile = makeCommunityPublicProfileForProgressTests(
            leaderboardParticipationEnabled: true
        )
        context.cloudSyncService.updatedCommunityPublicProfile = makeCommunityPublicProfileForProgressTests(
            leaderboardParticipationEnabled: false
        )
        context.store.publishProgressStreakLeaderboardSnapshotIsolatingErrors(
            scopeKey: leaderboardScopeKey,
            seriesScopeKey: scopeKey,
            now: now
        )
        let initialReadyState = try progressStreakLeaderboardReadyStateForBadgeTests(
            snapshot: try XCTUnwrap(context.store.progressStreakLeaderboardSnapshot)
        )
        XCTAssertEqual(4, initialReadyState.viewerStreakDays)

        try await context.store.updateLeaderboardParticipationEnabled(isEnabled: false)

        XCTAssertEqual(1, context.cloudSyncService.updateCommunityLeaderboardParticipationCallCount)
        XCTAssertEqual(
            false,
            try XCTUnwrap(context.cloudSyncService.lastUpdateCommunityLeaderboardParticipationEnabled)
        )
        XCTAssertNil(context.store.loadPersistedProgressLeaderboardServerBase(scopeKey: leaderboardScopeKey))
        XCTAssertNil(context.store.loadPersistedProgressStreakLeaderboardServerBase(scopeKey: leaderboardScopeKey))
        XCTAssertNil(context.store.progressLeaderboardServerBaseCache)
        XCTAssertNil(context.store.progressStreakLeaderboardServerBaseCache)
        let readyState = try progressStreakLeaderboardReadyStateForBadgeTests(
            snapshot: try XCTUnwrap(context.store.progressStreakLeaderboardSnapshot)
        )
        XCTAssertEqual(0, readyState.viewerStreakDays)
        let participantRows = readyState.rows.compactMap { row -> ProgressStreakLeaderboardParticipantRowState? in
            guard case .participant(let participantRow) = row else {
                return nil
            }

            return participantRow
        }
        XCTAssertEqual(1, participantRows.count)
        XCTAssertNil(participantRows.first?.publicProfileId)
    }

    @MainActor
    func testRemoteCommunityProfileRefreshClearsRatingAndStreakCachesWhenParticipationChanges() async throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()

        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-06-10T12:30:00.000Z"))
        let timeZone = try XCTUnwrap(TimeZone(identifier: "UTC"))
        let requestRange = try makeTestProgressRequestRange(
            now: now,
            timeZone: timeZone,
            dayCount: 140
        )
        let serverSeries = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [:],
            generatedAt: "2026-06-10T12:00:00.000Z"
        )
        let serverSummary = try makeTestProgressSummary(
            timeZone: requestRange.timeZone,
            reviewDates: [],
            generatedAt: "2026-06-10T12:00:00.000Z"
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
            linkedSession: makeProgressLinkedSessionForBadgeTests(
                userId: linkedUserId,
                workspaceId: workspace.workspaceId,
                apiBaseUrl: context.apiBaseUrl
            )
        )
        let scopeKey = try context.store.prepareProgressSnapshot(now: now)
        let leaderboardScopeKey = context.store.currentProgressLeaderboardScopeKey(seriesScopeKey: scopeKey)
        let ratingServerBase = PersistedProgressLeaderboardServerBase(
            scopeKey: leaderboardScopeKey,
            serverBase: makeNonReadyProgressLeaderboardForTests(status: .snapshotUnavailable),
            storedAt: "2026-06-10T12:00:05.000Z"
        )
        let streakServerBase = PersistedProgressStreakLeaderboardServerBase(
            scopeKey: leaderboardScopeKey,
            serverBase: makeReadyProgressStreakLeaderboardForTests(
                participantCount: 1,
                viewer: ProgressStreakLeaderboardViewer(
                    publicProfileId: "profile-viewer",
                    displayName: "You",
                    rank: 1,
                    streakDays: 4
                ),
                rows: [
                    makeProgressStreakLeaderboardParticipantRowForTests(
                        kind: .viewer,
                        publicProfileId: "profile-viewer",
                        anonymousDisplayName: "Indigo Quiet Field",
                        streakDays: 4,
                        rank: 1
                    ),
                ],
                rankingRows: [
                    makeProgressStreakLeaderboardRankingRowForTests(
                        kind: .viewer,
                        publicProfileId: "profile-viewer",
                        anonymousDisplayName: "Indigo Quiet Field",
                        streakDays: 4,
                        rank: 1
                    ),
                ],
                snapshotGeneratedAt: "2026-06-10T00:00:05.000Z",
                nextRefreshAfter: "2026-06-11T00:00:00.000Z"
            ),
            storedAt: "2026-06-10T00:00:05.000Z"
        )
        try context.store.persistProgressLeaderboardServerBase(serverBase: ratingServerBase)
        try context.store.persistProgressStreakLeaderboardServerBase(serverBase: streakServerBase)
        context.store.progressLeaderboardServerBaseCache = ratingServerBase
        context.store.progressStreakLeaderboardServerBaseCache = streakServerBase
        context.store.communityPublicProfile = makeCommunityPublicProfileForProgressTests(
            leaderboardParticipationEnabled: true
        )
        context.cloudSyncService.serverCommunityPublicProfile = makeCommunityPublicProfileForProgressTests(
            leaderboardParticipationEnabled: false
        )
        context.store.publishProgressStreakLeaderboardSnapshotIsolatingErrors(
            scopeKey: leaderboardScopeKey,
            seriesScopeKey: scopeKey,
            now: now
        )
        let initialReadyState = try progressStreakLeaderboardReadyStateForBadgeTests(
            snapshot: try XCTUnwrap(context.store.progressStreakLeaderboardSnapshot)
        )
        XCTAssertEqual(4, initialReadyState.viewerStreakDays)

        try await context.store.refreshCommunityPublicProfileIfAvailable()

        XCTAssertEqual(1, context.cloudSyncService.loadCommunityPublicProfileCallCount)
        XCTAssertNil(context.store.loadPersistedProgressLeaderboardServerBase(scopeKey: leaderboardScopeKey))
        XCTAssertNil(context.store.loadPersistedProgressStreakLeaderboardServerBase(scopeKey: leaderboardScopeKey))
        XCTAssertNil(context.store.progressLeaderboardServerBaseCache)
        XCTAssertNil(context.store.progressStreakLeaderboardServerBaseCache)
        let readyState = try progressStreakLeaderboardReadyStateForBadgeTests(
            snapshot: try XCTUnwrap(context.store.progressStreakLeaderboardSnapshot)
        )
        XCTAssertEqual(0, readyState.viewerStreakDays)
        let participantRows = readyState.rows.compactMap { row -> ProgressStreakLeaderboardParticipantRowState? in
            guard case .participant(let participantRow) = row else {
                return nil
            }

            return participantRow
        }
        XCTAssertEqual(1, participantRows.count)
        XCTAssertNil(participantRows.first?.publicProfileId)
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

private func makeProgressLinkedSessionForBadgeTests(
    userId: String,
    workspaceId: String,
    apiBaseUrl: String
) -> CloudLinkedSession {
    CloudLinkedSession(
        userId: userId,
        workspaceId: workspaceId,
        email: nil,
        configurationMode: .official,
        apiBaseUrl: apiBaseUrl,
        authorization: .bearer("id-token-1")
    )
}

private func progressStreakLeaderboardReadyStateForBadgeTests(
    snapshot: ProgressStreakLeaderboardSnapshot
) throws -> ProgressStreakLeaderboardReadyState {
    guard case .ready(let readyState) = snapshot.state else {
        throw LocalStoreError.validation("Expected a ready streak leaderboard snapshot")
    }

    return readyState
}
