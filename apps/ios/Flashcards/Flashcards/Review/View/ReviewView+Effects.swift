import SwiftUI

extension ReviewView {
    /// Shows at most one prompt: the first in the config `order` that its config settings and fixed
    /// code rules allow; see apps/backend/src/reviewPrompts/reviewPromptConfig.ts.
    func presentPromptAfterSavedReview(opportunity: SavedReviewPromptOpportunity) async {
        guard self.isSavedReviewPromptOpportunityCurrent(opportunity) else { return }
        let now = Date()
        let config = builtInReviewPromptConfig
        let counters: ReviewPromptCounters
        do {
            counters = try self.store.loadReviewPromptCounters(now: now)
        } catch {
            self.store.captureReviewPromptFailure(error: error, stage: "load_counters")
            return
        }
        for promptId in reviewPromptWalk(config: config) {
            guard let settings = config.prompts[promptId.rawValue] else { continue }
            guard self.isSavedReviewPromptOpportunityCurrent(opportunity) else { return }
            let endsWalk = await self.presentReviewPromptIfDue(
                promptId: promptId,
                settings: settings,
                counters: counters,
                opportunity: opportunity,
                configVersion: config.version,
                now: now
            )
            if endsWalk { return }
        }
    }

    private func isSavedReviewPromptOpportunityCurrent(_ opportunity: SavedReviewPromptOpportunity) -> Bool {
        self.store.savedReviewPromptOpportunity?.id == opportunity.id
            && self.store.workspace?.workspaceId == opportunity.workspaceId
            && self.store.selectedReviewFilter == opportunity.reviewFilter
            && self.canPresentSavedReviewPrompt
    }

    /// `true` ends the walk: the prompt was shown, or its check failed and was reported.
    private func presentReviewPromptIfDue(
        promptId: ReviewPromptId,
        settings: ReviewPromptSettings,
        counters: ReviewPromptCounters,
        opportunity: SavedReviewPromptOpportunity,
        configVersion: String,
        now: Date
    ) async -> Bool {
        switch promptId {
        case .hardReminder:
            return self.store.presentReviewHardReminderIfDue(
                rating: opportunity.rating, settings: settings, counters: counters,
                configVersion: configVersion, now: now
            )
        case .paywallInitial:
            return self.presentReviewPaywallIfDue(
                trigger: .initial, settings: settings, counters: counters, configVersion: configVersion, now: now
            )
        case .paywallSecond:
            return self.presentReviewPaywallIfDue(
                trigger: .day3, settings: settings, counters: counters, configVersion: configVersion, now: now
            )
        case .paywallPeriodic:
            return self.presentReviewPaywallIfDue(
                trigger: .weekly, settings: settings, counters: counters, configVersion: configVersion, now: now
            )
        case .notificationsPrePrompt:
            guard let permissionStatus = await self.store.reviewNotificationPrePromptPermissionStatusIfDue(
                settings: settings, counters: counters, now: now
            ), self.isSavedReviewPromptOpportunityCurrent(opportunity) else { return false }
            self.store.presentReviewNotificationPrePrompt(
                permissionStatus: permissionStatus, configVersion: configVersion, now: now
            )
            return true
        case .ratingRequest:
            return self.store.prepareStoreReviewRequestAttemptIfDue(
                settings: settings, counters: counters, configVersion: configVersion, now: now
            )
        case .guestSignIn:
            return self.store.presentGuestSignInAfterReviewPromptIfDue(
                settings: settings, counters: counters, configVersion: configVersion, now: now
            )
        case .automaticFeedback:
            return self.store.presentAutomaticFeedbackPromptIfDue(settings: settings, counters: counters, now: now)
        }
    }

    private func presentReviewPaywallIfDue(
        trigger: ReviewPaywallTrigger,
        settings: ReviewPromptSettings,
        counters: ReviewPromptCounters,
        configVersion: String,
        now: Date
    ) -> Bool {
        do {
            guard try self.store.isReviewPaywallDue(
                trigger: trigger, settings: settings, counters: counters, now: now
            ) else { return false }
            self.premiumPresenter.present(
                reason: .review(trigger, reviewPromptConfigVersion: configVersion), analyticsEntryPoint: .review,
                entitlement: self.store.cloudEntitlement,
                identity: try self.store.appleSubscriptionIdentity()
            )
            self.store.isPremiumPresentationActive = self.premiumPresenter.request != nil
            return true
        } catch AppleSubscriptionError.accountUnavailable {
            // A local-only installation has no known account entitlement yet.
            return false
        } catch {
            self.store.capturePaywallStateFailure(error: error, stage: "review_eligibility")
            return true
        }
    }

    func prewarmReviewReactionLottieAssets() {
        guard self.isReviewReactionScreenVisible, self.areReviewReactionAnimationsEnabled, self.scenePhase == .active else {
            return
        }
        guard self.reviewReactionLottiePrewarmTask == nil else {
            return
        }
        let pendingVariants: Set<ReviewReactionVariant> = self.reviewReactionLottieAssetStore.pendingVariants
        guard pendingVariants.isEmpty == false else {
            return
        }

        let prewarmId = UUID()
        self.reviewReactionLottiePrewarmId = prewarmId
        self.reviewReactionLottiePrewarmTask = startReviewReactionLottieAssetPrewarm(
            pendingVariants: pendingVariants,
            onLoadResult: { loadResult in
                guard self.reviewReactionLottiePrewarmId == prewarmId else { return }
                if case .failed(let failure) = loadResult,
                   self.reviewReactionLottieAssetStore.failedAssets[failure.variant] == nil {
                    FlashcardsObservability.captureReviewReactionFailure(failure: failure, source: .review)
                }
                self.reviewReactionLottieAssetStore = self.reviewReactionLottieAssetStore.recordingLoadResult(
                    loadResult: loadResult
                )
            },
            onCompletion: {
                self.finishReviewReactionLottiePrewarm(prewarmId: prewarmId)
            }
        )
    }

    func cancelReviewReactionLottiePrewarm() {
        self.reviewReactionLottiePrewarmTask?.cancel()
        self.reviewReactionLottiePrewarmTask = nil
        self.reviewReactionLottiePrewarmId = nil
    }

    private func finishReviewReactionLottiePrewarm(prewarmId: UUID) {
        guard self.reviewReactionLottiePrewarmId == prewarmId else {
            return
        }

        self.reviewReactionLottiePrewarmTask = nil
        self.reviewReactionLottiePrewarmId = nil
    }

    func emitReviewReaction(rating: ReviewRating) {
        guard self.isReviewReactionScreenVisible, self.areReviewReactionAnimationsEnabled, self.scenePhase == .active else { return }
        let reactionRating = makeReviewReactionRating(rating: rating)
        let readyVariants: Set<ReviewReactionVariant> = self.reviewReactionLottieAssetStore.readyVariants
        let totalWeight: Int = reviewReactionReadyVariantTotalWeight(
            rating: reactionRating,
            readyVariants: readyVariants
        )
        guard totalWeight > 0 else {
            FlashcardsObservability.recordReviewReaction(
                action: .skip, variant: nil, source: .review, reason: "no_ready_asset"
            )
            return
        }
        guard let variant: ReviewReactionVariant = selectReadyReviewReactionVariant(
            rating: reactionRating,
            readyVariants: readyVariants,
            roll: Int.random(in: 0..<totalWeight)
        ) else {
            return
        }

        let event = ReviewReactionEvent(
            id: UUID(),
            rating: reactionRating,
            variant: variant
        )
        self.dismissActiveReviewReactions(reason: "replacement")
        self.activeReviewReactionEvents = [event]
    }

    func dismissActiveReviewReactions(reason: String) {
        for event in self.activeReviewReactionEvents {
            FlashcardsObservability.recordReviewReaction(
                action: .cancel, variant: event.variant, source: .review, reason: reason
            )
        }
        self.activeReviewReactionEvents = []
    }

    func removeFinishedReviewReactionEvent(
        eventId: UUID, action: ReviewReactionLifecycleAction, reason: String
    ) {
        guard let event = self.activeReviewReactionEvents.first(where: { $0.id == eventId }) else { return }
        FlashcardsObservability.recordReviewReaction(
            action: action, variant: event.variant, source: .review, reason: reason
        )
        self.activeReviewReactionEvents.removeAll { $0.id == eventId }
    }

    func submitReview(cardId: String, rating: ReviewRating) {
        do {
            try store.enqueueReviewSubmission(cardId: cardId, rating: rating)
            // An enqueued rating ends this presentation, even if the card returns next.
            self.isAnswerVisible = false
            self.screenErrorMessage = ""
        } catch {
            if let inlineErrorMessage = reviewSubmissionInlineErrorMessage(error: error) {
                self.screenErrorMessage = inlineErrorMessage
            } else {
                self.screenErrorMessage = ""
                store.presentTechnicalError(error)
            }
        }
    }

    func reloadReviewMetadata() async {
        do {
            let tagsSummary = try store.loadWorkspaceTagsSummary()
            self.reviewTagSummaries = tagsSummary.tags
            self.totalCardsCount = tagsSummary.totalCards
            self.screenErrorMessage = ""
        } catch {
            self.screenErrorMessage = ""
            store.presentTechnicalError(error)
        }
    }

    func refreshPreparedRevealStates(reviewQueue: [Card]) async {
        let now = Date()
        let currentCard = currentReviewCard(reviewQueue: reviewQueue)
        let nextCard = nextReviewCard(reviewQueue: reviewQueue)
        if currentCard != nil || nextCard != nil {
            await Task.yield()
        }
        if Task.isCancelled {
            return
        }

        let currentPreparedRevealStatePreparation = currentCard.map { card in
            makePreparedReviewRevealStatePreparation(
                card: card,
                schedulerSettings: store.schedulerSettings,
                now: now
            )
        }
        let nextPreparedNextRevealStatePreparation = nextCard.map { card in
            makePreparedReviewRevealStatePreparation(
                card: card,
                schedulerSettings: store.schedulerSettings,
                now: now
            )
        }
        if Task.isCancelled {
            return
        }

        self.preparedRevealState = currentPreparedRevealStatePreparation?.state
        self.preparedNextRevealState = nextPreparedNextRevealStatePreparation?.state
        if let technicalError = currentPreparedRevealStatePreparation?.technicalError {
            store.presentTechnicalError(technicalError)
        }
    }

    func cachedPreparedRevealState(card: Card) -> PreparedReviewRevealState? {
        let preparedRevealStateId = makePreparedReviewRevealStateId(
            card: card,
            schedulerSettings: store.schedulerSettings
        )

        if let preparedRevealState, preparedRevealState.id == preparedRevealStateId {
            return preparedRevealState
        }
        if let preparedNextRevealState, preparedNextRevealState.id == preparedRevealStateId {
            return preparedNextRevealState
        }

        return nil
    }
}

private func reviewSubmissionInlineErrorMessage(error: Error) -> String? {
    if let localStoreError = error as? LocalStoreError {
        switch localStoreError {
        case .validation:
            return Flashcards.errorMessage(error: error)
        case .database, .notFound, .uninitialized:
            return nil
        }
    }

    if error is PendingGuestUpgradeLocalMutationError {
        return Flashcards.errorMessage(error: error)
    }

    return nil
}
