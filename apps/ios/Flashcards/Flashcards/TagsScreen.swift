import SwiftUI

private func formatCardsCount(_ cardsCount: Int) -> String {
    "\(cardsCount) " + (cardsCount == 1 ? "card" : "cards")
}

struct TagsScreen: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    @State private var tagsSummary: WorkspaceTagsSummary = WorkspaceTagsSummary(tags: [], totalCards: 0)
    @State private var errorMessage: String = ""
    @State private var isLoading: Bool = true
    @State private var isSearchPresented: Bool = false
    @State private var searchText: String = ""

    private var filteredTags: [WorkspaceTagSummary] {
        workspaceTagSummariesMatchingSearchText(
            tagSummaries: self.tagsSummary.tags,
            searchText: self.searchText
        )
    }

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
                } else if self.tagsSummary.tags.isEmpty {
                    Text("No tags have been used yet.")
                        .foregroundStyle(.secondary)
                } else if self.filteredTags.isEmpty {
                    ContentUnavailableView(
                        "No Matching Tags",
                        systemImage: "magnifyingglass",
                        description: Text("Try a different search.")
                    )
                } else {
                    ForEach(self.filteredTags, id: \.tag) { tagSummary in
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
        .searchable(
            text: self.$searchText,
            isPresented: self.$isSearchPresented,
            placement: .automatic,
            prompt: "Search tags"
        )
        .searchToolbarBehavior(preferredNativeSearchToolbarBehavior(horizontalSizeClass: self.horizontalSizeClass))
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
            self.errorMessage = Flashcards.errorMessage(error: error)
        }

        self.isLoading = false
    }
}

private func workspaceTagSummariesMatchingSearchText(
    tagSummaries: [WorkspaceTagSummary],
    searchText: String
) -> [WorkspaceTagSummary] {
    let normalizedSearchText = normalizeTag(rawValue: searchText).lowercased()
    if normalizedSearchText.isEmpty {
        return tagSummaries
    }

    return tagSummaries.filter { tagSummary in
        tagSummary.tag.lowercased().contains(normalizedSearchText)
    }
}

#Preview {
    NavigationStack {
        TagsScreen()
            .environment(FlashcardsStore())
    }
}
