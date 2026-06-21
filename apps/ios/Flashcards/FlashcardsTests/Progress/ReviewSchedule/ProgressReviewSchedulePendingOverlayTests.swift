import Foundation
import XCTest
@testable import Flashcards

final class ProgressReviewSchedulePendingOverlayTests: ProgressStoreTestCase {
    @MainActor
    func testLinkedReviewSchedulePendingOverlayUsesCompleteHydratedLocalCoverage() async throws {
        let database = try self.makeDatabase()
        let cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-18T12:00:00.000Z"))
        let dueToday = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-18T08:00:00.000Z"))
        for _ in 0..<4 {
            _ = try self.addDueReviewScheduleCard(
                database: database,
                workspaceId: workspace.workspaceId,
                dueAt: dueToday
            )
        }
        let outboxEntries = try database.loadOutboxEntries(
            workspaceId: workspace.workspaceId,
            limit: Int.max
        )
        try database.deleteOutboxEntries(operationIds: outboxEntries.map(\.operationId))
        try database.setHasHydratedHotState(
            workspaceId: workspace.workspaceId,
            hasHydratedHotState: true
        )

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
        let serverReviewSchedule = makeTestReviewSchedule(
            timeZone: requestRange.timeZone,
            countsByBucketKey: [
                .today: 4
            ],
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
            cloudState: .linked
        )
        defer { context.tearDown() }
        context.cloudSyncService.serverReviewSchedule = serverReviewSchedule
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

        await context.store.refreshProgressIfNeeded(now: now)
        context.store.updateCurrentVisibleTab(tab: .progress)
        _ = try self.addNewReviewScheduleCard(
            database: database,
            workspaceId: workspace.workspaceId
        )

        context.store.handleReviewScheduleLocalCardStateDidChange(now: now)

        let reviewScheduleSnapshot = try XCTUnwrap(context.store.reviewScheduleSnapshot)
        XCTAssertEqual(.serverBaseWithPendingLocalOverlay, reviewScheduleSnapshot.sourceState)
        XCTAssertTrue(reviewScheduleSnapshot.isApproximate)
        XCTAssertEqual(5, reviewScheduleSnapshot.schedule.totalCards)
        XCTAssertEqual(1, reviewScheduleCount(snapshot: reviewScheduleSnapshot, key: .new))
        XCTAssertEqual(4, reviewScheduleCount(snapshot: reviewScheduleSnapshot, key: .today))
    }

    @MainActor
    func testLinkedReviewSchedulePendingOverlayKeepsServerBaseWhenLocalTotalDeltaDoesNotReconcile() async throws {
        let database = try self.makeDatabase()
        let cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-18T12:00:00.000Z"))
        try database.setHasHydratedHotState(
            workspaceId: workspace.workspaceId,
            hasHydratedHotState: true
        )

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
        let serverReviewSchedule = makeTestReviewSchedule(
            timeZone: requestRange.timeZone,
            countsByBucketKey: [
                .today: 4
            ],
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
            cloudState: .linked
        )
        defer { context.tearDown() }
        context.cloudSyncService.serverReviewSchedule = serverReviewSchedule
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

        await context.store.refreshProgressIfNeeded(now: now)
        context.store.updateCurrentVisibleTab(tab: .progress)
        _ = try self.addNewReviewScheduleCard(
            database: database,
            workspaceId: workspace.workspaceId
        )

        context.store.handleReviewScheduleLocalCardStateDidChange(now: now)

        let reviewScheduleSnapshot = try XCTUnwrap(context.store.reviewScheduleSnapshot)
        XCTAssertEqual(.serverBaseWithPendingLocalOverlay, reviewScheduleSnapshot.sourceState)
        XCTAssertTrue(reviewScheduleSnapshot.isApproximate)
        XCTAssertEqual(4, reviewScheduleSnapshot.schedule.totalCards)
        XCTAssertEqual(0, reviewScheduleCount(snapshot: reviewScheduleSnapshot, key: .new))
        XCTAssertEqual(4, reviewScheduleCount(snapshot: reviewScheduleSnapshot, key: .today))
        XCTAssertTrue(context.store.progressErrorState.reviewScheduleRenderMessage.isEmpty)
    }

    @MainActor
    func testReviewSchedulePendingOverlayIgnoresTextOnlyCardEdits() async throws {
        let database = try self.makeDatabase()
        let cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let existingCard = try database.saveCard(
            workspaceId: workspace.workspaceId,
            input: CardEditorInput(
                frontText: "Question",
                backText: "Answer",
                tags: [],
            ),
            cardId: nil
        )
        let initialOutboxEntries = try database.loadOutboxEntries(
            workspaceId: workspace.workspaceId,
            limit: Int.max
        )
        try database.deleteOutboxEntries(operationIds: initialOutboxEntries.map(\.operationId))

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
        let serverReviewSchedule = makeTestReviewSchedule(
            timeZone: requestRange.timeZone,
            countsByBucketKey: [
                .today: 4
            ],
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
        context.cloudSyncService.serverReviewSchedule = serverReviewSchedule

        await context.store.refreshProgressIfNeeded(now: now)
        let scopeKey = try XCTUnwrap(context.store.progressObservedScopeKey)
        let scheduleScopeKey = reviewScheduleScopeKey(seriesScopeKey: scopeKey)
        _ = try database.saveCard(
            workspaceId: workspace.workspaceId,
            input: CardEditorInput(
                frontText: "Updated question",
                backText: "Updated answer",
                tags: ["edited"],
            ),
            cardId: existingCard.cardId
        )

        XCTAssertFalse(
            try database.hasPendingReviewScheduleImpactingCardOperation(
                workspaceId: workspace.workspaceId,
                installationId: cloudSettings.installationId
            )
        )
        try context.store.publishReviewScheduleSnapshot(scopeKey: scheduleScopeKey)

        let textOnlySnapshot = try XCTUnwrap(context.store.reviewScheduleSnapshot)
        XCTAssertEqual(.serverBase, textOnlySnapshot.sourceState)
        XCTAssertEqual(4, textOnlySnapshot.schedule.totalCards)
        XCTAssertEqual(4, reviewScheduleCount(snapshot: textOnlySnapshot, key: .today))

        let textEditOutboxEntries = try database.loadOutboxEntries(
            workspaceId: workspace.workspaceId,
            limit: Int.max
        )
        try database.deleteOutboxEntries(operationIds: textEditOutboxEntries.map(\.operationId))
        context.store.updateCurrentVisibleTab(tab: .progress)
        _ = try database.saveCard(
            workspaceId: workspace.workspaceId,
            input: CardEditorInput(
                frontText: "New question",
                backText: "New answer",
                tags: [],
            ),
            cardId: nil
        )
        context.store.handleReviewScheduleLocalCardStateDidChange(now: now)

        let createSnapshot = try XCTUnwrap(context.store.reviewScheduleSnapshot)
        XCTAssertEqual(.serverBaseWithPendingLocalOverlay, createSnapshot.sourceState)
        XCTAssertTrue(createSnapshot.isApproximate)
        XCTAssertEqual(4, createSnapshot.schedule.totalCards)
        XCTAssertEqual(4, reviewScheduleCount(snapshot: createSnapshot, key: .today))
        XCTAssertEqual(0, reviewScheduleCount(snapshot: createSnapshot, key: .new))
    }

    @MainActor
    func testPendingBucketOnlyMoveUsesCompleteLocalScheduleOverlay() async throws {
        let fixture = try await self.makeReviewScheduleBucketMoveFixture(localCoverage: .userWide)
        defer { fixture.context.tearDown() }

        try self.applyPendingReviewScheduleBucketMove(fixture: fixture)

        let reviewScheduleSnapshot = try XCTUnwrap(fixture.context.store.reviewScheduleSnapshot)
        XCTAssertEqual(.serverBaseWithPendingLocalOverlay, reviewScheduleSnapshot.sourceState)
        XCTAssertTrue(reviewScheduleSnapshot.isApproximate)
        XCTAssertEqual(1, reviewScheduleSnapshot.schedule.totalCards)
        XCTAssertEqual(0, reviewScheduleCount(snapshot: reviewScheduleSnapshot, key: .today))
        XCTAssertEqual(1, reviewScheduleCount(snapshot: reviewScheduleSnapshot, key: .days1To7))
    }

    @MainActor
    func testAcknowledgedBucketOnlyMoveRendersDirtyLocalOverlayBeforeFreshServerResponse() async throws {
        let fixture = try await self.makeReviewScheduleBucketMoveFixture(localCoverage: .userWide)
        defer { fixture.context.tearDown() }

        try self.applyPendingReviewScheduleBucketMove(fixture: fixture)
        let scheduleRefreshCount = fixture.context.cloudSyncService.loadProgressReviewScheduleCallCount
        try await self.acknowledgeReviewScheduleBucketMove(
            fixture: fixture,
            allowsImmediateRefresh: false
        )

        let reviewScheduleSnapshot = try XCTUnwrap(fixture.context.store.reviewScheduleSnapshot)
        XCTAssertEqual(.serverBaseWithPendingLocalOverlay, reviewScheduleSnapshot.sourceState)
        XCTAssertTrue(reviewScheduleSnapshot.isApproximate)
        XCTAssertEqual(1, reviewScheduleSnapshot.schedule.totalCards)
        XCTAssertEqual(0, reviewScheduleCount(snapshot: reviewScheduleSnapshot, key: .today))
        XCTAssertEqual(1, reviewScheduleCount(snapshot: reviewScheduleSnapshot, key: .days1To7))
        XCTAssertEqual(scheduleRefreshCount, fixture.context.cloudSyncService.loadProgressReviewScheduleCallCount)
        XCTAssertTrue(fixture.context.store.progressReviewScheduleServerBaseCache?.requiresRefresh ?? false)
    }

    @MainActor
    func testReviewScheduleServerCatchUpClearsAcknowledgedLocalOverlay() async throws {
        let fixture = try await self.makeReviewScheduleBucketMoveFixture(localCoverage: .userWide)
        defer { fixture.context.tearDown() }

        try self.applyPendingReviewScheduleBucketMove(fixture: fixture)
        try await self.acknowledgeReviewScheduleBucketMove(
            fixture: fixture,
            allowsImmediateRefresh: false
        )
        fixture.context.cloudSyncService.serverReviewSchedule = makeTestReviewSchedule(
            timeZone: fixture.requestRange.timeZone,
            countsByBucketKey: [
                .days1To7: 1
            ],
            generatedAt: "2026-04-18T12:02:00.000Z"
        )

        let activeSession = try XCTUnwrap(
            fixture.context.store.activeProgressCloudSession(scopeKey: fixture.progressScopeKey)
        )
        await fixture.context.store.refreshProgressReviewScheduleServerBase(
            scopeKey: fixture.scheduleScopeKey,
            linkedSession: activeSession
        )

        let reviewScheduleSnapshot = try XCTUnwrap(fixture.context.store.reviewScheduleSnapshot)
        XCTAssertEqual(.serverBase, reviewScheduleSnapshot.sourceState)
        XCTAssertFalse(reviewScheduleSnapshot.isApproximate)
        XCTAssertEqual(1, reviewScheduleSnapshot.schedule.totalCards)
        XCTAssertEqual(0, reviewScheduleCount(snapshot: reviewScheduleSnapshot, key: .today))
        XCTAssertEqual(1, reviewScheduleCount(snapshot: reviewScheduleSnapshot, key: .days1To7))
        XCTAssertFalse(
            fixture.context.store.progressReviewScheduleInvalidatedScopeKeys.contains(fixture.scheduleScopeKey)
        )
        XCTAssertFalse(fixture.context.store.progressReviewScheduleServerBaseCache?.requiresRefresh ?? true)
    }

    @MainActor
    func testAcknowledgedBucketOnlyMoveKeepsServerOverlayWhenLocalCoverageIsPartial() async throws {
        let fixture = try await self.makeReviewScheduleBucketMoveFixture(localCoverage: .partialOrUnknown)
        defer { fixture.context.tearDown() }

        try self.applyPendingReviewScheduleBucketMove(fixture: fixture)
        try await self.acknowledgeReviewScheduleBucketMove(
            fixture: fixture,
            allowsImmediateRefresh: false
        )

        let reviewScheduleSnapshot = try XCTUnwrap(fixture.context.store.reviewScheduleSnapshot)
        XCTAssertEqual(.serverBaseWithPendingLocalOverlay, reviewScheduleSnapshot.sourceState)
        XCTAssertTrue(reviewScheduleSnapshot.isApproximate)
        XCTAssertEqual(1, reviewScheduleSnapshot.schedule.totalCards)
        XCTAssertEqual(1, reviewScheduleCount(snapshot: reviewScheduleSnapshot, key: .today))
        XCTAssertEqual(0, reviewScheduleCount(snapshot: reviewScheduleSnapshot, key: .days1To7))
        XCTAssertTrue(fixture.context.store.progressReviewScheduleServerBaseCache?.requiresRefresh ?? false)
    }

    @MainActor
    func testPersistedDirtyReviewScheduleCacheKeepsRefreshIntentAcrossRelaunch() async throws {
        let fixture = try await self.makeReviewScheduleBucketMoveFixture(localCoverage: .userWide)
        var relaunchedContext: ProgressStoreTestContext?
        defer {
            relaunchedContext?.tearDown()
            fixture.context.tearDown()
        }

        try self.applyPendingReviewScheduleBucketMove(fixture: fixture)
        try await self.acknowledgeReviewScheduleBucketMove(
            fixture: fixture,
            allowsImmediateRefresh: false
        )
        let dirtyPersistedServerBase = try XCTUnwrap(
            fixture.context.store.loadPersistedReviewScheduleServerBase(scopeKey: fixture.scheduleScopeKey)
        )
        XCTAssertTrue(dirtyPersistedServerBase.requiresRefresh)
        fixture.context.store.shutdownForTests()

        let reloadedContext = try self.makeProgressStoreContext(
            database: fixture.database,
            workspaceId: fixture.workspaceId,
            installationId: fixture.installationId,
            serverSummary: fixture.serverSummary,
            serverSeries: fixture.serverSeries,
            loadProgressSummaryError: nil,
            loadProgressSeriesError: nil,
            cloudState: .guest,
            suiteName: fixture.context.suiteName,
            userDefaults: fixture.context.userDefaults
        )
        relaunchedContext = reloadedContext
        reloadedContext.cloudSyncService.serverReviewSchedule = makeTestReviewSchedule(
            timeZone: fixture.requestRange.timeZone,
            countsByBucketKey: [
                .today: 1
            ],
            generatedAt: "2026-04-18T12:02:00.000Z"
        )

        _ = try reloadedContext.store.prepareProgressSnapshot(now: fixture.now)

        let reviewScheduleSnapshot = try XCTUnwrap(reloadedContext.store.reviewScheduleSnapshot)
        XCTAssertEqual(.serverBaseWithPendingLocalOverlay, reviewScheduleSnapshot.sourceState)
        XCTAssertTrue(reviewScheduleSnapshot.isApproximate)
        XCTAssertEqual(1, reviewScheduleSnapshot.schedule.totalCards)
        XCTAssertEqual(0, reviewScheduleCount(snapshot: reviewScheduleSnapshot, key: .today))
        XCTAssertEqual(1, reviewScheduleCount(snapshot: reviewScheduleSnapshot, key: .days1To7))

        let scheduleRefreshCount = reloadedContext.cloudSyncService.loadProgressReviewScheduleCallCount
        await reloadedContext.store.refreshProgressIfNeeded(now: fixture.now)

        XCTAssertEqual(
            scheduleRefreshCount + 1,
            reloadedContext.cloudSyncService.loadProgressReviewScheduleCallCount
        )
    }

    @MainActor
    func testCleanReviewScheduleServerBaseRendersServerBaseWithoutCausalLocalChange() async throws {
        let database = try self.makeDatabase()
        let cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-18T12:00:00.000Z"))
        let dueToday = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-18T08:00:00.000Z"))
        let movedDueAt = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-21T08:00:00.000Z"))
        let card = try self.addDueReviewScheduleCard(
            database: database,
            workspaceId: workspace.workspaceId,
            dueAt: dueToday
        )
        let setupOutboxEntries = try database.loadOutboxEntries(
            workspaceId: workspace.workspaceId,
            limit: Int.max
        )
        try database.deleteOutboxEntries(operationIds: setupOutboxEntries.map(\.operationId))
        try database.setHasHydratedHotState(
            workspaceId: workspace.workspaceId,
            hasHydratedHotState: true
        )
        try self.moveReviewScheduleCardDueAt(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: card.cardId,
            dueAt: movedDueAt
        )

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
        let progressScopeKey = try context.store.prepareProgressScope(now: now)
        let scheduleScopeKey = reviewScheduleScopeKey(seriesScopeKey: progressScopeKey)
        let staleServerBase = PersistedReviewScheduleServerBase(
            scopeKey: scheduleScopeKey,
            serverBase: makeTestReviewSchedule(
                timeZone: requestRange.timeZone,
                countsByBucketKey: [
                    .today: 1
                ],
                generatedAt: "2026-04-18T11:59:00.000Z"
            ),
            storedAt: "2026-04-18T11:59:00.000Z",
            requiresRefresh: false
        )
        try context.store.persistReviewScheduleServerBase(serverBase: staleServerBase)
        context.store.progressReviewScheduleServerBaseCache = context.store.loadPersistedReviewScheduleServerBase(
            scopeKey: scheduleScopeKey
        )

        try context.store.publishReviewScheduleSnapshot(scopeKey: scheduleScopeKey)

        let reviewScheduleSnapshot = try XCTUnwrap(context.store.reviewScheduleSnapshot)
        XCTAssertEqual(.serverBase, reviewScheduleSnapshot.sourceState)
        XCTAssertFalse(reviewScheduleSnapshot.isApproximate)
        XCTAssertEqual(1, reviewScheduleCount(snapshot: reviewScheduleSnapshot, key: .today))
        XCTAssertEqual(0, reviewScheduleCount(snapshot: reviewScheduleSnapshot, key: .days1To7))
        XCTAssertFalse(context.store.progressReviewScheduleServerBaseCache?.requiresRefresh ?? true)
        XCTAssertFalse(context.store.progressReviewScheduleInvalidatedScopeKeys.contains(scheduleScopeKey))
    }

    @MainActor
    func testFreshDifferentServerResponseWithoutPendingLocalChangesWinsOverLocalFallback() async throws {
        let database = try self.makeDatabase()
        let cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-18T12:00:00.000Z"))
        let dueToday = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-18T08:00:00.000Z"))
        let movedDueAt = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-21T08:00:00.000Z"))
        let card = try self.addDueReviewScheduleCard(
            database: database,
            workspaceId: workspace.workspaceId,
            dueAt: dueToday
        )
        let setupOutboxEntries = try database.loadOutboxEntries(
            workspaceId: workspace.workspaceId,
            limit: Int.max
        )
        try database.deleteOutboxEntries(operationIds: setupOutboxEntries.map(\.operationId))
        try database.setHasHydratedHotState(
            workspaceId: workspace.workspaceId,
            hasHydratedHotState: true
        )
        try self.moveReviewScheduleCardDueAt(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: card.cardId,
            dueAt: movedDueAt
        )

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
        let progressScopeKey = try context.store.prepareProgressScope(now: now)
        let scheduleScopeKey = reviewScheduleScopeKey(seriesScopeKey: progressScopeKey)
        let dirtyServerBase = PersistedReviewScheduleServerBase(
            scopeKey: scheduleScopeKey,
            serverBase: makeTestReviewSchedule(
                timeZone: requestRange.timeZone,
                countsByBucketKey: [
                    .today: 1
                ],
                generatedAt: "2026-04-18T11:59:00.000Z"
            ),
            storedAt: "2026-04-18T11:59:00.000Z",
            requiresRefresh: true
        )
        try context.store.persistReviewScheduleServerBase(serverBase: dirtyServerBase)
        context.store.progressReviewScheduleServerBaseCache = dirtyServerBase
        context.store.progressReviewScheduleInvalidatedScopeKeys.insert(scheduleScopeKey)
        context.cloudSyncService.serverReviewSchedule = makeTestReviewSchedule(
            timeZone: requestRange.timeZone,
            countsByBucketKey: [
                .today: 1
            ],
            generatedAt: "2026-04-18T12:01:00.000Z"
        )

        let activeSession = try XCTUnwrap(context.store.activeProgressCloudSession(scopeKey: progressScopeKey))
        await context.store.refreshProgressReviewScheduleServerBase(
            scopeKey: scheduleScopeKey,
            linkedSession: activeSession
        )

        let reviewScheduleSnapshot = try XCTUnwrap(context.store.reviewScheduleSnapshot)
        XCTAssertEqual(.serverBase, reviewScheduleSnapshot.sourceState)
        XCTAssertFalse(reviewScheduleSnapshot.isApproximate)
        XCTAssertEqual(1, reviewScheduleCount(snapshot: reviewScheduleSnapshot, key: .today))
        XCTAssertEqual(0, reviewScheduleCount(snapshot: reviewScheduleSnapshot, key: .days1To7))
        XCTAssertFalse(context.store.progressReviewScheduleServerBaseCache?.requiresRefresh ?? true)
        XCTAssertFalse(context.store.progressReviewScheduleInvalidatedScopeKeys.contains(scheduleScopeKey))
    }

    @MainActor
    func testFirstReviewScheduleRefreshWithoutCacheKeepsPendingLocalOverlay() async throws {
        let database = try self.makeDatabase()
        let cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-18T12:00:00.000Z"))
        let dueToday = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-18T08:00:00.000Z"))
        let movedDueAt = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-21T08:00:00.000Z"))
        let card = try self.addDueReviewScheduleCard(
            database: database,
            workspaceId: workspace.workspaceId,
            dueAt: dueToday
        )
        let setupOutboxEntries = try database.loadOutboxEntries(
            workspaceId: workspace.workspaceId,
            limit: Int.max
        )
        try database.deleteOutboxEntries(operationIds: setupOutboxEntries.map(\.operationId))
        try database.setHasHydratedHotState(
            workspaceId: workspace.workspaceId,
            hasHydratedHotState: true
        )

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
        context.cloudSyncService.serverReviewSchedule = makeTestReviewSchedule(
            timeZone: requestRange.timeZone,
            countsByBucketKey: [
                .today: 1
            ],
            generatedAt: "2026-04-18T11:59:00.000Z"
        )
        context.store.updateCurrentVisibleTab(tab: .progress)
        _ = try database.submitReview(
            workspaceId: workspace.workspaceId,
            reviewSubmission: ReviewSubmission(
                cardId: card.cardId,
                rating: .good,
                reviewedAtClient: formatIsoTimestamp(date: now),
                reviewedTimeZone: "UTC"
            )
        )
        try self.moveReviewScheduleCardDueAt(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: card.cardId,
            dueAt: movedDueAt
        )
        context.store.handleReviewScheduleLocalCardStateDidChange(now: now)
        XCTAssertNil(context.store.progressReviewScheduleServerBaseCache)

        await context.store.refreshProgressIfNeeded(now: now)

        let reviewScheduleSnapshot = try XCTUnwrap(context.store.reviewScheduleSnapshot)
        XCTAssertEqual(.serverBaseWithPendingLocalOverlay, reviewScheduleSnapshot.sourceState)
        XCTAssertTrue(reviewScheduleSnapshot.isApproximate)
        XCTAssertEqual(0, reviewScheduleCount(snapshot: reviewScheduleSnapshot, key: .today))
        XCTAssertEqual(1, reviewScheduleCount(snapshot: reviewScheduleSnapshot, key: .days1To7))
        XCTAssertTrue(context.store.progressReviewScheduleServerBaseCache?.requiresRefresh ?? false)
    }

    @MainActor
    private func makeReviewScheduleBucketMoveFixture(
        localCoverage: ReviewScheduleLocalCoverage
    ) async throws -> ReviewScheduleBucketMoveFixture {
        let database = try self.makeDatabase()
        let cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-18T12:00:00.000Z"))
        let dueToday = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-18T08:00:00.000Z"))
        let movedDueAt = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-21T08:00:00.000Z"))
        let card = try self.addDueReviewScheduleCard(
            database: database,
            workspaceId: workspace.workspaceId,
            dueAt: dueToday
        )
        let setupOutboxEntries = try database.loadOutboxEntries(
            workspaceId: workspace.workspaceId,
            limit: Int.max
        )
        try database.deleteOutboxEntries(operationIds: setupOutboxEntries.map(\.operationId))
        switch localCoverage {
        case .userWide:
            try database.setHasHydratedHotState(
                workspaceId: workspace.workspaceId,
                hasHydratedHotState: true
            )
        case .partialOrUnknown:
            try database.setHasHydratedHotState(
                workspaceId: workspace.workspaceId,
                hasHydratedHotState: false
            )
        }

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
        context.cloudSyncService.serverReviewSchedule = makeTestReviewSchedule(
            timeZone: requestRange.timeZone,
            countsByBucketKey: [
                .today: 1
            ],
            generatedAt: "2026-04-18T11:59:00.000Z"
        )

        await context.store.refreshProgressIfNeeded(now: now)
        context.store.updateCurrentVisibleTab(tab: .progress)
        let progressScopeKey = try XCTUnwrap(context.store.progressObservedScopeKey)
        let scheduleScopeKey = reviewScheduleScopeKey(seriesScopeKey: progressScopeKey)

        return ReviewScheduleBucketMoveFixture(
            database: database,
            workspaceId: workspace.workspaceId,
            installationId: cloudSettings.installationId,
            now: now,
            movedDueAt: movedDueAt,
            requestRange: requestRange,
            serverSummary: serverSummary,
            serverSeries: serverSeries,
            progressScopeKey: progressScopeKey,
            scheduleScopeKey: scheduleScopeKey,
            context: context,
            card: card
        )
    }

    @MainActor
    private func applyPendingReviewScheduleBucketMove(
        fixture: ReviewScheduleBucketMoveFixture
    ) throws {
        _ = try fixture.database.submitReview(
            workspaceId: fixture.workspaceId,
            reviewSubmission: ReviewSubmission(
                cardId: fixture.card.cardId,
                rating: .good,
                reviewedAtClient: formatIsoTimestamp(date: fixture.now),
                reviewedTimeZone: "UTC"
            )
        )
        try self.moveReviewScheduleCardDueAt(
            database: fixture.database,
            workspaceId: fixture.workspaceId,
            cardId: fixture.card.cardId,
            dueAt: fixture.movedDueAt
        )
        fixture.context.store.handleReviewScheduleLocalCardStateDidChange(now: fixture.now)
    }

    @MainActor
    private func acknowledgeReviewScheduleBucketMove(
        fixture: ReviewScheduleBucketMoveFixture,
        allowsImmediateRefresh: Bool
    ) async throws {
        let outboxEntries = try fixture.database.loadOutboxEntries(
            workspaceId: fixture.workspaceId,
            limit: Int.max
        )
        try fixture.database.deleteOutboxEntries(operationIds: outboxEntries.map(\.operationId))
        if allowsImmediateRefresh == false {
            fixture.context.store.updateCurrentVisibleTab(tab: .cards)
        }

        await fixture.context.store.handleProgressSyncCompletion(
            now: fixture.now,
            syncResult: CloudSyncResult(
                appliedPullChangeCount: 0,
                reviewScheduleImpactingPullChangeCount: 0,
                changedEntityTypes: [],
                localIdRepairEntityTypes: [],
                acknowledgedOperationCount: outboxEntries.count,
                acknowledgedReviewEventOperationCount: 1,
                acknowledgedReviewScheduleImpactingOperationCount: 1,
                cleanedUpOperationCount: 0,
                cleanedUpReviewEventOperationCount: 0,
                cleanedUpReviewScheduleImpactingOperationCount: 0
            )
        )
        if allowsImmediateRefresh == false {
            fixture.context.store.updateCurrentVisibleTab(tab: .progress)
        }
    }
}

private struct ReviewScheduleBucketMoveFixture {
    let database: LocalDatabase
    let workspaceId: String
    let installationId: String
    let now: Date
    let movedDueAt: Date
    let requestRange: ProgressSeriesLoadRequest
    let serverSummary: UserProgressSummary
    let serverSeries: UserProgressSeries
    let progressScopeKey: ProgressScopeKey
    let scheduleScopeKey: ReviewScheduleScopeKey
    let context: ProgressStoreTestContext
    let card: Card
}
