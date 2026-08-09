import Foundation

private struct LoadedLocalReadModels {
    let cards: [Card]
    let decks: [Deck]
    let deckItems: [DeckListItem]
    let homeSnapshot: HomeSnapshot
}

private struct BootstrapReadExpectation: Sendable {
    let databaseIdentity: ObjectIdentifier
    let databaseURL: URL
    let localReadVersion: Int
    let reviewSubmissionMutationRevision: Int
}

private func loadLocalReadModels(
    database: LocalDatabase,
    snapshot: AppBootstrapSnapshot,
    now: Date
) throws -> LoadedLocalReadModels {
    let cards = try database.loadActiveCards(workspaceId: snapshot.workspace.workspaceId)
    let decks = try database.loadActiveDecks(workspaceId: snapshot.workspace.workspaceId)
    let overviewSnapshot = try database.loadWorkspaceOverviewSnapshot(
        workspaceId: snapshot.workspace.workspaceId,
        workspaceName: snapshot.workspace.name,
        now: now
    )
    return LoadedLocalReadModels(
        cards: cards,
        decks: decks,
        deckItems: makeDeckListItems(decks: decks, cards: cards, now: now),
        homeSnapshot: HomeSnapshot(
            deckCount: overviewSnapshot.deckCount,
            totalCards: overviewSnapshot.totalCards,
            dueCount: overviewSnapshot.dueCount,
            newCount: overviewSnapshot.newCount,
            reviewedCount: overviewSnapshot.reviewedCount
        )
    )
}

private func loadResolvedReviewQueryForReload(
    database: LocalDatabase,
    workspaceId: String,
    reviewFilter: ReviewFilter
) throws -> ResolvedReviewQuery {
    try database.loadResolvedReviewQuery(
        workspaceId: workspaceId,
        reviewFilter: reviewFilter
    )
}

@MainActor
extension FlashcardsStore {
    private func clearScheduledNotificationStorageForWorkspaceSwitch(
        previousWorkspaceId: String?,
        nextWorkspaceId: String
    ) {
        if let previousWorkspaceId {
            self.userDefaults.removeObject(
                forKey: makeScheduledReviewNotificationsUserDefaultsKey(workspaceId: previousWorkspaceId)
            )
        }
        self.userDefaults.removeObject(
            forKey: makeScheduledReviewNotificationsUserDefaultsKey(workspaceId: nextWorkspaceId)
        )
        clearStoredStrictReminders(userDefaults: self.userDefaults)
    }

    private func resetReviewRuntimeForWorkspace(nextWorkspaceId: String) {
        let nextReviewFilter = FlashcardsStore.loadSelectedReviewFilter(
            userDefaults: self.userDefaults,
            decoder: self.decoder,
            workspaceId: nextWorkspaceId
        )
        self.reviewRuntime.cancelForAccountDeletion()
        self.resetReviewHardReminderSession()
        self.reviewRuntime = ReviewQueueRuntime(
            reviewSeedQueueSize: reviewSeedQueueSize,
            reviewQueueReplenishmentThreshold: reviewQueueReplenishmentThreshold
        )
        self.applyReviewPublishedState(
            reviewState: ReviewQueueRuntime.makeInitialPublishedState(selectedReviewFilter: nextReviewFilter)
        )
        self.clearTransientBanners()
    }

    func prepareWorkspaceScopedStateForSwitch(nextWorkspaceId: String) async {
        await self.cachedAIChatStore?.prepareForWorkspaceChange()
        self.resetReviewRuntimeForWorkspace(nextWorkspaceId: nextWorkspaceId)
    }

    func reload() throws {
        try self.reload(now: Date(), refreshVisibleProgress: true)
    }

    func reload(
        now: Date,
        refreshVisibleProgress: Bool
    ) throws {
        try self.reload(
            now: now,
            refreshVisibleProgress: refreshVisibleProgress,
            resolvedReviewQueryLoader: loadResolvedReviewQueryForReload
        )
    }

    private func reload(
        now: Date,
        refreshVisibleProgress: Bool,
        resolvedReviewQueryLoader: (
            LocalDatabase,
            String,
            ReviewFilter
        ) throws -> ResolvedReviewQuery
    ) throws {
        guard let database else {
            throw LocalStoreError.uninitialized("Local database is unavailable")
        }

        let bootstrapSnapshot = try database.loadBootstrapSnapshot()
        let localReadModels = try loadLocalReadModels(
            database: database,
            snapshot: bootstrapSnapshot,
            now: now
        )
        let reviewFilter = self.reviewFilterForReload(snapshot: bootstrapSnapshot)
        let resolvedReviewQuery = try resolvedReviewQueryLoader(
            database,
            bootstrapSnapshot.workspace.workspaceId,
            reviewFilter
        )
        self.applyLoadedBootstrapSnapshot(
            snapshot: bootstrapSnapshot,
            localReadModels: localReadModels,
            resolvedReviewQuery: resolvedReviewQuery,
            databaseURL: database.databaseURL,
            now: now,
            refreshVisibleProgress: refreshVisibleProgress
        )
    }

    func reloadLocalStateForCredentialRecoveryGate(now: Date) throws {
        guard let database else {
            throw LocalStoreError.uninitialized("Local database is unavailable")
        }

        let bootstrapSnapshot = try database.loadBootstrapSnapshot()
        let localReadModels = try loadLocalReadModels(
            database: database,
            snapshot: bootstrapSnapshot,
            now: now
        )
        self.applyLoadedCredentialRecoveryGateSnapshot(
            snapshot: bootstrapSnapshot,
            localReadModels: localReadModels,
            now: now
        )
    }

    var localDatabaseURL: URL? {
        self.database?.databaseURL
    }

    private func applyLoadedCredentialRecoveryGateSnapshot(
        snapshot: AppBootstrapSnapshot,
        localReadModels: LoadedLocalReadModels,
        now: Date
    ) {
        self.applyLoadedLocalSnapshotContent(
            snapshot: snapshot,
            localReadModels: localReadModels
        )
        self.localReadVersion += 1
    }

    private func applyLoadedLocalSnapshotContent(
        snapshot: AppBootstrapSnapshot,
        localReadModels: LoadedLocalReadModels
    ) {
        self.reviewRuntime.invalidateReviewSource()
        self.workspace = snapshot.workspace
        self.userSettings = snapshot.userSettings
        self.schedulerSettings = snapshot.schedulerSettings
        self.cloudSettings = snapshot.cloudSettings
        self.reloadCachedAccountPreferencesForCurrentIdentity()
        self.reloadFeedbackPromptStateForCurrentIdentity()
        self.cards = localReadModels.cards
        self.decks = localReadModels.decks
        self.deckItems = localReadModels.deckItems
        self.homeSnapshot = localReadModels.homeSnapshot
    }

    private func applyLoadedBootstrapSnapshot(
        snapshot: AppBootstrapSnapshot,
        localReadModels: LoadedLocalReadModels,
        resolvedReviewQuery: ResolvedReviewQuery,
        databaseURL: URL,
        now: Date,
        refreshVisibleProgress: Bool
    ) {
        let previousWorkspaceId = self.workspace?.workspaceId
        let didSwitchWorkspace = previousWorkspaceId != snapshot.workspace.workspaceId
        let didTransitionWorkspace = previousWorkspaceId != nil && didSwitchWorkspace
        if didTransitionWorkspace {
            self.clearScheduledNotificationStorageForWorkspaceSwitch(
                previousWorkspaceId: previousWorkspaceId,
                nextWorkspaceId: snapshot.workspace.workspaceId
            )
        }
        if didSwitchWorkspace {
            self.resetReviewRuntimeForWorkspace(nextWorkspaceId: snapshot.workspace.workspaceId)
        }

        self.applyLoadedLocalSnapshotContent(
            snapshot: snapshot,
            localReadModels: localReadModels
        )
        self.globalErrorMessage = ""
        self.reloadReviewNotificationsSettings()
        self.reloadStrictRemindersSettings()
        if didTransitionWorkspace {
            self.reconcileStrictReminders(trigger: .workspaceChanged, now: now)
        } else {
            self.refreshAppNotificationPresentationOwnership()
        }
        self.reloadReviewReminderAttentionState()
        self.reconcileReviewReminderAttentionAfterReviewLogs(now: now)
        self.localReadVersion += 1
        if refreshVisibleProgress {
            self.prepareProgressForCurrentVisibleTabAndRefreshIfNeeded(now: now)
        } else {
            self.prepareProgressForCurrentVisibleTab(now: now)
        }
        self.cachedAIChatStore?.refreshAccessContextIfNeeded()
        self.startResolvedReviewLoad(
            resolvedReviewQuery: resolvedReviewQuery,
            workspaceId: snapshot.workspace.workspaceId,
            databaseURL: databaseURL,
            now: now
        )
        if didTransitionWorkspace == false {
            self.reconcileStrictReminders(trigger: .reviewHistoryImported, now: now)
        }
        self.reconcileReviewNotifications(
            trigger: didTransitionWorkspace ? .workspaceChanged : .filterChanged,
            now: now
        )
        self.requestGuestSignInAfterReviewPromptReconciliation()
    }

    @discardableResult
    func refreshBootstrapSnapshotWithoutReset(now: Date) async throws -> BootstrapSnapshotRefreshOutcome {
        let outcome = try await self.refreshBootstrapSnapshotContentWithoutReset(now: now)
        self.handleProgressContextDidChange(now: now)
        return outcome
    }

    @discardableResult
    func refreshBootstrapSnapshotWithoutProgressContextRefresh(now: Date) async throws -> BootstrapSnapshotRefreshOutcome {
        try await self.refreshBootstrapSnapshotContentWithoutReset(now: now)
    }

    private func refreshBootstrapSnapshotContentWithoutReset(now: Date) async throws -> BootstrapSnapshotRefreshOutcome {
        var staleResultCount = 0

        while true {
            let expectation = try self.currentBootstrapReadExpectation()
            let loadedSnapshot = try await defaultBootstrapSnapshotLoader(
                databaseURL: expectation.databaseURL,
                now: now
            )
            let actualDatabase = self.database
            let actualDatabaseIdentity = actualDatabase.map { ObjectIdentifier($0) }
            let actualDatabaseURL = actualDatabase?.databaseURL
            let actualLocalReadVersion = self.localReadVersion
            let isCurrentDatabaseState = actualDatabaseIdentity == expectation.databaseIdentity
                && actualDatabaseURL == expectation.databaseURL
                && actualLocalReadVersion == expectation.localReadVersion

            guard isCurrentDatabaseState else {
                if staleResultCount == 0 {
                    staleResultCount += 1
                    continue
                }
                throw self.staleBootstrapSnapshotError(
                    expectation: expectation,
                    actualDatabaseIdentity: actualDatabaseIdentity,
                    actualDatabaseURL: actualDatabaseURL,
                    actualLocalReadVersion: actualLocalReadVersion,
                    actualReviewSubmissionMutationState: self.reviewSubmissionOutboxMutationGate
                        .currentReviewSubmissionMutationState()
                )
            }

            let publication = self.reviewSubmissionOutboxMutationGate
                .publishIfReviewSubmissionMutationIsStable(
                    expectedRevision: expectation.reviewSubmissionMutationRevision
                ) {
                    self.applyRefreshedBootstrapSnapshotContent(
                        loadedSnapshot: loadedSnapshot,
                        now: now
                    )
                }
            switch publication {
            case .published(let outcome):
                return outcome
            case .stale(let actualReviewSubmissionMutationState):
                if staleResultCount == 0 {
                    staleResultCount += 1
                    continue
                }
                throw self.staleBootstrapSnapshotError(
                    expectation: expectation,
                    actualDatabaseIdentity: actualDatabaseIdentity,
                    actualDatabaseURL: actualDatabaseURL,
                    actualLocalReadVersion: actualLocalReadVersion,
                    actualReviewSubmissionMutationState: actualReviewSubmissionMutationState
                )
            }
        }
    }

    private func applyRefreshedBootstrapSnapshotContent(
        loadedSnapshot: LoadedBootstrapSnapshot,
        now: Date
    ) -> BootstrapSnapshotRefreshOutcome {
        let bootstrapSnapshot = loadedSnapshot.snapshot
        let nextCards = loadedSnapshot.cards
        let nextDecks = loadedSnapshot.decks
        let nextDeckItems = loadedSnapshot.deckItems
        let resolvedHomeSnapshot = loadedSnapshot.homeSnapshot

        let previousWorkspaceId = self.workspace?.workspaceId
        let didSwitchWorkspace = previousWorkspaceId != bootstrapSnapshot.workspace.workspaceId
        let didTransitionWorkspace = previousWorkspaceId != nil && didSwitchWorkspace
        let workspaceChanged = self.workspace != bootstrapSnapshot.workspace
        let cardsChanged = self.cards != nextCards
        let decksChanged = self.decks != nextDecks
        let schedulerSettingsChanged = self.schedulerSettings != bootstrapSnapshot.schedulerSettings
        let reviewSourceChanged = cardsChanged || decksChanged || schedulerSettingsChanged
        let shouldRestartActiveReviewLoad = reviewSourceChanged
            && (self.isReviewHeadLoading || self.isReviewCountsLoading || self.isReviewQueueChunkLoading)
        let didChange = workspaceChanged
            || self.userSettings != bootstrapSnapshot.userSettings
            || self.schedulerSettings != bootstrapSnapshot.schedulerSettings
            || self.cloudSettings != bootstrapSnapshot.cloudSettings
            || cardsChanged
            || decksChanged
            || self.deckItems != nextDeckItems
            || self.homeSnapshot != resolvedHomeSnapshot
        let homeSnapshotChanged = self.homeSnapshot != resolvedHomeSnapshot

        if reviewSourceChanged {
            self.reviewRuntime.invalidateReviewSource()
        }

        self.workspace = bootstrapSnapshot.workspace
        self.userSettings = bootstrapSnapshot.userSettings
        self.schedulerSettings = bootstrapSnapshot.schedulerSettings
        self.cloudSettings = bootstrapSnapshot.cloudSettings
        self.reloadCachedAccountPreferencesForCurrentIdentity()
        self.reloadFeedbackPromptStateForCurrentIdentity()
        self.cards = nextCards
        self.decks = nextDecks
        self.deckItems = nextDeckItems
        self.homeSnapshot = resolvedHomeSnapshot
        self.globalErrorMessage = ""
        if shouldRestartActiveReviewLoad {
            if self.reviewQueue.isEmpty && self.presentedReviewCard == nil {
                self.startReviewLoad(reviewFilter: self.selectedReviewFilter, now: now)
            } else {
                let settledReviewState = self.reviewRuntime.settleInvalidatedReviewLoads(
                    publishedState: self.currentReviewPublishedState()
                )
                self.applyReviewPublishedState(reviewState: settledReviewState)
            }
        }
        if didTransitionWorkspace {
            self.clearScheduledNotificationStorageForWorkspaceSwitch(
                previousWorkspaceId: previousWorkspaceId,
                nextWorkspaceId: bootstrapSnapshot.workspace.workspaceId
            )
        }
        self.reloadReviewNotificationsSettings()
        self.reloadStrictRemindersSettings()
        if didTransitionWorkspace {
            self.reconcileStrictReminders(trigger: .workspaceChanged, now: now)
        } else {
            self.refreshAppNotificationPresentationOwnership()
        }
        self.reloadReviewReminderAttentionState()
        self.reconcileReviewReminderAttentionAfterReviewLogs(now: now)
        if workspaceChanged {
            self.resetReviewHardReminderSession()
        }
        if didTransitionWorkspace == false {
            self.reconcileStrictReminders(trigger: .reviewHistoryImported, now: now)
        }
        self.reconcileReviewNotifications(
            trigger: didTransitionWorkspace ? .workspaceChanged : .filterChanged,
            now: now
        )

        return BootstrapSnapshotRefreshOutcome(
            didChange: didChange,
            workspaceChanged: workspaceChanged,
            cardsChanged: cardsChanged,
            homeSnapshotChanged: homeSnapshotChanged
        )
    }

    private func currentBootstrapReadExpectation() throws -> BootstrapReadExpectation {
        let database = try requireLocalDatabase(database: self.database)
        return BootstrapReadExpectation(
            databaseIdentity: ObjectIdentifier(database),
            databaseURL: database.databaseURL,
            localReadVersion: self.localReadVersion,
            reviewSubmissionMutationRevision: self.reviewSubmissionOutboxMutationGate
                .currentReviewSubmissionMutationState()
                .revision
        )
    }

    private func staleBootstrapSnapshotError(
        expectation: BootstrapReadExpectation,
        actualDatabaseIdentity: ObjectIdentifier?,
        actualDatabaseURL: URL?,
        actualLocalReadVersion: Int,
        actualReviewSubmissionMutationState: ReviewSubmissionMutationState
    ) -> LocalStoreError {
        let actualDatabaseIdentityDescription = actualDatabaseIdentity.map { String(describing: $0) } ?? "none"
        let actualDatabaseURLDescription = actualDatabaseURL?.path ?? "none"
        return LocalStoreError.database(
            "Bootstrap snapshot load produced a stale result twice. Expected database identity \(expectation.databaseIdentity) at \(expectation.databaseURL.path) with local read version \(expectation.localReadVersion) and review submission mutation revision \(expectation.reviewSubmissionMutationRevision), but found identity \(actualDatabaseIdentityDescription) at \(actualDatabaseURLDescription) with local read version \(actualLocalReadVersion), review submission mutation revision \(actualReviewSubmissionMutationState.revision), and \(actualReviewSubmissionMutationState.activeSubmissionCount) active review submissions."
        )
    }

    private func reviewFilterForReload(snapshot: AppBootstrapSnapshot) -> ReviewFilter {
        guard self.workspace?.workspaceId != snapshot.workspace.workspaceId else {
            return self.selectedReviewFilter
        }
        return FlashcardsStore.loadSelectedReviewFilter(
            userDefaults: self.userDefaults,
            decoder: self.decoder,
            workspaceId: snapshot.workspace.workspaceId
        )
    }

    func applyReviewPublishedState(reviewState: ReviewQueuePublishedState) {
        if reviewState != self.currentReviewPublishedState() {
            self.reviewRuntime.invalidateReviewReconciliation()
        }
        self.selectedReviewFilter = reviewState.selectedReviewFilter
        self.reviewQueue = reviewState.reviewQueue
        self.presentedReviewCard = reviewState.presentedReviewCard
        self.reviewCounts = reviewState.reviewCounts
        self.isReviewHeadLoading = reviewState.isReviewHeadLoading
        self.isReviewCountsLoading = reviewState.isReviewCountsLoading
        self.isReviewQueueChunkLoading = reviewState.isReviewQueueChunkLoading
        self.pendingReviewCardIds = reviewState.pendingReviewCardIds
        self.reviewSubmissionFailure = reviewState.reviewSubmissionFailure
    }

    func currentReviewPublishedState() -> ReviewQueuePublishedState {
        ReviewQueuePublishedState(
            selectedReviewFilter: self.selectedReviewFilter,
            reviewQueue: self.reviewQueue,
            presentedReviewCard: self.presentedReviewCard,
            reviewCounts: self.reviewCounts,
            isReviewHeadLoading: self.isReviewHeadLoading,
            isReviewCountsLoading: self.isReviewCountsLoading,
            isReviewQueueChunkLoading: self.isReviewQueueChunkLoading,
            pendingReviewCardIds: self.pendingReviewCardIds,
            reviewSubmissionFailure: self.reviewSubmissionFailure
        )
    }

    func reloadAfterReviewSourceMutation(now: Date) throws {
        try self.reloadAfterReviewSourceMutation(
            now: now,
            resolvedReviewQueryLoader: loadResolvedReviewQueryForReload
        )
    }

    func reloadAfterReviewSourceMutation(
        now: Date,
        resolvedReviewQueryLoader: (
            LocalDatabase,
            String,
            ReviewFilter
        ) throws -> ResolvedReviewQuery
    ) throws {
        do {
            try self.reload(
                now: now,
                refreshVisibleProgress: true,
                resolvedReviewQueryLoader: resolvedReviewQueryLoader
            )
        } catch {
            self.settleReviewSourceRefreshFailure(error: error)
            throw error
        }
    }

    @discardableResult
    func refreshLocalReadModels(now: Date) -> Bool {
        do {
            try self.reload(now: now, refreshVisibleProgress: true)
            return true
        } catch {
            self.settleReviewSourceRefreshFailure(error: error)
            return false
        }
    }

    func settleReviewSourceRefreshFailure(error: Error) {
        let settledReviewState = self.reviewRuntime.settleInvalidatedReviewLoads(
            publishedState: self.currentReviewPublishedState()
        )
        self.applyReviewPublishedState(reviewState: settledReviewState)
        self.globalErrorMessage = Flashcards.errorMessage(error: error)
    }

    func loadWorkspaceTagsSummary() throws -> WorkspaceTagsSummary {
        let database = try requireLocalDatabase(database: self.database)
        let workspaceId = try requireWorkspaceId(workspace: self.workspace)
        return try database.loadWorkspaceTagsSummary(workspaceId: workspaceId)
    }

    func loadDecksListSnapshot(now: Date) throws -> DecksListSnapshot {
        let database = try requireLocalDatabase(database: self.database)
        let workspaceId = try requireWorkspaceId(workspace: self.workspace)
        return try database.loadDecksListSnapshot(workspaceId: workspaceId, now: now)
    }

    func loadDeck(deckId: String) throws -> Deck {
        let database = try requireLocalDatabase(database: self.database)
        let workspaceId = try requireWorkspaceId(workspace: self.workspace)
        return try database.loadDeck(workspaceId: workspaceId, deckId: deckId)
    }

    func loadCardsMatchingDeck(filterDefinition: DeckFilterDefinition) throws -> [Card] {
        let database = try requireLocalDatabase(database: self.database)
        let workspaceId = try requireWorkspaceId(workspace: self.workspace)
        return try database.loadCardsMatchingDeck(
            workspaceId: workspaceId,
            filterDefinition: filterDefinition
        )
    }

    func makeAIChatStore() -> AIChatStore {
        let historyStore = AIChatHistoryStore(
            userDefaults: self.userDefaults,
            encoder: self.encoder,
            decoder: self.decoder,
            workspaceId: self.workspace?.workspaceId
        )
        let chatService = AIChatService(
            session: URLSession.shared,
            encoder: self.encoder,
            decoder: self.decoder
        )
        let contextLoader: any AIChatContextLoading
        if let databaseURL = self.localDatabaseURL {
            contextLoader = AIChatContextLoader(databaseURL: databaseURL)
        } else {
            contextLoader = UnavailableAIChatContextLoader()
        }

        return AIChatStore(
            flashcardsStore: self,
            historyStore: historyStore,
            chatService: chatService,
            contextLoader: contextLoader,
            voiceRecorder: AIChatVoiceRecorder(),
            audioTranscriber: AIChatTranscriptionService(
                session: URLSession.shared,
                decoder: self.decoder
            )
        )
    }
}
