import SwiftUI

private let reviewCardsStringsTableName: String = "ReviewCards"
private let reviewBottomBarHorizontalPadding: CGFloat = 20
private let reviewBottomBarTopPadding: CGFloat = 8
private let reviewBottomBarBottomPadding: CGFloat = 8
private let reviewBottomBarButtonSpacing: CGFloat = 10
private let reviewFilterMenuTitleMaxWidth: CGFloat = 180
private let reviewToolbarActionIconFont: Font = .body
private let reviewToolbarBadgeValueFont: Font = .body
private let reviewAnswerButtonMinHeight: CGFloat = 40
private let showAnswerButtonMinHeight: CGFloat = 56
let emptyBackTextPlaceholder: String = String(localized: "No back text", table: reviewCardsStringsTableName)
private let reviewQueuePreviewPageSize: Int = 50

struct ReviewView: View {
    @Environment(FlashcardsStore.self) var store: FlashcardsStore
    @Environment(AppNavigationModel.self) private var navigation: AppNavigationModel

    @StateObject private var reviewSpeechController = ReviewSpeechController()
    @State var isAnswerVisible: Bool = false
    @State var preparedRevealState: PreparedReviewRevealState? = nil
    // Keep the next review card warm so the next front can appear immediately after rating.
    @State var preparedNextRevealState: PreparedReviewRevealState? = nil
    @State var hasStartedReviewReactionLottiePrewarm: Bool = false
    @State var reviewReactionLottieAssetStore: ReviewReactionLottieAssetStore = makePendingReviewReactionLottieAssetStore()
    @State var activeReviewReactionEvents: [ReviewReactionEvent] = []
    @State var isQueuePreviewPresented: Bool = false
    @State var isEditorPresented: Bool = false
    @State var editingCardId: String? = nil
    @State var cardFormState: CardFormState = CardFormState(
        frontText: "",
        backText: "",
        tags: [],
        effortLevel: .fast
    )
    @State var screenErrorMessage: String = ""
    @State var reviewTagSummaries: [WorkspaceTagSummary] = []
    @State var reviewDeckSummaries: [DeckSummary] = []
    @State var totalCardsCount: Int = 0

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
        case .effort(let level):
            return localizedEffortTitle(effortLevel: level)
        case .tag(let tag):
            return tag
        }
    }

    /// Effort filters are stable virtual review scopes, so all three stay visible even when a count is zero.
    private var reviewEffortFilterCounts: [EffortLevel: Int] {
        let activeCards = deriveActiveCards(cards: store.cards)
        return EffortLevel.allCases.reduce(into: [EffortLevel: Int]()) { result, level in
            result[level] = activeCards.count { card in
                card.effortLevel == level
            }
        }
    }

    private func reviewFilterMenuItemLabel(reviewFilter: ReviewFilter) -> String {
        switch reviewFilter {
        case .allCards:
            return localizedAllCardsLabel()
        case .deck(let deckId):
            return self.reviewDeckSummaries.first(where: { deckSummary in
                deckSummary.deckId == deckId
            })?.name ?? localizedAllCardsLabel()
        case .effort(let level):
            return "\(localizedEffortTitle(effortLevel: level)) (\((self.reviewEffortFilterCounts[level] ?? 0).formatted()))"
        case .tag(let tag):
            guard let tagSummary = reviewTagSummaries.first(where: { summary in
                summary.tag == tag
            }) else {
                return tag
            }

            return "\(tagSummary.tag) (\(tagSummary.cardsCount.formatted()))"
        }
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
            if store.accountPreferences.reviewReactionAnimationsEnabled {
                self.prewarmReviewReactionLottieAssets()
            }
        }
        .onChange(of: store.accountPreferences.reviewReactionAnimationsEnabled) { _, isEnabled in
            if isEnabled {
                self.prewarmReviewReactionLottieAssets()
            } else {
                self.dismissActiveReviewReactions()
            }
        }
        .onChange(of: currentCard?.cardId) { _, _ in
            isAnswerVisible = false
            self.reviewSpeechController.stopSpeech()
        }
        .onDisappear {
            self.reviewSpeechController.stopSpeech()
        }
        .task(id: preparedRevealStatesTaskId) {
            await self.refreshPreparedRevealStates(reviewQueue: store.effectiveReviewQueue)
        }
        .task(id: store.localReadVersion) {
            await self.reloadReviewMetadata()
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
            .sharedBackgroundVisibility(.hidden)
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
                                tags: normalizedInput.tags,
                                effortLevel: normalizedInput.effortLevel
                            )
                        } else {
                            cardReference = nil
                        }

                        guard let cardReference else {
                            return
                        }
                        self.navigation.openAICardHandoff(
                            card: cardReference
                        )
                        self.isEditorPresented = false
                    },
                    onCancel: {
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

    /// This menu intentionally stays as one SwiftUI `Menu` backed by multiple grouped `Picker`s.
    /// The grouped picker structure preserves the platform's inset/alignment while still behaving like
    /// one conceptual single-choice review scope list with inline actions such as `Edit decks`.
    /// Do not flatten or replace this structure casually unless the review filter UX is being deliberately rewritten.
    private var reviewFilterMenu: some View {
        Menu {
            Picker(
                "",
                selection: Binding(
                    get: {
                        store.selectedReviewFilter
                    },
                    set: { nextReviewFilter in
                        store.selectReviewFilter(reviewFilter: nextReviewFilter)
                    }
                )
            ) {
                ForEach([ReviewFilter.allCards] + self.reviewDeckSummaries.map { deckSummary in
                    .deck(deckId: deckSummary.deckId)
                }) { reviewFilter in
                    Text(reviewFilterMenuItemLabel(reviewFilter: reviewFilter))
                        .tag(reviewFilter)
                }
            }

            Button {
                navigation.openSettings(destination: .workspaceDecks)
            } label: {
                Label(String(localized: "Edit decks", table: reviewCardsStringsTableName), systemImage: "square.stack.3d.up")
            }

            Divider()

            Picker(
                "",
                selection: Binding(
                    get: {
                        store.selectedReviewFilter
                    },
                    set: { nextReviewFilter in
                        store.selectReviewFilter(reviewFilter: nextReviewFilter)
                    }
                )
            ) {
                ForEach(EffortLevel.allCases) { level in
                    let reviewFilter = ReviewFilter.effort(level: level)

                    Text(reviewFilterMenuItemLabel(reviewFilter: reviewFilter))
                        .tag(reviewFilter)
                }
            }

            if reviewTagSummaries.isEmpty == false {
                Divider()

                Picker(
                    "",
                    selection: Binding(
                        get: {
                            store.selectedReviewFilter
                        },
                        set: { nextReviewFilter in
                            store.selectReviewFilter(reviewFilter: nextReviewFilter)
                        }
                    )
                ) {
                    ForEach(reviewTagSummaries, id: \.tag) { tagSummary in
                        let reviewFilter = ReviewFilter.tag(tag: tagSummary.tag)

                        Text(reviewFilterMenuItemLabel(reviewFilter: reviewFilter))
                            .tag(reviewFilter)
                    }
                }
            }
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
        .controlSize(.large)
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
        ScrollView {
            ReadableContentLayout(
                maxWidth: flashcardsReadableContentMaxWidth,
                horizontalPadding: 20
            ) {
                activeCardContentView(card: card, preparedRevealState: preparedRevealState)
                    .padding(.vertical, 20)
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
                    Label(localizedEffortTitle(effortLevel: card.effortLevel), systemImage: "timer")
                    Label(card.tags.isEmpty ? localizedNoTagsLabel() : formatTags(tags: card.tags), systemImage: "tag")
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
            }

            HStack(spacing: 12) {
                Label(localizedReviewDueLabel(value: card.dueAt), systemImage: "clock")
                Label(localizedReviewRepsLabel(value: card.reps), systemImage: "arrow.clockwise")
                Label(localizedReviewLapsesLabel(value: card.lapses), systemImage: "exclamationmark.circle")
            }
            .font(.caption)
            .foregroundStyle(.secondary)

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
                        .font(reviewToolbarActionIconFont)
                        .imageScale(.medium)
                }
                    .labelStyle(.iconOnly)
            }
            .buttonStyle(.glass)
            .controlSize(.large)
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

    private var reviewProgressBadgeButton: some View {
        let badgeState = self.store.reviewProgressBadgeState

        return Button {
            self.store.prepareVisibleTabForPresentation(tab: .progress, now: Date())
            self.navigation.openProgress(target: .streak)
        } label: {
            Label {
                Text(formatReviewProgressBadgeValue(badgeState: badgeState))
                    .font(reviewToolbarBadgeValueFont)
                    .monospacedDigit()
                    .lineLimit(1)
            } icon: {
                Image(systemName: makeReviewProgressBadgePresentation(badgeState: badgeState).iconSystemName)
                    .font(reviewToolbarActionIconFont)
                    .imageScale(.medium)
                    .foregroundStyle(self.reviewProgressBadgeToolbarIconColor(badgeState: badgeState))
            }
            .labelStyle(.titleAndIcon)
            .fixedSize(horizontal: true, vertical: false)
        }
        .buttonStyle(.glass)
        .controlSize(.large)
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
            self.store.prepareVisibleTabForPresentation(tab: .progress, now: Date())
            self.navigation.openProgress(target: .leaderboard)
        } label: {
            if let rank = badgeState.rank {
                Label {
                    Text(rank.formatted())
                        .font(reviewToolbarBadgeValueFont)
                        .monospacedDigit()
                        .lineLimit(1)
                } icon: {
                    Image(systemName: "trophy")
                        .font(reviewToolbarActionIconFont)
                        .imageScale(.medium)
                }
                .labelStyle(.titleAndIcon)
                .fixedSize(horizontal: true, vertical: false)
            } else {
                Label {
                    Text(self.reviewLeaderboardButtonTitle)
                } icon: {
                    Image(systemName: "trophy")
                        .font(reviewToolbarActionIconFont)
                        .imageScale(.medium)
                }
                .labelStyle(.iconOnly)
            }
        }
        .buttonStyle(.glass)
        .controlSize(.large)
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

        return String(
            format: localizedFormat,
            locale: Locale.current,
            badgeState.streakDays.formatted()
        )
    }

    private func reviewProgressBadgeAccessibilityValue(badgeState: ReviewProgressBadgeState) -> String {
        [
            "streakDays=\(badgeState.streakDays)",
            "hasReviewedToday=\(badgeState.hasReviewedToday ? "true" : "false")"
        ].joined(separator: ";")
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
            if store.accountPreferences.reviewReactionAnimationsEnabled {
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

private func localizedReviewDueLabel(value: String?) -> String {
    guard let value else {
        return String(localized: "New", table: reviewCardsStringsTableName)
    }

    let dueDateLabel: String
    if let date = parseIsoTimestamp(value: value) {
        dueDateLabel = date.formatted(date: .abbreviated, time: .shortened)
    } else {
        dueDateLabel = value
    }

    return String(
        format: String(localized: "Due %@", table: reviewCardsStringsTableName),
        locale: Locale.current,
        dueDateLabel
    )
}

private func localizedReviewRepsLabel(value: Int) -> String {
    String(
        format: String(localized: "Reps %@", table: reviewCardsStringsTableName),
        locale: Locale.current,
        value.formatted()
    )
}

private func localizedReviewLapsesLabel(value: Int) -> String {
    String(
        format: String(localized: "Lapses %@", table: reviewCardsStringsTableName),
        locale: Locale.current,
        value.formatted()
    )
}

#Preview {
    NavigationStack {
        ReviewView()
            .environment(FlashcardsStore())
            .environment(AppNavigationModel())
    }
}
