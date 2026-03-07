import SwiftUI

struct HomeView: View {
    let decks: [DeckSummary]
    let reviewCards: [ReviewCard]
    let startReview: () -> Void

    private var snapshot: HomeSnapshot {
        makeHomeSnapshot(decks: decks, reviewCards: reviewCards)
    }

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 16) {
                    Text("Ready for a short review")
                        .font(.headline)

                    Text("\(snapshot.dueCount) cards are due today across \(snapshot.deckCount) decks.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)

                    Button(action: startReview) {
                        Label("Start review", systemImage: "play.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                }
                .padding(.vertical, 8)
            }

            Section("Today") {
                SummaryRow(
                    title: "Due now",
                    value: "\(snapshot.dueCount)",
                    symbolName: "clock.badge.checkmark"
                )

                SummaryRow(
                    title: "New cards",
                    value: "\(snapshot.newCount)",
                    symbolName: "plus.circle"
                )

                SummaryRow(
                    title: "Sample review queue",
                    value: "\(snapshot.reviewCount)",
                    symbolName: "tray.full"
                )
            }

            Section("Decks") {
                ForEach(decks) { deck in
                    DeckRow(deck: deck)
                }
            }

            Section("Offline-first") {
                Label("Local data can stay the source of truth from day one.", systemImage: "iphone")
                Label("The backend sync layer can be added on top later.", systemImage: "arrow.trianglehead.2.clockwise")
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Home")
    }
}

private struct SummaryRow: View {
    let title: String
    let value: String
    let symbolName: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: symbolName)
                .font(.title3)
                .foregroundStyle(.tint)
                .frame(width: 28)

            Text(title)

            Spacer()

            Text(value)
                .font(.headline)
        }
        .padding(.vertical, 4)
    }
}

private struct DeckRow: View {
    let deck: DeckSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(deck.title)
                    .font(.headline)

                Spacer()

                Text("\(deck.dueCount) due")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            Text(deck.description)
                .font(.subheadline)
                .foregroundStyle(.secondary)

            HStack(spacing: 12) {
                Label("\(deck.newCount) new", systemImage: "plus.circle")
                Label("\(deck.dueCount) review", systemImage: "clock")
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }
}

#Preview {
    NavigationStack {
        HomeView(
            decks: sampleDecks(),
            reviewCards: sampleReviewCards(),
            startReview: {}
        )
    }
}
