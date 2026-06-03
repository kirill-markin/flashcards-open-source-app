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
                effortLevel: .medium
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
                effortLevel: .long
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
                effortLevel: .fast
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
}
