import SwiftUI

struct ReviewView: View {
    @EnvironmentObject private var store: FlashcardsStore

    @State private var isAnswerVisible: Bool = false
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
                Text("\(store.reviewQueue.count) due")
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(.secondary)
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
                    Label("Lapses \(card.lapses)", systemImage: "exclamationmark.arrow.trianglehead.counterclockwise")
                }
                .font(.caption)
                .foregroundStyle(.secondary)

                if isAnswerVisible {
                    VStack(spacing: 12) {
                        ForEach(ReviewRating.allCases) { rating in
                            Button {
                                self.submitReview(cardId: card.cardId, rating: rating)
                            } label: {
                                Label(rating.title, systemImage: rating.symbolName)
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.borderedProminent)
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

                if store.reviewQueue.count > 1 {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Queue preview")
                            .font(.headline)

                        ForEach(Array(store.reviewQueue.dropFirst().prefix(3))) { queueCard in
                            HStack {
                                Text(queueCard.frontText)
                                    .lineLimit(1)

                                Spacer()

                                Text(displayTimestamp(value: queueCard.dueAt))
                                    .foregroundStyle(.secondary)
                            }
                            .font(.subheadline)
                        }
                    }
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
                Text("Create local cards first. Review will use the SQLite queue immediately.")
            } else {
                Text("All due cards are cleared for now. Come back later or create more cards.")
            }
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
}

#Preview {
    NavigationStack {
        ReviewView()
            .environmentObject(FlashcardsStore())
    }
}
