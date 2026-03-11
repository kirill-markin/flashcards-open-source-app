import SwiftUI

private func formatCardsCount(_ cardsCount: Int) -> String {
    "\(cardsCount) " + (cardsCount == 1 ? "card" : "cards")
}

struct TagsScreen: View {
    @EnvironmentObject private var store: FlashcardsStore

    private var tagsSummary: WorkspaceTagsSummary {
        workspaceTagsSummary(cards: store.cards)
    }

    var body: some View {
        List {
            Section {
                Text("Tags group cards across the workspace. Per-tag counts can overlap when one card has multiple tags.")
                    .foregroundStyle(.secondary)
            }

            Section("Tags") {
                if tagsSummary.tags.isEmpty {
                    Text("No tags have been used yet.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(tagsSummary.tags, id: \.tag) { tagSummary in
                        HStack(spacing: 12) {
                            Label(tagSummary.tag, systemImage: "tag")
                                .foregroundStyle(.primary)

                            Spacer()

                            Text(formatCardsCount(tagSummary.cardsCount))
                                .font(.subheadline.monospacedDigit())
                                .foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 4)
                    }
                }
            }

            Section {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("Total cards")
                            .foregroundStyle(.secondary)

                        Spacer()

                        Text("\(tagsSummary.totalCards)")
                            .font(.headline.monospacedDigit())
                    }

                    Text("This count is for the full workspace and does not double-count cards that share tags.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .padding(.vertical, 4)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Tags")
    }
}

#Preview {
    NavigationStack {
        TagsScreen()
            .environmentObject(FlashcardsStore())
    }
}
