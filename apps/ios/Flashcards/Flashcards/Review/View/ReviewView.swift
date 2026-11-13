import SwiftUI
import UIKit

private let reviewCardsStringsTableName: String = "ReviewCards"
private let reviewBottomBarHorizontalPadding: CGFloat = 20
private let reviewCardContentHorizontalPadding: CGFloat = 20
private let reviewBottomBarTopPadding: CGFloat = 8
private let reviewBottomBarBottomPadding: CGFloat = 8
private let reviewBottomBarButtonSpacing: CGFloat = 10
private let reviewToolbarBadgeSpacing: CGFloat = 4
private let reviewAnswerButtonMinHeight: CGFloat = appMinimumTouchTarget
private let showAnswerButtonMinHeight: CGFloat = 56
let emptyBackTextPlaceholder: String = String(localized: "No back text", table: reviewCardsStringsTableName)
private let reviewQueuePreviewPageSize: Int = 50

private enum ReviewCardScrollTarget: Hashable {
    case front
    case back
}

struct ReviewView: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.locale) private var locale
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.tabBarPlacement) private var tabBarPlacement
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isKeyboardDocked) private var isKeyboardDocked
    @Environment(\.scenePhase) var scenePhase
    @Environment(\.isLowPowerModeEnabled) var isLowPowerModeEnabled: Bool
    @Environment(FlashcardsStore.self) var store: FlashcardsStore
    @Environment(AppNavigationModel.self) private var navigation: AppNavigationModel
    @Environment(PremiumPresenter.self) var premiumPresenter: PremiumPresenter
    @Environment(ReviewScreenModel.self) var reviewScreen: ReviewScreenModel
    @State private var isTextInputEditing: Bool = false

    @StateObject private var reviewSpeechController = ReviewSpeechController()
    @State private var textSelection: ReviewCardTextSelection? = nil
    @State private var reviewCardSideCopyRequest: ReviewCardSideCopyRequest? = nil
    @State var isReviewScreenVisible: Bool = false
    @State private var reviewReactionPlayback = ReviewReactionPlaybackModel()
    /// Resets on touch-up and on cancellation, which skips `onEnded`.
    @GestureState var isReviewReactionTouchDown: Bool = false
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
        observedTags: [],
        tags: [],
        mediaAssetIdsReadyForUpload: []
    )
    @State var screenErrorMessage: String = ""
    @State var reviewTagSummaries: [WorkspaceTagSummary] = []
    @State var totalCardsCount: Int = 0
    @State private var reviewFilterEditSession = ReviewFilterEditSession()
    @State private var reviewFilterButtonFrame: CGRect = .zero
    @State private var reviewTagFilterRequest: ReviewTagFilterRequest? = nil
    #if targetEnvironment(macCatalyst)
    @State private var macReviewFilterOpenRequest: UUID? = nil
    #endif

    private var availableTagSuggestions: [TagSuggestion] {
        self.reviewTagSummaries.map { tagSummary in
            TagSuggestion(
                tag: tagSummary.tag,
                countState: .ready(cardsCount: tagSummary.cardsCount)
            )
        }
    }

    private var selectedReviewFilterTitle: String {
        self.reviewFilterTitle(reviewFilter: store.selectedReviewFilter)
    }

    private var reviewFilterScope: ReviewFilterEditSession.Scope {
        ReviewFilterEditSession.Scope(
            workspaceId: self.store.workspace?.workspaceId,
            appliedFilter: self.store.selectedReviewFilter
        )
    }

    private var reviewFilterButtonTitle: String {
        self.reviewFilterTitle(reviewFilter: self.reviewFilterEditSession.displayedFilter(in: self.reviewFilterScope))
    }

    private func reviewFilterTitle(reviewFilter: ReviewFilter) -> String {
        switch reviewFilter {
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

    private func reviewReactionContext() -> ReviewReactionPlaybackContext {
        ReviewReactionPlaybackContext(
            areAnimationsEnabled: self.areReviewReactionAnimationsEnabled,
            scenePhase: self.scenePhase,
            isTouchDown: self.isReviewReactionTouchDown
        )
    }

    private var currentCard: Card? {
        store.presentedReviewCard
    }

    private var preparedRevealStatesTaskId: String {
        let presentedStateId = self.currentCard.map {
            makePreparedReviewRevealStateId(card: $0, schedulerSettings: store.schedulerSettings)
        } ?? "no-presented-card"
        let queueStateId = makePreparedReviewRevealStatesTaskId(
            reviewQueue: store.effectiveReviewQueue,
            schedulerSettings: store.schedulerSettings
        )
        return "\(presentedStateId)|\(queueStateId)"
    }

    /// A kept card stays on screen while a rebuild loads the queue behind it. A card opened by a widget's Reveal
    /// answer button stays behind the loader until its answer shows, so its question side never flashes.
    /// See docs/fsrs-scheduling-logic.md#non-blocking-review.
    private var shouldShowReviewLoader: Bool {
        if let currentCard, self.reviewScreen.pendingWidgetRevealCardId == currentCard.cardId {
            return self.reviewScreen.isAnswerVisible == false
        }
        return self.currentCard == nil && (store.isReviewHeadLoading || store.isReviewQueueChunkLoading)
    }

    private var usesPairedReviewSpacing: Bool {
        UIDevice.current.userInterfaceIdiom == .pad
            && self.horizontalSizeClass == .regular
            && self.navigation.isAICompanionVisible
    }

    private var usesCompactCompanionToolbar: Bool {
        #if targetEnvironment(macCatalyst)
        false
        #else
        self.usesPairedReviewSpacing
            && self.navigation.selectedTab == .review
            && self.tabBarPlacement == .topBar
        #endif
    }

    private var showsFilterInReviewColumn: Bool {
        #if targetEnvironment(macCatalyst)
        false
        #else
        self.usesPairedReviewSpacing && self.usesCompactCompanionToolbar == false
        #endif
    }

    private var hidesReviewNavigationBar: Bool {
        self.showsFilterInReviewColumn && self.navigation.isAICompanionVisible && self.tabBarPlacement == .sidebar
    }

    private var nativeReviewContent: some View {
        ZStack {
            Group {
                if self.shouldShowReviewLoader {
                    reviewLoadingView
                } else if let currentCard {
                    activeCardView(card: currentCard, preparedRevealState: self.displayedRevealState(card: currentCard))
                } else {
                    emptyStateView
                        .onAppear {
                            FlashcardsObservability.discardReviewNextCardVisibleSpan()
                        }
                }
            }

            ReviewReactionPlaybackLayer(
                model: self.reviewReactionPlayback,
                context: self.reviewReactionContext
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
            self.finishReviewFiltering()
        }
        .onChange(of: self.reviewFilterEditSession.isPresented) { _, _ in
            if self.reviewFilterEditSession.isPresented == false {
                self.finishReviewFiltering()
            }
        }
        .onChange(of: self.reviewFilterScope) { _, _ in
            self.reviewFilterEditSession.discardIfScopeChanged(to: self.reviewFilterScope)
        }
        .onChange(of: store.workspace?.workspaceId) { _, _ in
            self.textSelection = nil
        }
        .onChange(of: store.selectedReviewFilter, initial: true) { previousFilter, filter in
            if previousFilter != filter {
                self.textSelection = nil
                self.reviewSpeechController.stopSpeech()
            }
            // The model outlives this view, so a filter changed while Review was off screen resets it here.
            if self.reviewScreen.presentedReviewFilter != filter {
                self.reviewScreen.presentedReviewFilter = filter
                self.reviewScreen.endPresentation()
            }
        }
        .onChange(of: self.canPresentSavedReviewPrompt, initial: true) { _, isAvailable in
            self.store.isSavedReviewPromptSurfaceAvailable = isAvailable
        }
        .onChange(of: store.savedReviewPromptOpportunity) { _, opportunity in
            guard let opportunity else { return }
            Task { @MainActor in
                await self.presentPromptAfterSavedReview(opportunity: opportunity)
            }
        }
        .onChange(of: store.reviewPresentationResetRevision, initial: true) { previousRevision, revision in
            if previousRevision != revision {
                self.textSelection = nil
                self.reviewSpeechController.stopSpeech()
            }
            // Same as the filter reset: a reset made while Review was off screen applies on recreation.
            if self.reviewScreen.presentedReviewPresentationResetRevision != revision {
                self.reviewScreen.presentedReviewPresentationResetRevision = revision
                self.reviewScreen.endPresentation()
                self.reviewScreen.lastPresentedReviewCardId = self.currentCard?.cardId
                self.reviewScreen.lastPresentedReviewWorkspaceId = self.store.workspace?.workspaceId
            }
        }
        .animation(self.reduceMotion ? nil : .smooth(duration: 0.35), value: self.navigation.isAICompanionVisible)
        .nativeNavigationTitle(self.showsFilterInReviewColumn ? "" : String(localized: "Review", table: reviewCardsStringsTableName))
        #if !targetEnvironment(macCatalyst)
        .toolbar(self.hidesReviewNavigationBar ? .hidden : .automatic, for: .navigationBar)
        #endif
        // Keep iPad's shared tab/toolbar row stable when a card handoff focuses AI.
        // Switching from a large title can retain its empty band after keyboard dismissal.
        .navigationBarTitleDisplayMode(UIDevice.current.userInterfaceIdiom == .pad || self.dynamicTypeSize.isAccessibilitySize ? .inline : .automatic)
        .onAppear {
            self.isReviewScreenVisible = true
            self.reviewReactionPlayback.appear(context: self.reviewReactionContext)
        }
        .onChange(of: self.areReviewReactionAnimationsEnabled) { _, _ in
            self.reviewReactionPlayback.enablementChanged(context: self.reviewReactionContext)
        }
        .onChange(of: self.scenePhase) { _, _ in
            self.reviewReactionPlayback.scenePhaseChanged(context: self.reviewReactionContext)
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didReceiveMemoryWarningNotification)) { _ in
            self.reviewReactionPlayback.receiveMemoryWarning(context: self.reviewReactionContext)
        }
        .onChange(of: currentCard?.cardId, initial: true) { _, cardId in
            if self.textSelection?.cardId != cardId {
                self.textSelection = nil
            }
            self.reviewSpeechController.stopSpeech()
            self.reconcileReviewPresentation()
        }
        .onChange(of: self.reviewScreen.pendingWidgetRevealCardId) { _, _ in
            self.applyPendingWidgetReveal()
        }
        .onDisappear {
            self.textSelection = nil
            self.isReviewScreenVisible = false
            self.store.isSavedReviewPromptSurfaceAvailable = false
            self.reviewSpeechController.stopSpeech()
            self.reviewReactionPlayback.disappear(context: self.reviewReactionContext)
        }
        .task(id: preparedRevealStatesTaskId) {
            await self.refreshPreparedRevealStates(reviewQueue: store.effectiveReviewQueue, presentedCard: self.currentCard)
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
    }

    private var reviewContentWithOnboarding: some View {
        self.nativeReviewContent
        #if !targetEnvironment(macCatalyst)
        .background {
            // The presenter must outlive replacements of the toolbar/header control.
            GeometryReader { geometry in
                Color.clear
                    .popover(
                        isPresented: self.$reviewFilterEditSession.isPresented,
                        attachmentAnchor: .rect(.rect(self.reviewFilterButtonFrame.offsetBy(
                            dx: -geometry.frame(in: .global).minX,
                            dy: -geometry.frame(in: .global).minY
                        )))
                    ) {
                        ReviewFilterPopover(
                            reviewFilter: self.$reviewFilterEditSession.draft,
                            decks: store.decks,
                            tagSummaries: self.reviewTagSummaries,
                            onEditDecks: self.dismissReviewFilterPopoverAndOpenDecks,
                            onSingleChoice: self.dismissReviewFilterPopover
                        )
                        .presentationCompactAdaptation(.popover)
                    }
            }
        }
        #endif
        .overlayPreferenceValue(FirstReviewOnboardingAnchors.self) { anchors in
            GeometryReader { geometry in
                if self.canPresentSavedReviewPrompt,
                   self.shouldShowReviewLoader == false,
                   self.currentCard != nil,
                   self.store.firstReviewOnboardingCompleted == false,
                   let anchor = anchors[self.reviewScreen.isAnswerVisible ? .rating(.again) : .showAnswer] {
                    let target = geometry[anchor]
                    if target.width > 0, target.height > 0,
                       CGRect(origin: .zero, size: geometry.size).contains(target) {
                        FirstReviewOnboardingOverlay(
                            target: target, size: geometry.size,
                            accent: self.store.displayedAccountAccentColor,
                            animates: self.reduceMotion == false && self.isLowPowerModeEnabled == false
                        )
                    }
                }
            }
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
        #if targetEnvironment(macCatalyst)
        .catalystReviewShortcutHintOverlay()
        #endif
        .background {
            ReviewTextEditingObserver(isEditing: self.$isTextInputEditing)
        }
        .reviewKeyCommandActions(self.reviewKeyboardActions)
        .ignoresSafeArea(UIDevice.current.userInterfaceIdiom == .pad || self.navigation.canPresentAICompanion == false || self.isKeyboardDocked ? [] : .keyboard, edges: .bottom)
        .simultaneousGesture(
            DragGesture(minimumDistance: 0)
                .updating(self.$isReviewReactionTouchDown) { _, isTouchDown, _ in
                    isTouchDown = true
                }
                .onChanged { _ in
                    self.reviewReactionPlayback.dismissActiveReviewReactions(
                        reason: "interaction", context: self.reviewReactionContext
                    )
                }
        )
        .onChange(of: self.isReviewReactionTouchDown) { _, isTouchDown in
            if isTouchDown == false {
                self.reviewReactionPlayback.resumeReviewReactionPreparation(context: self.reviewReactionContext)
            }
        }
        #if targetEnvironment(macCatalyst)
        .macToolbarContribution(self.macReviewToolbar)
        #endif
        .toolbar {
            #if !targetEnvironment(macCatalyst)
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
                    reviewLeaderboardButton
                    reviewProgressBadgeButton
                }
            }
            #endif
        }
    }

    #if targetEnvironment(macCatalyst)
    private var macReviewToolbar: MacToolbarContribution {
        let streak = self.store.reviewProgressBadgeState
        let badge = makeReviewProgressBadgePresentation(badgeState: streak)
        let leaderboard = self.store.reviewLeaderboardBadgeState
        var actions: [MacToolbarAction] = []
        actions.append(MacToolbarAction(
            identifier: UITestIdentifier.reviewLeaderboardShortcut, symbol: "trophy.fill",
            label: self.reviewLeaderboardButtonAccessibilityLabel(badgeState: leaderboard),
            symbolColor: UIColor(Color.yellow),
            title: leaderboard.rank?.formatted(),
            value: self.reviewLeaderboardButtonAccessibilityValue(badgeState: leaderboard),
            isEnabled: leaderboard.isInteractive,
            perform: { _ in self.openProgressWithPresentationBreadcrumb(target: .leaderboard) }
        ))
        actions.append(MacToolbarAction(
            identifier: UITestIdentifier.reviewProgressBadge, symbol: badge.iconSystemName,
            label: formatReviewProgressBadgeAccessibilityLabel(badgeState: streak),
            symbolColor: streak.hasReviewedToday ? UIColor(self.store.displayedAccountAccentColor.color) : nil,
            title: formatReviewProgressBadgeValue(badgeState: streak),
            value: self.reviewProgressBadgeAccessibilityValue(badgeState: streak),
            isEnabled: streak.isInteractive,
            perform: { _ in self.openProgressWithPresentationBreadcrumb(target: .streak) }
        ))
        let dueCount = store.displayedReviewDueCount
        let dueLabel = makeReviewDueBadgeLabel(dueCount: dueCount)
        let filterTitle: String
        if #available(macCatalyst 26.0, *) {
            filterTitle = self.reviewFilterButtonTitle
        } else {
            filterTitle = [self.reviewFilterButtonTitle, dueLabel].compactMap { $0 }.joined(separator: " ")
        }
        let filter = MacToolbarAction(
            identifier: UITestIdentifier.reviewFilterMenu, symbol: "line.3.horizontal.decrease", label: self.reviewFilterButtonTitle,
            title: filterTitle,
            value: dueLabel,
            badgeCount: dueCount > 0 ? dueCount : nil,
            toolTip: String(
                format: String(localized: "Filter: %@ (F)", table: reviewCardsStringsTableName),
                locale: Locale.current,
                self.reviewFilterButtonTitle
            ),
            activationRequest: self.macReviewFilterOpenRequest.map { id in
                MacToolbarActivationRequest(id: id, onHandled: {
                    if self.macReviewFilterOpenRequest == id {
                        self.macReviewFilterOpenRequest = nil
                    }
                })
            },
            perform: { context in
                self.beginReviewFiltering()
                context.presentPopover(isPresented: self.$reviewFilterEditSession.isPresented) {
                    ReviewFilterPopover(
                        reviewFilter: self.$reviewFilterEditSession.draft, decks: self.store.decks,
                        tagSummaries: self.reviewTagSummaries,
                        onEditDecks: self.dismissReviewFilterPopoverAndOpenDecks,
                        onSingleChoice: self.dismissReviewFilterPopover
                    )
                    .environment(\.locale, self.locale)
                    .tint(self.store.displayedAccountAccentColor.color)
                }
            }
        )
        return MacToolbarContribution(
            tab: .review,
            leading: [MacToolbarGroup(identifier: "nibomo.reviewFilter", actions: [filter])],
            trailing: [MacToolbarGroup(identifier: "nibomo.reviewActions", actions: actions, usesSharedBezel: true)]
        )
    }
    #endif

    private var reviewContentWithSheets: some View {
        self.reviewContentWithOnboarding
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
        .sheet(item: self.$textSelection) { selection in
            ReviewCardTextSelectionSheet(selection: selection)
        }
        .sheet(
            isPresented: self.$isEditorPresented,
            onDismiss: {
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
                    onCancel: self.cancelReviewCardEditor,
                    onSave: self.saveEditedCard,
                    onDelete: {
                        self.deleteEditingCard()
                    }
                )
            }
            .modifier(CardEditorKeyboardModifier(
                isEnabled: self.isEditorPresented && self.store.presentedTechnicalError == nil,
                isSummaryVisible: self.cardFormState.navigationPath.isEmpty,
                onCancel: self.cancelReviewCardEditor,
                onSave: self.saveEditedCard
            ))
            .technicalErrorSheet(store: self.store)
            .interactiveDismissDisabled()
            .onAppear {
                Analytics.trackScreenViewed(.cardEditor)
            }
        }
    }

    var body: some View {
        self.reviewContentWithSheets
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
        .reviewNotificationPrePromptAlert(
            isPresented: Binding(
                get: {
                    store.isReviewNotificationPrePromptPresented
                },
                set: { isPresented in
                    if isPresented == false {
                        store.dismissReviewNotificationPrePrompt(markDismissed: false)
                    }
                }
            ),
            permissionStatus: store.reviewNotificationPrePromptPermissionStatus,
            onNotNow: {
                store.dismissReviewNotificationPrePrompt(markDismissed: true)
            },
            onContinue: {
                store.continueReviewNotificationPrePrompt()
            }
        )
        .reviewHardReminderAlert(
            isPresented: Binding(
                get: {
                    store.isReviewHardReminderPresented
                },
                set: { isPresented in
                    if isPresented == false {
                        store.dismissReviewHardReminder()
                    }
                }
            ),
            onOK: {
                store.dismissReviewHardReminder()
            }
        )
        .alert(
            String(
                localized: "review.tag_filter_alert.title",
                defaultValue: "Review filter",
                table: reviewCardsStringsTableName,
                comment: "Title of the alert shown after tapping a tag chip on the Review card"
            ),
            isPresented: Binding(
                get: {
                    self.reviewTagFilterRequest != nil
                },
                set: { isPresented in
                    if isPresented == false {
                        self.reviewTagFilterRequest = nil
                    }
                }
            ),
            presenting: self.reviewTagFilterRequest
        ) { request in
            self.reviewTagFilterAlertActions(request: request)
        } message: { request in
            Text(reviewTagFilterAlertMessage(request: request))
        }
        .onChange(of: store.workspace?.workspaceId) { _, _ in
            self.reviewTagFilterRequest = nil
        }
        .environment(self.reviewScreen.preparedImageCache)
    }

    @ViewBuilder
    private func reviewTagFilterAlertActions(request: ReviewTagFilterRequest) -> some View {
        if request.isRequestedTagFilterSelected {
            Button(String(localized: "OK", table: reviewCardsStringsTableName), role: .cancel) {}
        } else {
            Button(String(localized: "Cancel", table: reviewCardsStringsTableName), role: .cancel) {}
                .accessibilityIdentifier(UITestIdentifier.reviewTagFilterCancelButton)
            Button(
                String(
                    localized: "review.tag_filter_alert.change_filter",
                    defaultValue: "Change filter",
                    table: reviewCardsStringsTableName,
                    comment: "Alert button that switches the review filter to the tapped tag"
                )
            ) {
                store.selectReviewFilter(reviewFilter: makeReviewTagsFilter(tags: [request.tag]))
            }
        }
    }

    /// The toolbar names a multi-tag filter by its count, so the alert names its tags instead, joined
    /// as "a, b, or c" because the filter matches cards with any of them.
    private var reviewTagFilterCurrentFilterTitle: String {
        guard case .tags(let tags) = store.selectedReviewFilter, tags.isEmpty == false else {
            return self.selectedReviewFilterTitle
        }

        return tags.formatted(.list(type: .or))
    }

    private func requestReviewTagFilter(tag: String) {
        self.reviewTagFilterRequest = ReviewTagFilterRequest(
            tag: tag,
            currentFilterTitle: self.reviewTagFilterCurrentFilterTitle,
            // The filter id compares normalized tag keys, so a case or whitespace variant still matches.
            isRequestedTagFilterSelected: store.selectedReviewFilter.id == makeReviewTagsFilter(tags: [tag]).id
        )
    }

    private func reconcileReviewPresentation() {
        guard let cardId = self.currentCard?.cardId else {
            // Preserve the unfinished presentation when a reload temporarily removes its card.
            return
        }
        if let previousCardId = self.reviewScreen.lastPresentedReviewCardId, previousCardId != cardId {
            let isMigratedPresentation: Bool
            if let sourceWorkspaceId = self.reviewScreen.lastPresentedReviewWorkspaceId,
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
                self.reviewScreen.endPresentation()
            }
        }
        self.reviewScreen.lastPresentedReviewCardId = cardId
        self.reviewScreen.lastPresentedReviewWorkspaceId = self.store.workspace?.workspaceId
        self.applyPendingWidgetReveal()
    }

    /// Shows the answer for a widget's Reveal answer tap once its card is presented, through the same reveal action
    /// as Show answer; any other presented card drops the request.
    private func applyPendingWidgetReveal() {
        guard
            let pendingCardId = self.reviewScreen.pendingWidgetRevealCardId,
            let currentCardId = self.currentCard?.cardId
        else {
            return
        }
        self.reviewScreen.pendingWidgetRevealCardId = nil
        guard pendingCardId == currentCardId else {
            return
        }
        self.revealReviewAnswer()
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
        let dueLabel = makeReviewDueBadgeLabel(dueCount: store.displayedReviewDueCount)
        let usesNativeBadge: Bool
        if #available(iOS 26.0, *) {
            usesNativeBadge = self.showsFilterInReviewColumn == false
        } else {
            usesNativeBadge = false
        }
        let inlineDueLabel = usesNativeBadge ? nil : dueLabel
        let accessibilityValue = [
            self.usesCompactCompanionToolbar ? self.reviewFilterButtonTitle : nil,
            dueLabel
        ].compactMap { $0 }.joined(separator: ", ")

        return Group {
            Button(action: self.beginReviewFiltering) {
                if self.usesCompactCompanionToolbar && inlineDueLabel == nil {
                    Image(systemName: "line.3.horizontal.decrease")
                        .foregroundStyle(Color.primary)
                } else {
                    HStack(spacing: 4) {
                        if self.usesCompactCompanionToolbar {
                            Image(systemName: "line.3.horizontal.decrease")
                        } else {
                            Text(self.reviewFilterButtonTitle)
                                .lineLimit(1)
                                .truncationMode(.tail)
                                .frame(maxWidth: self.showsFilterInReviewColumn ? nil : 180, alignment: .leading)
                        }
                        if let inlineDueLabel {
                            Text(verbatim: inlineDueLabel)
                                .monospacedDigit()
                                .fixedSize()
                        }
                        if self.usesCompactCompanionToolbar == false {
                            Image(systemName: "chevron.down")
                                .font(.caption.weight(.semibold))
                        }
                    }
                    .foregroundStyle(Color.primary)
                    .frame(minHeight: self.showsFilterInReviewColumn ? 30 : nil)
                    .fixedSize(horizontal: self.showsFilterInReviewColumn == false, vertical: false)
                    .contentShape(Rectangle())
                }
            }
            .tint(Color.primary)
            .labelStyle(.titleAndIcon)
            .accessibilityIdentifier(UITestIdentifier.reviewFilterMenu)
            .accessibilityLabel(self.usesCompactCompanionToolbar
                ? String(localized: "Filters", table: reviewCardsStringsTableName)
                : self.reviewFilterButtonTitle)
            .accessibilityValue(accessibilityValue)
        }
        #if !targetEnvironment(macCatalyst)
        .onGeometryChange(for: CGRect.self) { geometry in
            geometry.frame(in: .global)
        } action: { frame in
            self.reviewFilterButtonFrame = frame
        }
        .badge(usesNativeBadge ? dueLabel.map(Text.init(verbatim:)) : nil)
        #endif
    }

    private func finishReviewFiltering() {
        if let candidate = self.reviewFilterEditSession.finish(in: self.reviewFilterScope) {
            self.store.selectReviewFilter(reviewFilter: candidate)
        }
    }

    private func dismissReviewFilterPopover() {
        self.reviewFilterEditSession.isPresented = false
    }

    private func dismissReviewFilterPopoverAndOpenDecks() {
        self.finishReviewFiltering()
        self.navigation.openLibrary(destination: .decks)
    }

    private func openLibraryTags() {
        self.navigation.openLibrary(destination: .tags)
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
        @Bindable var reviewScreen = self.reviewScreen
        return ScrollViewReader { proxy in
            ScrollView {
                ReadableContentLayout(
                    maxWidth: flashcardsReadableContentMaxWidth,
                    horizontalPadding: reviewCardContentHorizontalPadding
                ) {
                    activeCardContentView(card: card, preparedRevealState: preparedRevealState)
                        .padding(.vertical, 20)
                        .background(ReviewOutsideTextTapReceiver())
                        .macToolbarScrollSurface("review")
                }
            }
            .scrollPosition($reviewScreen.cardScrollPosition)
            // `ScrollPosition` measures y from the inset-adjusted top, unlike `contentOffset`.
            .onScrollGeometryChange(for: CGFloat.self) { geometry in
                geometry.contentOffset.y + geometry.contentInsets.top
            } action: { _, offsetY in
                reviewScreen.cardScrollOffset = ReviewCardScrollOffset(cardId: card.cardId, y: offsetY)
            }
            .onAppear {
                restoreReviewCardScrollOffset(reviewScreen: reviewScreen, cardId: card.cardId)
            }
            .onChange(of: self.reviewScreen.isAnswerVisible) { wasVisible, isVisible in
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

    /// A recreated Review returns to its unfinished presentation's offset; anything else starts at the top.
    private func restoreReviewCardScrollOffset(reviewScreen: ReviewScreenModel, cardId: String) {
        guard let offset = reviewScreen.cardScrollOffset, offset.cardId == cardId else {
            reviewScreen.cardScrollPosition.scrollTo(edge: .top)
            return
        }
        reviewScreen.cardScrollPosition.scrollTo(y: offset.y)
    }

    private func beginReviewFiltering() {
        self.reviewFilterEditSession.open(in: self.reviewFilterScope)
    }

    private func activeCardContentView(card: Card, preparedRevealState: PreparedReviewRevealState) -> some View {
        return VStack(alignment: .leading, spacing: 20) {
            if screenErrorMessage.isEmpty == false {
                Text(screenErrorMessage)
                    .foregroundStyle(.red)
            }

            ReviewCardTagChipRow(
                tags: card.tags,
                leadingBleed: reviewCardContentHorizontalPadding,
                // Compact width runs the chips to the screen edge; regular width stops them at the card edge.
                trailingBleed: self.horizontalSizeClass == .compact ? reviewCardContentHorizontalPadding : 0,
                onOpenTags: self.openLibraryTags,
                onSelectTag: self.requestReviewTagFilter(tag:)
            )
            .font(.subheadline)
            .foregroundStyle(.secondary)
            // A new card starts its chips from the first tag.
            .id(card.cardId)

            ReviewCardSideView(
                label: String(localized: "Front", table: reviewCardsStringsTableName),
                content: preparedRevealState.frontContent,
                sourceText: card.frontText,
                onSelectText: {
                    self.openReviewTextSelection(card: card, side: .front)
                },
                repetitionCount: card.reps,
                isSpeechPlaying: self.reviewSpeechController.activeSide == .front,
                onToggleSpeech: {
                    self.toggleSpeech(side: .front, sourceText: card.frontText)
                },
                showsSpeechButton: preparedRevealState.frontSpeakableText.isEmpty == false,
                onEdit: {
                    self.beginEditing(card: card)
                },
                showsAiButton: false,
                aiButtonAccentColor: self.store.displayedAccountAccentColor,
                onOpenAi: {},
                surfaceStyle: .front,
                showsShortcutHints: UIDevice.current.userInterfaceIdiom == .pad && self.reviewScreen.isAnswerVisible == false,
                copyRequest: self.reviewCardSideCopyRequest
            )
            .onAppear {
                FlashcardsObservability.finishReviewNextCardVisibleSpan(
                    shownCardId: card.cardId,
                    hasImages: reviewRenderedContentHasImages(content: preparedRevealState.frontContent)
                )
            }
            .id(card.cardId)
            .id(ReviewCardScrollTarget.front)

            if self.reviewScreen.isAnswerVisible {
                ReviewCardSideView(
                    label: String(localized: "Back", table: reviewCardsStringsTableName),
                    content: preparedRevealState.backContent,
                    sourceText: card.backText,
                    onSelectText: {
                        self.openReviewTextSelection(card: card, side: .back)
                    },
                    repetitionCount: nil,
                    isSpeechPlaying: self.reviewSpeechController.activeSide == .back,
                    onToggleSpeech: {
                        self.toggleSpeech(side: .back, sourceText: card.backText)
                    },
                    showsSpeechButton: preparedRevealState.backSpeakableText.isEmpty == false,
                    onEdit: {
                        self.beginEditing(card: card)
                    },
                    showsAiButton: true,
                    aiButtonAccentColor: self.store.displayedAccountAccentColor,
                    onOpenAi: {
                        self.navigation.openAICardHandoff(card: makeAIChatCardReference(card: card))
                    },
                    surfaceStyle: .back,
                    showsShortcutHints: UIDevice.current.userInterfaceIdiom == .pad,
                    copyRequest: self.reviewCardSideCopyRequest
                )
                .id(card.cardId)
                .id(ReviewCardScrollTarget.back)
            }

            if let reviewActionErrorMessage = reviewActionErrorMessage(card: card) {
                Text(reviewActionErrorMessage)
                    .foregroundStyle(.red)
            }

            if self.reviewScreen.isAnswerVisible, self.dynamicTypeSize.isAccessibilitySize,
               let options = preparedRevealState.reviewAnswerGridOptions {
                reviewAnswerButtonsGrid(cardId: card.cardId, options: options)
            }
        }
    }

    @ViewBuilder
    private func reviewBottomBar(card: Card, preparedRevealState: PreparedReviewRevealState) -> some View {
        if self.reviewScreen.isAnswerVisible {
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
            } else if !(self.reviewScreen.isAnswerVisible && self.dynamicTypeSize.isAccessibilitySize),
                      let currentCard {
                reviewBottomBarContainer {
                    reviewBottomBar(card: currentCard, preparedRevealState: self.displayedRevealState(card: currentCard))
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
            librarySurface: self.navigation.visibleLibraryAnalyticsSurface,
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
            .frame(minWidth: self.showsFilterInReviewColumn ? appMinimumTouchTarget : nil, minHeight: self.showsFilterInReviewColumn ? appMinimumTouchTarget : nil)
            .contentShape(Rectangle())
        }
        .disabled(badgeState.isInteractive == false)
        .labelStyle(.titleAndIcon)
        .accessibilityIdentifier(UITestIdentifier.reviewProgressBadge)
        .accessibilityLabel(formatReviewProgressBadgeAccessibilityLabel(badgeState: badgeState))
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
            .frame(minWidth: self.showsFilterInReviewColumn ? appMinimumTouchTarget : nil, minHeight: self.showsFilterInReviewColumn ? appMinimumTouchTarget : nil)
            .contentShape(Rectangle())
        }
        .labelStyle(.titleAndIcon)
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
        guard AutomationRun.current.isUITestLaunch else { return "" }
        let rankValue = badgeState.rank.map { rank in
            "\(rank)"
        } ?? "nil"
        let windowKeyValue = badgeState.windowKey?.rawValue ?? "nil"
        return [
            "rank=\(rankValue)",
            "windowKey=\(windowKeyValue)"
        ].joined(separator: ";")
    }

    private func reviewProgressBadgeAccessibilityValue(badgeState: ReviewProgressBadgeState) -> String {
        guard AutomationRun.current.isUITestLaunch else { return "" }
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
                #if targetEnvironment(macCatalyst)
                .padding(.bottom, 32)
                #else
                .padding(.bottom, self.usesPairedReviewSpacing ? 4 : reviewBottomBarBottomPadding)
                #endif
        }
    }

    private func openReviewTextSelection(card: Card, side: ReviewCardSurfaceStyle) {
        guard self.currentCard?.cardId == card.cardId else { return }
        guard side == .front || self.reviewScreen.isAnswerVisible else { return }
        let sourceText = side == .front ? card.frontText : card.backText
        self.textSelection = ReviewCardTextSelection(
            id: UUID(),
            cardId: card.cardId,
            title: side == .front
                ? String(localized: "Front", table: reviewCardsStringsTableName)
                : String(localized: "Back", table: reviewCardsStringsTableName),
            text: Result { try reviewCardSideCopyText(sourceText: sourceText) }
        )
    }

    var canPresentSavedReviewPrompt: Bool {
        self.isReviewScreenVisible
            && self.navigation.selectedTab == .review
            && self.scenePhase == .active
            && self.isEditorPresented == false
            && self.textSelection == nil
            && self.isQueuePreviewPresented == false
            && self.reviewFilterEditSession.isPresented == false
            && self.reviewTagFilterRequest == nil
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

    private var canUseReviewKeyboardShortcuts: Bool {
        #if !targetEnvironment(macCatalyst)
        guard self.store.pendingReviewCardIds.isEmpty else { return false }
        #endif
        return UIDevice.current.userInterfaceIdiom == .pad
            && self.navigation.selectedTab == .review
            && self.scenePhase == .active
            && self.isEditorPresented == false
            && self.textSelection == nil
            && self.isQueuePreviewPresented == false
            && self.reviewFilterEditSession.isPresented == false
            && self.reviewTagFilterRequest == nil
            && self.shouldShowReviewLoader == false
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
            && self.navigation.reviewKeyboardBlockingPresentationIDs.isEmpty
    }

    private var reviewKeyboardActions: ReviewKeyboardActions? {
        guard self.canUseReviewKeyboardShortcuts, self.isTextInputEditing == false else {
            return nil
        }
        guard let card = self.currentCard else {
            return ReviewKeyboardActions(
                revealAnswer: nil,
                rate: nil,
                activeSide: .front,
                isActiveSideSpeaking: false,
                toggleSpeech: nil,
                copy: nil,
                openFilter: self.keyboardOpenFilter
            )
        }
        let revealState = self.displayedRevealState(card: card)
        if self.reviewScreen.isAnswerVisible == false {
            let revealAnswer: @MainActor () -> Void = {
                self.reviewReactionPlayback.dismissActiveReviewReactions(
                    reason: "interaction", context: self.reviewReactionContext
                )
                self.revealReviewAnswer()
            }
            let toggleSpeech: (@MainActor () -> Void)? = self.keyboardToggleSpeech(
                side: .front, sourceText: card.frontText, speakableText: revealState.frontSpeakableText
            )
            let copy: @MainActor () -> Void = self.keyboardCopy(side: .front)
            return ReviewKeyboardActions(
                revealAnswer: revealAnswer,
                rate: nil,
                activeSide: .front,
                isActiveSideSpeaking: self.reviewSpeechController.activeSide == .front,
                toggleSpeech: toggleSpeech,
                copy: copy,
                openFilter: self.keyboardOpenFilter
            )
        }
        let rate: (@MainActor (ReviewRating) -> Void)? = self.keyboardRate(
            cardId: card.cardId, answerGridOptions: revealState.reviewAnswerGridOptions
        )
        let toggleSpeech: (@MainActor () -> Void)? = self.keyboardToggleSpeech(
            side: .back, sourceText: card.backText, speakableText: revealState.backSpeakableText
        )
        let copy: @MainActor () -> Void = self.keyboardCopy(side: .back)
        return ReviewKeyboardActions(
            revealAnswer: nil,
            rate: rate,
            activeSide: .back,
            isActiveSideSpeaking: self.reviewSpeechController.activeSide == .back,
            toggleSpeech: toggleSpeech,
            copy: copy,
            openFilter: self.keyboardOpenFilter
        )
    }

    /// Opens the filter as its button does; on Mac through the toolbar item, so the popover anchors there.
    private var keyboardOpenFilter: @MainActor () -> Void {
        #if targetEnvironment(macCatalyst)
        return { self.macReviewFilterOpenRequest = UUID() }
        #else
        return self.beginReviewFiltering
        #endif
    }

    /// Nil until the rating buttons are ready, matching the grid they mirror.
    private func keyboardRate(
        cardId: String,
        answerGridOptions: ReviewAnswerGridOptions?
    ) -> (@MainActor (ReviewRating) -> Void)? {
        guard answerGridOptions != nil else { return nil }
        return { rating in
            self.reviewReactionPlayback.dismissActiveReviewReactions(
                reason: "interaction", context: self.reviewReactionContext
            )
            self.rateReviewCard(cardId: cardId, rating: rating)
        }
    }

    /// Nil when the side has nothing to speak, matching the hidden speech button.
    private func keyboardToggleSpeech(
        side: ReviewSpeechSide,
        sourceText: String,
        speakableText: String
    ) -> (@MainActor () -> Void)? {
        guard speakableText.isEmpty == false else { return nil }
        return {
            self.reviewReactionPlayback.dismissActiveReviewReactions(
                reason: "interaction", context: self.reviewReactionContext
            )
            self.toggleSpeech(side: side, sourceText: sourceText)
        }
    }

    /// The side's own copy button action runs it, so the key gives the same feedback as a click.
    private func keyboardCopy(side: ReviewCardSurfaceStyle) -> @MainActor () -> Void {
        return {
            self.reviewReactionPlayback.dismissActiveReviewReactions(
                reason: "interaction", context: self.reviewReactionContext
            )
            self.reviewCardSideCopyRequest = ReviewCardSideCopyRequest(id: UUID(), side: side)
        }
    }

    private func cancelReviewCardEditor() {
        self.finishCardEditorSession()
        self.isEditorPresented = false
    }

    /**
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
        guard self.reviewScreen.isAnswerVisible == false else { return }
        self.reviewScreen.isAnswerVisible = true
        Analytics.track(.reviewCardRevealed)
    }

    private func rateReviewCard(cardId: String, rating: ReviewRating) {
        guard self.store.isReviewPending(cardId: cardId) == false else { return }
        let isReactionScheduled: Bool = self.reviewReactionPlayback.scheduleReviewReaction(
            rating: rating, context: self.reviewReactionContext
        )
        // Tap-to-next-card time; non-blocking review plans read it as their before/after number.
        FlashcardsObservability.startReviewNextCardVisibleSpan(ratedCardId: cardId, reactionPlayed: isReactionScheduled)
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
        #if targetEnvironment(macCatalyst)
        .catalystReviewShortcutHint(key: String(localized: "Space / Enter", table: reviewCardsStringsTableName))
        #else
        .reviewCardsShortcutHelp(key: String(localized: "Space", table: reviewCardsStringsTableName))
        #endif
        .anchorPreference(key: FirstReviewOnboardingAnchors.self, value: .bounds) {
            [.showAnswer: $0]
        }
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
        #if targetEnvironment(macCatalyst)
        .catalystReviewShortcutHint(key: String(option.rating.rawValue + 1))
        #else
        .reviewCardsShortcutHelp(key: String(option.rating.rawValue + 1))
        #endif
        .anchorPreference(key: FirstReviewOnboardingAnchors.self, value: .bounds) {
            [.rating(option.rating): $0]
        }
    }

    private func reviewActionErrorMessage(card: Card) -> String? {
        guard self.reviewScreen.isAnswerVisible else {
            return nil
        }

        return self.displayedRevealState(card: card).reviewAnswerOptionsErrorMessage
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
        let store = self.store
        self.reviewSpeechController.toggleSpeech(
            side: side,
            sourceText: sourceText,
            fallbackLanguageTag: fallbackLanguageTag,
            onError: { errorMessage in
                store.enqueueTransientBanner(
                    banner: makeReviewSpeechUnavailableBanner(message: errorMessage)
                )
            }
        )
    }

}

private func reviewAnswerButtonIdentifier(rating: ReviewRating) -> String {
    if rating == .good {
        return UITestIdentifier.reviewRateGoodButton
    }

    return "review.rating.\(rating.rawValue)"
}

private func reviewRenderedContentHasImages(content: ReviewRenderedContent) -> Bool {
    guard case .managedMarkdown(let managedContent) = content else {
        return false
    }

    return managedContent.blocks.contains { block in
        switch block {
        case .managedMedia(let reference):
            return reference.isImageSyntax
        case .mediaGallery:
            return true
        case .markdown, .formula:
            return false
        }
    }
}

private func reviewTagFilterAlertMessage(request: ReviewTagFilterRequest) -> String {
    if request.isRequestedTagFilterSelected {
        let localizedFormat = String(
            localized: "review.tag_filter_alert.already_selected_message",
            defaultValue: "You’re already reviewing cards tagged “%@”.",
            table: reviewCardsStringsTableName,
            comment: "Alert message after tapping the tag chip that is already the review filter. %@ is the tag."
        )
        return String(format: localizedFormat, locale: Locale.current, request.tag)
    }

    let localizedFormat = String(
        localized: "review.tag_filter_alert.change_message",
        defaultValue: "You’re reviewing “%@”. Review only cards tagged “%@” instead?",
        table: reviewCardsStringsTableName,
        comment: "Alert message asking before switching the review filter to a tapped tag. The first %@ is the current review filter, the second %@ is the tag."
    )
    return String(format: localizedFormat, locale: Locale.current, request.currentFilterTitle, request.tag)
}

#Preview {
    NavigationStack {
        ReviewView()
            .environment(FlashcardsStore())
            .environment(AppNavigationModel())
            .environment(PremiumPresenter())
            .environment(ReviewScreenModel())
    }
}

/// Tapping outside the card text clears its selection.
private struct ReviewOutsideTextTapReceiver: UIViewRepresentable {
    func makeUIView(context: Context) -> ReviewOutsideTextTapView {
        let view = ReviewOutsideTextTapView()
        view.isUserInteractionEnabled = false
        return view
    }

    func updateUIView(_ view: ReviewOutsideTextTapView, context: Context) {}

    static func dismantleUIView(_ view: ReviewOutsideTextTapView, coordinator: Void) {
        view.removeOutsideTapGesture()
    }
}

private final class ReviewOutsideTextTapView: UIView, UIGestureRecognizerDelegate {
    private lazy var outsideTap = UITapGestureRecognizer(target: self, action: #selector(self.clearTextSelection))

    override func didMoveToWindow() {
        super.didMoveToWindow()
        self.removeOutsideTapGesture()
        guard self.window != nil else { return }
        var ancestor = self.superview
        while let view = ancestor {
            if view is UIScrollView {
                self.outsideTap.cancelsTouchesInView = false
                self.outsideTap.delegate = self
                view.addGestureRecognizer(self.outsideTap)
                break
            }
            ancestor = view.superview
        }
    }

    func removeOutsideTapGesture() {
        self.outsideTap.view?.removeGestureRecognizer(self.outsideTap)
    }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        var ancestor = touch.view
        while let view = ancestor {
            if view is UITextInput || view is UIControl { return false }
            if view === gestureRecognizer.view { break }
            ancestor = view.superview
        }
        return true
    }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool {
        true
    }

    @objc private func clearTextSelection() {
        func resignSelection(in view: UIView) {
            if let selector = view as? ReviewSelectionTextView, selector.isFirstResponder {
                selector.resignFirstResponder()
            }
            for child in view.subviews { resignSelection(in: child) }
        }
        if let surface = self.outsideTap.view { resignSelection(in: surface) }
    }
}
