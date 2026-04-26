import Foundation

@MainActor
extension FlashcardsStore {
    func prepareProgressScope(now: Date) throws -> ProgressScopeKey {
        let scopeKey = try self.currentProgressScopeKey(now: now)
        let previousScopeKey = self.progressObservedScopeKey

        if previousScopeKey != scopeKey {
            self.progressObservedScopeKey = scopeKey
            self.progressSummaryServerBaseCache = self.loadPersistedProgressSummaryServerBase(
                scopeKey: progressSummaryScopeKey(seriesScopeKey: scopeKey)
            )
            self.progressSeriesServerBaseCache = self.loadPersistedProgressSeriesServerBase(scopeKey: scopeKey)
            self.clearProgressErrorMessage()
            if previousScopeKey != nil {
                self.invalidateProgress(
                    scopeKey: scopeKey,
                    summaryScopeKey: progressSummaryScopeKey(seriesScopeKey: scopeKey)
                )
            }
        }

        return scopeKey
    }

    func prepareProgressSnapshot(now: Date) throws -> ProgressScopeKey {
        let scopeKey = try self.prepareProgressScope(now: now)

        if self.progressSnapshot?.scopeKey != scopeKey {
            try self.publishProgressSnapshot(scopeKey: scopeKey)
        }

        return scopeKey
    }

    func publishProgressSnapshot(scopeKey: ProgressScopeKey) throws {
        let timeZone = try progressTimeZone(identifier: scopeKey.timeZone)
        let calendar = makeProgressStoreCalendar(timeZone: timeZone)
        let summaryScopeKey = progressSummaryScopeKey(seriesScopeKey: scopeKey)
        let reviewedAtClientSources = try self.loadProgressReviewedAtClientSources()
        let localFallbackSummary = try makeProgressSummaryFromReviewedAtClients(
            reviewedAtClients: reviewedAtClientSources.canonicalReviewedAtClients,
            timeZone: summaryScopeKey.timeZone,
            referenceLocalDate: scopeKey.to
        )
        let localFallbackSeries = try makeProgressSeriesFromReviewedAtClients(
            reviewedAtClients: reviewedAtClientSources.canonicalReviewedAtClients,
            requestRange: progressRequestRange(scopeKey: scopeKey)
        )
        let pendingLocalOverlaySeries = try makeProgressSeriesFromReviewedAtClients(
            reviewedAtClients: reviewedAtClientSources.pendingReviewedAtClients,
            requestRange: progressRequestRange(scopeKey: scopeKey)
        )
        let renderedSummary = makeProgressRenderedSummary(
            serverBase: self.progressSummaryServerBaseCache,
            scopeKey: summaryScopeKey,
            localFallbackSummary: localFallbackSummary,
            pendingLocalOverlayState: reviewedAtClientSources.pendingLocalOverlayState
        )
        let renderedSeries = try makeProgressRenderedSeries(
            serverBase: self.progressSeriesServerBaseCache,
            scopeKey: scopeKey,
            localFallbackSeries: localFallbackSeries,
            pendingLocalOverlaySeries: pendingLocalOverlaySeries,
            pendingLocalOverlayState: reviewedAtClientSources.pendingLocalOverlayState
        )

        let snapshot = try makeProgressSnapshot(
            summary: renderedSummary.summary,
            series: renderedSeries.series,
            scopeKey: scopeKey,
            summarySourceState: renderedSummary.sourceState,
            seriesSourceState: renderedSeries.sourceState,
            calendar: calendar
        )
        self.applyProgressSnapshot(snapshot: snapshot)
    }

    func publishReviewProgressBadgeState(scopeKey: ProgressScopeKey) throws {
        let summaryScopeKey = progressSummaryScopeKey(seriesScopeKey: scopeKey)
        let reviewedAtClientSources = try self.loadProgressReviewedAtClientSources()
        let localFallbackSummary = try makeProgressSummaryFromReviewedAtClients(
            reviewedAtClients: reviewedAtClientSources.canonicalReviewedAtClients,
            timeZone: summaryScopeKey.timeZone,
            referenceLocalDate: scopeKey.to
        )
        let renderedSummary = makeProgressRenderedSummary(
            serverBase: self.progressSummaryServerBaseCache,
            scopeKey: summaryScopeKey,
            localFallbackSummary: localFallbackSummary,
            pendingLocalOverlayState: reviewedAtClientSources.pendingLocalOverlayState
        )

        self.applyReviewProgressBadgeState(
            badgeState: makeReviewProgressBadgeState(summary: renderedSummary.summary)
        )
    }

    func applyProgressSnapshot(snapshot: ProgressSnapshot?) {
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

    private func loadProgressReviewedAtClientSources() throws -> ProgressReviewedAtClientSources {
        let database = try requireLocalDatabase(database: self.database)
        let workspaceIds = try self.loadCanonicalProgressWorkspaceIds(database: database)
        let canonicalReviewedAtClients = try workspaceIds.flatMap { workspaceId in
            try database.loadReviewEvents(workspaceId: workspaceId).map(\.reviewedAtClient)
        }
        let pendingReviewedAtClients: [String]
        if let installationId = self.cloudSettings?.installationId {
            pendingReviewedAtClients = try workspaceIds.flatMap { workspaceId in
                try database.loadPendingReviewEventPayloads(
                    workspaceId: workspaceId,
                    installationId: installationId
                ).map(\.reviewedAtClient)
            }
        } else {
            pendingReviewedAtClients = []
        }

        return ProgressReviewedAtClientSources(
            canonicalReviewedAtClients: canonicalReviewedAtClients,
            pendingReviewedAtClients: pendingReviewedAtClients
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

    private func loadCanonicalProgressWorkspaceIds(database: LocalDatabase) throws -> [String] {
        let workspaceIds = try database.workspaceSettingsStore.loadCachedWorkspaces().map(\.workspaceId)
        guard workspaceIds.isEmpty == false else {
            throw LocalStoreError.database("Progress requires at least one cached workspace")
        }

        return workspaceIds
    }
}

private func makeProgressWorkspaceMembershipKey(workspaceIds: [String]) -> String {
    workspaceIds.sorted().joined(separator: ",")
}
