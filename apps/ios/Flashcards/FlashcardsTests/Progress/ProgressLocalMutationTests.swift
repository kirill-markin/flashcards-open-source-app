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
            reviewedAtClient: "2026-04-18T12:30:00.000Z",
            reviewedTimeZone: "UTC",
            rating: .good
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
    func testHandleProgressLocalMutationPatchesLocalOnlySeriesInMixedSnapshot() async throws {
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
                localDate: "2026-04-02",
                hour: 12,
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
            loadProgressSeriesError: LocalStoreError.validation("Series refresh failed"),
            cloudState: .guest
        )
        defer { context.tearDown() }

        await context.store.refreshProgressIfNeeded(now: now)
        let initialSnapshot = try XCTUnwrap(context.store.progressSnapshot)
        XCTAssertEqual(.serverBase, initialSnapshot.summarySourceState)
        XCTAssertEqual(.localOnly, initialSnapshot.seriesSourceState)
        XCTAssertEqual(1, progressReviewCount(snapshot: initialSnapshot, localDate: "2026-04-02"))

        let reviewedAtClient = try makeReviewedAtClientForTests(
            localDate: "2026-04-03",
            hour: 12,
            timeZoneIdentifier: requestRange.timeZone
        )
        try self.addReviewedCard(
            database: database,
            workspaceId: workspace.workspaceId,
            reviewedAtClient: reviewedAtClient
        )

        context.store.handleProgressLocalMutation(
            now: now,
            reviewedAtClient: reviewedAtClient,
            reviewedTimeZone: "UTC",
            rating: .good
        )

        let progressSnapshot = try XCTUnwrap(context.store.progressSnapshot)
        XCTAssertEqual(.serverBase, progressSnapshot.summarySourceState)
        XCTAssertEqual(.localOnly, progressSnapshot.seriesSourceState)
        XCTAssertEqual(1, progressReviewCount(snapshot: progressSnapshot, localDate: "2026-04-02"))
        XCTAssertEqual(1, progressReviewCount(snapshot: progressSnapshot, localDate: "2026-04-03"))
        XCTAssertEqual(1, progressSnapshot.summary.activeReviewDays)
        XCTAssertEqual("2026-04-01", progressSnapshot.summary.lastReviewedOn)
    }

    @MainActor
    func testHandleProgressLocalMutationPreservesLocalOnlyStreakBeyondVisibleRange() async throws {
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
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let todayDate = try XCTUnwrap(progressDateForTests(localDate: requestRange.to, calendar: calendar))
        let firstReviewDate = try XCTUnwrap(calendar.date(byAdding: .day, value: -150, to: todayDate))
        for dayOffset in 0..<150 {
            let reviewDate = try XCTUnwrap(calendar.date(byAdding: .day, value: dayOffset, to: firstReviewDate))
            let localDate = progressLocalDateStringForTests(date: reviewDate, calendar: calendar)
            try self.addReviewedCard(
                database: database,
                workspaceId: workspace.workspaceId,
                reviewedAtClient: try makeReviewedAtClientForTests(
                    localDate: localDate,
                    hour: 12,
                    timeZoneIdentifier: requestRange.timeZone
                )
            )
        }

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
            cloudState: .disconnected
        )
        defer { context.tearDown() }

        await context.store.refreshProgressIfNeeded(now: now)
        let initialSnapshot = try XCTUnwrap(context.store.progressSnapshot)
        XCTAssertEqual(.localOnly, initialSnapshot.summarySourceState)
        XCTAssertEqual(.localOnly, initialSnapshot.seriesSourceState)
        XCTAssertEqual(150, initialSnapshot.summary.currentStreakDays)
        XCTAssertEqual(150, initialSnapshot.summary.activeReviewDays)

        let reviewedAtClient = try makeReviewedAtClientForTests(
            localDate: requestRange.to,
            hour: 12,
            timeZoneIdentifier: requestRange.timeZone
        )
        try self.addReviewedCard(
            database: database,
            workspaceId: workspace.workspaceId,
            reviewedAtClient: reviewedAtClient
        )

        context.store.handleProgressLocalMutation(
            now: now,
            reviewedAtClient: reviewedAtClient,
            reviewedTimeZone: "UTC",
            rating: .good
        )

        let progressSnapshot = try XCTUnwrap(context.store.progressSnapshot)
        XCTAssertEqual(.localOnly, progressSnapshot.summarySourceState)
        XCTAssertEqual(.localOnly, progressSnapshot.seriesSourceState)
        XCTAssertEqual(151, progressSnapshot.summary.currentStreakDays)
        XCTAssertEqual(151, progressSnapshot.summary.longestStreakDays)
        XCTAssertEqual(151, progressSnapshot.summary.activeReviewDays)
        XCTAssertTrue(progressSnapshot.summary.hasReviewedToday)
        XCTAssertEqual(requestRange.to, progressSnapshot.summary.lastReviewedOn)
        XCTAssertEqual(1, progressReviewCount(snapshot: progressSnapshot, localDate: requestRange.to))
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
            reviewedAtClient: "2026-04-18T12:30:00.000Z",
            reviewedTimeZone: "UTC",
            rating: .good
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
    func testHandleProgressLocalMutationDoesNotPatchYesterdayBucketFromLoadedServerSnapshot() async throws {
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
            reviewedAtClient: formatIsoTimestamp(date: yesterdayReviewDate),
            reviewedTimeZone: "UTC",
            rating: .good
        )

        let progressSnapshot = try XCTUnwrap(context.store.progressSnapshot)
        XCTAssertEqual(0, progressReviewCount(snapshot: progressSnapshot, localDate: yesterdayLocalDate))
        XCTAssertEqual(0, progressReviewCount(snapshot: progressSnapshot, localDate: todayLocalDate))
        XCTAssertEqual(0, progressSnapshot.summary.currentStreakDays)
        XCTAssertFalse(progressSnapshot.summary.hasReviewedToday)
        XCTAssertNil(progressSnapshot.summary.lastReviewedOn)
        XCTAssertEqual(0, progressSnapshot.summary.activeReviewDays)
    }

    @MainActor
    func testHandleProgressLocalMutationDoesNotRecomputeFrozenStateForBackdatedServerSnapshotReview() async throws {
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

        await context.store.refreshProgressIfNeeded(now: now)
        let initialSnapshot = try XCTUnwrap(context.store.progressSnapshot)
        XCTAssertEqual(.missed, progressStreakState(snapshot: initialSnapshot, localDate: "2026-04-17"))

        context.store.handleProgressLocalMutation(
            now: now,
            reviewedAtClient: try makeReviewedAtClientForTests(
                localDate: "2026-04-16",
                hour: 12,
                timeZoneIdentifier: requestRange.timeZone
            ),
            reviewedTimeZone: "UTC",
            rating: .good
        )

        let progressSnapshot = try XCTUnwrap(context.store.progressSnapshot)
        XCTAssertEqual(.missed, progressStreakState(snapshot: progressSnapshot, localDate: "2026-04-16"))
        XCTAssertEqual(.missed, progressStreakState(snapshot: progressSnapshot, localDate: "2026-04-17"))
        XCTAssertEqual(.pending, progressStreakState(snapshot: progressSnapshot, localDate: "2026-04-18"))
        XCTAssertEqual(0, progressSnapshot.summary.currentStreakDays)
        XCTAssertFalse(progressSnapshot.summary.hasReviewedToday)
        XCTAssertNil(progressSnapshot.summary.lastReviewedOn)
        XCTAssertEqual(0, progressSnapshot.summary.activeReviewDays)
    }

    @MainActor
    func testHandleProgressLocalMutationPreservesServerStreakStatesOutsideChangedDay() async throws {
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
        let baseServerSeries = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [:],
            generatedAt: "2026-04-18T11:59:00.000Z"
        )
        let frozenLocalDate = requestRange.from
        let serverSeries = makeProgressSeries(
            timeZone: baseServerSeries.timeZone,
            from: baseServerSeries.from,
            to: baseServerSeries.to,
            dailyReviews: baseServerSeries.dailyReviews,
            streakDays: baseServerSeries.streakDays.map { streakDay in
                streakDay.date == frozenLocalDate
                    ? ProgressStreakDay(date: streakDay.date, state: .frozen)
                    : streakDay
            },
            summary: baseServerSeries.summary,
            generatedAt: baseServerSeries.generatedAt,
            reviewHistoryWatermarks: baseServerSeries.reviewHistoryWatermarks
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

        await context.store.refreshProgressIfNeeded(now: now)
        let initialSnapshot = try XCTUnwrap(context.store.progressSnapshot)
        XCTAssertEqual(.frozen, progressStreakState(snapshot: initialSnapshot, localDate: frozenLocalDate))

        context.store.handleProgressLocalMutation(
            now: now,
            reviewedAtClient: try makeReviewedAtClientForTests(
                localDate: requestRange.to,
                hour: 12,
                timeZoneIdentifier: requestRange.timeZone
            ),
            reviewedTimeZone: "UTC",
            rating: .good
        )

        let progressSnapshot = try XCTUnwrap(context.store.progressSnapshot)
        XCTAssertEqual(.frozen, progressStreakState(snapshot: progressSnapshot, localDate: frozenLocalDate))
        XCTAssertEqual(.reviewed, progressStreakState(snapshot: progressSnapshot, localDate: requestRange.to))
        XCTAssertEqual(1, progressReviewCount(snapshot: progressSnapshot, localDate: requestRange.to))
    }

    @MainActor
    func testHandleProgressLocalMutationRebuildsSnapshotAfterLocalDayRollover() async throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        let timeZone = try XCTUnwrap(TimeZone(identifier: "UTC"))
        let initialNow = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-18T12:00:00.000Z"))
        let rolloverNow = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-19T12:00:00.000Z"))
        let initialRequestRange = try makeTestProgressRequestRange(
            now: initialNow,
            timeZone: timeZone,
            dayCount: 140
        )
        let rolloverRequestRange = try makeTestProgressRequestRange(
            now: rolloverNow,
            timeZone: timeZone,
            dayCount: 140
        )
        let serverSeries = try makeTestProgressSeries(
            requestRange: initialRequestRange,
            reviewCountsByDate: [:],
            generatedAt: "2026-04-18T11:59:00.000Z"
        )
        let serverSummary = try makeTestProgressSummary(
            timeZone: initialRequestRange.timeZone,
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

        await context.store.refreshProgressIfNeeded(now: initialNow)
        let initialSnapshot = try XCTUnwrap(context.store.progressSnapshot)
        XCTAssertEqual(initialRequestRange.to, initialSnapshot.scopeKey.to)
        XCTAssertEqual(.pending, progressStreakState(snapshot: initialSnapshot, localDate: initialRequestRange.to))

        let reviewedAtClient = try makeReviewedAtClientForTests(
            localDate: rolloverRequestRange.to,
            hour: 12,
            timeZoneIdentifier: rolloverRequestRange.timeZone
        )
        try self.addReviewedCard(
            database: database,
            workspaceId: workspace.workspaceId,
            reviewedAtClient: reviewedAtClient
        )

        context.store.handleProgressLocalMutation(
            now: rolloverNow,
            reviewedAtClient: reviewedAtClient,
            reviewedTimeZone: "UTC",
            rating: .good
        )

        let progressSnapshot = try XCTUnwrap(context.store.progressSnapshot)
        XCTAssertEqual(rolloverRequestRange.to, progressSnapshot.scopeKey.to)
        XCTAssertNotEqual(.pending, progressStreakState(snapshot: progressSnapshot, localDate: initialRequestRange.to))
        XCTAssertEqual(.reviewed, progressStreakState(snapshot: progressSnapshot, localDate: rolloverRequestRange.to))
        XCTAssertEqual(1, progressReviewCount(snapshot: progressSnapshot, localDate: rolloverRequestRange.to))
        XCTAssertTrue(progressSnapshot.summary.hasReviewedToday)
        XCTAssertEqual(1, progressSnapshot.summary.activeReviewDays)
        XCTAssertEqual(rolloverRequestRange.to, progressSnapshot.summary.lastReviewedOn)
    }
}

private func progressStreakState(
    snapshot: ProgressSnapshot,
    localDate: String
) -> ProgressStreakDayState? {
    snapshot.chartData.chartDays.first { chartDay in
        chartDay.localDate == localDate
    }?.streakState
}
