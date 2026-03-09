import SwiftUI

struct ReviewView: View {
    @EnvironmentObject private var store: FlashcardsStore

    @State private var isAnswerVisible: Bool = false
    @State private var isQueuePreviewPresented: Bool = false
    @State private var screenErrorMessage: String = ""

    private var reviewFilterOptions: [ReviewFilter] {
        [.allCards] + store.decks.map { deck in
            .deck(deckId: deck.deckId)
        }
    }

    private var currentCard: Card? {
        store.reviewQueue.first
    }

    var body: some View {
        Group {
            if let currentCard {
                activeCardView(card: currentCard)
            } else {
                emptyStateView
            }
        }
        .navigationTitle("Review")
        .onChange(of: currentCard?.cardId) { _, _ in
            isAnswerVisible = false
        }
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                reviewFilterMenu
            }

            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    self.isQueuePreviewPresented = true
                } label: {
                    Text("\(store.reviewQueue.count) / \(store.reviewTotalCount)")
                        .font(.subheadline.monospacedDigit())
                        .padding(.horizontal, 6)
                        .foregroundStyle(.secondary)
                }
                .disabled(store.reviewTotalCount == 0)
                .accessibilityLabel("Review queue \(store.reviewQueue.count) active of \(store.reviewTotalCount) total")
            }
        }
        .fullScreenCover(isPresented: self.$isQueuePreviewPresented) {
            NavigationStack {
                ReviewQueuePreviewScreen(
                    title: store.selectedReviewFilterTitle,
                    cards: store.reviewTimeline,
                    activeCount: store.reviewQueue.count,
                    currentCardId: currentCard?.cardId
                )
            }
        }
    }

    private var reviewFilterMenu: some View {
        Menu {
            ForEach(reviewFilterOptions) { reviewFilter in
                Button {
                    store.selectReviewFilter(reviewFilter: reviewFilter)
                } label: {
                    if reviewFilter == store.selectedReviewFilter {
                        Label(
                            reviewFilterTitle(reviewFilter: reviewFilter, decks: store.decks),
                            systemImage: "checkmark"
                        )
                    } else {
                        Text(reviewFilterTitle(reviewFilter: reviewFilter, decks: store.decks))
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

    private func activeCardView(card: Card) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if screenErrorMessage.isEmpty == false {
                    Text(screenErrorMessage)
                        .foregroundStyle(.red)
                }

                HStack(spacing: 12) {
                    Label(card.effortLevel.title, systemImage: "timer")
                    Label(card.tags.isEmpty ? "No tags" : formatTags(tags: card.tags), systemImage: "tag")
                }
                .font(.subheadline)
                .foregroundStyle(.secondary)

                VStack(alignment: .leading, spacing: 16) {
                    Text("Front")
                        .font(.caption)
                        .textCase(.uppercase)
                        .foregroundStyle(.secondary)

                    Text(card.frontText)
                        .font(.title2)
                        .fontWeight(.semibold)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(24)
                .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 24, style: .continuous))

                if isAnswerVisible {
                    VStack(alignment: .leading, spacing: 16) {
                        Text("Back")
                            .font(.caption)
                            .textCase(.uppercase)
                            .foregroundStyle(.secondary)

                        Text(card.backText)
                            .font(.title3)
                            .fontWeight(.medium)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(24)
                    .background(
                        RoundedRectangle(cornerRadius: 24, style: .continuous)
                            .fill(Color(uiColor: .secondarySystemBackground))
                    )
                }

                HStack(spacing: 12) {
                    Label("Due \(displayTimestamp(value: card.dueAt))", systemImage: "clock")
                    Label("Reps \(card.reps)", systemImage: "arrow.clockwise")
                    Label("Lapses \(card.lapses)", systemImage: "exclamationmark.circle")
                }
                .font(.caption)
                .foregroundStyle(.secondary)

                if isAnswerVisible {
                    let reviewAnswerOptionsState = self.loadReviewAnswerOptions(card: card)

                    if let message = reviewAnswerOptionsState.errorMessage {
                        Text(message)
                            .foregroundStyle(.red)
                    } else {
                        VStack(spacing: 12) {
                            ForEach(reviewAnswerOptionsState.options) { option in
                                Button {
                                    self.submitReview(cardId: card.cardId, rating: option.rating)
                                } label: {
                                    HStack(spacing: 12) {
                                        Image(systemName: option.rating.symbolName)
                                            .font(.title3)

                                        VStack(alignment: .leading, spacing: 4) {
                                            Text(option.rating.title)
                                                .fontWeight(.semibold)
                                            Text(option.intervalDescription)
                                                .font(.caption)
                                                .opacity(0.8)
                                        }

                                        Spacer()
                                    }
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                }
                                .buttonStyle(.borderedProminent)
                            }
                        }
                    }
                } else {
                    Button {
                        isAnswerVisible = true
                    } label: {
                        Label("Show answer", systemImage: "eye")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
            .padding(20)
        }
    }

    private var emptyStateView: some View {
        ContentUnavailableView {
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
            Button {
                store.openCardCreation()
            } label: {
                Label("Create card", systemImage: "plus")
            }
            .buttonStyle(.borderedProminent)
        }
    }

    private func submitReview(cardId: String, rating: ReviewRating) {
        do {
            try store.submitReview(cardId: cardId, rating: rating)
            self.screenErrorMessage = ""
        } catch {
            self.screenErrorMessage = localizedMessage(error: error)
        }
    }

    private func loadReviewAnswerOptions(card: Card) -> (options: [ReviewAnswerOption], errorMessage: String?) {
        guard let schedulerSettings = store.schedulerSettings else {
            return ([], "Scheduler settings are unavailable")
        }

        do {
            return (try makeReviewAnswerOptions(card: card, schedulerSettings: schedulerSettings, now: Date()), nil)
        } catch {
            return ([], localizedMessage(error: error))
        }
    }
}

private struct ReviewQueuePreviewScreen: View {
    @Environment(\.dismiss) private var dismiss

    let title: String
    let cards: [Card]
    let activeCount: Int
    let currentCardId: String?

    private var previewItems: [ReviewQueuePreviewItem] {
        let cardItems = cards.map { card in
            ReviewQueuePreviewItem.card(card)
        }

        guard activeCount < cards.count else {
            return cardItems
        }

        let prefixItems = Array(cardItems.prefix(activeCount))
        let suffixItems = Array(cardItems.dropFirst(activeCount))
        return prefixItems + [.separator] + suffixItems
    }

    var body: some View {
        ScrollView {
            if previewItems.isEmpty {
                ContentUnavailableView(
                    "No Matching Cards",
                    systemImage: "tray",
                    description: Text("This review filter does not include any cards yet.")
                )
                .padding(.top, 120)
            } else {
                IncrementalItemsView(
                    items: previewItems,
                    initialCount: 50,
                    pageSize: 50
                ) { item in
                    switch item {
                    case .separator:
                        ReviewQueueSectionSeparator()
                    case .card(let card):
                        ReviewQueuePreviewCardRow(
                            card: card,
                            isCurrent: card.cardId == currentCardId
                        )
                    }
                }
                .padding(20)
            }
        }
        .background(Color(uiColor: .systemGroupedBackground))
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Close") {
                    self.dismiss()
                }
            }
        }
    }
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
        .background(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(Color(uiColor: .secondarySystemBackground))
        )
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

struct IncrementalItemsView<Items: RandomAccessCollection, Content: View>: View where Items.Element: Identifiable, Items.Element.ID: Hashable {
    let items: Items
    let initialCount: Int
    let pageSize: Int
    let content: (Items.Element) -> Content

    @State private var visibleCount: Int

    init(
        items: Items,
        initialCount: Int,
        pageSize: Int,
        @ViewBuilder content: @escaping (Items.Element) -> Content
    ) {
        precondition(initialCount > 0, "IncrementalItemsView initialCount must be greater than zero")
        precondition(pageSize > 0, "IncrementalItemsView pageSize must be greater than zero")

        self.items = items
        self.initialCount = initialCount
        self.pageSize = pageSize
        self.content = content
        self._visibleCount = State(
            initialValue: initialIncrementalVisibleCount(totalCount: items.count, initialCount: initialCount)
        )
    }

    private var visibleItems: [Items.Element] {
        Array(self.items.prefix(self.visibleCount))
    }

    var body: some View {
        LazyVStack(alignment: .leading, spacing: 12) {
            ForEach(self.visibleItems) { item in
                self.content(item)
                    .onAppear {
                        self.loadMoreIfNeeded(itemId: item.id)
                    }
            }
        }
        .onChange(of: self.items.count) { _, nextCount in
            let initialVisibleCount = initialIncrementalVisibleCount(
                totalCount: nextCount,
                initialCount: self.initialCount
            )

            if nextCount == 0 {
                self.visibleCount = 0
                return
            }

            self.visibleCount = min(max(self.visibleCount, initialVisibleCount), nextCount)
        }
    }

    private func loadMoreIfNeeded(itemId: Items.Element.ID) {
        guard let lastVisibleItemId = self.visibleItems.last?.id else {
            return
        }
        guard itemId == lastVisibleItemId else {
            return
        }
        guard self.visibleCount < self.items.count else {
            return
        }

        self.visibleCount = nextIncrementalVisibleCount(
            currentVisibleCount: self.visibleCount,
            totalCount: self.items.count,
            pageSize: self.pageSize
        )
    }
}

#Preview {
    NavigationStack {
        ReviewView()
            .environmentObject(FlashcardsStore())
    }
}
