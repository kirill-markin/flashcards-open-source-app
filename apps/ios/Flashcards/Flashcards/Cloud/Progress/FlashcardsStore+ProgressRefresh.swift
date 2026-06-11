import Foundation

@MainActor
extension FlashcardsStore {
    func refreshProgressSummaryServerBase(
        scopeKey: ProgressSummaryScopeKey,
        linkedSession: CloudLinkedSession
    ) async {
        let refreshToken = self.progressSummaryRefreshToken
        if self.progressActiveSummaryRefreshScopeKey == scopeKey,
           self.progressActiveSummaryRefreshToken == refreshToken {
            return
        }

        self.progressActiveSummaryRefreshScopeKey = scopeKey
        self.progressActiveSummaryRefreshToken = refreshToken
        self.isProgressSummaryRefreshing = true
        self.updateProgressRefreshingState()
        self.beginProgressSummaryRefreshErrorScope()

        defer {
            if self.progressActiveSummaryRefreshScopeKey == scopeKey,
               self.progressActiveSummaryRefreshToken == refreshToken {
                self.progressActiveSummaryRefreshScopeKey = nil
                self.progressActiveSummaryRefreshToken = nil
                self.isProgressSummaryRefreshing = false
                self.updateProgressRefreshingState()
            }
        }

        do {
            let serverBase = try await self.loadProgressSummaryServerBase(
                scopeKey: scopeKey,
                linkedSession: linkedSession
            )

            guard self.isCurrentProgressSummaryRefresh(scopeKey: scopeKey, refreshToken: refreshToken) else {
                return
            }

            let persistedServerBase = PersistedProgressSummaryServerBase(
                scopeKey: scopeKey,
                serverBase: serverBase,
                storedAt: nowIsoTimestamp()
            )
            try self.persistProgressSummaryServerBase(serverBase: persistedServerBase)
            self.progressSummaryServerBaseCache = persistedServerBase
            self.progressSummaryInvalidatedScopeKeys.remove(scopeKey)
            self.clearProgressSummaryRefreshErrorMessage()

            guard let observedScopeKey = self.progressObservedScopeKey,
                  progressSummaryScopeKey(seriesScopeKey: observedScopeKey) == scopeKey else {
                return
            }

            try self.publishReviewProgressBadgeState(scopeKey: observedScopeKey)
            guard self.progressSeriesInvalidatedScopeKeys.contains(observedScopeKey) == false else {
                return
            }

            try self.publishProgressSnapshot(scopeKey: observedScopeKey)
        } catch {
            if isRequestCancellationError(error: error) {
                return
            }

            guard self.isCurrentProgressSummaryRefresh(scopeKey: scopeKey, refreshToken: refreshToken) else {
                return
            }

            self.replaceProgressSummaryRefreshErrorMessage(message: Flashcards.errorMessage(error: error))
        }
    }

    func refreshProgressSeriesServerBase(
        scopeKey: ProgressScopeKey,
        linkedSession: CloudLinkedSession
    ) async {
        let refreshToken = self.progressSeriesRefreshToken
        if self.progressActiveSeriesRefreshScopeKey == scopeKey,
           self.progressActiveSeriesRefreshToken == refreshToken {
            return
        }

        self.progressActiveSeriesRefreshScopeKey = scopeKey
        self.progressActiveSeriesRefreshToken = refreshToken
        self.isProgressSeriesRefreshing = true
        self.updateProgressRefreshingState()
        self.beginProgressSeriesRefreshErrorScope()

        defer {
            if self.progressActiveSeriesRefreshScopeKey == scopeKey,
               self.progressActiveSeriesRefreshToken == refreshToken {
                self.progressActiveSeriesRefreshScopeKey = nil
                self.progressActiveSeriesRefreshToken = nil
                self.isProgressSeriesRefreshing = false
                self.updateProgressRefreshingState()
            }
        }

        do {
            let serverBase = try await self.loadProgressSeriesServerBase(
                scopeKey: scopeKey,
                linkedSession: linkedSession
            )

            guard self.isCurrentProgressSeriesRefresh(scopeKey: scopeKey, refreshToken: refreshToken) else {
                return
            }

            let persistedServerBase = PersistedProgressSeriesServerBase(
                scopeKey: scopeKey,
                serverBase: serverBase,
                storedAt: nowIsoTimestamp()
            )
            try self.persistProgressSeriesServerBase(serverBase: persistedServerBase)
            self.progressSeriesServerBaseCache = persistedServerBase
            self.progressSeriesInvalidatedScopeKeys.remove(scopeKey)
            self.clearProgressSeriesRefreshErrorMessage()
            try self.publishProgressSnapshot(scopeKey: scopeKey)
        } catch {
            if isRequestCancellationError(error: error) {
                return
            }

            guard self.isCurrentProgressSeriesRefresh(scopeKey: scopeKey, refreshToken: refreshToken) else {
                return
            }

            self.replaceProgressSeriesRefreshErrorMessage(message: Flashcards.errorMessage(error: error))
        }
    }

    func refreshProgressReviewScheduleServerBase(
        scopeKey: ReviewScheduleScopeKey,
        linkedSession: CloudLinkedSession
    ) async {
        let refreshToken = self.progressReviewScheduleRefreshToken
        if self.progressActiveReviewScheduleRefreshScopeKey == scopeKey,
           self.progressActiveReviewScheduleRefreshToken == refreshToken {
            return
        }

        self.progressActiveReviewScheduleRefreshScopeKey = scopeKey
        self.progressActiveReviewScheduleRefreshToken = refreshToken
        self.isProgressReviewScheduleRefreshing = true
        self.updateProgressRefreshingState()
        self.beginProgressReviewScheduleRefreshErrorScope()

        defer {
            if self.progressActiveReviewScheduleRefreshScopeKey == scopeKey,
               self.progressActiveReviewScheduleRefreshToken == refreshToken {
                self.progressActiveReviewScheduleRefreshScopeKey = nil
                self.progressActiveReviewScheduleRefreshToken = nil
                self.isProgressReviewScheduleRefreshing = false
                self.updateProgressRefreshingState()
            }
        }

        do {
            let serverBase = try await self.loadProgressReviewScheduleServerBase(
                scopeKey: scopeKey,
                linkedSession: linkedSession
            )

            guard self.isCurrentProgressReviewScheduleRefresh(scopeKey: scopeKey, refreshToken: refreshToken) else {
                return
            }

            let database = try requireLocalDatabase(database: self.database)
            let workspaceIds = try self.loadCanonicalProgressWorkspaceIds(database: database)
            try self.acceptFreshProgressReviewScheduleServerBase(
                scopeKey: scopeKey,
                serverBaseSchedule: serverBase,
                storedAt: nowIsoTimestamp(),
                database: database,
                workspaceIds: workspaceIds
            )
            self.clearProgressReviewScheduleRefreshErrorMessage()

            guard let observedScopeKey = self.progressObservedScopeKey,
                  reviewScheduleScopeKey(seriesScopeKey: observedScopeKey) == scopeKey else {
                return
            }

            self.publishReviewScheduleSnapshotIsolatingErrors(scopeKey: scopeKey)
        } catch {
            if isRequestCancellationError(error: error) {
                return
            }

            guard self.isCurrentProgressReviewScheduleRefresh(scopeKey: scopeKey, refreshToken: refreshToken) else {
                return
            }

            self.replaceProgressReviewScheduleRefreshErrorMessage(message: Flashcards.errorMessage(error: error))
        }
    }

    func refreshProgressLeaderboardServerBase(
        scopeKey: ProgressLeaderboardScopeKey,
        linkedSession: CloudLinkedSession
    ) async {
        let refreshToken = self.progressLeaderboardRefreshToken
        if self.progressActiveLeaderboardRefreshScopeKey == scopeKey,
           self.progressActiveLeaderboardRefreshToken == refreshToken {
            return
        }

        self.progressActiveLeaderboardRefreshScopeKey = scopeKey
        self.progressActiveLeaderboardRefreshToken = refreshToken
        self.isProgressLeaderboardRefreshing = true
        self.updateProgressRefreshingState()
        self.beginProgressLeaderboardRefreshErrorScope()

        defer {
            if self.progressActiveLeaderboardRefreshScopeKey == scopeKey,
               self.progressActiveLeaderboardRefreshToken == refreshToken {
                self.progressActiveLeaderboardRefreshScopeKey = nil
                self.progressActiveLeaderboardRefreshToken = nil
                self.isProgressLeaderboardRefreshing = false
                self.updateProgressRefreshingState()
            }
        }

        do {
            let serverBase = try await self.loadProgressLeaderboardServerBase(linkedSession: linkedSession)

            guard self.isCurrentProgressLeaderboardRefresh(scopeKey: scopeKey, refreshToken: refreshToken) else {
                return
            }

            let persistedServerBase = PersistedProgressLeaderboardServerBase(
                scopeKey: scopeKey,
                serverBase: serverBase,
                storedAt: nowIsoTimestamp()
            )
            try self.persistProgressLeaderboardServerBase(serverBase: persistedServerBase)
            self.progressLeaderboardServerBaseCache = persistedServerBase
            self.progressLeaderboardInvalidatedScopeKeys.remove(scopeKey)
            self.clearProgressLeaderboardRefreshErrorMessage()

            guard let observedScopeKey = self.progressObservedScopeKey,
                  self.currentProgressLeaderboardScopeKey(seriesScopeKey: observedScopeKey) == scopeKey else {
                return
            }

            self.publishProgressLeaderboardSnapshotIsolatingErrors(scopeKey: scopeKey, now: Date())
        } catch {
            if isRequestCancellationError(error: error) {
                return
            }

            guard self.isCurrentProgressLeaderboardRefresh(scopeKey: scopeKey, refreshToken: refreshToken) else {
                return
            }

            self.replaceProgressLeaderboardRefreshErrorMessage(message: Flashcards.errorMessage(error: error))
        }
    }

    func shouldRefreshProgressSummary(scopeKey: ProgressSummaryScopeKey) -> Bool {
        guard self.progressSummaryServerBaseCache?.scopeKey == scopeKey else {
            return true
        }

        return self.progressSummaryInvalidatedScopeKeys.contains(scopeKey)
    }

    func shouldRefreshProgressSeries(scopeKey: ProgressScopeKey) -> Bool {
        guard self.progressSeriesServerBaseCache?.scopeKey == scopeKey else {
            return true
        }

        return self.progressSeriesInvalidatedScopeKeys.contains(scopeKey)
    }

    func shouldRefreshProgressReviewSchedule(scopeKey: ReviewScheduleScopeKey) -> Bool {
        guard let cachedServerBase = self.progressReviewScheduleServerBaseCache,
              cachedServerBase.scopeKey == scopeKey else {
            return true
        }

        if self.progressReviewScheduleInvalidatedScopeKeys.contains(scopeKey) {
            return true
        }
        if cachedServerBase.requiresRefresh {
            return true
        }
        if let reviewScheduleSnapshot = self.reviewScheduleSnapshot,
           reviewScheduleSnapshot.scopeKey == scopeKey,
           reviewScheduleSnapshot.sourceState == .serverBaseWithPendingLocalOverlay {
            return true
        }

        return false
    }

    /// The leaderboard is fetched only for linked accounts; guests and disconnected
    /// users render the sign-in placeholder locally without a request. Cached
    /// payloads are reused until their server-provided nextRefreshAfter passes.
    func shouldRefreshProgressLeaderboard(
        scopeKey: ProgressLeaderboardScopeKey,
        now: Date
    ) -> Bool {
        guard scopeKey.cloudState == .linked else {
            return false
        }
        guard let cachedServerBase = self.progressLeaderboardServerBaseCache,
              cachedServerBase.scopeKey == scopeKey else {
            return true
        }
        if self.progressLeaderboardInvalidatedScopeKeys.contains(scopeKey) {
            return true
        }

        return progressLeaderboardRequiresScheduledRefresh(
            leaderboard: cachedServerBase.serverBase,
            now: now
        )
    }

    func activeProgressCloudSession(scopeKey: ProgressScopeKey) -> CloudLinkedSession? {
        guard let cloudSettings = self.cloudSettings else {
            return nil
        }

        switch cloudSettings.cloudState {
        case .linked, .guest:
            break
        case .disconnected, .linkingReady:
            return nil
        }

        guard let activeSession = self.cloudRuntime.activeCloudSession() else {
            return nil
        }

        if let linkedUserId = scopeKey.linkedUserId, activeSession.userId != linkedUserId {
            return nil
        }

        return activeSession
    }

    func invalidateProgress(
        scopeKey: ProgressScopeKey,
        summaryScopeKey: ProgressSummaryScopeKey
    ) {
        let scheduleScopeKey = reviewScheduleScopeKey(seriesScopeKey: scopeKey)
        self.invalidateProgressSummaryAndSeries(scopeKey: scopeKey, summaryScopeKey: summaryScopeKey)
        self.invalidateProgressReviewSchedule(scopeKey: scheduleScopeKey)
        self.invalidateProgressLeaderboard(
            scopeKey: self.currentProgressLeaderboardScopeKey(seriesScopeKey: scopeKey)
        )
    }

    func invalidateProgressSummaryAndSeries(
        scopeKey: ProgressScopeKey,
        summaryScopeKey: ProgressSummaryScopeKey
    ) {
        self.progressSummaryInvalidatedScopeKeys.insert(summaryScopeKey)
        self.progressSeriesInvalidatedScopeKeys.insert(scopeKey)
        self.progressSummaryRefreshToken += 1
        self.progressSeriesRefreshToken += 1
        self.progressActiveSummaryRefreshScopeKey = nil
        self.progressActiveSeriesRefreshScopeKey = nil
        self.progressActiveSummaryRefreshToken = nil
        self.progressActiveSeriesRefreshToken = nil
        self.isProgressSummaryRefreshing = false
        self.isProgressSeriesRefreshing = false
        self.updateProgressRefreshingState()
    }

    func invalidateProgressReviewSchedule(scopeKey: ReviewScheduleScopeKey) {
        self.progressReviewScheduleInvalidatedScopeKeys.insert(scopeKey)
        self.removePersistedReviewScheduleServerBase(scopeKey: scopeKey)
        if self.progressReviewScheduleServerBaseCache?.scopeKey == scopeKey {
            self.progressReviewScheduleServerBaseCache = nil
        }
        self.progressReviewScheduleRefreshToken += 1
        self.progressActiveReviewScheduleRefreshScopeKey = nil
        self.progressActiveReviewScheduleRefreshToken = nil
        self.isProgressReviewScheduleRefreshing = false
        self.updateProgressRefreshingState()
    }

    func invalidateProgressLeaderboard(scopeKey: ProgressLeaderboardScopeKey) {
        // Keep the persisted payload so an offline manual refresh still renders the
        // cached leaderboard; the invalidation only forces the next online refetch.
        self.progressLeaderboardInvalidatedScopeKeys.insert(scopeKey)
        self.progressLeaderboardRefreshToken += 1
        self.progressActiveLeaderboardRefreshScopeKey = nil
        self.progressActiveLeaderboardRefreshToken = nil
        self.isProgressLeaderboardRefreshing = false
        self.updateProgressRefreshingState()
    }

    func markProgressReviewSchedulePendingLocalOverlay(scopeKey: ReviewScheduleScopeKey) throws {
        self.progressReviewScheduleInvalidatedScopeKeys.insert(scopeKey)
        if let cachedServerBase = self.progressReviewScheduleServerBaseCache,
           cachedServerBase.scopeKey == scopeKey {
            let dirtyServerBase = PersistedReviewScheduleServerBase(
                scopeKey: cachedServerBase.scopeKey,
                serverBase: cachedServerBase.serverBase,
                storedAt: cachedServerBase.storedAt,
                requiresRefresh: true
            )
            try self.persistReviewScheduleServerBase(serverBase: dirtyServerBase)
            self.progressReviewScheduleServerBaseCache = dirtyServerBase
        }
        self.progressReviewScheduleRefreshToken += 1
        self.progressActiveReviewScheduleRefreshScopeKey = nil
        self.progressActiveReviewScheduleRefreshToken = nil
        self.isProgressReviewScheduleRefreshing = false
        self.updateProgressRefreshingState()
    }

    func updateProgressRefreshingState() {
        let isRefreshing = self.isProgressSummaryRefreshing
            || self.isProgressSeriesRefreshing
            || self.isProgressReviewScheduleRefreshing
            || self.isProgressLeaderboardRefreshing
        if self.isProgressRefreshing != isRefreshing {
            self.isProgressRefreshing = isRefreshing
        }
    }

    private func loadProgressSummaryServerBase(
        scopeKey: ProgressSummaryScopeKey,
        linkedSession: CloudLinkedSession
    ) async throws -> UserProgressSummary {
        let cloudSyncService = try requireCloudSyncService(cloudSyncService: self.dependencies.cloudSyncService)
        let summary = try await cloudSyncService.loadProgressSummary(
            apiBaseUrl: linkedSession.apiBaseUrl,
            authorizationHeader: linkedSession.authorizationHeaderValue,
            timeZone: scopeKey.timeZone
        )
        try validateProgressSummaryMetadata(summary: summary, scopeKey: scopeKey)
        return summary
    }

    private func loadProgressSeriesServerBase(
        scopeKey: ProgressScopeKey,
        linkedSession: CloudLinkedSession
    ) async throws -> UserProgressSeries {
        let cloudSyncService = try requireCloudSyncService(cloudSyncService: self.dependencies.cloudSyncService)
        let series = try await cloudSyncService.loadProgressSeries(
            apiBaseUrl: linkedSession.apiBaseUrl,
            authorizationHeader: linkedSession.authorizationHeaderValue,
            timeZone: scopeKey.timeZone,
            from: scopeKey.from,
            to: scopeKey.to
        )
        let timeZone = try progressTimeZone(identifier: scopeKey.timeZone)
        try validateProgressSeries(
            series: series,
            scopeKey: scopeKey,
            calendar: makeProgressStoreCalendar(timeZone: timeZone)
        )
        return series
    }

    private func loadProgressReviewScheduleServerBase(
        scopeKey: ReviewScheduleScopeKey,
        linkedSession: CloudLinkedSession
    ) async throws -> UserReviewSchedule {
        let cloudSyncService = try requireCloudSyncService(cloudSyncService: self.dependencies.cloudSyncService)
        let schedule = try await cloudSyncService.loadProgressReviewSchedule(
            apiBaseUrl: linkedSession.apiBaseUrl,
            authorizationHeader: linkedSession.authorizationHeaderValue,
            timeZone: scopeKey.timeZone
        )
        try validateReviewSchedule(
            schedule: schedule,
            scopeKey: scopeKey
        )
        return schedule
    }

    private func loadProgressLeaderboardServerBase(
        linkedSession: CloudLinkedSession
    ) async throws -> UserProgressLeaderboard {
        let cloudSyncService = try requireCloudSyncService(cloudSyncService: self.dependencies.cloudSyncService)
        let leaderboard = try await cloudSyncService.loadProgressLeaderboard(
            apiBaseUrl: linkedSession.apiBaseUrl,
            authorizationHeader: linkedSession.authorizationHeaderValue
        )
        try validateProgressLeaderboard(leaderboard: leaderboard)
        return leaderboard
    }

    private func isCurrentProgressSummaryRefresh(
        scopeKey: ProgressSummaryScopeKey,
        refreshToken: Int
    ) -> Bool {
        self.progressActiveSummaryRefreshScopeKey == scopeKey
            && self.progressActiveSummaryRefreshToken == refreshToken
            && self.progressSummaryRefreshToken == refreshToken
    }

    private func isCurrentProgressSeriesRefresh(
        scopeKey: ProgressScopeKey,
        refreshToken: Int
    ) -> Bool {
        self.progressActiveSeriesRefreshScopeKey == scopeKey
            && self.progressActiveSeriesRefreshToken == refreshToken
            && self.progressSeriesRefreshToken == refreshToken
    }

    private func isCurrentProgressReviewScheduleRefresh(
        scopeKey: ReviewScheduleScopeKey,
        refreshToken: Int
    ) -> Bool {
        self.progressActiveReviewScheduleRefreshScopeKey == scopeKey
            && self.progressActiveReviewScheduleRefreshToken == refreshToken
            && self.progressReviewScheduleRefreshToken == refreshToken
    }

    private func isCurrentProgressLeaderboardRefresh(
        scopeKey: ProgressLeaderboardScopeKey,
        refreshToken: Int
    ) -> Bool {
        self.progressActiveLeaderboardRefreshScopeKey == scopeKey
            && self.progressActiveLeaderboardRefreshToken == refreshToken
            && self.progressLeaderboardRefreshToken == refreshToken
    }
}
