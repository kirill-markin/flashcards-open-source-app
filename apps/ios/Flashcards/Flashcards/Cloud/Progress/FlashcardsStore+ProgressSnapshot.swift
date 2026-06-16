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
            self.progressLeaderboardServerBaseCache = self.loadPersistedProgressLeaderboardServerBase(
                scopeKey: self.currentProgressLeaderboardScopeKey(seriesScopeKey: scopeKey)
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

    func currentProgressLeaderboardScopeKey(seriesScopeKey: ProgressScopeKey) -> ProgressLeaderboardScopeKey {
        progressLeaderboardScopeKey(
            seriesScopeKey: seriesScopeKey,
            localeIdentifier: progressLeaderboardPreferredLocaleIdentifier()
        )
    }

    func prepareProgressSnapshot(now: Date) throws -> ProgressScopeKey {
        let scopeKey = try self.prepareProgressScope(now: now)
        let scheduleScopeKey = reviewScheduleScopeKey(seriesScopeKey: scopeKey)
        let leaderboardScopeKey = self.currentProgressLeaderboardScopeKey(seriesScopeKey: scopeKey)

        if self.progressSnapshot?.scopeKey != scopeKey {
            try self.publishProgressSnapshot(scopeKey: scopeKey)
        }
        if self.reviewScheduleSnapshot?.scopeKey != scheduleScopeKey
            || self.progressReviewScheduleInvalidatedScopeKeys.contains(scheduleScopeKey) {
            self.publishReviewScheduleSnapshotIsolatingErrors(scopeKey: scheduleScopeKey)
        }
        // Republish on scope rotation, and also when local review data changed
        // while the leaderboard publish was skipped (for example a sync pull that
        // completed on the Review tab), so the viewer overlay never lags the chart.
        if self.progressLeaderboardSnapshot?.scopeKey != leaderboardScopeKey
            || self.progressLeaderboardPublishedClientRevision != self.progressReviewedAtClientRevision {
            self.publishProgressLeaderboardSnapshotIsolatingErrors(scopeKey: leaderboardScopeKey, now: now)
        }

        return scopeKey
    }

    func publishProgressSnapshot(scopeKey: ProgressScopeKey) throws {
        let timeZone = try progressTimeZone(identifier: scopeKey.timeZone)
        let calendar = makeProgressStoreCalendar(timeZone: timeZone)
        let reviewedAtClientSources = try self.loadProgressReviewedAtClientSources()
        let renderedProgress = try self.makeProgressRenderedSummaryAndSeries(
            scopeKey: scopeKey,
            reviewedAtClientSources: reviewedAtClientSources
        )

        let snapshot = try makeProgressSnapshot(
            summary: renderedProgress.renderedSummary.summary,
            series: renderedProgress.renderedSeries.series,
            scopeKey: scopeKey,
            summarySourceState: renderedProgress.renderedSummary.sourceState,
            seriesSourceState: renderedProgress.renderedSeries.sourceState,
            calendar: calendar
        )
        self.applyProgressSnapshot(snapshot: snapshot)
    }

    private func makeProgressRenderedSummaryAndSeries(
        scopeKey: ProgressScopeKey,
        reviewedAtClientSources: ProgressReviewedAtClientSources
    ) throws -> (
        renderedSummary: ProgressRenderedSummary,
        renderedSeries: ProgressRenderedSeries
    ) {
        let summaryScopeKey = progressSummaryScopeKey(seriesScopeKey: scopeKey)
        let localFallbackActiveDates = try progressActiveDatesFromReviewEvents(
            reviewEvents: reviewedAtClientSources.canonicalReviewEvents,
            timeZone: summaryScopeKey.timeZone
        )
        let pendingLocalOverlayActiveDates = try progressActiveDatesFromReviewedAtClients(
            reviewedAtClients: reviewedAtClientSources.pendingReviewedAtClients,
            timeZone: summaryScopeKey.timeZone
        )
        let mergedActiveReviewDates = localFallbackActiveDates.union(pendingLocalOverlayActiveDates)
        let localFallbackSummary = try makeProgressSummary(
            reviewDates: localFallbackActiveDates,
            timeZone: summaryScopeKey.timeZone,
            generatedAt: progressReferenceDate(
                localDate: scopeKey.to,
                timeZoneIdentifier: summaryScopeKey.timeZone
            )
        )
        let localFallbackSeries = try makeProgressSeriesFromReviewEvents(
            reviewEvents: reviewedAtClientSources.canonicalReviewEvents,
            requestRange: progressRequestRange(scopeKey: scopeKey)
        )
        let pendingLocalOverlaySeries = try makeProgressSeriesFromReviewEvents(
            reviewEvents: reviewedAtClientSources.pendingReviewEvents,
            requestRange: progressRequestRange(scopeKey: scopeKey)
        )
        let renderedSeries = try makeProgressRenderedSeries(
            serverBase: self.progressSeriesServerBaseCache,
            scopeKey: scopeKey,
            localFallbackSeries: localFallbackSeries,
            pendingLocalOverlaySeries: pendingLocalOverlaySeries,
            mergedActiveReviewDates: mergedActiveReviewDates
        )
        let renderedSummary = try makeProgressRenderedSummary(
            serverBase: self.progressSummaryServerBaseCache,
            scopeKey: summaryScopeKey,
            localFallbackSummary: localFallbackSummary,
            localFallbackActiveDates: mergedActiveReviewDates,
            renderedSeriesContext: try makeProgressRenderedSeriesSummaryContext(
                serverBase: self.progressSeriesServerBaseCache,
                scopeKey: scopeKey,
                series: renderedSeries.series
            ),
            pendingLocalOverlayState: reviewedAtClientSources.pendingLocalOverlayState
        )

        return (
            renderedSummary: renderedSummary,
            renderedSeries: renderedSeries
        )
    }

    func publishReviewScheduleSnapshot(scopeKey: ReviewScheduleScopeKey) throws {
        if let serverBase = self.progressReviewScheduleServerBaseCache,
           serverBase.scopeKey == scopeKey {
            try self.publishReviewScheduleSnapshotFromServerBase(
                serverBase: serverBase,
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
        serverBase: PersistedReviewScheduleServerBase,
        scopeKey: ReviewScheduleScopeKey
    ) throws {
        let database = try requireLocalDatabase(database: self.database)
        let workspaceIds = try self.loadCanonicalProgressWorkspaceIds(database: database)
        let renderedServerBase = try self.makeProgressReviewScheduleRenderedServerBase(
            serverBase: serverBase,
            database: database,
            workspaceIds: workspaceIds
        )
        try self.publishReviewScheduleSnapshot(
            schedule: renderedServerBase.renderedSchedule,
            scopeKey: scopeKey,
            sourceState: renderedServerBase.sourceState
        )
    }

    func makeProgressReviewScheduleRenderedServerBase(
        serverBase: PersistedReviewScheduleServerBase,
        database: LocalDatabase,
        workspaceIds: [String]
    ) throws -> ProgressReviewScheduleRenderedServerBase {
        let serverBaseSchedule = serverBase.serverBase
        let pendingLocalOverlayState = try self.computeReviewSchedulePendingLocalOverlayState(
            database: database,
            workspaceIds: workspaceIds
        )

        if pendingLocalOverlayState == .empty && serverBase.requiresRefresh == false {
            return ProgressReviewScheduleRenderedServerBase(
                renderedSchedule: serverBaseSchedule,
                sourceState: .serverBase
            )
        }

        let localEntry = try self.ensureProgressReviewScheduleLocalCacheEntry(
            database: database,
            workspaceIds: workspaceIds
        )

        if pendingLocalOverlayState == .present {
            return self.makeProgressReviewSchedulePendingOverlayRender(
                serverBaseSchedule: serverBaseSchedule,
                localEntry: localEntry
            )
        }

        return self.makeProgressReviewScheduleDirtyCacheRender(
            serverBaseSchedule: serverBaseSchedule,
            localEntry: localEntry
        )
    }

    func acceptFreshProgressReviewScheduleServerBase(
        scopeKey: ReviewScheduleScopeKey,
        serverBaseSchedule: UserReviewSchedule,
        storedAt: String,
        database: LocalDatabase,
        workspaceIds: [String]
    ) throws {
        let pendingLocalOverlayState = try self.computeReviewSchedulePendingLocalOverlayState(
            database: database,
            workspaceIds: workspaceIds
        )
        let requiresRefresh = pendingLocalOverlayState == .present
        let persistedServerBase = PersistedReviewScheduleServerBase(
            scopeKey: scopeKey,
            serverBase: serverBaseSchedule,
            storedAt: storedAt,
            requiresRefresh: requiresRefresh
        )
        try self.persistReviewScheduleServerBase(serverBase: persistedServerBase)
        self.progressReviewScheduleServerBaseCache = persistedServerBase
        if requiresRefresh {
            self.progressReviewScheduleInvalidatedScopeKeys.insert(scopeKey)
        } else {
            self.progressReviewScheduleInvalidatedScopeKeys.remove(scopeKey)
        }
    }

    private func makeProgressReviewScheduleDirtyCacheRender(
        serverBaseSchedule: UserReviewSchedule,
        localEntry: ProgressReviewScheduleLocalCacheEntry
    ) -> ProgressReviewScheduleRenderedServerBase {
        switch localEntry.localCoverage {
        case .userWide:
            return ProgressReviewScheduleRenderedServerBase(
                renderedSchedule: localEntry.reviewSchedule,
                sourceState: .serverBaseWithPendingLocalOverlay
            )
        case .partialOrUnknown:
            return ProgressReviewScheduleRenderedServerBase(
                renderedSchedule: serverBaseSchedule,
                sourceState: .serverBaseWithPendingLocalOverlay
            )
        }
    }

    private func makeProgressReviewSchedulePendingOverlayRender(
        serverBaseSchedule: UserReviewSchedule,
        localEntry: ProgressReviewScheduleLocalCacheEntry
    ) -> ProgressReviewScheduleRenderedServerBase {
        guard canReplaceServerReviewScheduleForPendingLocalChange(
            serverBaseSchedule: serverBaseSchedule,
            localFallbackSchedule: localEntry.reviewSchedule,
            localFallbackCoverage: localEntry.localCoverage,
            pendingLocalCardTotalDelta: localEntry.pendingCardTotalDelta
        ) else {
            return ProgressReviewScheduleRenderedServerBase(
                renderedSchedule: serverBaseSchedule,
                sourceState: .serverBaseWithPendingLocalOverlay
            )
        }

        return ProgressReviewScheduleRenderedServerBase(
            renderedSchedule: localEntry.reviewSchedule,
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

    /// Renders the leaderboard section state from the local account state and the
    /// cached server payload, overlaying only the viewer's live qualified count.
    func publishProgressLeaderboardSnapshot(
        scopeKey: ProgressLeaderboardScopeKey,
        now: Date
    ) throws {
        let snapshot = try self.makeCurrentProgressLeaderboardSnapshot(scopeKey: scopeKey, now: now)
        self.applyProgressLeaderboardSnapshot(snapshot: snapshot)
        self.progressLeaderboardPublishedClientRevision = self.progressReviewedAtClientRevision
    }

    private func makeCurrentProgressLeaderboardSnapshot(
        scopeKey: ProgressLeaderboardScopeKey,
        now: Date
    ) throws -> ProgressLeaderboardSnapshot {
        switch scopeKey.cloudState {
        case .none, .some(.disconnected), .some(.linkingReady), .some(.guest):
            return makeProgressLeaderboardPlaceholderSnapshot(
                scopeKey: scopeKey,
                state: .signInRequired
            )
        case .some(.linked):
            break
        }

        guard let cachedServerBase = self.progressLeaderboardServerBaseCache,
              cachedServerBase.scopeKey == scopeKey else {
            return makeProgressLeaderboardPlaceholderSnapshot(
                scopeKey: scopeKey,
                state: .awaitingServerData
            )
        }

        let reviewedAtClientSources = try self.loadProgressReviewedAtClientSources()
        return try makeProgressLeaderboardSnapshot(
            leaderboard: cachedServerBase.serverBase,
            scopeKey: scopeKey,
            canonicalQualifiedReviewEvents: reviewedAtClientSources.canonicalQualifiedReviewEvents,
            pendingQualifiedReviewEvents: reviewedAtClientSources.pendingQualifiedReviewEvents,
            now: now
        )
    }

    func publishProgressLeaderboardSnapshotIsolatingErrors(
        scopeKey: ProgressLeaderboardScopeKey,
        now: Date
    ) {
        do {
            try self.publishProgressLeaderboardSnapshot(scopeKey: scopeKey, now: now)
        } catch {
            if isRequestCancellationError(error: error) {
                return
            }

            self.applyProgressLeaderboardSnapshot(snapshot: nil)
            self.replaceProgressLeaderboardRefreshErrorMessage(message: Flashcards.errorMessage(error: error))
        }
    }

    func applyProgressLeaderboardSnapshot(snapshot: ProgressLeaderboardSnapshot?) {
        if self.progressLeaderboardSnapshot != snapshot {
            self.progressLeaderboardSnapshot = snapshot
        }
        self.applyReviewLeaderboardBadgeState(
            badgeState: makeReviewLeaderboardBadgeState(progressLeaderboardSnapshot: snapshot)
        )
    }

    func publishReviewProgressBadgeState(scopeKey: ProgressScopeKey) throws {
        let reviewedAtClientSources = try self.loadProgressReviewedAtClientSources()
        let renderedProgress = try self.makeProgressRenderedSummaryAndSeries(
            scopeKey: scopeKey,
            reviewedAtClientSources: reviewedAtClientSources
        )

        self.applyReviewProgressBadgeState(
            badgeState: makeReviewProgressBadgeState(summary: renderedProgress.renderedSummary.summary)
        )
    }

    func applyProgressSnapshot(snapshot: ProgressSnapshot?) {
        if self.progressSnapshot != snapshot {
            self.progressSnapshot = snapshot
        }
        if snapshot == nil {
            self.applyReviewScheduleSnapshot(snapshot: nil)
            self.applyProgressLeaderboardSnapshot(snapshot: nil)
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

    private func applyReviewLeaderboardBadgeState(badgeState: ReviewLeaderboardBadgeState) {
        if self.reviewLeaderboardBadgeState != badgeState {
            self.reviewLeaderboardBadgeState = badgeState
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

    func loadReviewScheduleLocalFallback(
        database: LocalDatabase,
        workspaceIds: [String]
    ) throws -> UserReviewSchedule {
        try self.ensureProgressReviewScheduleLocalCacheEntry(
            database: database,
            workspaceIds: workspaceIds
        ).reviewSchedule
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
        var canonicalReviewEvents: [ProgressReviewEventSource] = []
        var canonicalQualifiedReviewEvents: [ProgressQualifiedReviewEventSource] = []
        for workspaceId in workspaceIds {
            for reviewEvent in try database.loadReviewEvents(workspaceId: workspaceId) {
                canonicalReviewEvents.append(
                    ProgressReviewEventSource(
                        reviewEventId: reviewEvent.reviewEventId,
                        reviewedAtClient: reviewEvent.reviewedAtClient,
                        rating: reviewEvent.rating
                    )
                )
                if reviewEvent.rating != .again {
                    canonicalQualifiedReviewEvents.append(
                        ProgressQualifiedReviewEventSource(
                            reviewEventId: reviewEvent.reviewEventId,
                            reviewedAtClient: reviewEvent.reviewedAtClient
                        )
                    )
                }
            }
        }

        var pendingReviewEvents: [ProgressReviewEventSource] = []
        var pendingQualifiedReviewEvents: [ProgressQualifiedReviewEventSource] = []
        if let installationId = self.cloudSettings?.installationId {
            for workspaceId in workspaceIds {
                let pendingPayloads = try database.loadPendingReviewEventPayloads(
                    workspaceId: workspaceId,
                    installationId: installationId
                )
                for pendingPayload in pendingPayloads {
                    guard let pendingRating = ReviewRating(rawValue: pendingPayload.rating) else {
                        throw LocalStoreError.validation(
                            "Pending review event rating is invalid: \(pendingPayload.rating)"
                        )
                    }

                    pendingReviewEvents.append(
                        ProgressReviewEventSource(
                            reviewEventId: pendingPayload.reviewEventId,
                            reviewedAtClient: pendingPayload.reviewedAtClient,
                            rating: pendingRating
                        )
                    )
                    if pendingRating != .again {
                        pendingQualifiedReviewEvents.append(
                            ProgressQualifiedReviewEventSource(
                                reviewEventId: pendingPayload.reviewEventId,
                                reviewedAtClient: pendingPayload.reviewedAtClient
                            )
                        )
                    }
                }
            }
        }

        return ProgressReviewedAtClientSources(
            canonicalReviewEvents: canonicalReviewEvents,
            pendingReviewEvents: pendingReviewEvents,
            canonicalQualifiedReviewEvents: canonicalQualifiedReviewEvents,
            pendingQualifiedReviewEvents: pendingQualifiedReviewEvents
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

    func loadCanonicalProgressWorkspaceIds(database: LocalDatabase) throws -> [String] {
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

/// Cache-scope key component: a device language change rotates the leaderboard
/// scope and forces a refetch. Anonymous display names always come verbatim from
/// the server response, which resolves their language from account settings; the
/// client never derives or generates names from this locale value.
func progressLeaderboardPreferredLocaleIdentifier() -> String {
    Locale.preferredLanguages.first ?? "en"
}
