import SwiftUI
import MarkdownUI

private let reviewBottomBarHorizontalPadding: CGFloat = 20
private let reviewBottomBarTopPadding: CGFloat = 8
private let reviewBottomBarBottomPadding: CGFloat = 8
private let reviewBottomBarButtonSpacing: CGFloat = 10
private let reviewAnswerButtonMinHeight: CGFloat = 40
private let showAnswerButtonMinHeight: CGFloat = 56
private let emptyBackTextPlaceholder: String = "No back text"
private let reviewQueuePreviewPageSize: Int = 50

struct ReviewView: View {
    @EnvironmentObject private var store: FlashcardsStore

    @State private var isAnswerVisible: Bool = false
    @State private var preparedRevealState: PreparedReviewRevealState? = nil
    // Keep the next review card warm so the next front can appear immediately after rating.
    @State private var preparedNextRevealState: PreparedReviewRevealState? = nil
    @State private var isQueuePreviewPresented: Bool = false
    @State private var isEditorPresented: Bool = false
    @State private var editingCardId: String? = nil
    @State private var cardFormState: CardFormState = CardFormState(
        frontText: "",
        backText: "",
        tags: [],
        effortLevel: .fast
    )
    @State private var screenErrorMessage: String = ""

    private var reviewTagSummaries: [WorkspaceTagSummary] {
        workspaceTagsSummary(cards: store.cards).tags
    }

    private func reviewFilterMenuItemLabel(reviewFilter: ReviewFilter) -> String {
        switch reviewFilter {
        case .allCards, .deck:
            return reviewFilterTitle(reviewFilter: reviewFilter, decks: store.decks, cards: store.cards)
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
        .safeAreaBar(edge: .bottom, spacing: 0) {
            reviewBottomAccessory
        }
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
                    title: store.selectedReviewFilterTitle,
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
                ForEach([ReviewFilter.allCards] + store.decks.map { deck in
                    .deck(deckId: deck.deckId)
                }) { reviewFilter in
                    Text(reviewFilterMenuItemLabel(reviewFilter: reviewFilter))
                        .tag(reviewFilter)
                }
            }

            Button {
                store.openDeckManagement()
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
                Text(store.selectedReviewFilterTitle)
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
                Label("Due \(displayTimestamp(value: card.dueAt))", systemImage: "clock")
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
                reviewAnswerButton(cardId: cardId, option: options.easy)
                reviewAnswerButton(cardId: cardId, option: options.good)
            }

            VStack(spacing: reviewBottomBarButtonSpacing) {
                reviewAnswerButton(cardId: cardId, option: options.hard)
                reviewAnswerButton(cardId: cardId, option: options.again)
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

    private func beginEditing(card: Card) {
        self.editingCardId = card.cardId
        self.cardFormState = CardFormState(
            frontText: card.frontText,
            backText: card.backText,
            tags: card.tags,
            effortLevel: card.effortLevel
        )
        self.screenErrorMessage = ""
        self.isEditorPresented = true
    }

    private func saveEditedCard() {
        guard let editingCardId else {
            self.screenErrorMessage = "Card not found."
            return
        }

        do {
            try store.saveCard(
                input: CardEditorInput(
                    frontText: cardFormState.frontText.trimmingCharacters(in: .whitespacesAndNewlines),
                    backText: cardFormState.backText.trimmingCharacters(in: .whitespacesAndNewlines),
                    tags: cardFormState.tags,
                    effortLevel: cardFormState.effortLevel
                ),
                editingCardId: editingCardId
            )
            self.screenErrorMessage = ""
            self.isEditorPresented = false
        } catch {
            self.screenErrorMessage = localizedMessage(error: error)
        }
    }

    private func deleteEditingCard() {
        guard let editingCardId else {
            self.screenErrorMessage = "Card not found."
            return
        }

        do {
            try store.deleteCard(cardId: editingCardId)
            self.screenErrorMessage = ""
            self.isEditorPresented = false
            self.editingCardId = nil
        } catch {
            self.screenErrorMessage = localizedMessage(error: error)
        }
    }

    private var emptyStateView: some View {
        let shouldShowSwitchToAllCardsAction = shouldShowSwitchToAllCardsReviewAction(
            reviewFilter: store.selectedReviewFilter,
            decks: store.decks,
            cards: store.cards
        )

        return ContentUnavailableView {
            if store.cards.isEmpty {
                Label("No Cards Yet", systemImage: "tray")
            } else {
                Label("Nothing Due", systemImage: "checkmark.circle")
            }
        } description: {
            if store.cards.isEmpty {
                Text("You haven't created any cards yet. Add your first card to start studying.")
            } else {
                Text("You're all caught up for now. Come back later or add more cards.")
            }
        } actions: {
            VStack(spacing: 8) {
                Button {
                    store.openCardCreation()
                } label: {
                    Label("Create card", systemImage: "plus")
                }
                .buttonStyle(.glassProminent)

                Text("or")
                    .font(.footnote)
                    .foregroundStyle(.secondary)

                Button {
                    store.openAICardCreation()
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

    private func submitReview(cardId: String, rating: ReviewRating) {
        do {
            try store.enqueueReviewSubmission(cardId: cardId, rating: rating)
            self.screenErrorMessage = ""
        } catch {
            self.screenErrorMessage = localizedMessage(error: error)
        }
    }

    private func refreshPreparedRevealStates(reviewQueue: [Card]) async {
        let now = Date()
        let currentCard = currentReviewCard(reviewQueue: reviewQueue)
        let nextCard = nextReviewCard(reviewQueue: reviewQueue)
        if currentCard != nil || nextCard != nil {
            await Task.yield()
        }
        if Task.isCancelled {
            return
        }

        let nextPreparedRevealState = currentCard.map { card in
            makePreparedReviewRevealState(
                card: card,
                schedulerSettings: store.schedulerSettings,
                now: now
            )
        }
        let nextPreparedNextRevealState = nextCard.map { card in
            makePreparedReviewRevealState(
                card: card,
                schedulerSettings: store.schedulerSettings,
                now: now
            )
        }
        if Task.isCancelled {
            return
        }

        self.preparedRevealState = nextPreparedRevealState
        self.preparedNextRevealState = nextPreparedNextRevealState
    }

    private func cachedPreparedRevealState(card: Card) -> PreparedReviewRevealState? {
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

private struct PreparedReviewRevealState {
    let id: String
    let frontContent: ReviewRenderedContent
    let backContent: ReviewRenderedContent
    let reviewAnswerGridOptions: ReviewAnswerGridOptions?
    let reviewAnswerOptionsErrorMessage: String?
}

private func makePreparedReviewRevealStateId(
    card: Card,
    schedulerSettings: WorkspaceSchedulerSettings?
) -> String {
    let schedulerSettingsUpdatedAt = schedulerSettings?.updatedAt ?? "no-scheduler-settings"
    return "\(card.cardId)|\(card.updatedAt)|\(schedulerSettingsUpdatedAt)"
}

private func makePreparedReviewRevealStatesTaskId(
    reviewQueue: [Card],
    schedulerSettings: WorkspaceSchedulerSettings?
) -> String {
    let currentCardStateId = currentReviewCard(reviewQueue: reviewQueue).map { card in
        makePreparedReviewRevealStateId(card: card, schedulerSettings: schedulerSettings)
    } ?? "no-current-card"
    let nextCardStateId = nextReviewCard(reviewQueue: reviewQueue).map { card in
        makePreparedReviewRevealStateId(card: card, schedulerSettings: schedulerSettings)
    } ?? "no-next-card"

    return "\(currentCardStateId)|\(nextCardStateId)"
}

private func makePreparedReviewRevealState(
    card: Card,
    schedulerSettings: WorkspaceSchedulerSettings?,
    now: Date
) -> PreparedReviewRevealState {
    let frontContent = makeReviewRenderedContent(text: card.frontText)
    let backText = card.backText.isEmpty ? emptyBackTextPlaceholder : card.backText
    let backContent = makeReviewRenderedContent(text: backText)

    guard let schedulerSettings else {
        return PreparedReviewRevealState(
            id: makePreparedReviewRevealStateId(card: card, schedulerSettings: nil),
            frontContent: frontContent,
            backContent: backContent,
            reviewAnswerGridOptions: nil,
            reviewAnswerOptionsErrorMessage: "Scheduler settings are unavailable"
        )
    }

    do {
        let options = try makeReviewAnswerOptions(card: card, schedulerSettings: schedulerSettings, now: now)
        return PreparedReviewRevealState(
            id: makePreparedReviewRevealStateId(card: card, schedulerSettings: schedulerSettings),
            frontContent: frontContent,
            backContent: backContent,
            reviewAnswerGridOptions: try ReviewAnswerGridOptions(options: options),
            reviewAnswerOptionsErrorMessage: nil
        )
    } catch {
        return PreparedReviewRevealState(
            id: makePreparedReviewRevealStateId(card: card, schedulerSettings: schedulerSettings),
            frontContent: frontContent,
            backContent: backContent,
            reviewAnswerGridOptions: nil,
            reviewAnswerOptionsErrorMessage: localizedMessage(error: error)
        )
    }
}

private struct ReviewAnswerGridOptions {
    let easy: ReviewAnswerOption
    let good: ReviewAnswerOption
    let hard: ReviewAnswerOption
    let again: ReviewAnswerOption

    init(options: [ReviewAnswerOption]) throws {
        guard let easyOption = options.first(where: { option in
            option.rating == .easy
        }) else {
            throw ReviewViewError.missingReviewAnswerOption(.easy)
        }
        guard let goodOption = options.first(where: { option in
            option.rating == .good
        }) else {
            throw ReviewViewError.missingReviewAnswerOption(.good)
        }
        guard let hardOption = options.first(where: { option in
            option.rating == .hard
        }) else {
            throw ReviewViewError.missingReviewAnswerOption(.hard)
        }
        guard let againOption = options.first(where: { option in
            option.rating == .again
        }) else {
            throw ReviewViewError.missingReviewAnswerOption(.again)
        }

        self.easy = easyOption
        self.good = goodOption
        self.hard = hardOption
        self.again = againOption
    }
}

private enum ReviewViewError: LocalizedError {
    case missingReviewAnswerOption(ReviewRating)

    var errorDescription: String? {
        switch self {
        case .missingReviewAnswerOption(let rating):
            return "Missing review answer option for \(rating.title)"
        }
    }
}

private enum ReviewCardSurfaceStyle {
    case front
    case back
}

@MainActor
private func makeReviewMarkdownTheme(surfaceStyle: ReviewCardSurfaceStyle) -> Theme {
    Theme.gitHub
        .text {
            ForegroundColor(reviewMarkdownTextColor(surfaceStyle: surfaceStyle))
            BackgroundColor(nil)
            FontSize(surfaceStyle == .front ? 18 : 17)
        }
        .code {
            FontFamilyVariant(.monospaced)
            FontSize(.em(0.88))
            ForegroundColor(reviewMarkdownInlineCodeTextColor(surfaceStyle: surfaceStyle))
            BackgroundColor(reviewMarkdownInlineCodeBackgroundColor(surfaceStyle: surfaceStyle))
        }
        .heading1 { configuration in
            configuration.label
                .relativeLineSpacing(.em(0.1))
                .markdownMargin(top: 0, bottom: 14)
                .markdownTextStyle {
                    FontWeight(.bold)
                    FontSize(.em(1.5))
                }
        }
        .heading2 { configuration in
            configuration.label
                .relativeLineSpacing(.em(0.1))
                .markdownMargin(top: 0, bottom: 14)
                .markdownTextStyle {
                    FontWeight(.bold)
                    FontSize(.em(1.3))
                }
        }
        .heading3 { configuration in
            configuration.label
                .relativeLineSpacing(.em(0.1))
                .markdownMargin(top: 0, bottom: 12)
                .markdownTextStyle {
                    FontWeight(.semibold)
                    FontSize(.em(1.15))
                }
        }
        .heading4 { configuration in
            configuration.label
                .markdownMargin(top: 0, bottom: 12)
                .markdownTextStyle {
                    FontWeight(.semibold)
                }
        }
        .heading5 { configuration in
            configuration.label
                .markdownMargin(top: 0, bottom: 10)
                .markdownTextStyle {
                    FontWeight(.semibold)
                    FontSize(.em(0.95))
                }
        }
        .heading6 { configuration in
            configuration.label
                .markdownMargin(top: 0, bottom: 10)
                .markdownTextStyle {
                    FontWeight(.semibold)
                    FontSize(.em(0.9))
                    ForegroundColor(reviewMarkdownSecondaryTextColor(surfaceStyle: surfaceStyle))
                }
        }
        .paragraph { configuration in
            configuration.label
                .fixedSize(horizontal: false, vertical: true)
                .relativeLineSpacing(.em(0.2))
                .markdownMargin(top: 0, bottom: 14)
        }
        .blockquote { configuration in
            HStack(alignment: .top, spacing: 12) {
                RoundedRectangle(cornerRadius: 6)
                    .fill(reviewMarkdownBorderColor(surfaceStyle: surfaceStyle))
                    .frame(width: 4)

                configuration.label
                    .fixedSize(horizontal: false, vertical: true)
                    .markdownTextStyle {
                        ForegroundColor(reviewMarkdownSecondaryTextColor(surfaceStyle: surfaceStyle))
                    }
            }
            .padding(.vertical, 2)
        }
        .codeBlock { configuration in
            ScrollView(.horizontal, showsIndicators: false) {
                configuration.label
                    .fixedSize(horizontal: false, vertical: true)
                    .relativeLineSpacing(.em(0.2))
                    .markdownTextStyle {
                        FontFamilyVariant(.monospaced)
                        FontSize(.em(0.88))
                        ForegroundColor(reviewMarkdownTextColor(surfaceStyle: surfaceStyle))
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
            }
            .background(reviewMarkdownCodeBlockBackgroundColor(surfaceStyle: surfaceStyle))
            .overlay {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(reviewMarkdownBorderColor(surfaceStyle: surfaceStyle), lineWidth: 1)
            }
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .markdownMargin(top: 0, bottom: 14)
        }
        .listItem { configuration in
            configuration.label
                .fixedSize(horizontal: false, vertical: true)
                .markdownMargin(top: .em(0.22))
        }
        .table { configuration in
            configuration.label
                .fixedSize(horizontal: false, vertical: true)
                .markdownTableBorderStyle(.init(color: reviewMarkdownBorderColor(surfaceStyle: surfaceStyle)))
                .markdownTableBackgroundStyle(
                    .alternatingRows(
                        reviewMarkdownTablePrimaryBackgroundColor(surfaceStyle: surfaceStyle),
                        reviewMarkdownTableSecondaryBackgroundColor(surfaceStyle: surfaceStyle)
                    )
                )
                .markdownMargin(top: 0, bottom: 14)
        }
        .tableCell { configuration in
            configuration.label
                .markdownTextStyle {
                    if configuration.row == 0 {
                        FontWeight(.semibold)
                    }

                    BackgroundColor(nil)
                }
                .fixedSize(horizontal: false, vertical: true)
                .padding(.vertical, 6)
                .padding(.horizontal, 10)
                .relativeLineSpacing(.em(0.2))
        }
        .thematicBreak {
            Divider()
                .overlay(reviewMarkdownBorderColor(surfaceStyle: surfaceStyle))
                .markdownMargin(top: 16, bottom: 16)
        }
}

private func reviewMarkdownTextColor(surfaceStyle: ReviewCardSurfaceStyle) -> Color {
    switch surfaceStyle {
    case .front:
        return Color.primary
    case .back:
        return Color(uiColor: .label)
    }
}

private func reviewMarkdownSecondaryTextColor(surfaceStyle: ReviewCardSurfaceStyle) -> Color {
    switch surfaceStyle {
    case .front:
        return Color.secondary
    case .back:
        return Color(uiColor: .secondaryLabel)
    }
}

private func reviewMarkdownInlineCodeTextColor(surfaceStyle: ReviewCardSurfaceStyle) -> Color {
    switch surfaceStyle {
    case .front:
        return Color.primary
    case .back:
        return Color(uiColor: .label)
    }
}

private func reviewMarkdownInlineCodeBackgroundColor(surfaceStyle: ReviewCardSurfaceStyle) -> Color {
    switch surfaceStyle {
    case .front:
        return Color.white.opacity(0.4)
    case .back:
        return Color(uiColor: .systemBackground)
    }
}

private func reviewMarkdownCodeBlockBackgroundColor(surfaceStyle: ReviewCardSurfaceStyle) -> Color {
    switch surfaceStyle {
    case .front:
        return Color.white.opacity(0.3)
    case .back:
        return Color(uiColor: .systemBackground)
    }
}

private func reviewMarkdownTablePrimaryBackgroundColor(surfaceStyle: ReviewCardSurfaceStyle) -> Color {
    switch surfaceStyle {
    case .front:
        return Color.clear
    case .back:
        return Color.primary.opacity(0.06)
    }
}

private func reviewMarkdownTableSecondaryBackgroundColor(surfaceStyle: ReviewCardSurfaceStyle) -> Color {
    switch surfaceStyle {
    case .front:
        return Color.white.opacity(0.22)
    case .back:
        return Color.primary.opacity(0.03)
    }
}

private func reviewMarkdownBorderColor(surfaceStyle: ReviewCardSurfaceStyle) -> Color {
    switch surfaceStyle {
    case .front:
        return Color.white.opacity(0.35)
    case .back:
        return Color(uiColor: .separator)
    }
}

private struct ReviewCardSideView: View {
    let label: String
    let content: ReviewRenderedContent
    let surfaceStyle: ReviewCardSurfaceStyle

    init(label: String, content: ReviewRenderedContent, surfaceStyle: ReviewCardSurfaceStyle) {
        self.label = label
        self.content = content
        self.surfaceStyle = surfaceStyle
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(label)
                .font(.caption)
                .textCase(.uppercase)
                .foregroundStyle(.secondary)

            contentView
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(24)
        .background(backgroundStyle, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    @ViewBuilder
    private var contentView: some View {
        switch content {
        case .shortPlain(let text):
            Text(text)
                .font(shortPlainFont)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity, alignment: .center)
        case .paragraphPlain(let text):
            Text(text)
                .font(.body)
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .topLeading)
        case .markdown(let markdownContent):
            ReviewMarkdownText(
                markdownContent: markdownContent,
                surfaceStyle: surfaceStyle
            )
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
    }

    private var shortPlainFont: Font {
        switch surfaceStyle {
        case .front:
            return .title2.weight(.semibold)
        case .back:
            return .title3.weight(.medium)
        }
    }

    private var backgroundStyle: AnyShapeStyle {
        switch surfaceStyle {
        case .front:
            return AnyShapeStyle(.thinMaterial)
        case .back:
            return AnyShapeStyle(.regularMaterial)
        }
    }
}

private struct ReviewMarkdownText: View {
    let markdownContent: MarkdownContent
    let surfaceStyle: ReviewCardSurfaceStyle

    var body: some View {
        Markdown(markdownContent)
            .markdownTheme(makeReviewMarkdownTheme(surfaceStyle: surfaceStyle))
            .frame(maxWidth: .infinity, alignment: .topLeading)
    }
}

private struct ReviewQueuePreviewScreen: View {
    @Environment(\.dismiss) private var dismiss

    let title: String
    let activeCount: Int
    let currentCardId: String?
    let hiddenCardIds: Set<String>
    let loadPage: (Int) async throws -> ReviewTimelinePage

    @State private var cards: [Card] = []
    @State private var hasMoreCards: Bool = true
    @State private var isInitialLoading: Bool = true
    @State private var isNextPageLoading: Bool = false
    @State private var errorMessage: String? = nil
    @State private var activeLoadRequest: ReviewQueuePreviewLoadRequest? = ReviewQueuePreviewLoadRequest(offset: 0, token: 0)
    @State private var nextLoadToken: Int = 1

    private var visibleCards: [Card] {
        self.cards.filter { card in
            self.hiddenCardIds.contains(card.cardId) == false
        }
    }

    private var previewItems: [ReviewQueuePreviewItem] {
        let cardItems = self.visibleCards.map { card in
            ReviewQueuePreviewItem.card(card)
        }

        guard self.activeCount < self.visibleCards.count else {
            return cardItems
        }

        let prefixItems = Array(cardItems.prefix(self.activeCount))
        let suffixItems = Array(cardItems.dropFirst(self.activeCount))
        return prefixItems + [.separator] + suffixItems
    }

    var body: some View {
        ScrollView {
            if self.isInitialLoading && self.visibleCards.isEmpty {
                VStack {
                    ProgressView()
                        .controlSize(.large)
                        .padding(.bottom, 12)
                    Text("Loading queue")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity)
                .padding(.top, 120)
            } else if self.previewItems.isEmpty && self.errorMessage == nil {
                ContentUnavailableView(
                    "No Matching Cards",
                    systemImage: "tray",
                    description: Text("This review filter does not include any cards yet.")
                )
                .padding(.top, 120)
            } else {
                ReadableContentLayout(
                    maxWidth: flashcardsReadableContentMaxWidth,
                    horizontalPadding: 20
                ) {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        if let errorMessage = self.errorMessage {
                            ReviewQueuePreviewErrorCard(
                                message: errorMessage,
                                onRetry: {
                                    self.retryLoad()
                                },
                                onClose: {
                                    self.dismiss()
                                }
                            )
                        }

                        ForEach(self.previewItems) { item in
                            switch item {
                            case .separator:
                                ReviewQueueSectionSeparator()
                            case .card(let card):
                                ReviewQueuePreviewCardRow(
                                    card: card,
                                    isCurrent: card.cardId == self.currentCardId
                                )
                                .onAppear {
                                    self.loadNextPageIfNeeded(itemId: item.id)
                                }
                            }
                        }

                        if self.isNextPageLoading {
                            HStack {
                                Spacer()
                                ProgressView()
                                    .controlSize(.small)
                                Spacer()
                            }
                            .padding(.vertical, 8)
                        }
                    }
                }
                .padding(.vertical, 20)
            }
        }
        .background(.thinMaterial)
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .task(id: self.activeLoadRequest) {
            await self.performActiveLoadRequest()
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Close") {
                    self.dismiss()
                }
            }
        }
    }

    private func performActiveLoadRequest() async {
        guard let activeLoadRequest = self.activeLoadRequest else {
            return
        }

        let isInitialPage = activeLoadRequest.offset == 0
        if isInitialPage {
            self.isInitialLoading = true
        } else {
            self.isNextPageLoading = true
        }

        do {
            let reviewTimelinePage = try await self.loadPage(activeLoadRequest.offset)

            if isInitialPage {
                self.cards = reviewTimelinePage.cards
            } else {
                self.cards.append(contentsOf: reviewTimelinePage.cards)
            }

            self.hasMoreCards = reviewTimelinePage.hasMoreCards
            self.errorMessage = nil
        } catch is CancellationError {
            self.isInitialLoading = false
            self.isNextPageLoading = false
            return
        } catch {
            self.errorMessage = localizedMessage(error: error)
        }

        self.isInitialLoading = false
        self.isNextPageLoading = false
        self.activeLoadRequest = nil
    }

    private func loadNextPageIfNeeded(itemId: String) {
        guard self.activeLoadRequest == nil else {
            return
        }
        guard self.errorMessage == nil else {
            return
        }
        guard self.isInitialLoading == false else {
            return
        }
        guard self.isNextPageLoading == false else {
            return
        }
        guard self.hasMoreCards else {
            return
        }
        guard let lastVisibleItemId = self.previewItems.last?.id else {
            return
        }
        guard itemId == lastVisibleItemId else {
            return
        }

        self.activeLoadRequest = ReviewQueuePreviewLoadRequest(
            offset: self.cards.count,
            token: self.nextLoadToken
        )
        self.nextLoadToken += 1
    }

    private func retryLoad() {
        self.cards = []
        self.hasMoreCards = true
        self.isInitialLoading = true
        self.isNextPageLoading = false
        self.errorMessage = nil
        self.activeLoadRequest = ReviewQueuePreviewLoadRequest(offset: 0, token: self.nextLoadToken)
        self.nextLoadToken += 1
    }
}

private struct ReviewQueuePreviewLoadRequest: Hashable {
    let offset: Int
    let token: Int
}

private enum ReviewQueuePreviewItem: Identifiable, Hashable {
    case card(Card)
    case separator

    var id: String {
        switch self {
        case .card(let card):
            return card.cardId
        case .separator:
            return "review-queue-separator"
        }
    }
}

private struct ReviewQueuePreviewErrorCard: View {
    let message: String
    let onRetry: () -> Void
    let onClose: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Queue couldn't be loaded")
                .font(.headline)

            Text(message)
                .font(.subheadline)
                .foregroundStyle(.secondary)

            HStack(spacing: 12) {
                Button("Retry") {
                    self.onRetry()
                }

                Button("Close") {
                    self.onClose()
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }
}

private struct ReviewQueuePreviewCardRow: View {
    let card: Card
    let isCurrent: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                Text(card.frontText)
                    .font(.headline)
                    .frame(maxWidth: .infinity, alignment: .leading)

                if isCurrent {
                    Text("Current")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.tint)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(
                            Capsule(style: .continuous)
                                .fill(Color.accentColor.opacity(0.14))
                        )
                }
            }

            Text(card.backText)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineLimit(2)

            HStack(spacing: 12) {
                Label(displayTimestamp(value: card.dueAt), systemImage: "clock")
                Label(card.effortLevel.title, systemImage: "timer")
                Label(card.tags.isEmpty ? "No tags" : formatTags(tags: card.tags), systemImage: "tag")
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(
                    isCurrent ? Color.accentColor.opacity(0.35) : Color.clear,
                    lineWidth: 1
                )
        }
    }
}

private struct ReviewQueueSectionSeparator: View {
    var body: some View {
        HStack(spacing: 12) {
            Rectangle()
                .fill(Color.secondary.opacity(0.35))
                .frame(height: 1)

            Text("Later")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)

            Rectangle()
                .fill(Color.secondary.opacity(0.35))
                .frame(height: 1)
        }
        .padding(.vertical, 8)
    }
}

#Preview {
    NavigationStack {
        ReviewView()
            .environmentObject(FlashcardsStore())
    }
}
