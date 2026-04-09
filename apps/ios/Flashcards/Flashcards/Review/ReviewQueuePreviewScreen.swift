import SwiftUI

private let reviewCardsStringsTableName: String = "ReviewCards"

struct ReviewQueuePreviewScreen: View {
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
                    Text(String(localized: "Loading queue", table: reviewCardsStringsTableName))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity)
                .padding(.top, 120)
            } else if self.previewItems.isEmpty && self.errorMessage == nil {
                ContentUnavailableView(
                    String(localized: "No Matching Cards", table: reviewCardsStringsTableName),
                    systemImage: "tray",
                    description: Text(String(localized: "This review filter does not include any cards yet.", table: reviewCardsStringsTableName))
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
                Button(String(localized: "Close", table: reviewCardsStringsTableName)) {
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
            self.errorMessage = Flashcards.errorMessage(error: error)
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
            Text(String(localized: "Queue couldn't be loaded", table: reviewCardsStringsTableName))
                .font(.headline)

            Text(message)
                .font(.subheadline)
                .foregroundStyle(.secondary)

            HStack(spacing: 12) {
                Button(String(localized: "Retry", table: reviewCardsStringsTableName)) {
                    self.onRetry()
                }

                Button(String(localized: "Close", table: reviewCardsStringsTableName)) {
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
                    Text(String(localized: "Current", table: reviewCardsStringsTableName))
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
                Label(localizedDueDateLabel(value: card.dueAt), systemImage: "clock")
                Label(localizedEffortTitle(effortLevel: card.effortLevel), systemImage: "timer")
                Label(card.tags.isEmpty ? localizedNoTagsLabel() : formatTags(tags: card.tags), systemImage: "tag")
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

            Text(String(localized: "Later", table: reviewCardsStringsTableName))
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)

            Rectangle()
                .fill(Color.secondary.opacity(0.35))
                .frame(height: 1)
        }
        .padding(.vertical, 8)
    }
}

private func localizedDueDateLabel(value: String?) -> String {
    guard let value else {
        return String(localized: "New", table: reviewCardsStringsTableName)
    }

    guard let date = parseIsoTimestamp(value: value) else {
        return value
    }

    return date.formatted(date: .abbreviated, time: .shortened)
}
