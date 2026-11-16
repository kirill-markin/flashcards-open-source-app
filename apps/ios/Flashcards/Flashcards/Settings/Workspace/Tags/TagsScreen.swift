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
    @Environment(SettingsScrollModel.self) private var settingsScroll: SettingsScrollModel

    @FocusState private var isSearchFocused: Bool
    @State private var loadedWorkspaceId: String?
    @State private var tagsSummary: WorkspaceTagsSummary = WorkspaceTagsSummary(tags: [], totalCards: 0)
    @State private var isLoading: Bool = true
    @State private var searchText: String = ""

    private var filteredTags: [WorkspaceTagSummary] {
        workspaceTagSummariesMatchingSearchText(
            tagSummaries: self.tagsSummary.tags,
            searchText: self.searchText
        )
    }

    private var descriptionText: Text {
        Text(
            aiSettingsLocalized(
                "settings.workspace.tags.description",
                "Tags group cards across the workspace. Per-tag counts can overlap when one card has multiple tags."
            )
        )
    }

    var body: some View {
        ScrollViewReader { scrollProxy in
            List {
                Section {
                    #if targetEnvironment(macCatalyst)
                    self.descriptionText.foregroundStyle(.secondary)
                    #else
                    NativeSearchRow(text: self.$searchText, isFocused: self.$isSearchFocused, prompt: aiSettingsLocalized("settings.workspace.tags.searchPrompt", "Search tags"))
                    #endif
                } footer: {
                    #if !targetEnvironment(macCatalyst)
                    self.descriptionText
                    #endif
                }

                Section(aiSettingsLocalized("settings.workspace.row.tags", "Tags")) {
                    if self.isLoading || self.loadedWorkspaceId != self.store.workspace?.workspaceId {
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
                    } else if let workspaceId = self.loadedWorkspaceId {
                        ForEach(self.filteredTags, id: \.tag) { tagSummary in
                            NavigationLink(value: LibraryNavigationDestination.tagDetail(tag: tagSummary.tag, workspaceId: workspaceId)) {
                                HStack(spacing: 12) {
                                    Label(tagSummary.tag, systemImage: "tag")
                                        .foregroundStyle(.primary)

                                    Spacer()

                                    Text(formatCardsCount(tagSummary.cardsCount))
                                        .font(.subheadline.monospacedDigit())
                                        .foregroundStyle(.secondary)
                                }
                                #if targetEnvironment(macCatalyst)
                                .frame(minHeight: appMinimumTouchTarget)
                                #endif
                                .contentShape(Rectangle())
                            }
                            .padding(.vertical, 4)
                            .rememberedListRow(id: tagSummary.tag)
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
            .nativeSearchListMargins()
            .nativeSearchKeyboardShortcut(isFocused: self.isSearchFocused, onFocus: { self.isSearchFocused = true }, prompt: aiSettingsLocalized("settings.workspace.tags.searchPrompt", "Search tags"), scrollProxy: scrollProxy)
            .rememberedListScroll(
                topRowID: self.settingsScroll.topRowID(\.tagsTopRowID, whileOnPath: { self.navigation.isTagsOnLibraryPath }),
                isContentReady: self.isLoading == false
            )
        }
        .accessibilityIdentifier(UITestIdentifier.tagsScreen)
        .nativeNavigationTitle(aiSettingsLocalized("settings.workspace.row.tags", "Tags"))
        #if targetEnvironment(macCatalyst)
        .macToolbarContribution(MacToolbarContribution(
            tab: .library,
            role: .navigation,
            search: MacToolbarSearch(
                text: self.searchText,
                prompt: aiSettingsLocalized("settings.workspace.tags.searchPrompt", "Search tags"),
                focusRequest: nil,
                onChange: { self.searchText = $0 },
                onFocusRequestHandled: {}
            )
        ))
        #else
        .toolbar {
            AICompanionToolbarItem()
        }
        #endif
        .task(id: store.localReadVersion) {
            await self.reloadTagsSummary()
        }
        .onAppear {
            Analytics.trackScreenViewed(.tags)
        }
        .onDisappear {
            if self.navigation.isTagsOnLibraryPath == false {
                Analytics.trackScreenViewedOnDismiss(of: .tags, restoring: .library)
            }
        }
    }

    @MainActor
    private func reloadTagsSummary() async {
        guard let database = store.database, let workspaceId = store.workspace?.workspaceId else {
            self.loadedWorkspaceId = nil
            self.tagsSummary = WorkspaceTagsSummary(tags: [], totalCards: 0)
            self.isLoading = false
            return
        }

        self.isLoading = true

        do {
            self.tagsSummary = try database.loadWorkspaceTagsSummary(workspaceId: workspaceId)
            self.loadedWorkspaceId = workspaceId
        } catch {
            self.store.presentTechnicalError(error)
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
            .environment(AppNavigationModel())
            .environment(SettingsScrollModel())
    }
}
