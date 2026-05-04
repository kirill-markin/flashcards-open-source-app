import Foundation

@MainActor
extension FlashcardsStore {
    func prepareProgressScope(now: Date) throws -> ProgressScopeKey {
        let scopeKey = try self.currentProgressScopeKey(now: now)
        let previousScopeKey = self.progressObservedScopeKey

        if previousScopeKey != scopeKey {
            self.progressObservedScopeKey = scopeKey
            self.progressReviewedAtClientRevision += 1
            self.progressReviewScheduleLocalRevision += 1
            self.progressSummaryServerBaseCache = self.loadPersistedProgressSummaryServerBase(
                scopeKey: progressSummaryScopeKey(seriesScopeKey: scopeKey)
            )
            self.progressSeriesServerBaseCache = self.loadPersistedProgressSeriesServerBase(scopeKey: scopeKey)
            self.progressReviewScheduleServerBaseCache = self.loadPersistedReviewScheduleServerBase(
                scopeKey: reviewScheduleScopeKey(seriesScopeKey: scopeKey)
            )
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
        let scheduleScopeKey = reviewScheduleScopeKey(seriesScopeKey: scopeKey)

        if self.progressSnapshot?.scopeKey != scopeKey {
            try self.publishProgressSnapshot(scopeKey: scopeKey)
        }
        if self.reviewScheduleSnapshot?.scopeKey != scheduleScopeKey
            || self.progressReviewScheduleInvalidatedScopeKeys.contains(scheduleScopeKey) {
            self.publishReviewScheduleSnapshotIsolatingErrors(scopeKey: scheduleScopeKey)
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

    func publishReviewScheduleSnapshot(scopeKey: ReviewScheduleScopeKey) throws {
        if let serverBase = self.progressReviewScheduleServerBaseCache,
           serverBase.scopeKey == scopeKey {
            try self.publishReviewScheduleSnapshotFromServerBase(
                serverBaseSchedule: serverBase.serverBase,
                scopeKey: scopeKey
            )
            return
        }

        let database = try requireLocalDatabase(database: self.database)
        let workspaceIds = try self.loadCanonicalProgressWorkspaceIds(database: database)
        let localFallbackSchedule = try self.loadReviewScheduleLocalFallback(
            database: database,
            workspaceIds: workspaceIds
        )
        try self.publishReviewScheduleSnapshot(
            schedule: localFallbackSchedule,
            scopeKey: scopeKey,
            sourceState: .localOnly
        )
    }

    func publishReviewScheduleSnapshotIsolatingErrors(scopeKey: ReviewScheduleScopeKey) {
        do {
            try self.publishReviewScheduleSnapshot(scopeKey: scopeKey)
            self.clearProgressReviewScheduleRenderErrorMessage()
        } catch {
            if isRequestCancellationError(error: error) {
                return
            }

            self.applyReviewScheduleSnapshot(snapshot: nil)
            self.replaceProgressReviewScheduleRenderErrorMessage(message: Flashcards.errorMessage(error: error))
        }
    }

    private func publishReviewScheduleSnapshotFromServerBase(
        serverBaseSchedule: UserReviewSchedule,
        scopeKey: ReviewScheduleScopeKey
    ) throws {
        guard self.progressReviewScheduleInvalidatedScopeKeys.contains(scopeKey) else {
            try self.publishReviewScheduleSnapshot(
                schedule: serverBaseSchedule,
                scopeKey: scopeKey,
                sourceState: .serverBase
            )
            return
        }

        let database = try requireLocalDatabase(database: self.database)
        let workspaceIds = try self.loadCanonicalProgressWorkspaceIds(database: database)
        let pendingLocalOverlayState = try self.loadReviewSchedulePendingLocalOverlayState(
            database: database,
            workspaceIds: workspaceIds
        )

        guard pendingLocalOverlayState == .present else {
            try self.publishReviewScheduleSnapshot(
                schedule: serverBaseSchedule,
                scopeKey: scopeKey,
                sourceState: .serverBase
            )
            return
        }

        let localFallbackCoverage = try self.loadReviewScheduleLocalCoverage(
            database: database,
            workspaceIds: workspaceIds
        )
        guard localFallbackCoverage == .userWide else {
            try self.publishReviewScheduleSnapshot(
                schedule: serverBaseSchedule,
                scopeKey: scopeKey,
                sourceState: .serverBaseWithPendingLocalOverlay
            )
            return
        }

        let localFallbackSchedule = try self.loadReviewScheduleLocalFallback(
            database: database,
            workspaceIds: workspaceIds
        )
        let pendingLocalCardTotalDelta = try self.loadReviewSchedulePendingLocalCardTotalDelta(
            database: database,
            workspaceIds: workspaceIds
        )
        guard localFallbackSchedule.totalCards - pendingLocalCardTotalDelta == serverBaseSchedule.totalCards else {
            try self.publishReviewScheduleSnapshot(
                schedule: serverBaseSchedule,
                scopeKey: scopeKey,
                sourceState: .serverBaseWithPendingLocalOverlay
            )
            return
        }

        try self.publishReviewScheduleSnapshot(
            schedule: localFallbackSchedule,
            scopeKey: scopeKey,
            sourceState: .serverBaseWithPendingLocalOverlay
        )
    }

    private func publishReviewScheduleSnapshot(
        schedule: UserReviewSchedule,
        scopeKey: ReviewScheduleScopeKey,
        sourceState: ProgressSourceState
    ) throws {
        let snapshot = try makeReviewScheduleSnapshot(
            schedule: schedule,
            scopeKey: scopeKey,
            sourceState: sourceState
        )
        self.applyReviewScheduleSnapshot(snapshot: snapshot)
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
        if snapshot == nil {
            self.applyReviewScheduleSnapshot(snapshot: nil)
        }

        self.applyReviewProgressBadgeState(
            badgeState: makeReviewProgressBadgeState(progressSnapshot: snapshot)
        )
    }

    func applyReviewScheduleSnapshot(snapshot: ReviewScheduleSnapshot?) {
        if self.reviewScheduleSnapshot != snapshot {
            self.reviewScheduleSnapshot = snapshot
        }
    }

    private func applyReviewProgressBadgeState(badgeState: ReviewProgressBadgeState) {
        if self.reviewProgressBadgeState != badgeState {
            self.reviewProgressBadgeState = badgeState
        }
    }

    private func loadProgressReviewedAtClientSources() throws -> ProgressReviewedAtClientSources {
        let database = try requireLocalDatabase(database: self.database)
        let workspaceIds = try self.loadCanonicalProgressWorkspaceIds(database: database)
        return try self.ensureProgressReviewedAtClientCacheEntry(
            database: database,
            workspaceIds: workspaceIds
        ).sources
    }

    private func loadReviewSchedulePendingLocalOverlayState(
        database: LocalDatabase,
        workspaceIds: [String]
    ) throws -> ProgressPendingLocalOverlayState {
        try self.ensureProgressReviewScheduleLocalCacheEntry(
            database: database,
            workspaceIds: workspaceIds
        ).pendingOverlayState
    }

    private func loadReviewSchedulePendingLocalCardTotalDelta(
        database: LocalDatabase,
        workspaceIds: [String]
    ) throws -> Int {
        try self.ensureProgressReviewScheduleLocalCacheEntry(
            database: database,
            workspaceIds: workspaceIds
        ).pendingCardTotalDelta
    }

    private func loadReviewScheduleLocalFallback(
        database: LocalDatabase,
        workspaceIds: [String]
    ) throws -> UserReviewSchedule {
        try self.ensureProgressReviewScheduleLocalCacheEntry(
            database: database,
            workspaceIds: workspaceIds
        ).reviewSchedule
    }

    private func loadReviewScheduleLocalCoverage(
        database: LocalDatabase,
        workspaceIds: [String]
    ) throws -> ReviewScheduleLocalCoverage {
        try self.ensureProgressReviewScheduleLocalCacheEntry(
            database: database,
            workspaceIds: workspaceIds
        ).localCoverage
    }

    private func ensureProgressReviewedAtClientCacheEntry(
        database: LocalDatabase,
        workspaceIds: [String]
    ) throws -> ProgressReviewedAtClientCacheEntry {
        guard let scopeKey = self.progressObservedScopeKey else {
            throw LocalStoreError.database(
                "Progress reviewed-at-client cache requires a prepared progress scope"
            )
        }
        let cacheKey = ProgressReviewedAtClientCacheKey(
            workspaceMembershipKey: scopeKey.workspaceMembershipKey,
            installationId: self.cloudSettings?.installationId,
            revision: self.progressReviewedAtClientRevision
        )
        if let entry = self.progressReviewedAtClientCache, entry.key == cacheKey {
            return entry
        }

        let entry = ProgressReviewedAtClientCacheEntry(
            key: cacheKey,
            sources: try self.computeProgressReviewedAtClientSources(
                database: database,
                workspaceIds: workspaceIds
            )
        )
        self.progressReviewedAtClientCache = entry
        return entry
    }

    private func ensureProgressReviewScheduleLocalCacheEntry(
        database: LocalDatabase,
        workspaceIds: [String]
    ) throws -> ProgressReviewScheduleLocalCacheEntry {
        guard let scopeKey = self.progressObservedScopeKey else {
            throw LocalStoreError.database(
                "Progress review-schedule local cache requires a prepared progress scope"
            )
        }
        let scheduleScopeKey = reviewScheduleScopeKey(seriesScopeKey: scopeKey)
        let cacheKey = ProgressReviewScheduleLocalCacheKey(
            workspaceMembershipKey: scopeKey.workspaceMembershipKey,
            timeZone: scheduleScopeKey.timeZone,
            referenceLocalDate: scheduleScopeKey.referenceLocalDate,
            installationId: self.cloudSettings?.installationId,
            revision: self.progressReviewScheduleLocalRevision
        )
        if let entry = self.progressReviewScheduleLocalCache, entry.key == cacheKey {
            return entry
        }

        let entry = ProgressReviewScheduleLocalCacheEntry(
            key: cacheKey,
            reviewSchedule: try self.computeReviewScheduleLocalFallback(
                database: database,
                workspaceIds: workspaceIds,
                scopeKey: scheduleScopeKey
            ),
            pendingOverlayState: try self.computeReviewSchedulePendingLocalOverlayState(
                database: database,
                workspaceIds: workspaceIds
            ),
            pendingCardTotalDelta: try self.computeReviewSchedulePendingLocalCardTotalDelta(
                database: database,
                workspaceIds: workspaceIds
            ),
            localCoverage: try self.computeReviewScheduleLocalCoverage(
                database: database,
                workspaceIds: workspaceIds
            )
        )
        self.progressReviewScheduleLocalCache = entry
        return entry
    }

    private func computeProgressReviewedAtClientSources(
        database: LocalDatabase,
        workspaceIds: [String]
    ) throws -> ProgressReviewedAtClientSources {
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

    private func computeReviewSchedulePendingLocalOverlayState(
        database: LocalDatabase,
        workspaceIds: [String]
    ) throws -> ProgressPendingLocalOverlayState {
        guard let installationId = self.cloudSettings?.installationId else {
            return .empty
        }

        for workspaceId in workspaceIds {
            if try database.hasPendingReviewScheduleImpactingCardOperation(
                workspaceId: workspaceId,
                installationId: installationId
            ) {
                return .present
            }
        }

        return .empty
    }

    private func computeReviewSchedulePendingLocalCardTotalDelta(
        database: LocalDatabase,
        workspaceIds: [String]
    ) throws -> Int {
        guard let installationId = self.cloudSettings?.installationId else {
            return 0
        }

        return try database.loadPendingReviewScheduleCardTotalDelta(
            workspaceIds: workspaceIds,
            installationId: installationId
        )
    }

    private func computeReviewScheduleLocalFallback(
        database: LocalDatabase,
        workspaceIds: [String],
        scopeKey: ReviewScheduleScopeKey
    ) throws -> UserReviewSchedule {
        try database.cardStore.loadReviewSchedule(
            workspaceIds: workspaceIds,
            timeZone: scopeKey.timeZone,
            referenceLocalDate: scopeKey.referenceLocalDate
        )
    }

    private func computeReviewScheduleLocalCoverage(
        database: LocalDatabase,
        workspaceIds: [String]
    ) throws -> ReviewScheduleLocalCoverage {
        guard let cloudSettings = self.cloudSettings else {
            return .userWide
        }

        switch cloudSettings.cloudState {
        case .guest, .linked:
            return try self.loadHydratedReviewScheduleLocalCoverage(
                database: database,
                workspaceIds: workspaceIds
            )
        case .disconnected, .linkingReady:
            return .userWide
        }
    }

    private func loadHydratedReviewScheduleLocalCoverage(
        database: LocalDatabase,
        workspaceIds: [String]
    ) throws -> ReviewScheduleLocalCoverage {
        for workspaceId in workspaceIds {
            if try database.hasHydratedHotState(workspaceId: workspaceId) == false {
                return .partialOrUnknown
            }
        }

        return .userWide
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
