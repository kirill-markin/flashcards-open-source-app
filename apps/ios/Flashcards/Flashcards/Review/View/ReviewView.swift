import SwiftUI

private let reviewCardsStringsTableName: String = "ReviewCards"
private let reviewBottomBarHorizontalPadding: CGFloat = 20
private let reviewBottomBarTopPadding: CGFloat = 8
private let reviewBottomBarBottomPadding: CGFloat = 8
private let reviewBottomBarButtonSpacing: CGFloat = 10
private let reviewFilterMenuTitleMaxWidth: CGFloat = 180
private let reviewToolbarBadgeSpacing: CGFloat = 4
private let reviewAnswerButtonMinHeight: CGFloat = 40
private let showAnswerButtonMinHeight: CGFloat = 56
let emptyBackTextPlaceholder: String = String(localized: "No back text", table: reviewCardsStringsTableName)
private let reviewQueuePreviewPageSize: Int = 50

private enum ReviewCardScrollTarget: Hashable {
    case front
    case back
}

private struct ReviewFilterPresentationContext: Equatable {
    let workspaceId: String?
    let committedFilter: ReviewFilter
}

struct ReviewView: View {
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.isLowPowerModeEnabled) var isLowPowerModeEnabled: Bool
    @Environment(FlashcardsStore.self) var store: FlashcardsStore
    @Environment(AppNavigationModel.self) private var navigation: AppNavigationModel

    @StateObject private var reviewSpeechController = ReviewSpeechController()
    @State var isAnswerVisible: Bool = false
    @State var preparedRevealState: PreparedReviewRevealState? = nil
    // Keep the next review card warm so the next front can appear immediately after rating.
    @State var preparedNextRevealState: PreparedReviewRevealState? = nil
    @State var reviewReactionLottiePrewarmTask: Task<Void, Never>?
    @State var reviewReactionLottiePrewarmId: UUID?
    @State var reviewReactionLottieAssetStore: ReviewReactionLottieAssetStore = makePendingReviewReactionLottieAssetStore()
    @State var activeReviewReactionEvents: [ReviewReactionEvent] = []
    @State var isQueuePreviewPresented: Bool = false
    @State var isEditorPresented: Bool = false
    @State var editingCardId: String? = nil
    @State var cardFormState: CardFormState = CardFormState(
        editorSessionId: UUID(),
        frontText: "",
        backText: "",
        frontTextSelection: nil,
        backTextSelection: nil,
        observedFrontText: nil,
        observedBackText: nil,
        tags: [],
        mediaAssetIdsReadyForUpload: []
    )
    @State var screenErrorMessage: String = ""
    @State var reviewTagSummaries: [WorkspaceTagSummary] = []
    @State var reviewDeckSummaries: [DeckSummary] = []
    @State var totalCardsCount: Int = 0
    @State var isReviewFilterPopoverPresented: Bool = false
    @State var reviewFilterDraft: ReviewFilter = .allCards
    @State private var reviewFilterPresentationContext: ReviewFilterPresentationContext? = nil

    private var availableTagSuggestions: [TagSuggestion] {
        self.reviewTagSummaries.map { tagSummary in
            TagSuggestion(
                tag: tagSummary.tag,
                countState: .ready(cardsCount: tagSummary.cardsCount)
            )
        }
    }

    private var selectedReviewFilterTitle: String {
        switch store.selectedReviewFilter {
        case .allCards:
            return localizedAllCardsLabel()
        case .deck(let deckId):
            return self.reviewDeckSummaries.first(where: { deckSummary in
                deckSummary.deckId == deckId
            })?.name ?? localizedAllCardsLabel()
        case .tags(let tags):
            return localizedReviewTagsFilterTitle(tags: tags)
        }
    }

    var areReviewReactionAnimationsEnabled: Bool {
        store.accountPreferences.reviewReactionAnimationsEnabled && self.isLowPowerModeEnabled == false
    }

    private var currentCard: Card? {
        store.presentedReviewCard
    }

    private var cachedPreparedCurrentRevealState: PreparedReviewRevealState? {
        guard let currentCard else {
            return nil
        }

        return self.cachedPreparedRevealState(card: currentCard)
    }

    private var preparedRevealStatesTaskId: String {
        makePreparedReviewRevealStatesTaskId(
            reviewQueue: store.effectiveReviewQueue,
            schedulerSettings: store.schedulerSettings
        )
    }

    private var shouldShowReviewLoader: Bool {
        if store.isReviewHeadLoading {
            return true
        }
        if let currentCard {
            return self.cachedPreparedRevealState(card: currentCard) == nil
        }

        return store.isReviewQueueChunkLoading
    }

    var body: some View {
        ZStack {
            Group {
                if self.shouldShowReviewLoader {
                    reviewLoadingView
                } else if let currentCard, let preparedRevealState = self.cachedPreparedCurrentRevealState {
                    activeCardView(card: currentCard, preparedRevealState: preparedRevealState)
                } else {
                    emptyStateView
                }
            }

            ReviewReactionLayer(
                events: self.activeReviewReactionEvents,
                lottieAssetStore: self.reviewReactionLottieAssetStore,
                onEventFinished: self.removeFinishedReviewReactionEvent(eventId:)
            )
        }
        .accessibilityIdentifier(UITestIdentifier.reviewScreen)
        .navigationTitle(String(localized: "Review", table: reviewCardsStringsTableName))
        .onAppear {
            if self.areReviewReactionAnimationsEnabled {
                self.prewarmReviewReactionLottieAssets()
            }
        }
        .onChange(of: self.areReviewReactionAnimationsEnabled) { _, isEnabled in
            if isEnabled {
                self.prewarmReviewReactionLottieAssets()
            } else {
                self.cancelReviewReactionLottiePrewarm()
                self.dismissActiveReviewReactions()
            }
        }
        .onChange(of: currentCard?.cardId) { _, _ in
            isAnswerVisible = false
            self.reviewSpeechController.stopSpeech()
        }
        .onDisappear {
            self.reviewSpeechController.stopSpeech()
            self.cancelReviewReactionLottiePrewarm()
        }
        .task(id: preparedRevealStatesTaskId) {
            await self.refreshPreparedRevealStates(reviewQueue: store.effectiveReviewQueue)
        }
        .task(id: store.localReadVersion) {
            await self.reloadReviewMetadata()
            self.reconcileEditingCardFormState()
        }
        .safeAreaBar(edge: .bottom, spacing: 0) {
            reviewBottomAccessory
        }
        .simultaneousGesture(
            DragGesture(minimumDistance: 0)
                .onChanged { _ in
                    self.dismissActiveReviewReactions()
                }
        )
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                reviewFilterMenu
            }

            ToolbarItemGroup(placement: .topBarTrailing) {
                // TODO: Revisit the queue shortcut placement. Keeping a third glass toolbar action
                // makes iOS collapse the trailing Review actions into overflow too aggressively.
                reviewLeaderboardButton
                reviewProgressBadgeButton
            }
        }
        // TODO: This preview is unreachable from Review while the queue toolbar shortcut is withheld.
        .fullScreenCover(isPresented: self.$isQueuePreviewPresented) {
            NavigationStack {
                ReviewQueuePreviewScreen(
                    title: self.selectedReviewFilterTitle,
                    activeCount: store.displayedReviewDueCount,
                    currentCardId: currentCard?.cardId,
                    hiddenCardIds: store.pendingReviewCardIds,
                    loadPage: { offset in
                        try await store.loadReviewTimelinePage(
                            limit: reviewQueuePreviewPageSize,
                            offset: offset
                        )
                    }
                )
            }
        }
        .sheet(isPresented: self.$isEditorPresented) {
            NavigationStack {
                CardEditorScreen(
                    title: String(localized: "Edit card", table: reviewCardsStringsTableName),
                    isEditing: true,
                    errorMessage: screenErrorMessage,
                    availableTagSuggestions: self.availableTagSuggestions,
                    readOnlyMetadata: self.editingCard().map(cardEditorReadOnlyMetadata),
                    formState: self.$cardFormState,
                    onEditWithAI: {
                        let cardReference: AIChatCardReference?
                        if self.isEditedCardDirty() {
                            cardReference = self.saveEditedCardForAIHandoff()
                        } else if let editingCardId = self.editingCardId {
                            let normalizedInput = self.normalizedEditedCardInput()
                            cardReference = AIChatCardReference(
                                cardId: editingCardId,
                                frontText: normalizedInput.frontText,
                                backText: normalizedInput.backText,
                                tags: normalizedInput.tags
                            )
                        } else {
                            cardReference = nil
                        }

                        guard let cardReference else {
                            return
                        }
                        self.finishCardEditorSession()
                        self.navigation.openAICardHandoff(
                            card: cardReference
                        )
                        self.isEditorPresented = false
                    },
                    onCancel: {
                        self.finishCardEditorSession()
                        self.isEditorPresented = false
                    },
                    onSave: {
                        self.saveEditedCard()
                    },
                    onDelete: {
                        self.deleteEditingCard()
                    }
                )
            }
            .technicalErrorSheet(store: self.store)
            .interactiveDismissDisabled()
        }
        .alert(
            String(localized: "Review wasn't saved", table: reviewCardsStringsTableName),
            isPresented: Binding(
                get: {
                    store.reviewSubmissionFailure != nil
                },
                set: { isPresented in
                    if isPresented == false {
                        store.dismissReviewSubmissionFailure()
                    }
                }
            )
        ) {
            Button(String(localized: "OK", table: reviewCardsStringsTableName), role: .cancel) {
                store.dismissReviewSubmissionFailure()
            }
        } message: {
            Text(store.reviewSubmissionFailure?.message ?? "")
        }
        .alert(
            String(localized: "Stay on top of your cards", table: reviewCardsStringsTableName),
            isPresented: Binding(
                get: {
                    store.isReviewNotificationPrePromptPresented
                },
                set: { isPresented in
                    if isPresented == false {
                        store.dismissReviewNotificationPrePrompt(markDismissed: false)
                    }
                }
            )
        ) {
            Button(String(localized: "Not now", table: reviewCardsStringsTableName), role: .cancel) {
                store.dismissReviewNotificationPrePrompt(markDismissed: true)
            }
            Button(String(localized: "Continue", table: reviewCardsStringsTableName)) {
                store.continueReviewNotificationPrePrompt()
            }
        } message: {
            Text(String(localized: "Flashcards Open Source App can send study reminders with a card from your review queue. These notifications contain study cards only and never marketing messages.", table: reviewCardsStringsTableName))
        }
        .alert(
            String(localized: "Hard is for difficult recall", table: reviewCardsStringsTableName),
            isPresented: Binding(
                get: {
                    store.isReviewHardReminderPresented
                },
                set: { isPresented in
                    if isPresented == false {
                        store.dismissReviewHardReminder()
                    }
                }
            )
        ) {
            Button(String(localized: "OK", table: reviewCardsStringsTableName), role: .cancel) {
                store.dismissReviewHardReminder()
            }
        } message: {
            Text(String(localized: "If you did not know the answer, choose \"Again\". \"Hard\" is only for answers you knew but it was difficult to recall.", table: reviewCardsStringsTableName))
        }
    }

    private var reviewFilterMenu: some View {
        Button {
            let committedFilter = store.selectedReviewFilter
            self.reviewFilterDraft = committedFilter
            self.reviewFilterPresentationContext = ReviewFilterPresentationContext(
                workspaceId: store.workspace?.workspaceId,
                committedFilter: committedFilter
            )
            self.isReviewFilterPopoverPresented = true
        } label: {
            HStack(spacing: 4) {
                Text(self.selectedReviewFilterTitle)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: reviewFilterMenuTitleMaxWidth, alignment: .leading)
                Image(systemName: "chevron.down")
                    .font(.caption.weight(.semibold))
            }
        }
        .accessibilityIdentifier(UITestIdentifier.reviewFilterMenu)
        .popover(isPresented: self.$isReviewFilterPopoverPresented) {
            ReviewFilterPopover(
                reviewFilter: self.$reviewFilterDraft,
                deckSummaries: self.reviewDeckSummaries,
                tagSummaries: self.reviewTagSummaries,
                onEditDecks: self.dismissReviewFilterPopoverAndOpenDecks
            )
            .presentationCompactAdaptation(.popover)
        }
        .onChange(of: self.isReviewFilterPopoverPresented) { _, isPresented in
            if isPresented == false {
                self.finalizeReviewFilterDraft()
            }
        }
        .onChange(of: store.workspace?.workspaceId) { _, _ in
            self.dismissReviewFilterPopoverIfContextDiverged()
        }
        .onChange(of: store.selectedReviewFilter) { _, _ in
            self.dismissReviewFilterPopoverIfContextDiverged()
        }
    }

    private func finalizeReviewFilterDraft() {
        guard let presentationContext = self.reviewFilterPresentationContext else {
            return
        }
        self.reviewFilterPresentationContext = nil

        guard presentationContext.workspaceId == store.workspace?.workspaceId,
              presentationContext.committedFilter == store.selectedReviewFilter,
              presentationContext.committedFilter != self.reviewFilterDraft else {
            return
        }

        store.selectReviewFilter(reviewFilter: self.reviewFilterDraft)
    }

    private func dismissReviewFilterPopoverIfContextDiverged() {
        guard self.isReviewFilterPopoverPresented,
              let presentationContext = self.reviewFilterPresentationContext,
              presentationContext.workspaceId != store.workspace?.workspaceId
                || presentationContext.committedFilter != store.selectedReviewFilter else {
            return
        }

        // The committed filter moved underneath the open popover, so the draft is built on a stale
        // snapshot and is discarded instead of applied; reopening the menu re-seeds it. Clearing the
        // context first also keeps the finalize on popover dismissal a no-op.
        self.reviewFilterPresentationContext = nil
        self.isReviewFilterPopoverPresented = false
    }

    private func dismissReviewFilterPopoverAndOpenDecks() {
        self.finalizeReviewFilterDraft()
        self.isReviewFilterPopoverPresented = false
        navigation.openSettings(destination: .workspaceDecks)
    }

    private var reviewLoadingView: some View {
        VStack {
            Spacer()
            ProgressView()
                .controlSize(.large)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func activeCardView(card: Card, preparedRevealState: PreparedReviewRevealState) -> some View {
        ScrollViewReader { proxy in
            ScrollView {
                ReadableContentLayout(
                    maxWidth: flashcardsReadableContentMaxWidth,
                    horizontalPadding: 20
                ) {
                    activeCardContentView(card: card, preparedRevealState: preparedRevealState)
                        .padding(.vertical, 20)
                }
            }
            .onChange(of: isAnswerVisible) { wasVisible, isVisible in
                guard wasVisible == false, isVisible else {
                    return
                }

                proxy.scrollTo(ReviewCardScrollTarget.back, anchor: .top)
            }
            .onChange(of: card.cardId) { _, _ in
                proxy.scrollTo(ReviewCardScrollTarget.front, anchor: .top)
            }
        }
    }

    private func activeCardContentView(card: Card, preparedRevealState: PreparedReviewRevealState) -> some View {
        return VStack(alignment: .leading, spacing: 20) {
            if screenErrorMessage.isEmpty == false {
                Text(screenErrorMessage)
                    .foregroundStyle(.red)
            }

            HStack(alignment: .top, spacing: 12) {
                HStack(spacing: 12) {
                    Label(card.tags.isEmpty ? localizedNoTagsLabel() : formatTags(tags: card.tags), systemImage: "tag")
                    reviewRepetitionBadge(reps: card.reps)
                }

                Spacer(minLength: 12)

                Button {
                    self.beginEditing(card: card)
                } label: {
                    Image(systemName: "pencil.circle.fill")
                        .font(.title3)
                }
                .accessibilityLabel(String(localized: "Edit card", table: reviewCardsStringsTableName))
            }
            .font(.subheadline)
            .foregroundStyle(.secondary)

            ReviewCardSideView(
                label: String(localized: "Front", table: reviewCardsStringsTableName),
                content: preparedRevealState.frontContent,
                isSpeechPlaying: self.reviewSpeechController.activeSide == .front,
                onToggleSpeech: {
                    self.toggleSpeech(side: .front, sourceText: card.frontText)
                },
                showsSpeechButton: preparedRevealState.frontSpeakableText.isEmpty == false,
                showsAiButton: false,
                onOpenAi: {},
                surfaceStyle: .front
            )
            .id(ReviewCardScrollTarget.front)

            if isAnswerVisible {
                ReviewCardSideView(
                    label: String(localized: "Back", table: reviewCardsStringsTableName),
                    content: preparedRevealState.backContent,
                    isSpeechPlaying: self.reviewSpeechController.activeSide == .back,
                    onToggleSpeech: {
                        self.toggleSpeech(side: .back, sourceText: card.backText)
                    },
                    showsSpeechButton: preparedRevealState.backSpeakableText.isEmpty == false,
                    showsAiButton: true,
                    onOpenAi: {
                        self.navigation.openAICardHandoff(card: makeAIChatCardReference(card: card))
                    },
                    surfaceStyle: .back
                )
                .id(ReviewCardScrollTarget.back)
            }

            if let reviewActionErrorMessage = reviewActionErrorMessage(card: card) {
                Text(reviewActionErrorMessage)
                    .foregroundStyle(.red)
            }
        }
    }

    @ViewBuilder
    private func reviewBottomBar(card: Card, preparedRevealState: PreparedReviewRevealState) -> some View {
        if isAnswerVisible {
            if let options = preparedRevealState.reviewAnswerGridOptions {
                reviewAnswerButtonsGrid(cardId: card.cardId, options: options)
            }
        } else {
            showAnswerButton
        }
    }

    private var reviewBottomAccessory: some View {
        Group {
            if self.shouldShowReviewLoader {
                EmptyView()
            } else if let currentCard, let preparedRevealState = self.cachedPreparedCurrentRevealState {
                reviewBottomBarContainer {
                    reviewBottomBar(card: currentCard, preparedRevealState: preparedRevealState)
                }
            }
        }
    }

    @ViewBuilder
    private var reviewQueueButton: some View {
        if store.isReviewCountsLoading {
            ProgressView()
                .controlSize(.small)
                .accessibilityIdentifier(UITestIdentifier.reviewQueueButton)
                .accessibilityLabel(String(localized: "Loading review queue", table: reviewCardsStringsTableName))
        } else {
            Button {
                self.isQueuePreviewPresented = true
            } label: {
                Label {
                    Text(self.reviewQueueButtonTitle)
                } icon: {
                    Image(systemName: "list.bullet")
                }
                    .labelStyle(.iconOnly)
            }
            .disabled(store.reviewTotalCount == 0)
            .accessibilityIdentifier(UITestIdentifier.reviewQueueButton)
            .accessibilityLabel(
                String(
                    format: String(localized: "Review queue status: %@ active of %@ total", table: reviewCardsStringsTableName),
                    locale: Locale.current,
                    store.displayedReviewDueCount.formatted(),
                    store.reviewTotalCount.formatted()
                )
            )
        }
    }

    private var reviewQueueButtonTitle: String {
        String(
            localized: "Review queue",
            table: reviewCardsStringsTableName,
            comment: "Toolbar shortcut title for opening the Review queue preview"
        )
    }

    @MainActor
    private func openProgressWithPresentationBreadcrumb(target: ProgressPresentationTarget) {
        prepareVisibleTabForPresentationWithBreadcrumb(
            store: self.store,
            selectedTab: .progress,
            previousTab: self.navigation.selectedTab,
            scenePhase: self.scenePhase,
            isStartupReady: nil,
            isRecoveryGateActive: self.store.cloudCredentialRecoveryState != nil,
            now: Date()
        )
        self.navigation.openProgress(target: target)
    }

    private var reviewProgressBadgeButton: some View {
        let badgeState = self.store.reviewProgressBadgeState
        let badgePresentation = makeReviewProgressBadgePresentation(badgeState: badgeState)

        return Button {
            self.openProgressWithPresentationBreadcrumb(target: .streak)
        } label: {
            HStack(spacing: reviewToolbarBadgeSpacing) {
                Image(systemName: badgePresentation.iconSystemName)
                    .foregroundStyle(self.reviewProgressBadgeToolbarIconColor(badgeState: badgeState))
                Text(formatReviewProgressBadgeValue(badgeState: badgeState))
                    .monospacedDigit()
                    .lineLimit(1)
            }
            .fixedSize(horizontal: true, vertical: false)
        }
        .disabled(badgeState.isInteractive == false)
        .accessibilityIdentifier(UITestIdentifier.reviewProgressBadge)
        .accessibilityLabel(self.reviewProgressBadgeAccessibilityLabel(badgeState: badgeState))
        .accessibilityValue(self.reviewProgressBadgeAccessibilityValue(badgeState: badgeState))
    }

    private func reviewProgressBadgeToolbarIconColor(badgeState: ReviewProgressBadgeState) -> Color {
        if badgeState.hasReviewedToday {
            return .accentColor
        }

        return .primary
    }

    private var reviewLeaderboardButton: some View {
        let badgeState = self.store.reviewLeaderboardBadgeState

        return Button {
            self.openProgressWithPresentationBreadcrumb(target: .leaderboard)
        } label: {
            if let rank = badgeState.rank {
                HStack(spacing: reviewToolbarBadgeSpacing) {
                    Image(systemName: "trophy.fill")
                        .foregroundStyle(Color.yellow)
                    Text(rank.formatted())
                        .monospacedDigit()
                        .lineLimit(1)
                }
                .fixedSize(horizontal: true, vertical: false)
            } else {
                Image(systemName: "trophy.fill")
                    .foregroundStyle(Color.yellow)
            }
        }
        .disabled(badgeState.isInteractive == false)
        .accessibilityIdentifier(UITestIdentifier.reviewLeaderboardShortcut)
        .accessibilityLabel(self.reviewLeaderboardButtonAccessibilityLabel(badgeState: badgeState))
        .accessibilityValue(self.reviewLeaderboardButtonAccessibilityValue(badgeState: badgeState))
    }

    private var reviewLeaderboardButtonTitle: String {
        String(
            localized: "review.leaderboard_shortcut.accessibility_label",
            defaultValue: "Open leaderboard",
            table: reviewCardsStringsTableName,
            comment: "Accessibility label for the Review toolbar shortcut that opens the Progress leaderboard"
        )
    }

    private func reviewLeaderboardButtonAccessibilityLabel(badgeState: ReviewLeaderboardBadgeState) -> String {
        guard let rank = badgeState.rank else {
            return self.reviewLeaderboardButtonTitle
        }

        let localizedFormat = String(
            localized: "review.leaderboard_shortcut.accessibility_label_ranked",
            defaultValue: "Open leaderboard. Best rank %@.",
            table: reviewCardsStringsTableName,
            comment: "Accessibility label for the Review toolbar leaderboard shortcut when the user's best rank is known"
        )
        return String(format: localizedFormat, locale: Locale.current, rank.formatted())
    }

    private func reviewLeaderboardButtonAccessibilityValue(badgeState: ReviewLeaderboardBadgeState) -> String {
        let rankValue = badgeState.rank.map { rank in
            "\(rank)"
        } ?? "nil"
        let windowKeyValue = badgeState.windowKey?.rawValue ?? "nil"
        return [
            "rank=\(rankValue)",
            "windowKey=\(windowKeyValue)"
        ].joined(separator: ";")
    }

    private func reviewProgressBadgeAccessibilityLabel(badgeState: ReviewProgressBadgeState) -> String {
        let localizedFormat: String
        if badgeState.hasReviewedToday {
            localizedFormat = String(
                localized: "review.progress_badge.accessibility.reviewed_today",
                defaultValue: "Review streak %@ days. Reviewed today.",
                table: reviewCardsStringsTableName,
                comment: "Accessibility label for the review progress badge when the user has reviewed today"
            )
        } else {
            localizedFormat = String(
                localized: "review.progress_badge.accessibility.not_reviewed_today",
                defaultValue: "Review streak %@ days. Not reviewed today.",
                table: reviewCardsStringsTableName,
                comment: "Accessibility label for the review progress badge when the user has not reviewed today"
            )
        }

        let streakLabel = String(
            format: localizedFormat,
            locale: Locale.current,
            badgeState.streakDays.formatted()
        )
        return streakLabel
    }

    private func reviewProgressBadgeAccessibilityValue(badgeState: ReviewProgressBadgeState) -> String {
        let components: [String] = [
            "streakDays=\(badgeState.streakDays)",
            "hasReviewedToday=\(badgeState.hasReviewedToday ? "true" : "false")"
        ]
        return components.joined(separator: ";")
    }

    private func reviewBottomBarContainer<Content: View>(
        @ViewBuilder content: () -> Content
    ) -> some View {
        ReadableContentLayout(
            maxWidth: flashcardsReadableContentMaxWidth,
            horizontalPadding: reviewBottomBarHorizontalPadding
        ) {
            content()
                .padding(.top, reviewBottomBarTopPadding)
                .padding(.bottom, reviewBottomBarBottomPadding)
        }
    }

    private var showAnswerButton: some View {
        Button {
            isAnswerVisible = true
        } label: {
            Label(String(localized: "Show answer", table: reviewCardsStringsTableName), systemImage: "eye")
                .frame(maxWidth: .infinity)
                .frame(minHeight: showAnswerButtonMinHeight)
        }
        .buttonStyle(.glassProminent)
        .accessibilityIdentifier(UITestIdentifier.reviewShowAnswerButton)
    }

    private func reviewAnswerButtonsGrid(cardId: String, options: ReviewAnswerGridOptions) -> some View {
        HStack(alignment: .top, spacing: reviewBottomBarButtonSpacing) {
            VStack(spacing: reviewBottomBarButtonSpacing) {
                reviewAnswerButton(cardId: cardId, option: options.again)
                reviewAnswerButton(cardId: cardId, option: options.good)
            }

            VStack(spacing: reviewBottomBarButtonSpacing) {
                reviewAnswerButton(cardId: cardId, option: options.hard)
                reviewAnswerButton(cardId: cardId, option: options.easy)
            }
        }
    }

    private func reviewAnswerButton(cardId: String, option: ReviewAnswerOption) -> some View {
        Button {
            if self.areReviewReactionAnimationsEnabled {
                self.emitReviewReaction(rating: option.rating)
            }
            self.submitReview(cardId: cardId, rating: option.rating)
        } label: {
            VStack(alignment: .center, spacing: 4) {
                HStack(spacing: 8) {
                    Image(systemName: option.rating.symbolName)
                        .font(.headline)

                    Text(localizedReviewRatingTitle(rating: option.rating))
                        .fontWeight(.semibold)
                        .lineLimit(1)
                }

                Text(option.intervalDescription)
                    .font(.caption2)
                    .opacity(0.8)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity, alignment: .center)
            }
            .frame(maxWidth: .infinity, minHeight: reviewAnswerButtonMinHeight, alignment: .center)
        }
        .buttonStyle(.glassProminent)
        .disabled(store.isReviewPending(cardId: cardId))
        .accessibilityIdentifier(reviewAnswerButtonIdentifier(rating: option.rating))
    }

    private func reviewActionErrorMessage(card: Card) -> String? {
        guard isAnswerVisible else {
            return nil
        }

        return self.cachedPreparedRevealState(card: card)?.reviewAnswerOptionsErrorMessage
    }

    private var emptyStateView: some View {
        let shouldShowSwitchToAllCardsAction = store.selectedReviewFilter != .allCards

        return ContentUnavailableView {
            if self.totalCardsCount == 0 {
                Label(String(localized: "No Cards Yet", table: reviewCardsStringsTableName), systemImage: "tray")
            } else {
                Label(String(localized: "Nothing Due", table: reviewCardsStringsTableName), systemImage: "checkmark.circle")
            }
        } description: {
            if self.totalCardsCount == 0 {
                Text(String(localized: "You haven't created any cards yet. Add your first card to start studying.", table: reviewCardsStringsTableName))
            } else {
                Text(String(localized: "You're all caught up for now. Come back later or add more cards.", table: reviewCardsStringsTableName))
            }
        } actions: {
            VStack(spacing: 8) {
                Button {
                    navigation.openCardCreation()
                } label: {
                    Label(String(localized: "Create card", table: reviewCardsStringsTableName), systemImage: "plus")
                        .font(.body)
                        .imageScale(.medium)
                }
                .buttonStyle(.glass)

                Text(String(localized: "or", table: reviewCardsStringsTableName))
                    .font(.footnote)
                    .foregroundStyle(.secondary)

                Button {
                    navigation.openAICardCreation()
                } label: {
                    Label(String(localized: "Create with AI", table: reviewCardsStringsTableName), systemImage: "sparkles")
                        .font(.body)
                        .imageScale(.medium)
                }
                .buttonStyle(.glassProminent)

                if shouldShowSwitchToAllCardsAction {
                    Text(String(localized: "or", table: reviewCardsStringsTableName))
                        .font(.footnote)
                        .foregroundStyle(.secondary)

                    Button {
                        store.selectReviewFilter(reviewFilter: .allCards)
                    } label: {
                        Text(String(localized: "Switch to all cards deck", table: reviewCardsStringsTableName))
                    }
                    .buttonStyle(.glass)
                }
            }
        }
    }

    private func toggleSpeech(side: ReviewSpeechSide, sourceText: String) {
        let fallbackLanguageTag = Locale.autoupdatingCurrent.identifier.replacingOccurrences(of: "_", with: "-")
        let errorMessage = self.reviewSpeechController.toggleSpeech(
            side: side,
            sourceText: sourceText,
            fallbackLanguageTag: fallbackLanguageTag
        )

        if let errorMessage {
            self.store.enqueueTransientBanner(
                banner: makeReviewSpeechUnavailableBanner(message: errorMessage)
            )
        }
    }

}

private func reviewAnswerButtonIdentifier(rating: ReviewRating) -> String {
    if rating == .good {
        return UITestIdentifier.reviewRateGoodButton
    }

    return "review.rating.\(rating.rawValue)"
}

@ViewBuilder
private func reviewRepetitionBadge(reps: Int) -> some View {
    let accessibilityLabel = String(localized: "Reps", table: reviewCardsStringsTableName)

    if reps == 0 {
        let accessibilityValue = String(localized: "New", table: reviewCardsStringsTableName)

        Label(accessibilityValue, systemImage: "arrow.clockwise")
            .fontWeight(.semibold)
            .foregroundStyle(.white)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Color.accentColor, in: Capsule(style: .continuous))
            .accessibilityLabel(accessibilityLabel)
            .accessibilityValue(accessibilityValue)
    } else {
        let accessibilityValue = localizedCardCountValue(count: reps)

        Label(accessibilityValue, systemImage: "arrow.clockwise")
            .foregroundStyle(.secondary)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(.thinMaterial, in: Capsule(style: .continuous))
            .accessibilityLabel(accessibilityLabel)
            .accessibilityValue(accessibilityValue)
    }
}

#Preview {
    NavigationStack {
        ReviewView()
            .environment(FlashcardsStore())
            .environment(AppNavigationModel())
    }
}
