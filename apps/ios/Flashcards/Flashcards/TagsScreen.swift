import SwiftUI

private func formatCardsCount(_ cardsCount: Int) -> String {
    "\(cardsCount) " + (cardsCount == 1 ? "card" : "cards")
}

struct TagsScreen: View {
    @EnvironmentObject private var store: FlashcardsStore
    @State private var tagsSummary: WorkspaceTagsSummary = WorkspaceTagsSummary(tags: [], totalCards: 0)
    @State private var errorMessage: String = ""
    @State private var isLoading: Bool = true

    var body: some View {
        List {
            if self.errorMessage.isEmpty == false {
                Section {
                    Text(self.errorMessage)
                        .foregroundStyle(.red)
                }
            }

            Section {
                Text("Tags group cards across the workspace. Per-tag counts can overlap when one card has multiple tags.")
                    .foregroundStyle(.secondary)
            }

            Section("Tags") {
                if self.isLoading {
                    Text("Loading tags…")
                        .foregroundStyle(.secondary)
                } else if tagsSummary.tags.isEmpty {
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
        .task(id: store.localReadVersion) {
            await self.reloadTagsSummary()
        }
    }

    @MainActor
    private func reloadTagsSummary() async {
        guard let database = store.database, let workspaceId = store.workspace?.workspaceId else {
            self.tagsSummary = WorkspaceTagsSummary(tags: [], totalCards: 0)
            self.errorMessage = ""
            self.isLoading = false
            return
        }

        self.isLoading = true
        self.errorMessage = ""

        do {
            self.tagsSummary = try database.loadWorkspaceTagsSummary(workspaceId: workspaceId)
        } catch {
            self.errorMessage = localizedMessage(error: error)
        }

        self.isLoading = false
    }
}

#Preview {
    NavigationStack {
        TagsScreen()
            .environmentObject(FlashcardsStore())
    }
}
