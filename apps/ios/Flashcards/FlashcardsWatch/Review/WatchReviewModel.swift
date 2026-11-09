import Foundation
import Observation
import OSLog

private let watchReviewLogger: Logger = Logger(subsystem: appBundleIdentifier(), category: "watch_review")
private let watchReviewSeedQueueSize: Int = 8
private let watchReviewQueueReplenishmentThreshold: Int = 4

enum WatchReviewLoadState: Equatable {
    case loading
    case loaded
    case failed(message: String)
}

enum WatchReviewReloadIntent: Equatable {
    case startNewSession
    case keepShownCard
}

/**
 The watch's Review session over the shared queue runtime, scheduler and submission path. A rating
 hides its card at once, saves it to the local outbox, starts a sync, and rereads only the bounded
 queue window and counts. See docs/fsrs-scheduling-logic.md#non-blocking-review.
 */
@Observable
@MainActor
final class WatchReviewModel {
    private(set) var reviewState: ReviewQueuePublishedState
    private(set) var loadState: WatchReviewLoadState
    private(set) var nextDueAt: Date?
    private(set) var schedulerSettings: WorkspaceSchedulerSettings?
    /// The card whose answer is shown; a rating or a new card ends the presentation.
    private var revealedCardId: String?

    @ObservationIgnored private var runtime: ReviewQueueRuntime
    @ObservationIgnored private let session: WatchSessionModel
    @ObservationIgnored private let reader: WatchReviewReader
    @ObservationIgnored private let submissionExecutor: ReviewSubmissionExecutor
    @ObservationIgnored private let databaseURL: URL
    @ObservationIgnored private var requestedReviewFilter: ReviewFilter
    @ObservationIgnored private var workspaceId: String?
    @ObservationIgnored private var resolvedReviewQuery: ResolvedReviewQuery?
    /// Changes with every rating, so a read that started before it is redone instead of applied.
    @ObservationIgnored private var queueRevision: Int
    @ObservationIgnored private var activeReload: Task<Void, Never>?
    @ObservationIgnored private var pendingReloadIntent: WatchReviewReloadIntent?
    @ObservationIgnored private var activeProcessor: Task<Void, Never>?
    @ObservationIgnored private var nextDueRefreshTask: Task<Void, Never>?
    @ObservationIgnored private var isStopped: Bool

    init(session: WatchSessionModel, databaseURL: URL, reviewFilter: ReviewFilter) {
        self.session = session
        self.databaseURL = databaseURL
        self.reader = WatchReviewReader(databaseURL: databaseURL)
        self.submissionExecutor = ReviewSubmissionExecutor(
            databaseURL: databaseURL,
            outboxMutationGate: ReviewSubmissionOutboxMutationGate()
        )
        self.runtime = ReviewQueueRuntime(
            reviewSeedQueueSize: watchReviewSeedQueueSize,
            reviewQueueReplenishmentThreshold: watchReviewQueueReplenishmentThreshold
        )
        self.reviewState = ReviewQueueRuntime.makeInitialPublishedState(selectedReviewFilter: reviewFilter)
        self.loadState = .loading
        self.nextDueAt = nil
        self.schedulerSettings = nil
        self.revealedCardId = nil
        self.requestedReviewFilter = reviewFilter
        self.workspaceId = nil
        self.resolvedReviewQuery = nil
        self.queueRevision = 0
        self.activeReload = nil
        self.pendingReloadIntent = nil
        self.activeProcessor = nil
        self.nextDueRefreshTask = nil
        self.isStopped = false
    }

    var presentedCard: Card? {
        currentReviewCard(reviewQueue: self.runtime.effectiveReviewQueue(publishedState: self.reviewState))
    }

    var isAnswerRevealed: Bool {
        self.revealedCardId != nil && self.revealedCardId == self.presentedCard?.cardId
    }

    /// No card is left to show, and the loaded window has no more cards behind it.
    var isQueueExhausted: Bool {
        self.loadState == .loaded
            && self.presentedCard == nil
            && self.runtime.state.hasMoreReviewQueueCards == false
    }

    func start() {
        self.requestReload(intent: .startNewSession)
    }

    func selectReviewFilter(reviewFilter: ReviewFilter) {
        guard reviewFilter != self.requestedReviewFilter else {
            return
        }
        self.requestedReviewFilter = reviewFilter
        // Picking the scope already shown, such as the all-cards fallback the iPhone saves after the selected
        // deck was deleted, keeps the card, as on iPhone.
        guard reviewFilter != self.reviewState.selectedReviewFilter else {
            self.requestReload(intent: .keepShownCard)
            return
        }
        self.revealedCardId = nil
        self.requestReload(intent: .startNewSession)
    }

    /// A sync, a return to the foreground or a card coming due; the shown card stays.
    func refreshKeepingShownCard() {
        self.requestReload(intent: .keepShownCard)
    }

    func retry() {
        self.loadState = .loading
        self.requestReload(intent: .startNewSession)
    }

    /// The session left the signed-in workspace: nothing from this model may be shown or saved again.
    func stop() {
        self.isStopped = true
        self.activeReload?.cancel()
        self.activeProcessor?.cancel()
        self.nextDueRefreshTask?.cancel()
        self.runtime.cancelForAccountDeletion()
    }

    func revealAnswer() {
        guard let presentedCard = self.presentedCard, self.isAnswerRevealed == false else {
            return
        }
        self.revealedCardId = presentedCard.cardId
        Analytics.track(.reviewCardRevealed)
    }

    func answerOptions(card: Card) -> [ReviewAnswerOption]? {
        guard let schedulerSettings = self.schedulerSettings else {
            return nil
        }
        do {
            return try makeReviewAnswerOptions(card: card, schedulerSettings: schedulerSettings, now: Date())
        } catch {
            logWatchReviewFailure(event: "watch_review_answer_options_failed", error: error)
            return nil
        }
    }

    func rate(rating: ReviewRating) {
        guard self.isStopped == false,
              self.isAnswerRevealed,
              let presentedCard = self.presentedCard,
              let workspaceId = self.workspaceId,
              let resolvedReviewQuery = self.resolvedReviewQuery else {
            return
        }

        do {
            self.reviewState = try self.runtime.enqueueReviewSubmission(
                publishedState: self.reviewState,
                workspaceId: workspaceId,
                cardId: presentedCard.cardId,
                rating: rating,
                reviewContext: ReviewSubmissionContext(
                    selectedReviewFilter: resolvedReviewQuery.reviewFilter,
                    reviewQueryDefinition: resolvedReviewQuery.queryDefinition
                ),
                schedulerSettings: self.schedulerSettings
            )
        } catch {
            logWatchReviewFailure(event: "watch_review_enqueue_failed", error: error)
            return
        }
        self.queueRevision += 1
        self.revealedCardId = nil
        self.startProcessorIfNeeded()
    }

    private func startProcessorIfNeeded() {
        guard self.runtime.startReviewProcessorIfNeeded() else {
            return
        }
        self.activeProcessor = Task { @MainActor in
            await self.processPendingSubmissions()
            let shouldRestart = self.runtime.finishReviewProcessor()
            self.activeProcessor = nil
            if shouldRestart && self.isStopped == false {
                self.startProcessorIfNeeded()
            }
        }
    }

    private func processPendingSubmissions() async {
        while self.isStopped == false, let request = self.runtime.dequeuePendingReviewRequest() {
            do {
                _ = try await self.submissionExecutor.submitReview(
                    workspaceId: request.workspaceId,
                    submission: ReviewSubmission(
                        cardId: request.cardId,
                        rating: request.rating,
                        reviewedAtClient: request.reviewedAtClient,
                        reviewedTimeZone: request.reviewedTimeZone
                    )
                )
            } catch {
                Analytics.track(
                    .reviewAnswerFailed(reason: analyticsReviewAnswerFailureReason(error: error)),
                    screen: .review
                )
                logWatchReviewFailure(event: "watch_review_submission_failed", error: error)
                await self.restoreFailedReviewSubmission(request: request, error: error)
                continue
            }
            guard self.isStopped == false else {
                return
            }

            // The rating is already in the local outbox, so the sync can push it.
            Task { @MainActor in
                await self.session.syncNow()
            }
            // The rated card leaves the window before it stops being pending, so it never shows again.
            await self.reload(intent: .keepShownCard)
            guard self.isStopped == false else {
                return
            }
            self.reviewState = self.runtime.completeReviewSubmission(
                publishedState: self.reviewState,
                request: request,
                validationContext: nil
            )
        }
    }

    /// Nothing was saved, so the card returns as the shown card with its answer revealed, as before the
    /// rating; a stop or workspace switch during the reread leaves it out.
    private func restoreFailedReviewSubmission(request: ReviewSubmissionRequest, error: Error) async {
        let validationContext: ReviewSubmissionRollbackValidationContext?
        do {
            validationContext = try await self.reader.loadRollbackValidationContext(now: Date())
        } catch {
            logWatchReviewFailure(event: "watch_review_rollback_load_failed", error: error)
            validationContext = nil
        }
        guard self.isStopped == false else {
            return
        }

        self.reviewState = self.runtime.failReviewSubmission(
            publishedState: self.reviewState,
            request: request,
            message: Flashcards.errorMessage(error: error),
            validationContext: validationContext?.currentWorkspaceId == self.workspaceId ? validationContext : nil
        )
        // A read that started before the card returned would replace it as the shown card.
        self.queueRevision += 1
        if self.presentedCard?.cardId == request.cardId {
            self.revealedCardId = request.cardId
        }
    }

    private func requestReload(intent: WatchReviewReloadIntent) {
        Task { @MainActor in
            await self.reload(intent: intent)
        }
    }

    /// A call during a running reload waits for it and one more run after it, so it always sees the
    /// database as of the call.
    private func reload(intent: WatchReviewReloadIntent) async {
        self.mergePendingReloadIntent(intent: intent)
        if let activeReload = self.activeReload {
            await activeReload.value
            return
        }

        let task = Task { @MainActor in
            while self.isStopped == false, let nextIntent = self.pendingReloadIntent {
                self.pendingReloadIntent = nil
                await self.reloadOnce(intent: nextIntent)
            }
            self.activeReload = nil
        }
        self.activeReload = task
        await task.value
    }

    private func mergePendingReloadIntent(intent: WatchReviewReloadIntent) {
        self.pendingReloadIntent = self.pendingReloadIntent == .startNewSession ? .startNewSession : intent
    }

    private func reloadOnce(intent: WatchReviewReloadIntent) async {
        let now = Date()
        let revision = self.queueRevision
        let requestedReviewFilter = self.requestedReviewFilter
        let effectiveQueue = self.runtime.effectiveReviewQueue(publishedState: self.reviewState)
        let shownCardId = intent == .keepShownCard ? currentReviewCard(reviewQueue: effectiveQueue)?.cardId : nil
        let nextCardId = intent == .keepShownCard ? nextReviewCard(reviewQueue: effectiveQueue)?.cardId : nil

        let snapshot: WatchReviewSnapshot
        do {
            snapshot = try await self.reader.loadSnapshot(
                request: WatchReviewSnapshotRequest(
                    requestedReviewFilter: requestedReviewFilter,
                    keptCardIds: [shownCardId, nextCardId].compactMap { cardId in cardId },
                    now: now,
                    seedQueueSize: watchReviewSeedQueueSize
                )
            )
        } catch {
            guard self.isStopped == false else {
                return
            }
            logWatchReviewFailure(event: "watch_review_load_failed", error: error)
            // A card already on screen stays reviewable; only an empty screen shows the failure.
            if self.presentedCard == nil {
                self.loadState = .failed(message: Flashcards.errorMessage(error: error))
            }
            return
        }
        guard self.isStopped == false, Task.isCancelled == false else {
            return
        }
        guard revision == self.queueRevision, requestedReviewFilter == self.requestedReviewFilter else {
            // A rating or filter change happened during the read, so its kept cards are outdated.
            self.mergePendingReloadIntent(intent: intent)
            return
        }

        self.apply(snapshot: snapshot, intent: intent, shownCardId: shownCardId, nextCardId: nextCardId, now: now)
    }

    private func apply(
        snapshot: WatchReviewSnapshot,
        intent: WatchReviewReloadIntent,
        shownCardId: String?,
        nextCardId: String?,
        now: Date
    ) {
        let resolvedReviewFilter = snapshot.resolvedReviewQuery.reviewFilter
        // A workspace change or a selected deck that disappeared is a new scope, so the session starts over;
        // once the scope is all cards, later reloads keep the shown card.
        let startsNewSession = intent == .startNewSession
            || snapshot.workspaceId != self.workspaceId
            || (
                isMissingDeckReviewFilterFallback(
                    requestedReviewFilter: self.requestedReviewFilter,
                    resolvedReviewFilter: resolvedReviewFilter
                )
                && self.reviewState.selectedReviewFilter != resolvedReviewFilter
            )
        let pendingReviewCardIds = self.reviewState.pendingReviewCardIds
        let validatedShownCard = startsNewSession ? nil : presentedReviewCardForBackgroundRefresh(
            reviewQueue: [],
            presentedCardId: shownCardId,
            pendingReviewCardIds: pendingReviewCardIds,
            resolvedReviewFilter: resolvedReviewFilter,
            decks: snapshot.decks,
            cards: snapshot.keptCards,
            now: now
        )
        let validatedNextCard = startsNewSession ? nil : presentedReviewCardForBackgroundRefresh(
            reviewQueue: [],
            presentedCardId: nextCardId,
            pendingReviewCardIds: pendingReviewCardIds,
            resolvedReviewFilter: resolvedReviewFilter,
            decks: snapshot.decks,
            cards: snapshot.keptCards,
            now: now
        )
        // A shown card that left review advances to the prepared next card.
        let preservedShownCard = validatedShownCard ?? validatedNextCard
        let preservedNextCard = validatedShownCard == nil ? nil : validatedNextCard

        let plan = self.runtime.startReviewLoad(
            publishedState: self.reviewState,
            resolvedReviewQuery: snapshot.resolvedReviewQuery,
            workspaceId: snapshot.workspaceId,
            databaseURL: self.databaseURL,
            now: now,
            preservedPresentedReviewCard: preservedShownCard,
            preservedNextReviewCard: preservedNextCard
        )
        self.runtime.startReviewCountsLoad(request: plan.countsRequest)
        guard let headLoadedState = self.runtime.applyReviewHeadLoadSuccess(
            publishedState: plan.publishedState,
            reviewHeadState: snapshot.reviewHead,
            preparedNextReviewCard: preservedNextCard,
            requestId: plan.headRequest.requestId,
            sourceVersion: plan.headRequest.sourceVersion
        ), let loadedState = self.runtime.applyReviewCountsLoadSuccess(
            publishedState: headLoadedState,
            reviewCounts: snapshot.reviewCounts,
            requestId: plan.countsRequest.requestId,
            sourceVersion: plan.countsRequest.sourceVersion
        ) else {
            // Only a cancelled reload is refused.
            return
        }

        if startsNewSession {
            self.revealedCardId = nil
        }
        self.workspaceId = snapshot.workspaceId
        self.resolvedReviewQuery = snapshot.resolvedReviewQuery
        self.schedulerSettings = snapshot.schedulerSettings
        self.nextDueAt = snapshot.nextDueAt
        self.reviewState = loadedState
        self.loadState = .loaded
        self.scheduleNextDueRefresh(nextDueAt: snapshot.nextDueAt)
    }

    /// One timer at the next due time rereads the window, so a card rated "Again" returns.
    private func scheduleNextDueRefresh(nextDueAt: Date?) {
        self.nextDueRefreshTask?.cancel()
        guard let nextDueAt else {
            self.nextDueRefreshTask = nil
            return
        }
        self.nextDueRefreshTask = Task { @MainActor in
            do {
                try await Task.sleep(for: .seconds(max(nextDueAt.timeIntervalSinceNow, 0) + 1))
            } catch {
                return
            }
            self.refreshKeepingShownCard()
        }
    }
}

private func logWatchReviewFailure(event: String, error: Error) {
    watchReviewLogger.error(
        "event=\(event, privacy: .public) error=\(Flashcards.errorMessage(error: error), privacy: .public) errorType=\(String(reflecting: type(of: error)), privacy: .public)"
    )
}
