import SwiftUI

private let reviewBottomBarHorizontalPadding: CGFloat = 20
private let reviewBottomBarTopPadding: CGFloat = 8
private let reviewBottomBarBottomPadding: CGFloat = 8
private let reviewBottomBarButtonSpacing: CGFloat = 10
private let reviewAnswerButtonMinHeight: CGFloat = 40
private let showAnswerButtonMinHeight: CGFloat = 56
let emptyBackTextPlaceholder: String = "No back text"
private let reviewQueuePreviewPageSize: Int = 50
let reviewOverlayBannerDismissDelayNanoseconds: UInt64 = 3_000_000_000

struct ReviewView: View {
    @Environment(FlashcardsStore.self) var store: FlashcardsStore
    @Environment(AppNavigationModel.self) private var navigation: AppNavigationModel

    @State var isAnswerVisible: Bool = false
    @State var preparedRevealState: PreparedReviewRevealState? = nil
    // Keep the next review card warm so the next front can appear immediately after rating.
    @State var preparedNextRevealState: PreparedReviewRevealState? = nil
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
            return allCardsDeckLabel
        case .deck(let deckId):
            return self.reviewDeckSummaries.first(where: { deckSummary in
                deckSummary.deckId == deckId
            })?.name ?? allCardsDeckLabel
        case .tag(let tag):
            return tag
        }
    }

    private func reviewFilterMenuItemLabel(reviewFilter: ReviewFilter) -> String {
        switch reviewFilter {
        case .allCards:
            return allCardsDeckLabel
        case .deck(let deckId):
            return self.reviewDeckSummaries.first(where: { deckSummary in
                deckSummary.deckId == deckId
            })?.name ?? allCardsDeckLabel
        case .tag(let tag):
            guard let tagSummary = reviewTagSummaries.first(where: { summary in
                summary.tag == tag
            }) else {
                return tag
            }

            return "\(tagSummary.tag) (\(tagSummary.cardsCount))"
        }
    }

    private var currentCard: Card? {
        currentReviewCard(reviewQueue: store.effectiveReviewQueue)
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
        Group {
            if self.shouldShowReviewLoader {
                reviewLoadingView
            } else if let currentCard, let preparedRevealState = self.cachedPreparedCurrentRevealState {
                activeCardView(card: currentCard, preparedRevealState: preparedRevealState)
            } else {
                emptyStateView
            }
        }
        .navigationTitle("Review")
        .onChange(of: currentCard?.cardId) { _, _ in
            isAnswerVisible = false
        }
        .task(id: preparedRevealStatesTaskId) {
            await self.refreshPreparedRevealStates(reviewQueue: store.effectiveReviewQueue)
        }
        .task(id: store.localReadVersion) {
            await self.reloadReviewMetadata()
        }
        .task(id: store.reviewOverlayBanner?.id) {
            await self.autoDismissReviewOverlayBanner()
        }
        .safeAreaBar(edge: .bottom, spacing: 0) {
            reviewBottomAccessory
        }
        .overlay(alignment: .top) {
            if let reviewOverlayBanner = store.reviewOverlayBanner {
                ReviewOverlayBannerView(
                    banner: reviewOverlayBanner,
                    onDismiss: {
                        self.dismissReviewOverlayBanner()
                    }
                )
                .padding(.top, 12)
                .padding(.horizontal, 16)
                .transition(.move(edge: .top).combined(with: .opacity))
                .zIndex(1)
            }
        }
        .animation(.spring(response: 0.36, dampingFraction: 0.88), value: store.reviewOverlayBanner?.id)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                reviewFilterMenu
            }

            ToolbarItem(placement: .topBarTrailing) {
                if store.isReviewCountsLoading {
                    ProgressView()
                        .controlSize(.small)
                        .accessibilityLabel("Loading review queue")
                } else {
                    Button {
                        self.isQueuePreviewPresented = true
                    } label: {
                        Text("\(store.displayedReviewDueCount) / \(store.reviewTotalCount)")
                            .font(.subheadline.monospacedDigit())
                            .padding(.horizontal, 6)
                            .foregroundStyle(.secondary)
                    }
                    .disabled(store.reviewTotalCount == 0)
                    .accessibilityLabel("Review queue \(store.displayedReviewDueCount) active of \(store.reviewTotalCount) total")
                }
            }
        }
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
                    title: "Edit card",
                    isEditing: true,
                    errorMessage: screenErrorMessage,
                    availableTagSuggestions: self.availableTagSuggestions,
                    formState: self.$cardFormState,
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
            "Review wasn't saved",
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
            Button("OK", role: .cancel) {
                store.dismissReviewSubmissionFailure()
            }
        } message: {
            Text(store.reviewSubmissionFailure?.message ?? "")
        }
    }

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
                Label("Edit decks", systemImage: "square.stack.3d.up")
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
                Image(systemName: "chevron.down")
                    .font(.caption.weight(.semibold))
            }
        }
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
                    Label(card.effortLevel.title, systemImage: "timer")
                    Label(card.tags.isEmpty ? "No tags" : formatTags(tags: card.tags), systemImage: "tag")
                }

                Spacer(minLength: 12)

                Button {
                    self.beginEditing(card: card)
                } label: {
                    Image(systemName: "pencil.circle.fill")
                        .font(.title3)
                }
                .accessibilityLabel("Edit card")
            }
            .font(.subheadline)
            .foregroundStyle(.secondary)

            ReviewCardSideView(
                label: "Front",
                content: preparedRevealState.frontContent,
                surfaceStyle: .front
            )

            if isAnswerVisible {
                ReviewCardSideView(
                    label: "Back",
                    content: preparedRevealState.backContent,
                    surfaceStyle: .back
                )
            }

            HStack(spacing: 12) {
                Label("Due \(formatOptionalIsoTimestampForDisplay(value: card.dueAt))", systemImage: "clock")
                Label("Reps \(card.reps)", systemImage: "arrow.clockwise")
                Label("Lapses \(card.lapses)", systemImage: "exclamationmark.circle")
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
            Label("Show answer", systemImage: "eye")
                .frame(maxWidth: .infinity)
                .frame(minHeight: showAnswerButtonMinHeight)
        }
        .buttonStyle(.glassProminent)
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
            self.submitReview(cardId: cardId, rating: option.rating)
        } label: {
            VStack(alignment: .center, spacing: 4) {
                HStack(spacing: 8) {
                    Image(systemName: option.rating.symbolName)
                        .font(.headline)

                    Text(option.rating.title)
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
                Label("No Cards Yet", systemImage: "tray")
            } else {
                Label("Nothing Due", systemImage: "checkmark.circle")
            }
        } description: {
            if self.totalCardsCount == 0 {
                Text("You haven't created any cards yet. Add your first card to start studying.")
            } else {
                Text("You're all caught up for now. Come back later or add more cards.")
            }
        } actions: {
            VStack(spacing: 8) {
                Button {
                    navigation.openCardCreation()
                } label: {
                    Label("Create card", systemImage: "plus")
                }
                .buttonStyle(.glassProminent)

                Text("or")
                    .font(.footnote)
                    .foregroundStyle(.secondary)

                Button {
                    navigation.openAICardCreation()
                } label: {
                    Label("Create with AI", systemImage: "sparkles")
                }
                .buttonStyle(.glass)

                if shouldShowSwitchToAllCardsAction {
                    Text("or")
                        .font(.footnote)
                        .foregroundStyle(.secondary)

                    Button {
                        store.selectReviewFilter(reviewFilter: .allCards)
                    } label: {
                        Text("switch to all cards deck")
                    }
                    .buttonStyle(.glass)
                }
            }
        }
    }

}

#Preview {
    NavigationStack {
        ReviewView()
            .environment(FlashcardsStore())
            .environment(AppNavigationModel())
    }
}
