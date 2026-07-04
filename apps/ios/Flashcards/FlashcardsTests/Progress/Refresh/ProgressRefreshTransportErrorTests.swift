import Foundation
import XCTest
@testable import Flashcards

final class ProgressRefreshTransportErrorTests: ProgressStoreTestCase {
    @MainActor
    func testRetryableCredentialRefreshTransportFailureDoesNotPresentProgressRefreshErrors() async throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        let timeZone = try XCTUnwrap(TimeZone(identifier: "UTC"))
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-06-10T12:00:00.000Z"))
        let requestRange = try makeTestProgressRequestRange(
            now: now,
            timeZone: timeZone,
            dayCount: 140
        )
        let serverSeries = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [:],
            generatedAt: "2026-06-10T11:59:00.000Z"
        )
        let serverSummary = try makeTestProgressSummary(
            timeZone: requestRange.timeZone,
            reviewDates: [],
            generatedAt: "2026-06-10T11:59:00.000Z"
        )
        let refreshedToken = CloudIdentityToken(
            idToken: "id-token-refreshed",
            idTokenExpiresAt: "2099-01-01T00:00:00.000Z"
        )
        let cloudAuthService = ProgressCloudAuthService(refreshedToken: refreshedToken)
        cloudAuthService.refreshIdTokenError = URLError(.timedOut)
        let suiteName = "progress-auth-transport-error-\(UUID().uuidString.lowercased())"
        let userDefaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        let context = try self.makeProgressStoreContext(
            database: database,
            workspaceId: workspace.workspaceId,
            installationId: cloudSettings.installationId,
            serverSummary: serverSummary,
            serverSeries: serverSeries,
            loadProgressSummaryError: nil,
            loadProgressSeriesError: nil,
            cloudState: .linked,
            suiteName: suiteName,
            userDefaults: userDefaults,
            cloudAuthService: cloudAuthService
        )
        defer { context.tearDown() }

        try context.credentialStore.saveCredentials(
            credentials: StoredCloudCredentials(
                refreshToken: "refresh-token-1",
                idToken: "id-token-expired",
                idTokenExpiresAt: "2020-01-01T00:00:00.000Z"
            )
        )
        let linkedUserId = try XCTUnwrap(context.store.cloudSettings?.linkedUserId)
        context.store.cloudRuntime.setActiveCloudSession(
            linkedSession: CloudLinkedSession(
                userId: linkedUserId,
                workspaceId: workspace.workspaceId,
                email: nil,
                configurationMode: .official,
                apiBaseUrl: context.apiBaseUrl,
                authorization: .bearer("id-token-expired")
            )
        )

        await context.store.refreshProgressIfNeeded(now: now)

        XCTAssertEqual(1, cloudAuthService.refreshIdTokenCallCount)
        XCTAssertEqual(0, context.cloudSyncService.loadProgressSummaryCallCount)
        XCTAssertEqual(0, context.cloudSyncService.loadProgressSeriesCallCount)
        XCTAssertEqual(0, context.cloudSyncService.loadProgressReviewScheduleCallCount)
        XCTAssertEqual(0, context.cloudSyncService.loadProgressLeaderboardCallCount)
        XCTAssertEqual(0, context.cloudSyncService.loadProgressStreakLeaderboardCallCount)
        assertProgressTransportMissIsSilent(store: context.store, file: #filePath, line: #line)
    }

    @MainActor
    func testRetryableTransportFailuresDoNotPresentProgressRefreshErrors() async throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        let timeZone = try XCTUnwrap(TimeZone(identifier: "UTC"))
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-06-10T12:00:00.000Z"))
        let requestRange = try makeTestProgressRequestRange(
            now: now,
            timeZone: timeZone,
            dayCount: 140
        )
        let serverSeries = try makeTestProgressSeries(
            requestRange: requestRange,
            reviewCountsByDate: [:],
            generatedAt: "2026-06-10T11:59:00.000Z"
        )
        let serverSummary = try makeTestProgressSummary(
            timeZone: requestRange.timeZone,
            reviewDates: [],
            generatedAt: "2026-06-10T11:59:00.000Z"
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
        let linkedSession = makeProgressLinkedSessionForTransportErrorTests(
            userId: linkedUserId,
            workspaceId: workspace.workspaceId,
            apiBaseUrl: context.apiBaseUrl
        )
        let scopeKey = try context.store.prepareProgressScope(now: now)
        let summaryScopeKey = progressSummaryScopeKey(seriesScopeKey: scopeKey)
        let scheduleScopeKey = reviewScheduleScopeKey(seriesScopeKey: scopeKey)
        let leaderboardScopeKey = context.store.currentProgressLeaderboardScopeKey(seriesScopeKey: scopeKey)
        let transportError = URLError(.timedOut)

        context.cloudSyncService.loadProgressSummaryError = transportError
        await context.store.refreshProgressSummaryServerBase(
            scopeKey: summaryScopeKey,
            linkedSession: linkedSession
        )
        assertProgressTransportMissIsSilent(store: context.store, file: #filePath, line: #line)

        context.cloudSyncService.loadProgressSeriesError = transportError
        await context.store.refreshProgressSeriesServerBase(
            scopeKey: scopeKey,
            linkedSession: linkedSession
        )
        assertProgressTransportMissIsSilent(store: context.store, file: #filePath, line: #line)

        context.cloudSyncService.loadProgressReviewScheduleError = transportError
        await context.store.refreshProgressReviewScheduleServerBase(
            scopeKey: scheduleScopeKey,
            linkedSession: linkedSession
        )
        assertProgressTransportMissIsSilent(store: context.store, file: #filePath, line: #line)

        context.cloudSyncService.loadProgressLeaderboardError = transportError
        await context.store.refreshProgressLeaderboardServerBase(
            scopeKey: leaderboardScopeKey,
            linkedSession: linkedSession
        )
        assertProgressTransportMissIsSilent(store: context.store, file: #filePath, line: #line)

        context.cloudSyncService.loadProgressStreakLeaderboardError = transportError
        await context.store.refreshProgressStreakLeaderboardServerBase(
            scopeKey: leaderboardScopeKey,
            linkedSession: linkedSession
        )
        assertProgressTransportMissIsSilent(store: context.store, file: #filePath, line: #line)
    }
}

@MainActor
private func assertProgressTransportMissIsSilent(
    store: FlashcardsStore,
    file: StaticString,
    line: UInt
) {
    XCTAssertNil(store.presentedTechnicalError, file: file, line: line)
    XCTAssertTrue(store.progressErrorMessage.isEmpty, file: file, line: line)
    XCTAssertEqual(makeEmptyProgressErrorState(), store.progressErrorState, file: file, line: line)
    XCTAssertFalse(store.isProgressRefreshing, file: file, line: line)
}

private func makeProgressLinkedSessionForTransportErrorTests(
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
