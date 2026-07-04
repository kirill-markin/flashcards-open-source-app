import Foundation

struct ProgressOperationRefreshNeeds: Sendable, Hashable {
    let summary: Bool?
    let series: Bool?
    let reviewSchedule: Bool?
    let leaderboard: Bool?
    let streakLeaderboard: Bool?
}

/// Store-owned progress lifecycle:
/// prepare a scope snapshot from local state, render immediately from cached/local data,
/// then refresh summary and series independently and re-render whenever the latest response still matches the latest token.
@MainActor
extension FlashcardsStore {
    func addProgressForegroundOperationBreadcrumb(
        action: ForegroundOperationAction,
        phase: ForegroundOperationPhase,
        startedAt: Date?,
        cloudState: CloudAccountState?,
        refreshNeeds: ProgressOperationRefreshNeeds,
        errorSummary: String?
    ) {
        let durationMilliseconds = startedAt.map { startDate in
            iosObservationDurationMilliseconds(startedAt: startDate, finishedAt: Date())
        }
        let scope = IOSObservationScope(
            feature: .progress,
            userId: self.cloudSettings?.linkedUserId,
            workspaceId: self.workspace?.workspaceId,
            requestId: nil,
            clientRequestId: nil,
            sessionId: nil,
            runId: nil,
            cloudState: cloudState,
            configurationMode: try? self.currentCloudServiceConfiguration().mode
        )

        FlashcardsObservability.addBreadcrumb(
            .foregroundOperation(
                ForegroundOperationObservation(
                    scope: scope,
                    action: action,
                    phase: phase,
                    durationMilliseconds: durationMilliseconds,
                    selectedTab: nil,
                    scenePhase: nil,
                    isStartupReady: nil,
                    isRecoveryGateActive: nil,
                    cardCount: self.cards.count,
                    deckCount: self.decks.count,
                    pendingOutboxOperationCount: nil,
                    reviewQueueCount: nil,
                    reviewDueCount: nil,
                    reviewNewCount: nil,
                    reviewPendingCount: nil,
                    reviewTotalCount: nil,
                    reviewFilterKind: nil,
                    reviewRefreshMode: nil,
                    reviewLoadKind: nil,
                    progressSummaryRefreshNeeded: refreshNeeds.summary,
                    progressSeriesRefreshNeeded: refreshNeeds.series,
                    progressReviewScheduleRefreshNeeded: refreshNeeds.reviewSchedule,
                    progressLeaderboardRefreshNeeded: refreshNeeds.leaderboard,
                    progressStreakLeaderboardRefreshNeeded: refreshNeeds.streakLeaderboard,
                    cloudSyncBlocked: self.isCloudSyncBlocked,
                    errorSummary: errorSummary
                )
            )
        )
    }

    func prepareVisibleTabForPresentation(
        tab: AppTab,
        now: Date
    ) {
        self.updateCurrentVisibleTab(tab: tab)

        guard isProgressConsumerTab(tab: tab) else {
            return
        }

        self.prepareProgressForCurrentVisibleTab(now: now)
    }

    func refreshReviewProgressBadgeIfNeeded() async {
        await self.refreshReviewProgressBadgeIfNeeded(now: Date())
    }

    func refreshReviewLeaderboardBadgeIfNeeded() async {
        await self.refreshReviewLeaderboardBadgeIfNeeded(now: Date())
    }

    func refreshReviewBadgesIfNeeded() async {
        await self.refreshReviewBadgesIfNeeded(now: Date())
    }

    func refreshReviewBadgesIfNeeded(now: Date) async {
        let startedAt = Date()
        var refreshNeeds = ProgressOperationRefreshNeeds(
            summary: nil,
            series: nil,
            reviewSchedule: nil,
            leaderboard: nil,
            streakLeaderboard: nil
        )
        self.addProgressForegroundOperationBreadcrumb(
            action: .progressBadgeRefresh,
            phase: .start,
            startedAt: nil,
            cloudState: self.cloudSettings?.cloudState,
            refreshNeeds: refreshNeeds,
            errorSummary: nil
        )
        do {
            let scopeKey = try self.prepareProgressScope(now: now)
            try self.publishReviewProgressBadgeState(scopeKey: scopeKey)

            let summaryScopeKey = progressSummaryScopeKey(seriesScopeKey: scopeKey)
            let leaderboardScopeKey = self.currentProgressLeaderboardScopeKey(seriesScopeKey: scopeKey)
            self.publishProgressLeaderboardSnapshotIsolatingErrors(
                scopeKey: leaderboardScopeKey,
                now: now
            )

            let shouldRefreshSummary = self.shouldRefreshProgressSummary(scopeKey: summaryScopeKey)
            let shouldRefreshLeaderboard = leaderboardScopeKey.cloudState == .linked
                && self.shouldRefreshProgressLeaderboard(scopeKey: leaderboardScopeKey, now: now)
            refreshNeeds = ProgressOperationRefreshNeeds(
                summary: shouldRefreshSummary,
                series: false,
                reviewSchedule: false,
                leaderboard: shouldRefreshLeaderboard,
                streakLeaderboard: false
            )
            self.addProgressForegroundOperationBreadcrumb(
                action: .progressBadgeRefresh,
                phase: .start,
                startedAt: nil,
                cloudState: scopeKey.cloudState,
                refreshNeeds: refreshNeeds,
                errorSummary: nil
            )
            guard shouldRefreshSummary || shouldRefreshLeaderboard else {
                self.addProgressForegroundOperationBreadcrumb(
                    action: .progressBadgeRefresh,
                    phase: .success,
                    startedAt: startedAt,
                    cloudState: scopeKey.cloudState,
                    refreshNeeds: refreshNeeds,
                    errorSummary: nil
                )
                return
            }

            guard self.isCloudSyncBlocked == false else {
                self.addProgressForegroundOperationBreadcrumb(
                    action: .progressBadgeRefresh,
                    phase: .success,
                    startedAt: startedAt,
                    cloudState: scopeKey.cloudState,
                    refreshNeeds: refreshNeeds,
                    errorSummary: nil
                )
                return
            }

            guard let activeSession = try await self.progressCloudSession(scopeKey: scopeKey) else {
                self.addProgressForegroundOperationBreadcrumb(
                    action: .progressBadgeRefresh,
                    phase: .success,
                    startedAt: startedAt,
                    cloudState: scopeKey.cloudState,
                    refreshNeeds: refreshNeeds,
                    errorSummary: nil
                )
                return
            }

            if shouldRefreshSummary && shouldRefreshLeaderboard {
                async let refreshProgressBadge: Void = self.refreshProgressSummaryServerBase(
                    scopeKey: summaryScopeKey,
                    linkedSession: activeSession
                )
                async let refreshLeaderboardBadge: Void = self.refreshProgressLeaderboardServerBase(
                    scopeKey: leaderboardScopeKey,
                    linkedSession: activeSession
                )
                _ = await (refreshProgressBadge, refreshLeaderboardBadge)
            } else if shouldRefreshSummary {
                await self.refreshProgressSummaryServerBase(
                    scopeKey: summaryScopeKey,
                    linkedSession: activeSession
                )
            } else if shouldRefreshLeaderboard {
                await self.refreshProgressLeaderboardServerBase(
                    scopeKey: leaderboardScopeKey,
                    linkedSession: activeSession
                )
            }
            self.addProgressForegroundOperationBreadcrumb(
                action: .progressBadgeRefresh,
                phase: .success,
                startedAt: startedAt,
                cloudState: scopeKey.cloudState,
                refreshNeeds: refreshNeeds,
                errorSummary: nil
            )
        } catch {
            if isRequestCancellationError(error: error) {
                return
            }

            if self.isCloudSyncBlocked {
                self.addProgressForegroundOperationBreadcrumb(
                    action: .progressBadgeRefresh,
                    phase: .success,
                    startedAt: startedAt,
                    cloudState: self.cloudSettings?.cloudState,
                    refreshNeeds: refreshNeeds,
                    errorSummary: nil
                )
                return
            }

            let errorMessage = Flashcards.errorMessage(error: error)
            self.addProgressForegroundOperationBreadcrumb(
                action: .progressBadgeRefresh,
                phase: .failure,
                startedAt: startedAt,
                cloudState: self.cloudSettings?.cloudState,
                refreshNeeds: refreshNeeds,
                errorSummary: errorMessage
            )
            if self.isNonCriticalProgressRefreshTransportFailure(error: error) {
                return
            }

            if self.shouldPresentProgressRefreshTechnicalError(error: error) {
                self.presentTechnicalError(error)
            }
            self.replaceProgressErrorMessage(message: localizedProgressUnavailableErrorMessage())
        }
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

            guard self.isCloudSyncBlocked == false else {
                return
            }

            guard let activeSession = try await self.progressCloudSession(scopeKey: scopeKey) else {
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

            if self.isCloudSyncBlocked {
                return
            }

            if self.isNonCriticalProgressRefreshTransportFailure(error: error) {
                return
            }

            if self.shouldPresentProgressRefreshTechnicalError(error: error) {
                self.presentTechnicalError(error)
            }
            self.replaceProgressErrorMessage(message: localizedProgressUnavailableErrorMessage())
        }
    }

    func refreshReviewLeaderboardBadgeIfNeeded(now: Date) async {
        do {
            let scopeKey = try self.prepareProgressScope(now: now)
            let leaderboardScopeKey = self.currentProgressLeaderboardScopeKey(seriesScopeKey: scopeKey)
            self.publishProgressLeaderboardSnapshotIsolatingErrors(
                scopeKey: leaderboardScopeKey,
                now: now
            )

            guard leaderboardScopeKey.cloudState == .linked else {
                return
            }

            guard self.shouldRefreshProgressLeaderboard(scopeKey: leaderboardScopeKey, now: now) else {
                return
            }

            guard self.isCloudSyncBlocked == false else {
                return
            }

            guard let activeSession = try await self.progressCloudSession(scopeKey: scopeKey) else {
                return
            }

            await self.refreshProgressLeaderboardServerBase(
                scopeKey: leaderboardScopeKey,
                linkedSession: activeSession
            )
        } catch {
            if isRequestCancellationError(error: error) {
                return
            }

            if self.isCloudSyncBlocked {
                return
            }

            if self.isNonCriticalProgressRefreshTransportFailure(error: error) {
                return
            }

            if self.shouldPresentProgressRefreshTechnicalError(error: error) {
                self.presentTechnicalError(error)
            }
            self.replaceProgressLeaderboardRefreshErrorMessage(
                message: localizedProgressLeaderboardRefreshErrorMessage()
            )
        }
    }

    func refreshProgressIfNeeded(now: Date) async {
        let startedAt = Date()
        var refreshNeeds = ProgressOperationRefreshNeeds(
            summary: nil,
            series: nil,
            reviewSchedule: nil,
            leaderboard: nil,
            streakLeaderboard: nil
        )
        self.addProgressForegroundOperationBreadcrumb(
            action: .progressRefresh,
            phase: .start,
            startedAt: nil,
            cloudState: self.cloudSettings?.cloudState,
            refreshNeeds: refreshNeeds,
            errorSummary: nil
        )
        do {
            let scopeKey = try self.prepareProgressSnapshot(now: now)
            let summaryScopeKey = progressSummaryScopeKey(seriesScopeKey: scopeKey)
            let scheduleScopeKey = reviewScheduleScopeKey(seriesScopeKey: scopeKey)
            let leaderboardScopeKey = self.currentProgressLeaderboardScopeKey(seriesScopeKey: scopeKey)
            let shouldRefreshSummary = self.shouldRefreshProgressSummary(scopeKey: summaryScopeKey)
            let shouldRefreshSeries = self.shouldRefreshProgressSeries(scopeKey: scopeKey)
            let shouldRefreshReviewSchedule = self.shouldRefreshProgressReviewSchedule(scopeKey: scheduleScopeKey)
            let shouldRefreshLeaderboard = self.shouldRefreshProgressLeaderboard(
                scopeKey: leaderboardScopeKey,
                now: now
            )
            let shouldRefreshStreakLeaderboard = self.shouldRefreshProgressStreakLeaderboard(
                scopeKey: leaderboardScopeKey,
                now: now
            )
            refreshNeeds = ProgressOperationRefreshNeeds(
                summary: shouldRefreshSummary,
                series: shouldRefreshSeries,
                reviewSchedule: shouldRefreshReviewSchedule,
                leaderboard: shouldRefreshLeaderboard,
                streakLeaderboard: shouldRefreshStreakLeaderboard
            )
            self.addProgressForegroundOperationBreadcrumb(
                action: .progressRefresh,
                phase: .start,
                startedAt: nil,
                cloudState: scopeKey.cloudState,
                refreshNeeds: refreshNeeds,
                errorSummary: nil
            )

            guard shouldRefreshSummary
                || shouldRefreshSeries
                || shouldRefreshReviewSchedule
                || shouldRefreshLeaderboard
                || shouldRefreshStreakLeaderboard else {
                self.addProgressForegroundOperationBreadcrumb(
                    action: .progressRefresh,
                    phase: .success,
                    startedAt: startedAt,
                    cloudState: scopeKey.cloudState,
                    refreshNeeds: refreshNeeds,
                    errorSummary: nil
                )
                return
            }

            guard self.isCloudSyncBlocked == false else {
                self.addProgressForegroundOperationBreadcrumb(
                    action: .progressRefresh,
                    phase: .success,
                    startedAt: startedAt,
                    cloudState: scopeKey.cloudState,
                    refreshNeeds: refreshNeeds,
                    errorSummary: nil
                )
                return
            }

            guard let activeSession = try await self.progressCloudSession(scopeKey: scopeKey) else {
                self.addProgressForegroundOperationBreadcrumb(
                    action: .progressRefresh,
                    phase: .success,
                    startedAt: startedAt,
                    cloudState: scopeKey.cloudState,
                    refreshNeeds: refreshNeeds,
                    errorSummary: nil
                )
                return
            }

            if shouldRefreshSummary || shouldRefreshSeries {
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
                } else if shouldRefreshSeries {
                    await self.refreshProgressSeriesServerBase(
                        scopeKey: scopeKey,
                        linkedSession: activeSession
                    )
                }
            }

            async let refreshReviewSchedule: Void = self.refreshProgressReviewScheduleServerBaseIfNeeded(
                scopeKey: scheduleScopeKey,
                linkedSession: activeSession
            )
            async let refreshLeaderboard: Void = self.refreshProgressLeaderboardServerBaseIfNeeded(
                scopeKey: leaderboardScopeKey,
                linkedSession: activeSession,
                now: now
            )
            async let refreshStreakLeaderboard: Void = self.refreshProgressStreakLeaderboardServerBaseIfNeeded(
                scopeKey: leaderboardScopeKey,
                linkedSession: activeSession,
                now: now
            )
            _ = await (refreshReviewSchedule, refreshLeaderboard, refreshStreakLeaderboard)

            if self.progressObservedScopeKey == scopeKey {
                try self.publishProgressSnapshot(scopeKey: scopeKey)
                self.publishReviewScheduleSnapshotIsolatingErrors(scopeKey: scheduleScopeKey)
                self.publishProgressStreakLeaderboardSnapshotIsolatingErrors(
                    scopeKey: leaderboardScopeKey,
                    seriesScopeKey: scopeKey,
                    now: now
                )
            }
            self.addProgressForegroundOperationBreadcrumb(
                action: .progressRefresh,
                phase: .success,
                startedAt: startedAt,
                cloudState: scopeKey.cloudState,
                refreshNeeds: refreshNeeds,
                errorSummary: nil
            )
        } catch {
            if isRequestCancellationError(error: error) {
                return
            }

            if self.isCloudSyncBlocked {
                self.addProgressForegroundOperationBreadcrumb(
                    action: .progressRefresh,
                    phase: .success,
                    startedAt: startedAt,
                    cloudState: self.cloudSettings?.cloudState,
                    refreshNeeds: refreshNeeds,
                    errorSummary: nil
                )
                return
            }

            let errorMessage = Flashcards.errorMessage(error: error)
            self.addProgressForegroundOperationBreadcrumb(
                action: .progressRefresh,
                phase: .failure,
                startedAt: startedAt,
                cloudState: self.cloudSettings?.cloudState,
                refreshNeeds: refreshNeeds,
                errorSummary: errorMessage
            )
            if self.isNonCriticalProgressRefreshTransportFailure(error: error) {
                return
            }

            if self.shouldPresentProgressRefreshTechnicalError(error: error) {
                self.presentTechnicalError(error)
            }
            self.replaceProgressErrorMessage(message: localizedProgressUnavailableErrorMessage())
        }
    }

    func refreshProgressManually(now: Date) async {
        let startedAt = Date()
        var refreshNeeds = ProgressOperationRefreshNeeds(
            summary: nil,
            series: nil,
            reviewSchedule: nil,
            leaderboard: nil,
            streakLeaderboard: nil
        )
        self.addProgressForegroundOperationBreadcrumb(
            action: .progressManualRefresh,
            phase: .start,
            startedAt: nil,
            cloudState: self.cloudSettings?.cloudState,
            refreshNeeds: refreshNeeds,
            errorSummary: nil
        )
        do {
            let scopeKey = try self.prepareProgressSnapshot(now: now)
            let summaryScopeKey = progressSummaryScopeKey(seriesScopeKey: scopeKey)
            let scheduleScopeKey = reviewScheduleScopeKey(seriesScopeKey: scopeKey)
            let leaderboardScopeKey = self.currentProgressLeaderboardScopeKey(seriesScopeKey: scopeKey)
            let shouldRefreshLeaderboard = leaderboardScopeKey.cloudState == .linked
            refreshNeeds = ProgressOperationRefreshNeeds(
                summary: true,
                series: true,
                reviewSchedule: true,
                leaderboard: shouldRefreshLeaderboard,
                streakLeaderboard: shouldRefreshLeaderboard
            )
            self.addProgressForegroundOperationBreadcrumb(
                action: .progressManualRefresh,
                phase: .start,
                startedAt: nil,
                cloudState: scopeKey.cloudState,
                refreshNeeds: refreshNeeds,
                errorSummary: nil
            )

            self.invalidateProgress(scopeKey: scopeKey, summaryScopeKey: summaryScopeKey)
            guard self.isCloudSyncBlocked == false else {
                self.addProgressForegroundOperationBreadcrumb(
                    action: .progressManualRefresh,
                    phase: .success,
                    startedAt: startedAt,
                    cloudState: scopeKey.cloudState,
                    refreshNeeds: refreshNeeds,
                    errorSummary: nil
                )
                return
            }

            guard let activeSession = try await self.progressCloudSession(scopeKey: scopeKey) else {
                self.addProgressForegroundOperationBreadcrumb(
                    action: .progressManualRefresh,
                    phase: .success,
                    startedAt: startedAt,
                    cloudState: scopeKey.cloudState,
                    refreshNeeds: refreshNeeds,
                    errorSummary: nil
                )
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
            async let refreshReviewSchedule: Void = self.refreshProgressReviewScheduleServerBase(
                scopeKey: scheduleScopeKey,
                linkedSession: activeSession
            )
            async let refreshLeaderboard: Void = self.refreshProgressLeaderboardServerBaseIfLinked(
                scopeKey: leaderboardScopeKey,
                linkedSession: activeSession
            )
            async let refreshStreakLeaderboard: Void = self.refreshProgressStreakLeaderboardServerBaseIfLinked(
                scopeKey: leaderboardScopeKey,
                linkedSession: activeSession
            )
            _ = await (refreshSummary, refreshSeries, refreshReviewSchedule, refreshLeaderboard, refreshStreakLeaderboard)

            if self.progressObservedScopeKey == scopeKey {
                try self.publishProgressSnapshot(scopeKey: scopeKey)
                self.publishProgressStreakLeaderboardSnapshotIsolatingErrors(
                    scopeKey: leaderboardScopeKey,
                    seriesScopeKey: scopeKey,
                    now: now
                )
            }
            self.addProgressForegroundOperationBreadcrumb(
                action: .progressManualRefresh,
                phase: .success,
                startedAt: startedAt,
                cloudState: scopeKey.cloudState,
                refreshNeeds: refreshNeeds,
                errorSummary: nil
            )
        } catch {
            if isRequestCancellationError(error: error) {
                return
            }

            if self.isCloudSyncBlocked {
                self.addProgressForegroundOperationBreadcrumb(
                    action: .progressManualRefresh,
                    phase: .success,
                    startedAt: startedAt,
                    cloudState: self.cloudSettings?.cloudState,
                    refreshNeeds: refreshNeeds,
                    errorSummary: nil
                )
                return
            }

            let errorMessage = Flashcards.errorMessage(error: error)
            self.addProgressForegroundOperationBreadcrumb(
                action: .progressManualRefresh,
                phase: .failure,
                startedAt: startedAt,
                cloudState: self.cloudSettings?.cloudState,
                refreshNeeds: refreshNeeds,
                errorSummary: errorMessage
            )
            if self.isNonCriticalProgressRefreshTransportFailure(error: error) {
                return
            }

            if self.shouldPresentProgressRefreshTechnicalError(error: error) {
                self.presentTechnicalError(error)
            }
            self.replaceProgressErrorMessage(message: localizedProgressUnavailableErrorMessage())
        }
    }

    /// Guests render the sign-in placeholder locally, so only linked accounts
    /// refetch the leaderboard on a manual refresh.
    private func refreshProgressLeaderboardServerBaseIfLinked(
        scopeKey: ProgressLeaderboardScopeKey,
        linkedSession: CloudLinkedSession
    ) async {
        guard scopeKey.cloudState == .linked else {
            return
        }

        await self.refreshProgressLeaderboardServerBase(
            scopeKey: scopeKey,
            linkedSession: linkedSession
        )
    }

    private func refreshProgressStreakLeaderboardServerBaseIfLinked(
        scopeKey: ProgressLeaderboardScopeKey,
        linkedSession: CloudLinkedSession
    ) async {
        guard scopeKey.cloudState == .linked else {
            return
        }

        await self.refreshProgressStreakLeaderboardServerBase(
            scopeKey: scopeKey,
            linkedSession: linkedSession
        )
    }

    private func refreshProgressReviewScheduleServerBaseIfNeeded(
        scopeKey: ReviewScheduleScopeKey,
        linkedSession: CloudLinkedSession
    ) async {
        guard self.shouldRefreshProgressReviewSchedule(scopeKey: scopeKey) else {
            return
        }

        await self.refreshProgressReviewScheduleServerBase(
            scopeKey: scopeKey,
            linkedSession: linkedSession
        )
    }

    private func refreshProgressLeaderboardServerBaseIfNeeded(
        scopeKey: ProgressLeaderboardScopeKey,
        linkedSession: CloudLinkedSession,
        now: Date
    ) async {
        guard self.shouldRefreshProgressLeaderboard(scopeKey: scopeKey, now: now) else {
            return
        }

        await self.refreshProgressLeaderboardServerBase(
            scopeKey: scopeKey,
            linkedSession: linkedSession
        )
    }

    private func refreshProgressStreakLeaderboardServerBaseIfNeeded(
        scopeKey: ProgressLeaderboardScopeKey,
        linkedSession: CloudLinkedSession,
        now: Date
    ) async {
        guard self.shouldRefreshProgressStreakLeaderboard(scopeKey: scopeKey, now: now) else {
            return
        }

        await self.refreshProgressStreakLeaderboardServerBase(
            scopeKey: scopeKey,
            linkedSession: linkedSession
        )
    }

    func loadProgressLeaderboardProfile(
        publicProfileId: String
    ) async throws -> UserProgressLeaderboardProfile {
        let requestedPublicProfileId = publicProfileId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard requestedPublicProfileId.isEmpty == false else {
            throw LocalStoreError.validation("Progress leaderboard profile id must not be empty")
        }

        guard self.cloudSettings?.cloudState == .linked else {
            return UserProgressLeaderboardProfile(status: .linkedAccountRequired, readyPayload: nil)
        }

        guard let activeSession = self.cloudRuntime.activeCloudSession() else {
            throw LocalStoreError.validation(
                "Progress leaderboard profile requires an active linked cloud session"
            )
        }

        return try await self.withCloudSessionPreservingStableContext(linkedSession: activeSession) { refreshedSession in
            let cloudSyncService = try requireCloudSyncService(
                cloudSyncService: self.dependencies.cloudSyncService
            )
            let profile = try await cloudSyncService.loadProgressLeaderboardProfile(
                apiBaseUrl: refreshedSession.apiBaseUrl,
                authorizationHeader: refreshedSession.authorizationHeaderValue,
                publicProfileId: requestedPublicProfileId
            )
            try validateProgressLeaderboardProfile(
                profile: profile,
                expectedPublicProfileId: requestedPublicProfileId
            )
            return profile
        }
    }

    func handleProgressContextDidChange(now: Date) {
        self.prepareProgressForCurrentVisibleTabAndRefreshIfNeeded(now: now)
    }

    func handleProgressLocalMutation(
        now: Date,
        reviewedAtClient: String,
        reviewedTimeZone: String?,
        rating: ReviewRating
    ) {
        do {
            let scopeKey = try self.prepareProgressScope(now: now)
            let scheduleScopeKey = reviewScheduleScopeKey(seriesScopeKey: scopeKey)
            self.progressReviewedAtClientRevision += 1
            self.progressReviewScheduleLocalRevision += 1
            self.invalidateProgressSummaryAndSeries(
                scopeKey: scopeKey,
                summaryScopeKey: progressSummaryScopeKey(seriesScopeKey: scopeKey)
            )
            try self.markProgressReviewSchedulePendingLocalOverlay(scopeKey: scheduleScopeKey)
            try self.publishReviewProgressBadgeState(scopeKey: scopeKey)
            let leaderboardScopeKey = self.currentProgressLeaderboardScopeKey(seriesScopeKey: scopeKey)
            self.publishReviewScheduleSnapshotIsolatingErrors(
                scopeKey: scheduleScopeKey
            )
            // Re-render the cached leaderboard so the viewer's live qualified
            // count reflects the just-submitted review immediately.
            self.publishProgressLeaderboardSnapshotIsolatingErrors(
                scopeKey: leaderboardScopeKey,
                now: now
            )

            guard let progressSnapshot = self.progressSnapshot else {
                self.publishProgressStreakLeaderboardSnapshotIsolatingErrors(
                    scopeKey: leaderboardScopeKey,
                    seriesScopeKey: scopeKey,
                    now: now
                )
                self.clearProgressErrorMessage()
                return
            }

            guard progressSnapshot.scopeKey == scopeKey else {
                try self.publishProgressSnapshot(scopeKey: scopeKey)
                self.publishProgressStreakLeaderboardSnapshotIsolatingErrors(
                    scopeKey: leaderboardScopeKey,
                    seriesScopeKey: scopeKey,
                    now: now
                )
                self.clearProgressErrorMessage()
                return
            }

            let reviewedAtClientSources = try self.loadProgressReviewedAtClientSources()
            let activeReviewLocalDates = try progressActiveDatesFromReviewedAtClientSources(
                sources: reviewedAtClientSources,
                timeZone: scopeKey.timeZone
            )
            let patchedSnapshot = try patchProgressSnapshot(
                snapshot: progressSnapshot,
                scopeKey: scopeKey,
                reviewedAtClient: reviewedAtClient,
                reviewedTimeZone: reviewedTimeZone,
                rating: rating,
                activeReviewLocalDates: activeReviewLocalDates
            )
            self.applyProgressSnapshot(snapshot: patchedSnapshot)
            self.publishProgressStreakLeaderboardSnapshotIsolatingErrors(
                scopeKey: leaderboardScopeKey,
                seriesScopeKey: scopeKey,
                now: now
            )
            self.clearProgressErrorMessage()
        } catch {
            self.presentTechnicalError(error)
            self.replaceProgressErrorMessage(message: localizedProgressUnavailableErrorMessage())
        }
    }

    func handleReviewScheduleLocalCardStateDidChange(now: Date) {
        do {
            let scopeKey = try self.prepareProgressScope(now: now)
            let scheduleScopeKey = reviewScheduleScopeKey(seriesScopeKey: scopeKey)
            self.progressReviewScheduleLocalRevision += 1
            try self.markProgressReviewSchedulePendingLocalOverlay(scopeKey: scheduleScopeKey)
            guard self.currentVisibleTab == .progress else {
                return
            }

            self.publishReviewScheduleSnapshotIsolatingErrors(scopeKey: scheduleScopeKey)
        } catch {
            self.presentTechnicalError(error)
            self.replaceProgressErrorMessage(message: localizedProgressUnavailableErrorMessage())
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
            let scheduleScopeKey = reviewScheduleScopeKey(seriesScopeKey: scopeKey)

            let reviewProgressDataChanged = syncResult.reviewProgressDataChanged
            let reviewScheduleDataChanged = syncResult.reviewScheduleDataChanged
            guard reviewProgressDataChanged || reviewScheduleDataChanged else {
                return
            }
            if reviewProgressDataChanged {
                self.progressReviewedAtClientRevision += 1
            }
            if reviewScheduleDataChanged {
                self.progressReviewScheduleLocalRevision += 1
            }

            if reviewProgressDataChanged {
                self.invalidateProgressSummaryAndSeries(scopeKey: scopeKey, summaryScopeKey: summaryScopeKey)
                if reviewScheduleDataChanged {
                    try self.markProgressReviewScheduleChangedAfterSync(
                        scopeKey: scheduleScopeKey,
                        syncResult: syncResult
                    )
                }
                if isReviewVisible {
                    try self.publishReviewProgressBadgeState(scopeKey: scopeKey)
                } else if self.progressSummaryServerBaseCache == nil || self.progressSeriesServerBaseCache == nil {
                    try self.publishProgressSnapshot(scopeKey: scopeKey)
                }
            } else {
                try self.markProgressReviewScheduleChangedAfterSync(
                    scopeKey: scheduleScopeKey,
                    syncResult: syncResult
                )
            }

            if reviewScheduleDataChanged && isReviewVisible == false {
                self.publishReviewScheduleSnapshotIsolatingErrors(scopeKey: scheduleScopeKey)
            }
            if reviewProgressDataChanged && isReviewVisible == false {
                self.publishProgressLeaderboardSnapshotIsolatingErrors(
                    scopeKey: self.currentProgressLeaderboardScopeKey(seriesScopeKey: scopeKey),
                    now: now
                )
                self.publishProgressStreakLeaderboardSnapshotIsolatingErrors(
                    scopeKey: self.currentProgressLeaderboardScopeKey(seriesScopeKey: scopeKey),
                    seriesScopeKey: scopeKey,
                    now: now
                )
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

            if self.isCloudSyncBlocked {
                return
            }

            if self.shouldPresentProgressRefreshTechnicalError(error: error) {
                self.presentTechnicalError(error)
            }
            self.replaceProgressErrorMessage(message: localizedProgressUnavailableErrorMessage())
        }
    }

    private func markProgressReviewScheduleChangedAfterSync(
        scopeKey: ReviewScheduleScopeKey,
        syncResult: CloudSyncResult
    ) throws {
        let didAcknowledgeLocalScheduleChange = syncResult.acknowledgedReviewScheduleImpactingOperationCount > 0
            || syncResult.cleanedUpReviewScheduleImpactingOperationCount > 0
        let didPullScheduleChange = syncResult.reviewScheduleImpactingPullChangeCount > 0
        guard didAcknowledgeLocalScheduleChange || didPullScheduleChange else {
            return
        }

        try self.markProgressReviewSchedulePendingLocalOverlay(scopeKey: scopeKey)
    }

    func prepareProgressForCurrentVisibleTab(now: Date) {
        do {
            try self.prepareProgressForCurrentVisibleTabState(now: now)
        } catch {
            self.presentTechnicalError(error)
            self.replaceProgressErrorMessage(message: localizedProgressUnavailableErrorMessage())
            self.applyProgressSnapshot(snapshot: nil)
        }
    }

    func prepareProgressForCurrentVisibleTabAndRefreshIfNeeded(now: Date) {
        do {
            try self.prepareProgressForCurrentVisibleTabState(now: now)
            guard isProgressConsumerTab(tab: self.currentVisibleTab) else {
                return
            }

            Task { @MainActor in
                await self.refreshVisibleProgressIfNeeded(now: now)
            }
        } catch {
            self.presentTechnicalError(error)
            self.replaceProgressErrorMessage(message: localizedProgressUnavailableErrorMessage())
            self.applyProgressSnapshot(snapshot: nil)
        }
    }

    private func prepareProgressForCurrentVisibleTabState(now: Date) throws {
        if self.currentVisibleTab == .review {
            let scopeKey = try self.prepareProgressScope(now: now)
            try self.publishReviewProgressBadgeState(scopeKey: scopeKey)
        } else {
            _ = try self.prepareProgressSnapshot(now: now)
        }
    }

    private func refreshVisibleProgressIfNeeded(now: Date) async {
        switch self.currentVisibleTab {
        case .review:
            await self.refreshReviewBadgesIfNeeded(now: now)
        case .progress:
            await self.refreshProgressIfNeeded(now: now)
        case .cards, .ai, .settings:
            return
        }
    }
}
