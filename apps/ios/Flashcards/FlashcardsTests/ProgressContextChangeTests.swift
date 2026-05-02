import Foundation
import XCTest
@testable import Flashcards

final class ProgressContextChangeTests: ProgressStoreTestCase {
    @MainActor
    func testHandleProgressContextDidChangeReloadsProgressWhenWorkspaceMembershipChanges() async throws {
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
        context.store.updateCurrentVisibleTab(tab: .progress)

        let initialScopeKey = try XCTUnwrap(context.store.progressObservedScopeKey)
        let initialSnapshot = try XCTUnwrap(context.store.progressSnapshot)
        XCTAssertEqual(1, initialSnapshot.summary.activeReviewDays)
        XCTAssertEqual("2026-04-02", initialSnapshot.summary.lastReviewedOn)
        XCTAssertEqual(1, context.cloudSyncService.loadProgressSummaryCallCount)
        XCTAssertEqual(1, context.cloudSyncService.loadProgressSeriesCallCount)

        let secondWorkspace = try self.insertWorkspace(
            database: database,
            name: "Workspace 2",
            createdAt: "2026-04-03T00:00:00Z"
        )
        try self.addReviewedCard(
            database: database,
            workspaceId: secondWorkspace.workspaceId,
            reviewedAtClient: "2026-04-03T09:00:00.000Z"
        )

        context.store.handleProgressContextDidChange(now: now)

        let updatedScopeKey = try XCTUnwrap(context.store.progressObservedScopeKey)
        let updatedSnapshot = try XCTUnwrap(context.store.progressSnapshot)
        XCTAssertNotEqual(initialScopeKey, updatedScopeKey)
        XCTAssertNotEqual(initialScopeKey.workspaceMembershipKey, updatedScopeKey.workspaceMembershipKey)
        XCTAssertEqual(2, updatedSnapshot.summary.activeReviewDays)
        XCTAssertEqual("2026-04-03", updatedSnapshot.summary.lastReviewedOn)

        await self.waitForProgressRefreshCallCounts(
            cloudSyncService: context.cloudSyncService,
            summaryCount: 2,
            seriesCount: 2
        )
    }

    @MainActor
    func testHandleProgressContextDidChangeRefreshesBadgeWithoutUpdatingSharedSnapshotWhenReviewIsVisible() async throws {
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
        context.store.updateCurrentVisibleTab(tab: .review)
        let initialSnapshot = try XCTUnwrap(context.store.progressSnapshot)

        let secondWorkspace = try self.insertWorkspace(
            database: database,
            name: "Workspace 2",
            createdAt: "2026-04-03T00:00:00Z"
        )
        try self.addReviewedCard(
            database: database,
            workspaceId: secondWorkspace.workspaceId,
            reviewedAtClient: "\(requestRange.to)T09:00:00.000Z"
        )
        context.cloudSyncService.serverSummary = try makeTestProgressSummary(
            timeZone: requestRange.timeZone,
            reviewDates: [requestRange.to],
            generatedAt: "2026-04-18T12:01:00.000Z"
        )

        context.store.handleProgressContextDidChange(now: now)
        await self.waitForProgressRefreshCallCounts(
            cloudSyncService: context.cloudSyncService,
            summaryCount: 2,
            seriesCount: 1
        )

        XCTAssertEqual(initialSnapshot, context.store.progressSnapshot)
        XCTAssertEqual(1, context.store.reviewProgressBadgeState.streakDays)
        XCTAssertTrue(context.store.reviewProgressBadgeState.hasReviewedToday)
        XCTAssertTrue(context.store.reviewProgressBadgeState.isInteractive)
    }

    @MainActor
    func testHandleProgressContextDidChangeClearsReviewedTodayBadgeAfterLocalDayRollover() async throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        try self.addReviewedCard(
            database: database,
            workspaceId: workspace.workspaceId,
            reviewedAtClient: "2026-04-18T15:50:57.000Z"
        )

        let initialNow = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-18T18:00:00.000Z"))
        let rolloverNow = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-19T08:00:00.000Z"))
        let initialRequestRange = try makeTestProgressRequestRange(
            now: initialNow,
            timeZone: TimeZone.current,
            dayCount: 140
        )
        let rolloverRequestRange = try makeTestProgressRequestRange(
            now: rolloverNow,
            timeZone: TimeZone.current,
            dayCount: 140
        )
        let serverSeries = try makeTestProgressSeries(
            requestRange: initialRequestRange,
            reviewCountsByDate: [
                initialRequestRange.to: 1
            ],
            generatedAt: "2026-04-18T17:59:00.000Z"
        )
        let serverSummary = try makeTestProgressSummary(
            timeZone: initialRequestRange.timeZone,
            reviewDates: [initialRequestRange.to],
            generatedAt: "2026-04-18T17:59:00.000Z"
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

        context.store.updateCurrentVisibleTab(tab: .review)
        await context.store.refreshReviewProgressBadgeIfNeeded(now: initialNow)

        XCTAssertTrue(context.store.reviewProgressBadgeState.hasReviewedToday)
        XCTAssertEqual(1, context.store.reviewProgressBadgeState.streakDays)
        XCTAssertEqual(1, context.cloudSyncService.loadProgressSummaryCallCount)
        XCTAssertEqual(0, context.cloudSyncService.loadProgressSeriesCallCount)

        context.cloudSyncService.serverSummary = try makeTestProgressSummary(
            timeZone: rolloverRequestRange.timeZone,
            reviewDates: [initialRequestRange.to],
            generatedAt: "2026-04-19T07:59:00.000Z"
        )

        context.store.handleProgressContextDidChange(now: rolloverNow)

        XCTAssertFalse(context.store.reviewProgressBadgeState.hasReviewedToday)
        XCTAssertEqual(1, context.store.reviewProgressBadgeState.streakDays)
        XCTAssertTrue(context.store.reviewProgressBadgeState.isInteractive)
        XCTAssertEqual(rolloverRequestRange.to, context.store.progressObservedScopeKey?.to)
    }

    @MainActor
    func testProgressSummaryScopeKeyChangesAcrossLocalDayRollover() async throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        let initialNow = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-18T18:00:00.000Z"))
        let rolloverNow = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-19T08:00:00.000Z"))
        let initialRequestRange = try makeTestProgressRequestRange(
            now: initialNow,
            timeZone: TimeZone.current,
            dayCount: 140
        )
        let rolloverRequestRange = try makeTestProgressRequestRange(
            now: rolloverNow,
            timeZone: TimeZone.current,
            dayCount: 140
        )
        let context = try self.makeProgressStoreContext(
            database: database,
            workspaceId: workspace.workspaceId,
            installationId: cloudSettings.installationId,
            serverSummary: try makeTestProgressSummary(
                timeZone: initialRequestRange.timeZone,
                reviewDates: [initialRequestRange.to],
                generatedAt: "2026-04-18T17:59:00.000Z"
            ),
            serverSeries: try makeTestProgressSeries(
                requestRange: initialRequestRange,
                reviewCountsByDate: [initialRequestRange.to: 1],
                generatedAt: "2026-04-18T17:59:00.000Z"
            ),
            loadProgressSummaryError: nil,
            loadProgressSeriesError: nil,
            cloudState: .guest
        )
        defer { context.tearDown() }

        context.store.updateCurrentVisibleTab(tab: .review)
        await context.store.refreshReviewProgressBadgeIfNeeded(now: initialNow)
        let initialScopeKey = try XCTUnwrap(context.store.progressObservedScopeKey)

        context.store.handleProgressContextDidChange(now: rolloverNow)
        let rolloverScopeKey = try XCTUnwrap(context.store.progressObservedScopeKey)

        XCTAssertNotEqual(initialScopeKey.to, rolloverScopeKey.to)
        XCTAssertNotEqual(
            progressSummaryScopeKey(seriesScopeKey: initialScopeKey),
            progressSummaryScopeKey(seriesScopeKey: rolloverScopeKey)
        )
        XCTAssertEqual(initialRequestRange.to, progressSummaryScopeKey(seriesScopeKey: initialScopeKey).referenceLocalDate)
        XCTAssertEqual(rolloverRequestRange.to, progressSummaryScopeKey(seriesScopeKey: rolloverScopeKey).referenceLocalDate)
    }

    @MainActor
    func testRefreshProgressIfNeededKeepsServerScopeStableAcrossWorkspaceSwitch() async throws {
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
        let firstSnapshot = try XCTUnwrap(context.store.progressSnapshot)
        let firstScopeKey = try XCTUnwrap(context.store.progressObservedScopeKey)
        XCTAssertEqual(2, firstSnapshot.summary.activeReviewDays)
        XCTAssertEqual("2026-04-03", firstSnapshot.summary.lastReviewedOn)
        XCTAssertEqual(1, context.cloudSyncService.loadProgressSummaryCallCount)
        XCTAssertEqual(1, context.cloudSyncService.loadProgressSeriesCallCount)

        context.store.workspace = secondWorkspace
        context.store.cloudSettings = CloudSettings(
            installationId: cloudSettings.installationId,
            cloudState: .guest,
            linkedUserId: "guest-user-1",
            linkedWorkspaceId: workspace.workspaceId,
            activeWorkspaceId: secondWorkspace.workspaceId,
            linkedEmail: nil,
            onboardingCompleted: true,
            updatedAt: "2026-04-02T00:00:00Z"
        )

        await context.store.refreshProgressIfNeeded(now: now)

        XCTAssertEqual(1, context.cloudSyncService.loadProgressSummaryCallCount)
        XCTAssertEqual(1, context.cloudSyncService.loadProgressSeriesCallCount)
        let secondSnapshot = try XCTUnwrap(context.store.progressSnapshot)
        let secondScopeKey = try XCTUnwrap(context.store.progressObservedScopeKey)
        XCTAssertEqual(firstSnapshot, secondSnapshot)
        XCTAssertEqual(firstScopeKey, secondScopeKey)
        XCTAssertEqual(firstScopeKey.workspaceMembershipKey, secondScopeKey.workspaceMembershipKey)
    }
}
