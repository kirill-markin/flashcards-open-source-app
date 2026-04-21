import Foundation

struct PersistedProgressSummaryServerBase: Codable, Hashable, Sendable {
    let scopeKey: ProgressSummaryScopeKey
    let serverBase: UserProgressSummary
    let storedAt: String
}

struct PersistedProgressSeriesServerBase: Codable, Hashable, Sendable {
    let scopeKey: ProgressScopeKey
    let serverBase: UserProgressSeries
    let storedAt: String
}

private struct ProgressRequestRange: Hashable, Sendable {
    let timeZone: String
    let from: String
    let to: String
}

private let recentProgressHistoryDayCount: Int = 140
private let progressSummaryServerBaseCacheUserDefaultsKeyPrefix: String = "progress-summary-server-base"
private let progressSeriesServerBaseCacheUserDefaultsKeyPrefix: String = "progress-series-server-base"

/// Store-owned progress lifecycle:
/// prepare a scope snapshot from local state, render immediately from cached/local data,
/// then refresh summary and series independently and re-render whenever the latest response still matches the latest token.
@MainActor
extension FlashcardsStore {
    func refreshReviewProgressBadgeIfNeeded() async {
        await self.refreshReviewProgressBadgeIfNeeded(now: Date())
    }

    func refreshProgressIfNeeded() async {
        await self.refreshProgressIfNeeded(now: Date())
    }

    func refreshProgressManually() async {
        await self.refreshProgressManually(now: Date())
    }

    func refreshReviewProgressBadgeIfNeeded(now: Date) async {
        do {
            let scopeKey = try self.prepareProgressScope(now: now)
            try self.publishReviewProgressBadgeState(scopeKey: scopeKey)
            let summaryScopeKey = progressSummaryScopeKey(seriesScopeKey: scopeKey)
            guard self.shouldRefreshProgressSummary(scopeKey: summaryScopeKey) else {
                return
            }

            guard let activeSession = self.activeProgressCloudSession(scopeKey: scopeKey) else {
                return
            }

            await self.refreshProgressSummaryServerBase(
                scopeKey: summaryScopeKey,
                linkedSession: activeSession
            )
        } catch {
            if isRequestCancellationError(error: error) {
                return
            }

            self.progressErrorMessage = Flashcards.errorMessage(error: error)
        }
    }

    func refreshProgressIfNeeded(now: Date) async {
        do {
            let scopeKey = try self.prepareProgressSnapshot(now: now)
            let summaryScopeKey = progressSummaryScopeKey(seriesScopeKey: scopeKey)
            let shouldRefreshSummary = self.shouldRefreshProgressSummary(scopeKey: summaryScopeKey)
            let shouldRefreshSeries = self.shouldRefreshProgressSeries(scopeKey: scopeKey)

            guard shouldRefreshSummary || shouldRefreshSeries else {
                return
            }

            guard let activeSession = self.activeProgressCloudSession(scopeKey: scopeKey) else {
                return
            }

            if shouldRefreshSummary && shouldRefreshSeries {
                async let refreshSummary: Void = self.refreshProgressSummaryServerBase(
                    scopeKey: summaryScopeKey,
                    linkedSession: activeSession
                )
                async let refreshSeries: Void = self.refreshProgressSeriesServerBase(
                    scopeKey: scopeKey,
                    linkedSession: activeSession
                )
                _ = await (refreshSummary, refreshSeries)
            } else if shouldRefreshSummary {
                await self.refreshProgressSummaryServerBase(
                    scopeKey: summaryScopeKey,
                    linkedSession: activeSession
                )
            } else {
                await self.refreshProgressSeriesServerBase(
                    scopeKey: scopeKey,
                    linkedSession: activeSession
                )
            }

            if self.progressObservedScopeKey == scopeKey {
                try self.publishProgressSnapshot(scopeKey: scopeKey)
            }
        } catch {
            if isRequestCancellationError(error: error) {
                return
            }

            self.progressErrorMessage = Flashcards.errorMessage(error: error)
        }
    }

    func refreshProgressManually(now: Date) async {
        do {
            let scopeKey = try self.prepareProgressSnapshot(now: now)
            let summaryScopeKey = progressSummaryScopeKey(seriesScopeKey: scopeKey)

            self.invalidateProgress(scopeKey: scopeKey, summaryScopeKey: summaryScopeKey)
            guard let activeSession = self.activeProgressCloudSession(scopeKey: scopeKey) else {
                return
            }

            async let refreshSummary: Void = self.refreshProgressSummaryServerBase(
                scopeKey: summaryScopeKey,
                linkedSession: activeSession
            )
            async let refreshSeries: Void = self.refreshProgressSeriesServerBase(
                scopeKey: scopeKey,
                linkedSession: activeSession
            )
            _ = await (refreshSummary, refreshSeries)
        } catch {
            if isRequestCancellationError(error: error) {
                return
            }

            self.progressErrorMessage = Flashcards.errorMessage(error: error)
        }
    }

    func handleProgressContextDidChange(now: Date) {
        self.applyProgressContextChange(now: now, refreshVisibleProgress: true)
    }

    func applyProgressContextChange(
        now: Date,
        refreshVisibleProgress: Bool
    ) {
        do {
            if self.currentVisibleTab == .review {
                let scopeKey = try self.prepareProgressScope(now: now)
                try self.publishReviewProgressBadgeState(scopeKey: scopeKey)
            } else {
                _ = try self.prepareProgressSnapshot(now: now)
            }
            guard isProgressConsumerTab(tab: self.currentVisibleTab) else {
                return
            }
            guard refreshVisibleProgress else {
                return
            }

            Task { @MainActor in
                await self.refreshVisibleProgressIfNeeded(now: now)
            }
        } catch {
            self.progressErrorMessage = Flashcards.errorMessage(error: error)
            self.applyProgressSnapshot(snapshot: nil)
        }
    }

    func handleProgressLocalMutation(
        now: Date,
        reviewedAtClient: String
    ) {
        do {
            let scopeKey = try self.prepareProgressScope(now: now)
            self.invalidateProgress(
                scopeKey: scopeKey,
                summaryScopeKey: progressSummaryScopeKey(seriesScopeKey: scopeKey)
            )
            try self.publishReviewProgressBadgeState(scopeKey: scopeKey)

            guard let progressSnapshot = self.progressSnapshot else {
                self.progressErrorMessage = ""
                return
            }

            let patchedSnapshot = try patchProgressSnapshot(
                snapshot: progressSnapshot,
                scopeKey: scopeKey,
                reviewedAtClient: reviewedAtClient
            )
            self.applyProgressSnapshot(snapshot: patchedSnapshot)
            self.progressErrorMessage = ""
        } catch {
            self.progressErrorMessage = Flashcards.errorMessage(error: error)
        }
    }

    func handleProgressSyncCompletion(
        now: Date,
        syncResult: CloudSyncResult
    ) async {
        do {
            let isReviewVisible = self.currentVisibleTab == .review
            let scopeKey: ProgressScopeKey
            if isReviewVisible {
                scopeKey = try self.prepareProgressScope(now: now)
            } else {
                scopeKey = try self.prepareProgressSnapshot(now: now)
            }
            let summaryScopeKey = progressSummaryScopeKey(seriesScopeKey: scopeKey)

            guard syncResult.reviewProgressDataChanged else {
                return
            }

            self.invalidateProgress(scopeKey: scopeKey, summaryScopeKey: summaryScopeKey)
            if isReviewVisible {
                try self.publishReviewProgressBadgeState(scopeKey: scopeKey)
            } else if self.progressSummaryServerBaseCache == nil || self.progressSeriesServerBaseCache == nil {
                try self.publishProgressSnapshot(scopeKey: scopeKey)
            }

            guard isProgressConsumerTab(tab: self.currentVisibleTab) else {
                return
            }

            guard self.activeProgressCloudSession(scopeKey: scopeKey) != nil else {
                return
            }

            await self.refreshVisibleProgressIfNeeded(now: now)
        } catch {
            if isRequestCancellationError(error: error) {
                return
            }

            self.progressErrorMessage = Flashcards.errorMessage(error: error)
        }
    }

    private func refreshVisibleProgressIfNeeded(now: Date) async {
        switch self.currentVisibleTab {
        case .review:
            await self.refreshReviewProgressBadgeIfNeeded(now: now)
        case .progress:
            await self.refreshProgressIfNeeded(now: now)
        case .cards, .ai, .settings:
            return
        }
    }

    private func refreshProgressSummaryServerBase(
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
        self.progressErrorMessage = ""

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

            guard let observedScopeKey = self.progressObservedScopeKey,
                  progressSummaryScopeKey(seriesScopeKey: observedScopeKey) == scopeKey else {
                return
            }

            try self.publishReviewProgressBadgeState(scopeKey: observedScopeKey)
            guard self.progressSeriesInvalidatedScopeKeys.contains(observedScopeKey) == false else {
                return
            }

            try self.publishProgressSnapshot(scopeKey: observedScopeKey)
            self.progressErrorMessage = ""
        } catch {
            if isRequestCancellationError(error: error) {
                return
            }

            guard self.isCurrentProgressSummaryRefresh(scopeKey: scopeKey, refreshToken: refreshToken) else {
                return
            }

            self.progressErrorMessage = Flashcards.errorMessage(error: error)
        }
    }

    private func refreshProgressSeriesServerBase(
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
        self.progressErrorMessage = ""

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
            try self.publishProgressSnapshot(scopeKey: scopeKey)
            self.progressErrorMessage = ""
        } catch {
            if isRequestCancellationError(error: error) {
                return
            }

            guard self.isCurrentProgressSeriesRefresh(scopeKey: scopeKey, refreshToken: refreshToken) else {
                return
            }

            self.progressErrorMessage = Flashcards.errorMessage(error: error)
        }
    }

    private func prepareProgressScope(now: Date) throws -> ProgressScopeKey {
        let scopeKey = try self.currentProgressScopeKey(now: now)
        let previousScopeKey = self.progressObservedScopeKey

        if previousScopeKey != scopeKey {
            self.progressObservedScopeKey = scopeKey
            self.progressSummaryServerBaseCache = self.loadPersistedProgressSummaryServerBase(
                scopeKey: progressSummaryScopeKey(seriesScopeKey: scopeKey)
            )
            self.progressSeriesServerBaseCache = self.loadPersistedProgressSeriesServerBase(scopeKey: scopeKey)
            self.progressErrorMessage = ""
            if previousScopeKey != nil {
                self.invalidateProgress(
                    scopeKey: scopeKey,
                    summaryScopeKey: progressSummaryScopeKey(seriesScopeKey: scopeKey)
                )
            }
        }

        return scopeKey
    }

    private func prepareProgressSnapshot(now: Date) throws -> ProgressScopeKey {
        let scopeKey = try self.prepareProgressScope(now: now)

        if self.progressSnapshot?.scopeKey != scopeKey {
            try self.publishProgressSnapshot(scopeKey: scopeKey)
        }

        return scopeKey
    }

    private func publishProgressSnapshot(scopeKey: ProgressScopeKey) throws {
        let timeZone = try progressTimeZone(identifier: scopeKey.timeZone)
        let calendar = makeProgressStoreCalendar(timeZone: timeZone)
        let summaryScopeKey = progressSummaryScopeKey(seriesScopeKey: scopeKey)
        let canonicalReviewedAtClients = try self.loadCanonicalProgressReviewedAtClients()
        let pendingReviewedAtClients = try self.loadPendingProgressReviewedAtClients()
        let localFallbackSummary = try makeProgressSummaryFromReviewedAtClients(
            reviewedAtClients: canonicalReviewedAtClients,
            timeZone: summaryScopeKey.timeZone,
            referenceLocalDate: scopeKey.to
        )
        let localFallbackSeries = try makeProgressSeriesFromReviewedAtClients(
            reviewedAtClients: canonicalReviewedAtClients,
            requestRange: progressRequestRange(scopeKey: scopeKey)
        )
        let pendingLocalOverlaySeries = try makeProgressSeriesFromReviewedAtClients(
            reviewedAtClients: pendingReviewedAtClients,
            requestRange: progressRequestRange(scopeKey: scopeKey)
        )
        let hasPendingLocalOverlay = pendingReviewedAtClients.isEmpty == false

        let renderedSummary: ProgressSummary
        let summarySourceState: ProgressSourceState
        if let serverBase = self.progressSummaryServerBaseCache?.serverBase,
           self.progressSummaryServerBaseCache?.scopeKey == summaryScopeKey {
            if hasPendingLocalOverlay {
                renderedSummary = localFallbackSummary
                summarySourceState = .serverBaseWithPendingLocalOverlay
            } else {
                renderedSummary = serverBase.summary
                summarySourceState = .serverBase
            }
        } else {
            renderedSummary = localFallbackSummary
            summarySourceState = .localOnly
        }

        let renderedSeries: UserProgressSeries
        let seriesSourceState: ProgressSourceState
        if let serverBase = self.progressSeriesServerBaseCache?.serverBase,
           self.progressSeriesServerBaseCache?.scopeKey == scopeKey {
            renderedSeries = try mergeProgressSeries(
                serverBase: serverBase,
                pendingLocalOverlay: pendingLocalOverlaySeries
            )
            seriesSourceState = hasPendingLocalOverlay ? .serverBaseWithPendingLocalOverlay : .serverBase
        } else {
            renderedSeries = localFallbackSeries
            seriesSourceState = .localOnly
        }

        let snapshot = try makeProgressSnapshot(
            summary: renderedSummary,
            series: renderedSeries,
            scopeKey: scopeKey,
            summarySourceState: summarySourceState,
            seriesSourceState: seriesSourceState,
            calendar: calendar
        )
        self.applyProgressSnapshot(snapshot: snapshot)
    }

    private func publishReviewProgressBadgeState(scopeKey: ProgressScopeKey) throws {
        let summaryScopeKey = progressSummaryScopeKey(seriesScopeKey: scopeKey)
        let canonicalReviewedAtClients = try self.loadCanonicalProgressReviewedAtClients()
        let pendingReviewedAtClients = try self.loadPendingProgressReviewedAtClients()
        let localFallbackSummary = try makeProgressSummaryFromReviewedAtClients(
            reviewedAtClients: canonicalReviewedAtClients,
            timeZone: summaryScopeKey.timeZone,
            referenceLocalDate: scopeKey.to
        )
        let hasPendingLocalOverlay = pendingReviewedAtClients.isEmpty == false

        let renderedSummary: ProgressSummary
        if let serverBase = self.progressSummaryServerBaseCache?.serverBase,
           self.progressSummaryServerBaseCache?.scopeKey == summaryScopeKey {
            if hasPendingLocalOverlay {
                renderedSummary = localFallbackSummary
            } else {
                renderedSummary = serverBase.summary
            }
        } else {
            renderedSummary = localFallbackSummary
        }

        self.applyReviewProgressBadgeState(
            badgeState: makeReviewProgressBadgeState(summary: renderedSummary)
        )
    }

    private func applyProgressSnapshot(snapshot: ProgressSnapshot?) {
        if self.progressSnapshot != snapshot {
            self.progressSnapshot = snapshot
        }

        self.applyReviewProgressBadgeState(
            badgeState: makeReviewProgressBadgeState(progressSnapshot: snapshot)
        )
    }

    private func applyReviewProgressBadgeState(badgeState: ReviewProgressBadgeState) {
        if self.reviewProgressBadgeState != badgeState {
            self.reviewProgressBadgeState = badgeState
        }
    }

    private func updateProgressRefreshingState() {
        let isRefreshing = self.isProgressSummaryRefreshing || self.isProgressSeriesRefreshing
        if self.isProgressRefreshing != isRefreshing {
            self.isProgressRefreshing = isRefreshing
        }
    }

    private func loadCanonicalProgressReviewedAtClients() throws -> [String] {
        let database = try requireLocalDatabase(database: self.database)
        let workspaceIds = try self.loadCanonicalProgressWorkspaceIds(database: database)
        return try workspaceIds.flatMap { workspaceId in
            try database.loadReviewEvents(workspaceId: workspaceId).map(\.reviewedAtClient)
        }
    }

    private func loadPendingProgressReviewedAtClients() throws -> [String] {
        let database = try requireLocalDatabase(database: self.database)
        guard let installationId = self.cloudSettings?.installationId else {
            return []
        }

        let workspaceIds = try self.loadCanonicalProgressWorkspaceIds(database: database)
        return try workspaceIds.flatMap { workspaceId in
            try database.loadPendingReviewEventPayloads(
                workspaceId: workspaceId,
                installationId: installationId
            ).map(\.reviewedAtClient)
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
        return try await cloudSyncService.loadProgressSeries(
            apiBaseUrl: linkedSession.apiBaseUrl,
            authorizationHeader: linkedSession.authorizationHeaderValue,
            timeZone: scopeKey.timeZone,
            from: scopeKey.from,
            to: scopeKey.to
        )
    }

    private func currentProgressScopeKey(now: Date) throws -> ProgressScopeKey {
        let database = try requireLocalDatabase(database: self.database)
        let requestRange = try makeProgressRequestRange(
            now: now,
            timeZone: .current,
            dayCount: recentProgressHistoryDayCount
        )
        let workspaceIds = try self.loadCanonicalProgressWorkspaceIds(database: database)

        return ProgressScopeKey(
            cloudState: self.cloudSettings?.cloudState,
            linkedUserId: self.cloudSettings?.linkedUserId,
            workspaceMembershipKey: makeProgressWorkspaceMembershipKey(workspaceIds: workspaceIds),
            timeZone: requestRange.timeZone,
            from: requestRange.from,
            to: requestRange.to
        )
    }

    private func shouldRefreshProgressSummary(scopeKey: ProgressSummaryScopeKey) -> Bool {
        guard self.progressSummaryServerBaseCache?.scopeKey == scopeKey else {
            return true
        }

        return self.progressSummaryInvalidatedScopeKeys.contains(scopeKey)
    }

    private func shouldRefreshProgressSeries(scopeKey: ProgressScopeKey) -> Bool {
        guard self.progressSeriesServerBaseCache?.scopeKey == scopeKey else {
            return true
        }

        return self.progressSeriesInvalidatedScopeKeys.contains(scopeKey)
    }

    private func activeProgressCloudSession(scopeKey: ProgressScopeKey) -> CloudLinkedSession? {
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

    private func loadCanonicalProgressWorkspaceIds(database: LocalDatabase) throws -> [String] {
        let workspaceIds = try database.workspaceSettingsStore.loadCachedWorkspaces().map(\.workspaceId)
        guard workspaceIds.isEmpty == false else {
            throw LocalStoreError.database("Progress requires at least one cached workspace")
        }

        return workspaceIds
    }

    private func invalidateProgress(
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

    private func persistProgressSummaryServerBase(serverBase: PersistedProgressSummaryServerBase) throws {
        let data = try self.encoder.encode(serverBase)
        self.userDefaults.set(
            data,
            forKey: progressSummaryServerBaseUserDefaultsKey(scopeKey: serverBase.scopeKey)
        )
    }

    private func persistProgressSeriesServerBase(serverBase: PersistedProgressSeriesServerBase) throws {
        let data = try self.encoder.encode(serverBase)
        self.userDefaults.set(
            data,
            forKey: progressSeriesServerBaseUserDefaultsKey(scopeKey: serverBase.scopeKey)
        )
    }

    private func loadPersistedProgressSummaryServerBase(
        scopeKey: ProgressSummaryScopeKey
    ) -> PersistedProgressSummaryServerBase? {
        let key = progressSummaryServerBaseUserDefaultsKey(scopeKey: scopeKey)
        if let data = self.userDefaults.data(forKey: key) {
            do {
                let serverBase = try self.decoder.decode(PersistedProgressSummaryServerBase.self, from: data)
                guard serverBase.scopeKey == scopeKey else {
                    self.userDefaults.removeObject(forKey: key)
                    return nil
                }

                return serverBase
            } catch {
                self.userDefaults.removeObject(forKey: key)
                return nil
            }
        }
        return nil
    }

    private func loadPersistedProgressSeriesServerBase(scopeKey: ProgressScopeKey) -> PersistedProgressSeriesServerBase? {
        let key = progressSeriesServerBaseUserDefaultsKey(scopeKey: scopeKey)
        if let data = self.userDefaults.data(forKey: key) {
            do {
                let serverBase = try self.decoder.decode(PersistedProgressSeriesServerBase.self, from: data)
                guard serverBase.scopeKey == scopeKey else {
                    self.userDefaults.removeObject(forKey: key)
                    return nil
                }

                return serverBase
            } catch {
                self.userDefaults.removeObject(forKey: key)
                return nil
            }
        }
        return nil
    }
}

private func progressSummaryServerBaseUserDefaultsKey(scopeKey: ProgressSummaryScopeKey) -> String {
    "\(progressSummaryServerBaseCacheUserDefaultsKeyPrefix)|\(scopeKey.storageKey)"
}

private func progressSeriesServerBaseUserDefaultsKey(scopeKey: ProgressScopeKey) -> String {
    "\(progressSeriesServerBaseCacheUserDefaultsKeyPrefix)|\(scopeKey.storageKey)"
}

func progressSummaryScopeKey(seriesScopeKey: ProgressScopeKey) -> ProgressSummaryScopeKey {
    ProgressSummaryScopeKey(
        cloudState: seriesScopeKey.cloudState,
        linkedUserId: seriesScopeKey.linkedUserId,
        workspaceMembershipKey: seriesScopeKey.workspaceMembershipKey,
        timeZone: seriesScopeKey.timeZone,
        referenceLocalDate: seriesScopeKey.to
    )
}

private func makeProgressWorkspaceMembershipKey(workspaceIds: [String]) -> String {
    workspaceIds.sorted().joined(separator: ",")
}

private func makeProgressRequestRange(
    now: Date,
    timeZone: TimeZone,
    dayCount: Int
) throws -> ProgressRequestRange {
    guard dayCount > 0 else {
        throw LocalStoreError.validation("Progress date range must include at least one day")
    }

    let calendar = makeProgressStoreCalendar(timeZone: timeZone)
    let endDate = calendar.startOfDay(for: now)
    guard let startDate = calendar.date(byAdding: .day, value: -(dayCount - 1), to: endDate) else {
        throw LocalStoreError.validation("Progress date range could not be calculated")
    }

    let formatter = DateFormatter()
    formatter.calendar = calendar
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = timeZone
    formatter.dateFormat = "yyyy-MM-dd"

    let timeZoneIdentifier = timeZone.identifier.trimmingCharacters(in: .whitespacesAndNewlines)
    if timeZoneIdentifier.isEmpty {
        throw LocalStoreError.validation("Current timezone identifier is unavailable")
    }

    return ProgressRequestRange(
        timeZone: timeZoneIdentifier,
        from: formatter.string(from: startDate),
        to: formatter.string(from: endDate)
    )
}

private func progressRequestRange(scopeKey: ProgressScopeKey) -> ProgressRequestRange {
    ProgressRequestRange(
        timeZone: scopeKey.timeZone,
        from: scopeKey.from,
        to: scopeKey.to
    )
}

private func makeProgressStoreCalendar(timeZone: TimeZone) -> Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.locale = Locale(identifier: "en_US_POSIX")
    calendar.timeZone = timeZone
    return calendar
}

private func progressTimeZone(identifier: String) throws -> TimeZone {
    guard let timeZone = TimeZone(identifier: identifier) else {
        throw LocalStoreError.validation("Progress timezone identifier is invalid: \(identifier)")
    }

    return timeZone
}

private func makeZeroFilledProgressDays(requestRange: ProgressRequestRange) throws -> [ProgressDay] {
    let timeZone = try progressTimeZone(identifier: requestRange.timeZone)
    let calendar = makeProgressStoreCalendar(timeZone: timeZone)
    let startDate = try progressDateForStore(localDate: requestRange.from, calendar: calendar)
    let endDate = try progressDateForStore(localDate: requestRange.to, calendar: calendar)

    var progressDays: [ProgressDay] = []
    var currentDate = startDate
    while currentDate <= endDate {
        progressDays.append(
            ProgressDay(
                date: progressLocalDateStringForStore(date: currentDate, calendar: calendar),
                reviewCount: 0
            )
        )

        guard let nextDate = calendar.date(byAdding: .day, value: 1, to: currentDate) else {
            throw LocalStoreError.validation("Progress date range could not be advanced")
        }

        currentDate = nextDate
    }

    return progressDays
}

private func makeProgressSeriesFromReviewedAtClients(
    reviewedAtClients: [String],
    requestRange: ProgressRequestRange
) throws -> UserProgressSeries {
    let timeZone = try progressTimeZone(identifier: requestRange.timeZone)
    let calendar = makeProgressStoreCalendar(timeZone: timeZone)
    var reviewCountsByLocalDate: [String: Int] = [:]

    for reviewedAtClient in reviewedAtClients {
        guard let reviewedAtDate = parseIsoTimestamp(value: reviewedAtClient) else {
            throw LocalStoreError.validation("Progress reviewedAtClient timestamp is invalid: \(reviewedAtClient)")
        }

        let localDate = progressLocalDateStringForStore(date: reviewedAtDate, calendar: calendar)
        if localDate < requestRange.from || localDate > requestRange.to {
            continue
        }

        reviewCountsByLocalDate[localDate, default: 0] += 1
    }

    let zeroFilledDays = try makeZeroFilledProgressDays(requestRange: requestRange)
    let progressDays = zeroFilledDays.map { progressDay in
        ProgressDay(
            date: progressDay.date,
            reviewCount: reviewCountsByLocalDate[progressDay.date] ?? 0
        )
    }

    return makeProgressSeries(
        timeZone: requestRange.timeZone,
        from: requestRange.from,
        to: requestRange.to,
        dailyReviews: progressDays,
        summary: nil,
        generatedAt: nil
    )
}

private func makeProgressSummaryFromReviewedAtClients(
    reviewedAtClients: [String],
    timeZone: String,
    referenceLocalDate: String
) throws -> ProgressSummary {
    let resolvedTimeZone = try progressTimeZone(identifier: timeZone)
    let calendar = makeProgressStoreCalendar(timeZone: resolvedTimeZone)
    let reviewDates = try Set(reviewedAtClients.map { reviewedAtClient in
        guard let reviewedAtDate = parseIsoTimestamp(value: reviewedAtClient) else {
            throw LocalStoreError.validation("Progress reviewedAtClient timestamp is invalid: \(reviewedAtClient)")
        }

        return progressLocalDateStringForStore(date: reviewedAtDate, calendar: calendar)
    })

    return try makeProgressSummary(
        reviewDates: reviewDates,
        timeZone: timeZone,
        generatedAt: progressReferenceDate(
            localDate: referenceLocalDate,
            timeZoneIdentifier: timeZone
        )
    )
}

private func mergeProgressSeries(
    serverBase: UserProgressSeries,
    pendingLocalOverlay: UserProgressSeries
) throws -> UserProgressSeries {
    guard
        serverBase.timeZone == pendingLocalOverlay.timeZone,
        serverBase.from == pendingLocalOverlay.from,
        serverBase.to == pendingLocalOverlay.to
    else {
        throw LocalStoreError.validation("Progress merge inputs must share the same time range")
    }

    let overlayCounts = Dictionary(uniqueKeysWithValues: pendingLocalOverlay.dailyReviews.map { progressDay in
        (progressDay.date, progressDay.reviewCount)
    })
    let mergedDailyReviews = serverBase.dailyReviews.map { progressDay in
        ProgressDay(
            date: progressDay.date,
            reviewCount: progressDay.reviewCount + (overlayCounts[progressDay.date] ?? 0)
        )
    }

    return makeProgressSeries(
        timeZone: serverBase.timeZone,
        from: serverBase.from,
        to: serverBase.to,
        dailyReviews: mergedDailyReviews,
        summary: nil,
        generatedAt: serverBase.generatedAt
    )
}

private func patchProgressSnapshot(
    snapshot: ProgressSnapshot,
    scopeKey: ProgressScopeKey,
    reviewedAtClient: String
) throws -> ProgressSnapshot {
    guard snapshot.scopeKey.timeZone == scopeKey.timeZone else {
        return snapshot
    }

    let timeZone = try progressTimeZone(identifier: scopeKey.timeZone)
    let calendar = makeProgressStoreCalendar(timeZone: timeZone)
    let reviewedAtDate = try reviewedAtDateForProgressMutation(reviewedAtClient: reviewedAtClient)
    let reviewedLocalDate = progressLocalDateStringForStore(date: reviewedAtDate, calendar: calendar)
    let previousRangeActiveDates = Set(
        snapshot.chartData.chartDays.compactMap { chartDay in
            chartDay.reviewCount > 0 ? chartDay.localDate : nil
        }
    )
    let previousRangeStreakDays = progressCurrentStreakDays(
        reviewDates: previousRangeActiveDates,
        todayLocalDate: snapshot.scopeKey.to
    )
    let streakExtensionDays = max(0, snapshot.summary.currentStreakDays - previousRangeStreakDays)

    var dailyReviews = try makeSnapshotProgressDailyReviews(
        snapshot: snapshot,
        scopeKey: scopeKey,
        calendar: calendar
    )
    if let dayIndex = dailyReviews.firstIndex(where: { progressDay in
        progressDay.date == reviewedLocalDate
    }) {
        let progressDay = dailyReviews[dayIndex]
        dailyReviews[dayIndex] = ProgressDay(
            date: progressDay.date,
            reviewCount: progressDay.reviewCount + 1
        )
    }

    let nextRangeActiveDates = Set(
        dailyReviews.compactMap { progressDay in
            progressDay.reviewCount > 0 ? progressDay.date : nil
        }
    )
    let nextRangeStreakDays = progressCurrentStreakDays(
        reviewDates: nextRangeActiveDates,
        todayLocalDate: scopeKey.to
    )
    let didAddActiveReviewDay = previousRangeActiveDates.contains(reviewedLocalDate) == false
        && nextRangeActiveDates.contains(reviewedLocalDate)
    let patchedSummary = ProgressSummary(
        currentStreakDays: nextRangeStreakDays + streakExtensionDays,
        hasReviewedToday: nextRangeActiveDates.contains(scopeKey.to),
        lastReviewedOn: maxProgressLocalDate(
            left: snapshot.summary.lastReviewedOn,
            right: nextRangeActiveDates.max()
        ),
        activeReviewDays: snapshot.summary.activeReviewDays + (didAddActiveReviewDay ? 1 : 0)
    )
    let patchedSeries = makeProgressSeries(
        timeZone: scopeKey.timeZone,
        from: scopeKey.from,
        to: scopeKey.to,
        dailyReviews: dailyReviews,
        summary: nil,
        generatedAt: snapshot.generatedAt
    )

    return try makeProgressSnapshot(
        summary: patchedSummary,
        series: patchedSeries,
        scopeKey: scopeKey,
        summarySourceState: patchedProgressSourceState(sourceState: snapshot.summarySourceState),
        seriesSourceState: patchedProgressSourceState(sourceState: snapshot.seriesSourceState),
        calendar: calendar
    )
}

private func makeSnapshotProgressDailyReviews(
    snapshot: ProgressSnapshot,
    scopeKey: ProgressScopeKey,
    calendar: Calendar
) throws -> [ProgressDay] {
    let reviewCountsByLocalDate = Dictionary(uniqueKeysWithValues: snapshot.chartData.chartDays.map { chartDay in
        (chartDay.localDate, chartDay.reviewCount)
    })
    let startDate = try progressDateForStore(localDate: scopeKey.from, calendar: calendar)
    let endDate = try progressDateForStore(localDate: scopeKey.to, calendar: calendar)
    var progressDays: [ProgressDay] = []
    var currentDate = startDate

    while currentDate <= endDate {
        let localDate = progressLocalDateStringForStore(date: currentDate, calendar: calendar)
        progressDays.append(
            ProgressDay(
                date: localDate,
                reviewCount: reviewCountsByLocalDate[localDate] ?? 0
            )
        )
        guard let nextDate = calendar.date(byAdding: .day, value: 1, to: currentDate) else {
            throw LocalStoreError.validation("Progress date range could not be advanced")
        }

        currentDate = nextDate
    }

    return progressDays
}

private func patchedProgressSourceState(sourceState: ProgressSourceState) -> ProgressSourceState {
    switch sourceState {
    case .localOnly:
        return .localOnly
    case .serverBase, .serverBaseWithPendingLocalOverlay:
        return .serverBaseWithPendingLocalOverlay
    }
}

private func reviewedAtDateForProgressMutation(reviewedAtClient: String) throws -> Date {
    guard let reviewedAtDate = parseIsoTimestamp(value: reviewedAtClient) else {
        throw LocalStoreError.validation("Progress reviewedAtClient timestamp is invalid: \(reviewedAtClient)")
    }

    return reviewedAtDate
}

private func progressCurrentStreakDays(
    reviewDates: Set<String>,
    todayLocalDate: String
) -> Int {
    var currentDate = reviewDates.contains(todayLocalDate)
        ? todayLocalDate
        : progressShiftLocalDateForStore(value: todayLocalDate, offsetDays: -1)
    var streakDayCount = 0

    while reviewDates.contains(currentDate) {
        streakDayCount += 1
        currentDate = progressShiftLocalDateForStore(value: currentDate, offsetDays: -1)
    }

    return streakDayCount
}

private func progressShiftLocalDateForStore(value: String, offsetDays: Int) -> String {
    let formatter = DateFormatter()
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    formatter.dateFormat = "yyyy-MM-dd"
    let parsedDate = formatter.date(from: value) ?? Date(timeIntervalSince1970: 0)
    let shiftedDate = formatter.calendar.date(byAdding: .day, value: offsetDays, to: parsedDate) ?? parsedDate
    return formatter.string(from: shiftedDate)
}

private func progressReferenceDate(
    localDate: String,
    timeZoneIdentifier: String
) throws -> Date {
    let timeZone = try progressTimeZone(identifier: timeZoneIdentifier)
    let calendar = makeProgressStoreCalendar(timeZone: timeZone)
    return try progressDateForStore(localDate: localDate, calendar: calendar)
}

private func maxProgressLocalDate(left: String?, right: String?) -> String? {
    switch (left, right) {
    case (.none, .none):
        return nil
    case (.some(let leftValue), .none):
        return leftValue
    case (.none, .some(let rightValue)):
        return rightValue
    case (.some(let leftValue), .some(let rightValue)):
        return max(leftValue, rightValue)
    }
}

private func progressLocalDateStringForStore(date: Date, calendar: Calendar) -> String {
    let components = calendar.dateComponents([.year, .month, .day], from: date)
    guard
        let year = components.year,
        let month = components.month,
        let day = components.day
    else {
        preconditionFailure("Progress local date components are unavailable")
    }

    return String(format: "%04d-%02d-%02d", year, month, day)
}

private func progressDateForStore(localDate: String, calendar: Calendar) throws -> Date {
    let components = localDate.split(separator: "-", omittingEmptySubsequences: false)
    guard
        components.count == 3,
        let year = Int(components[0]),
        let month = Int(components[1]),
        let day = Int(components[2]),
        let date = calendar.date(from: DateComponents(year: year, month: month, day: day))
    else {
        throw LocalStoreError.validation("Progress local date is invalid: \(localDate)")
    }

    return calendar.startOfDay(for: date)
}
