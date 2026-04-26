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

    private func updateProgressRefreshingState() {
        let isRefreshing = self.isProgressSummaryRefreshing || self.isProgressSeriesRefreshing
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
}
