import SwiftUI

private func formatCardsCount(_ cardsCount: Int) -> String {
    if cardsCount == 1 {
        return aiSettingsLocalizedFormat("settings.workspace.tags.oneCard", "%d card", cardsCount)
    }

    return aiSettingsLocalizedFormat("settings.workspace.tags.multipleCards", "%d cards", cardsCount)
}

struct TagsScreen: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @Environment(AppNavigationModel.self) private var navigation: AppNavigationModel
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    @State private var tagsSummary: WorkspaceTagsSummary = WorkspaceTagsSummary(tags: [], totalCards: 0)
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
            Section {
                Text(
                    aiSettingsLocalized(
                        "settings.workspace.tags.description",
                        "Tags group cards across the workspace. Per-tag counts can overlap when one card has multiple tags."
                    )
                )
                    .foregroundStyle(.secondary)
            }

            Section(aiSettingsLocalized("settings.workspace.row.tags", "Tags")) {
                if self.isLoading {
                    Text(aiSettingsLocalized("settings.workspace.tags.loading", "Loading tags…"))
                        .foregroundStyle(.secondary)
                } else if self.tagsSummary.tags.isEmpty {
                    Text(aiSettingsLocalized("settings.workspace.tags.empty", "No tags have been used yet."))
                        .foregroundStyle(.secondary)
                } else if self.filteredTags.isEmpty {
                    ContentUnavailableView(
                        aiSettingsLocalized("settings.workspace.tags.noMatching", "No Matching Tags"),
                        systemImage: "magnifyingglass",
                        description: Text(aiSettingsLocalized("common.tryDifferentSearch", "Try a different search."))
                    )
                } else {
                    ForEach(self.filteredTags, id: \.tag) { tagSummary in
                        Button {
                            self.openReview(tag: tagSummary.tag)
                        } label: {
                            HStack(spacing: 12) {
                                Label(tagSummary.tag, systemImage: "tag")
                                    .foregroundStyle(.primary)

                                Spacer()

                                Text(formatCardsCount(tagSummary.cardsCount))
                                    .font(.subheadline.monospacedDigit())
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .buttonStyle(.plain)
                        .padding(.vertical, 4)
                        .accessibilityLabel("\(aiSettingsLocalized("settings.workspace.decks.openReview", "Open review")): \(tagSummary.tag)")
                    }
                }
            }

            Section {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text(aiSettingsLocalized("settings.workspace.tags.totalCards", "Total cards"))
                            .foregroundStyle(.secondary)

                        Spacer()

                        Text("\(tagsSummary.totalCards)")
                            .font(.headline.monospacedDigit())
                    }

                    Text(
                        aiSettingsLocalized(
                            "settings.workspace.tags.totalCardsDescription",
                            "This count is for the full workspace and does not double-count cards that share tags."
                        )
                    )
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .padding(.vertical, 4)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(aiSettingsLocalized("settings.workspace.row.tags", "Tags"))
        .searchable(
            text: self.$searchText,
            isPresented: self.$isSearchPresented,
            placement: .automatic,
            prompt: aiSettingsLocalized("settings.workspace.tags.searchPrompt", "Search tags")
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
            self.isLoading = false
            return
        }

        self.isLoading = true

        do {
            self.tagsSummary = try database.loadWorkspaceTagsSummary(workspaceId: workspaceId)
        } catch {
            self.store.presentTechnicalError(error)
        }

        self.isLoading = false
    }

    private func openReview(tag: String) {
        store.selectReviewFilter(reviewFilter: .tag(tag: tag))
        navigation.selectTab(.review)
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
            .environment(AppNavigationModel())
    }
}
