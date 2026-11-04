import SwiftUI

extension ReviewView {
    /// Shows at most one prompt: the first in the config `order` that its config settings and fixed
    /// code rules allow; see apps/backend/src/reviewPrompts/reviewPromptConfig.ts.
    func presentPromptAfterSavedReview(opportunity: SavedReviewPromptOpportunity) async {
        guard self.isSavedReviewPromptOpportunityCurrent(opportunity) else { return }
        let now = Date()
        let config = self.store.activeReviewPromptConfig
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

    func submitReview(cardId: String, rating: ReviewRating) {
        do {
            try store.enqueueReviewSubmission(cardId: cardId, rating: rating)
            // An enqueued rating ends this presentation, even if the card returns next.
            self.reviewScreen.endPresentation()
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
            let database = try requireLocalDatabase(database: store.database)
            let workspaceId = try requireWorkspaceId(workspace: store.workspace)
            // Reads every card tag, so it stays off the main thread; see docs/fsrs-scheduling-logic.md#non-blocking-review.
            let tagsSummary = try await loadWorkspaceTagsSummaryInBackground(
                databaseURL: database.databaseURL,
                workspaceId: workspaceId
            )
            // A newer reload replaced this one while the read ran.
            guard Task.isCancelled == false else {
                return
            }
            self.reviewTagSummaries = tagsSummary.tags
            self.totalCardsCount = tagsSummary.totalCards
            self.screenErrorMessage = ""
        } catch {
            guard Task.isCancelled == false else {
                return
            }
            self.screenErrorMessage = ""
            store.presentTechnicalError(error)
        }
    }

    func refreshPreparedRevealStates(reviewQueue: [Card], presentedCard: Card?) async {
        let now = Date()
        // The retained presentation can differ from the queue while submissions
        // and local edits reconcile. Prepare the same card the view renders.
        let currentCard = presentedCard
        // The card a rating shows is the visible queue head after this one, so this is the card to prepare;
        // every queue change re-prepares it. See docs/fsrs-scheduling-logic.md#non-blocking-review
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

        self.reviewScreen.preparedRevealState = currentPreparedRevealStatePreparation?.state
        self.reviewScreen.preparedNextRevealState = nextPreparedNextRevealStatePreparation?.state
        if let technicalError = currentPreparedRevealStatePreparation?.technicalError {
            store.presentTechnicalError(technicalError)
        }

        // Images follow the text so a slow download never delays the next card's text and answer buttons.
        var currentSides: [ReviewImagePreparationSide] = []
        var imagePreparationSides: [ReviewImagePreparationSide] = []
        if let currentCard, let currentState = currentPreparedRevealStatePreparation?.state {
            let currentBackSide = ReviewImagePreparationSide(cardId: currentCard.cardId, content: currentState.backContent)
            currentSides = [
                ReviewImagePreparationSide(cardId: currentCard.cardId, content: currentState.frontContent),
                currentBackSide
            ]
            imagePreparationSides.append(currentBackSide)
        }
        if let nextCard, let nextState = nextPreparedNextRevealStatePreparation?.state {
            imagePreparationSides.append(ReviewImagePreparationSide(cardId: nextCard.cardId, content: nextState.frontContent))
            imagePreparationSides.append(ReviewImagePreparationSide(cardId: nextCard.cardId, content: nextState.backContent))
        }
        self.reviewScreen.preparedImageCache.retainPreparedImages(for: currentSides)
        self.reviewScreen.preparedImageCache.releaseImagesOutside(sides: currentSides + imagePreparationSides)
        await self.reviewScreen.preparedImageCache.prepareReviewImages(for: imagePreparationSides, store: store)
    }

    /// A card the task has not prepared yet, such as one an edit just changed, builds the same pure state inline
    /// so it never falls back to the loader and keeps its reveal and scroll state; the task still stores it and
    /// presents its technical error. See docs/fsrs-scheduling-logic.md#non-blocking-review.
    func displayedRevealState(card: Card) -> PreparedReviewRevealState {
        let preparedRevealStateId = makePreparedReviewRevealStateId(
            card: card,
            schedulerSettings: store.schedulerSettings
        )

        if let preparedRevealState = self.reviewScreen.preparedRevealState, preparedRevealState.id == preparedRevealStateId {
            return preparedRevealState
        }
        if let preparedNextRevealState = self.reviewScreen.preparedNextRevealState, preparedNextRevealState.id == preparedRevealStateId {
            return preparedNextRevealState
        }

        return makePreparedReviewRevealStatePreparation(
            card: card,
            schedulerSettings: store.schedulerSettings,
            now: Date()
        ).state
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
