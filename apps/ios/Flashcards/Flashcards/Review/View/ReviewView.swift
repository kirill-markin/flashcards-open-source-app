import SwiftUI
import UIKit

private let reviewCardsStringsTableName: String = "ReviewCards"
private let reviewBottomBarHorizontalPadding: CGFloat = 20
private let reviewBottomBarTopPadding: CGFloat = 8
private let reviewBottomBarBottomPadding: CGFloat = 8
private let reviewBottomBarButtonSpacing: CGFloat = 10
private let reviewToolbarBadgeSpacing: CGFloat = 4
private let reviewAnswerButtonMinHeight: CGFloat = 44
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
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.tabBarPlacement) private var tabBarPlacement
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isKeyboardDocked) private var isKeyboardDocked
    @Environment(\.scenePhase) var scenePhase
    @Environment(\.isLowPowerModeEnabled) var isLowPowerModeEnabled: Bool
    @Environment(FlashcardsStore.self) var store: FlashcardsStore
    @Environment(AppNavigationModel.self) private var navigation: AppNavigationModel
    @Environment(PremiumPresenter.self) private var premiumPresenter: PremiumPresenter
    @FocusState private var isReviewKeyboardFocused: Bool

    @StateObject private var reviewSpeechController = ReviewSpeechController()
    @State var isAnswerVisible: Bool = false
    @State private var lastPresentedReviewCardId: String? = nil
    @State private var lastPresentedReviewWorkspaceId: String? = nil
    @State var preparedRevealState: PreparedReviewRevealState? = nil
    @State var preparedNextRevealState: PreparedReviewRevealState? = nil
    @State var isReviewReactionScreenVisible: Bool = false
    @State var reviewReactionLottiePrewarmTask: Task<Void, Never>?
    @State var reviewReactionLottiePrewarmId: UUID?
    @State var reviewReactionLottieAssetStore: ReviewReactionLottieAssetStore = makePendingReviewReactionLottieAssetStore()
    @State var activeReviewReactionEvents: [ReviewReactionEvent] = []
    @State var isQueuePreviewPresented: Bool = false
    @State var isEditorPresented: Bool = false
    @State var editingCardId: String? = nil
    @State var cardFormState: CardFormState = CardFormState(
        editorSessionId: UUID(),
        readOnlyMetadata: nil,
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
            return store.decks.first(where: { deck in
                deck.deckId == deckId
            })?.name ?? localizedAllCardsLabel()
        case .tags(let tags):
            return localizedReviewTagsFilterTitle(tags: tags)
        }
    }

    var areReviewReactionAnimationsEnabled: Bool {
        store.effectiveReviewReactionAnimationsEnabled && self.isLowPowerModeEnabled == false
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

    private var usesPairedReviewSpacing: Bool {
        UIDevice.current.userInterfaceIdiom == .pad
            && self.horizontalSizeClass == .regular
            && self.navigation.isAICompanionVisible
    }

    private var usesCompactCompanionToolbar: Bool {
        self.usesPairedReviewSpacing
            && self.navigation.selectedTab == .review
            && self.tabBarPlacement == .topBar
    }

    private var showsFilterInReviewColumn: Bool {
        self.usesPairedReviewSpacing && self.usesCompactCompanionToolbar == false
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
                source: .review,
                onEventFinished: self.removeFinishedReviewReactionEvent(eventId:action:reason:)
            )
        }
        .accessibilityIdentifier(UITestIdentifier.reviewScreen)
        .nativeTopBar(alignment: .leading) {
            if self.showsFilterInReviewColumn {
                reviewCompanionHeader
                    .padding(.horizontal, 20)
                    .padding(.bottom, 10)
                    .background(.bar)
            }
        }
        .onChange(of: [self.showsFilterInReviewColumn, self.usesCompactCompanionToolbar]) { _, _ in
            // Relocating the anchor dismisses its popover like an ordinary outside tap.
            if self.isReviewFilterPopoverPresented {
                self.finalizeReviewFilterDraft()
                self.isReviewFilterPopoverPresented = false
            }
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
            self.isAnswerVisible = false
            self.reviewSpeechController.stopSpeech()
            self.dismissReviewFilterPopoverIfContextDiverged()
        }
        .onChange(of: store.reviewPresentationResetRevision) { _, _ in
            self.isAnswerVisible = false
            self.reviewSpeechController.stopSpeech()
            self.lastPresentedReviewCardId = self.currentCard?.cardId
            self.lastPresentedReviewWorkspaceId = self.store.workspace?.workspaceId
        }
        .animation(self.reduceMotion ? nil : .smooth(duration: 0.35), value: self.navigation.isAICompanionVisible)
        .navigationTitle(self.showsFilterInReviewColumn ? "" : String(localized: "Review", table: reviewCardsStringsTableName))
        .toolbar(self.showsFilterInReviewColumn && self.tabBarPlacement == .sidebar ? .hidden : .automatic, for: .navigationBar)
        .navigationBarTitleDisplayMode(self.usesPairedReviewSpacing || self.dynamicTypeSize.isAccessibilitySize ? .inline : .automatic)
        .onAppear {
            self.isReviewReactionScreenVisible = true
            if self.canUseReviewKeyboardShortcuts && self.navigation.isAIChatVisible == false {
                self.isReviewKeyboardFocused = true
            }
            if self.areReviewReactionAnimationsEnabled {
                self.prewarmReviewReactionLottieAssets()
            }
        }
        .onChange(of: self.shouldShowReviewLoader) { _, isLoading in
            if isLoading == false && self.canUseReviewKeyboardShortcuts && self.navigation.isAIChatVisible == false {
                self.isReviewKeyboardFocused = true
            }
        }
        .onChange(of: self.areReviewReactionAnimationsEnabled) { _, isEnabled in
            if isEnabled {
                self.prewarmReviewReactionLottieAssets()
            } else {
                self.cancelReviewReactionLottiePrewarm()
                self.dismissActiveReviewReactions(reason: "disabled")
            }
        }
        .onChange(of: self.scenePhase) { _, phase in
            if phase == .active {
                self.prewarmReviewReactionLottieAssets()
            } else {
                self.cancelReviewReactionLottiePrewarm()
                self.dismissActiveReviewReactions(reason: "scene_inactive")
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didReceiveMemoryWarningNotification)) { _ in
            self.cancelReviewReactionLottiePrewarm()
            self.dismissActiveReviewReactions(reason: "memory_warning")
        }
        .onChange(of: currentCard?.cardId, initial: true) { _, _ in
            self.reviewSpeechController.stopSpeech()
            self.reconcileReviewPresentation()
        }
        .onDisappear {
            self.isReviewKeyboardFocused = false
            self.isReviewReactionScreenVisible = false
            self.reviewSpeechController.stopSpeech()
            self.cancelReviewReactionLottiePrewarm()
            self.dismissActiveReviewReactions(reason: "screen_disappeared")
        }
        .task(id: preparedRevealStatesTaskId) {
            await self.refreshPreparedRevealStates(reviewQueue: store.effectiveReviewQueue)
        }
        .task(id: store.localReadVersion) {
            await self.reloadReviewMetadata()
            self.reconcileEditingCardFormState()
        }
        .nativeBottomBar(
            alignment: .center,
            usesColumnLayout: UIDevice.current.userInterfaceIdiom == .pad && self.navigation.isAICompanionVisible,
            showsBackground: UIDevice.current.userInterfaceIdiom != .pad
        ) {
            reviewBottomAccessory
        }
        .ignoresSafeArea(UIDevice.current.userInterfaceIdiom == .pad || self.navigation.canPresentAICompanion == false || self.isKeyboardDocked ? [] : .keyboard, edges: .bottom)
        .simultaneousGesture(
            DragGesture(minimumDistance: 0)
                .onChanged { _ in
                    self.dismissActiveReviewReactions(reason: "interaction")
                }
        )
        .toolbar {
            AICompanionToolbarItem()
            if self.usesCompactCompanionToolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    reviewFilterMenu
                }
                if #available(iOS 26.0, *) {
                    ToolbarSpacer(.fixed, placement: .topBarTrailing)
                }
                ToolbarItemGroup(placement: .topBarTrailing) {
                    reviewLeaderboardButton
                    reviewProgressBadgeButton
                }
            } else if self.showsFilterInReviewColumn == false {
                ToolbarItem(placement: .topBarLeading) {
                    reviewFilterMenu
                }
                ToolbarItemGroup(placement: .topBarTrailing) {
                    // Keeping a third glass action collapses these shortcuts into overflow.
                    reviewLeaderboardButton
                    reviewProgressBadgeButton
                }
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
        .sheet(
            isPresented: self.$isEditorPresented,
            onDismiss: {
                // The same pair the Cards tab's editor reports, because it is the same screen: the
                // pencil here opens `CardEditorScreen` too, and leaving it out would leave
                // `card_editor` half-populated, counting only the editor views that happen on the
                // Cards tab. This sheet is the edit path alone — the create button on Review calls
                // `navigation.openCardCreation()`, which opens the Cards tab's own editor and is
                // reported there. From the presentation, never from the content, for the reason
                // `Analytics.trackScreenViewedOnDismiss` gives; the hand-off to the AI tab reports
                // `ai` before it closes the editor, so this restore is then refused.
                Analytics.trackScreenViewedOnDismiss(of: .cardEditor, restoring: .review)
            }
        ) {
            NavigationStack(path: self.$cardFormState.navigationPath) {
                CardEditorScreen(
                    title: String(localized: "Edit card", table: reviewCardsStringsTableName),
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
            .onAppear {
                Analytics.trackScreenViewed(.cardEditor)
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
            Text(String(localized: "Nibomo can send study reminders with a card from your review queue. These notifications contain study cards only and never marketing messages.", table: reviewCardsStringsTableName))
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

    private func reconcileReviewPresentation() {
        guard let cardId = self.currentCard?.cardId else {
            // Preserve the unfinished presentation when a reload temporarily removes its card.
            return
        }
        if let previousCardId = self.lastPresentedReviewCardId, previousCardId != cardId {
            let isMigratedPresentation: Bool
            if let sourceWorkspaceId = self.lastPresentedReviewWorkspaceId,
               let destinationWorkspaceId = self.store.workspace?.workspaceId,
               sourceWorkspaceId != destinationWorkspaceId {
                isMigratedPresentation = forkedCardIdForWorkspace(
                    sourceWorkspaceId: sourceWorkspaceId,
                    destinationWorkspaceId: destinationWorkspaceId,
                    sourceCardId: previousCardId
                ) == cardId
            } else {
                isMigratedPresentation = false
            }
            if !isMigratedPresentation {
                self.isAnswerVisible = false
            }
        }
        self.lastPresentedReviewCardId = cardId
        self.lastPresentedReviewWorkspaceId = self.store.workspace?.workspaceId
    }

    private var reviewCompanionHeader: some View {
        // Preserve the same controls/popover anchor when enlarged text needs more space.
        let layout = self.dynamicTypeSize > .large
            ? AnyLayout(VStackLayout(spacing: 12))
            : AnyLayout(HStackLayout(spacing: 12))
        return layout {
            reviewFilterMenu
                .nativeActionButtonStyle()
                .controlSize(.regular)
                .frame(maxWidth: .infinity, alignment: .leading)

            Text(String(localized: "Review", table: reviewCardsStringsTableName))
                .font(.headline)
                .lineLimit(1)
                .fixedSize(horizontal: true, vertical: false)
                .frame(maxWidth: .infinity)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier(UITestIdentifier.reviewCompanionTitle)

            reviewCompanionBadges
                .frame(maxWidth: .infinity, alignment: .trailing)
        }
    }

    @ViewBuilder
    private var reviewCompanionBadges: some View {
        let badges = HStack(spacing: 8) {
            reviewLeaderboardButton
            reviewProgressBadgeButton
        }
        .buttonStyle(.plain)
        .font(.title3)
        .padding(.horizontal, 8)

        if #available(iOS 26.0, *) {
            badges.glassEffect(.regular, in: .capsule)
        } else {
            badges.background(.regularMaterial, in: Capsule())
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
            if self.usesCompactCompanionToolbar {
                Image(systemName: "line.3.horizontal.decrease")
                    .foregroundStyle(Color.primary)
            } else {
                HStack(spacing: 4) {
                    Text(self.selectedReviewFilterTitle)
                        .lineLimit(1)
                        .truncationMode(.tail)
                        .frame(maxWidth: self.showsFilterInReviewColumn ? nil : 180, alignment: .leading)
                    Image(systemName: "chevron.down")
                        .font(.caption.weight(.semibold))
                }
                .foregroundStyle(Color.primary)
                .frame(minHeight: self.showsFilterInReviewColumn ? 30 : nil)
                .fixedSize(horizontal: self.showsFilterInReviewColumn == false, vertical: false)
            }
        }
        .tint(Color.primary)
        .accessibilityIdentifier(UITestIdentifier.reviewFilterMenu)
        .accessibilityLabel(self.usesCompactCompanionToolbar
            ? String(localized: "Filters", table: reviewCardsStringsTableName)
            : self.selectedReviewFilterTitle)
        .accessibilityValue(self.usesCompactCompanionToolbar ? self.selectedReviewFilterTitle : "")
        .popover(isPresented: self.$isReviewFilterPopoverPresented) {
            ReviewFilterPopover(
                reviewFilter: self.$reviewFilterDraft,
                decks: store.decks,
                tagSummaries: self.reviewTagSummaries,
                onEditDecks: self.dismissReviewFilterPopoverAndOpenDecks
            )
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
            .modifier(ReviewHardwareKeyboardModifier(
                isFocused: self.$isReviewKeyboardFocused,
                onKeyPress: self.handleReviewKeyPress,
                onTap: {
                    if self.canUseReviewKeyboardShortcuts {
                        self.isReviewKeyboardFocused = true
                    }
                }
            ))
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

            if isAnswerVisible, self.dynamicTypeSize.isAccessibilitySize,
               let options = preparedRevealState.reviewAnswerGridOptions {
                reviewAnswerButtonsGrid(cardId: card.cardId, options: options)
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
            } else if !(isAnswerVisible && self.dynamicTypeSize.isAccessibilitySize),
                      let currentCard, let preparedRevealState = self.cachedPreparedCurrentRevealState {
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
                    .foregroundStyle(Color.primary)
                    .monospacedDigit()
                    .lineLimit(1)
            }
            .fixedSize(horizontal: true, vertical: false)
            .frame(minWidth: self.showsFilterInReviewColumn ? 44 : nil, minHeight: self.showsFilterInReviewColumn ? 44 : nil)
            .contentShape(Rectangle())
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
            Group {
                if let rank = badgeState.rank {
                    HStack(spacing: reviewToolbarBadgeSpacing) {
                        Image(systemName: "trophy.fill")
                            .foregroundStyle(Color.yellow)
                        Text(rank.formatted())
                            .foregroundStyle(Color.primary)
                            .monospacedDigit()
                            .lineLimit(1)
                    }
                    .fixedSize(horizontal: true, vertical: false)
                } else {
                    Image(systemName: "trophy.fill")
                        .foregroundStyle(Color.yellow)
                }
            }
            .frame(minWidth: self.showsFilterInReviewColumn ? 44 : nil, minHeight: self.showsFilterInReviewColumn ? 44 : nil)
            .contentShape(Rectangle())
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
                .padding(.bottom, self.usesPairedReviewSpacing ? 4 : reviewBottomBarBottomPadding)
        }
    }

    private var canUseReviewKeyboardShortcuts: Bool {
        UIDevice.current.userInterfaceIdiom == .pad
            && self.navigation.selectedTab == .review
            && self.scenePhase == .active
            && self.isEditorPresented == false
            && self.isQueuePreviewPresented == false
            && self.isReviewFilterPopoverPresented == false
            && self.shouldShowReviewLoader == false
            && self.currentCard != nil
            && self.store.pendingReviewCardIds.isEmpty
            && self.store.reviewSubmissionFailure == nil
            && self.store.isReviewHardReminderPresented == false
            && self.store.isReviewNotificationPrePromptPresented == false
            && self.store.isGuestSignInAfterReviewPromptPresented == false
            && self.store.activeCloudSignInSheetCount == 0
            && self.store.feedbackPresentation == nil
            && self.store.presentedTechnicalError == nil
            && self.store.accountDeletionState == .hidden
            && self.store.accountDeletionSuccessMessage == nil
            && self.premiumPresenter.request == nil
    }

    private func handleReviewKeyPress(_ press: KeyPress) -> KeyPress.Result {
        // Only the study surface owns these unmodified keys; focused editors/chat keep typing.
        guard self.canUseReviewKeyboardShortcuts, press.modifiers.isEmpty else {
            return .ignored
        }
        self.dismissActiveReviewReactions(reason: "interaction")
        if press.key == .space {
            guard self.isAnswerVisible == false else { return .ignored }
            self.revealReviewAnswer()
            return .handled
        }
        guard self.isAnswerVisible, let card = self.currentCard,
              self.cachedPreparedCurrentRevealState?.reviewAnswerGridOptions != nil,
              let number = Int(press.characters), let rating = ReviewRating(rawValue: number - 1) else {
            return .ignored
        }
        self.rateReviewCard(cardId: card.cardId, rating: rating)
        return .handled
    }

    /**
     * The flip, and the only place the answer side is shown.
     *
     * `review_card_revealed` is emitted from the explicit reveal action rather than from a state observer,
     * because an observer fires for view updates the person did not cause. The guard is
     * `isAnswerVisible`, which is per *presentation* and not per card: `.onChange(of:
     * currentCard?.cardId)` clears it whenever the presented card changes, and answering a card puts
     * it in the pending set so the presented card changes immediately — so a card that later returns
     * to the head of the queue is a new presentation and reports its flip again. A "last card
     * reported" guard would go silent on exactly that card. Within one presentation the guard also
     * absorbs a double tap landing before SwiftUI swaps the bottom bar for the rating buttons.
     */
    private func revealReviewAnswer() {
        guard self.isAnswerVisible == false else { return }
        self.isAnswerVisible = true
        Analytics.track(.reviewCardRevealed)
    }

    private func rateReviewCard(cardId: String, rating: ReviewRating) {
        guard self.store.isReviewPending(cardId: cardId) == false else { return }
        if self.areReviewReactionAnimationsEnabled {
            self.emitReviewReaction(rating: rating)
        }
        self.submitReview(cardId: cardId, rating: rating)
    }

    private var showAnswerButton: some View {
        Button {
            self.revealReviewAnswer()
        } label: {
            Label(String(localized: "Show answer", table: reviewCardsStringsTableName), systemImage: "eye")
                .frame(maxWidth: .infinity)
                .frame(minHeight: showAnswerButtonMinHeight)
        }
        .nativeProminentActionButtonStyle()
        .accessibilityIdentifier(UITestIdentifier.reviewShowAnswerButton)
    }

    @ViewBuilder
    private func reviewAnswerButtonsGrid(cardId: String, options: ReviewAnswerGridOptions) -> some View {
        if self.dynamicTypeSize.isAccessibilitySize {
            VStack(spacing: reviewBottomBarButtonSpacing) {
                reviewAnswerButton(cardId: cardId, option: options.again)
                reviewAnswerButton(cardId: cardId, option: options.hard)
                reviewAnswerButton(cardId: cardId, option: options.good)
                reviewAnswerButton(cardId: cardId, option: options.easy)
            }
        } else {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: reviewBottomBarButtonSpacing) {
                    reviewAnswerButton(cardId: cardId, option: options.again)
                    reviewAnswerButton(cardId: cardId, option: options.hard)
                    reviewAnswerButton(cardId: cardId, option: options.good)
                    reviewAnswerButton(cardId: cardId, option: options.easy)
                }
                .frame(minWidth: 600)

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
        }
    }

    private func reviewAnswerButton(cardId: String, option: ReviewAnswerOption) -> some View {
        Button {
            self.rateReviewCard(cardId: cardId, rating: option.rating)
        } label: {
            VStack(alignment: .center, spacing: 4) {
                HStack(spacing: 8) {
                    Image(systemName: option.rating.symbolName)
                        .font(.headline)

                    Text(localizedReviewRatingTitle(rating: option.rating))
                        .fontWeight(.semibold)
                        .multilineTextAlignment(.center)
                }

                Text(option.intervalDescription)
                    .font(.caption2)
                    .opacity(0.8)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity, alignment: .center)
            }
            .frame(maxWidth: .infinity, minHeight: reviewAnswerButtonMinHeight, alignment: .center)
        }
        .nativeProminentActionButtonStyle()
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
                    Analytics.track(.cardCreateStarted(entryPoint: .review), screen: .review)
                    navigation.openCardCreation()
                } label: {
                    Label(String(localized: "Create card", table: reviewCardsStringsTableName), systemImage: "plus")
                        .font(.body)
                        .imageScale(.medium)
                }
                .nativeActionButtonStyle()

                Text(String(localized: "or", table: reviewCardsStringsTableName))
                    .font(.footnote)
                    .foregroundStyle(.secondary)

                Button {
                    Analytics.track(.cardCreateStarted(entryPoint: .ai), screen: .review)
                    navigation.openAICardCreation()
                } label: {
                    Label(String(localized: "Create with AI", table: reviewCardsStringsTableName), systemImage: "sparkles")
                        .font(.body)
                        .imageScale(.medium)
                }
                .nativeProminentActionButtonStyle()

                if shouldShowSwitchToAllCardsAction {
                    Text(String(localized: "or", table: reviewCardsStringsTableName))
                        .font(.footnote)
                        .foregroundStyle(.secondary)

                    Button {
                        store.selectReviewFilter(reviewFilter: .allCards)
                    } label: {
                        Text(String(localized: "Switch to all cards deck", table: reviewCardsStringsTableName))
                    }
                    .nativeActionButtonStyle()
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
    let accessibilityValue = reps == 0
        ? String(localized: "New", table: reviewCardsStringsTableName)
        : localizedCardCountValue(count: reps)

    Label(accessibilityValue, systemImage: "arrow.clockwise")
        .foregroundStyle(.secondary)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(.thinMaterial, in: Capsule(style: .continuous))
        .accessibilityLabel(accessibilityLabel)
        .accessibilityValue(accessibilityValue)
}

#Preview {
    NavigationStack {
        ReviewView()
            .environment(FlashcardsStore())
            .environment(AppNavigationModel())
            .environment(PremiumPresenter())
    }
}

/// Add hardware study focus only to iPad; phones retain their native focus behavior.
private struct ReviewHardwareKeyboardModifier: ViewModifier {
    var isFocused: FocusState<Bool>.Binding
    var onKeyPress: (KeyPress) -> KeyPress.Result
    var onTap: () -> Void

    @ViewBuilder
    func body(content: Content) -> some View {
        if UIDevice.current.userInterfaceIdiom == .pad {
            content
                .focusable()
                .focusEffectDisabled()
                .focused(self.isFocused)
                .onKeyPress(keys: [.space, "1", "2", "3", "4"], phases: .down, action: self.onKeyPress)
                .simultaneousGesture(TapGesture().onEnded(self.onTap))
        } else {
            content
        }
    }
}
