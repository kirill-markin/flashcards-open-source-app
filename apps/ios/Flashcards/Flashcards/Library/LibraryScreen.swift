import SwiftUI

private let libraryStringsTableName: String = "Foundation"

/// The Library tab's root: every workspace content screen, pushed on the Library stack.
struct LibraryScreen: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore

    /// Nil until the tags summary has loaded once.
    @State private var tagsCount: Int? = nil

    private var tagsSourceKey: String {
        "\(self.store.workspace?.workspaceId ?? "")|\(self.store.localReadVersion)"
    }

    var body: some View {
        List {
            Section(String(localized: "library.section.your_cards", table: libraryStringsTableName)) {
                NavigationLink(value: LibraryNavigationDestination.cards) {
                    LibraryRow(
                        title: LibrarySection.cards.localizedTitle,
                        subtitle: nil,
                        systemImage: LibrarySection.cards.systemImage,
                        count: self.store.cards.count
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.libraryCardsRow)

                NavigationLink(value: LibraryNavigationDestination.tags) {
                    LibraryRow(
                        title: LibrarySection.tags.localizedTitle,
                        subtitle: nil,
                        systemImage: LibrarySection.tags.systemImage,
                        count: self.tagsCount
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.libraryTagsRow)

                NavigationLink(value: LibraryNavigationDestination.decks) {
                    LibraryRow(
                        title: LibrarySection.decks.localizedTitle,
                        subtitle: nil,
                        systemImage: LibrarySection.decks.systemImage,
                        count: self.store.decks.count
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.libraryDecksRow)
            }

            Section(String(localized: "library.section.add_cards", table: libraryStringsTableName)) {
                NavigationLink(value: LibraryNavigationDestination.deckCatalog) {
                    LibraryRow(
                        title: LibrarySection.deckCatalog.localizedTitle,
                        subtitle: String(localized: "library.row.deck_catalog.subtitle", table: libraryStringsTableName),
                        systemImage: LibrarySection.deckCatalog.systemImage,
                        count: nil
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.libraryDeckCatalogRow)

                NavigationLink(value: LibraryNavigationDestination.importData) {
                    LibraryRow(
                        title: LibrarySection.importData.localizedTitle,
                        subtitle: String(localized: "library.row.import.subtitle", table: libraryStringsTableName),
                        systemImage: LibrarySection.importData.systemImage,
                        count: nil
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.libraryImportRow)
            }

            Section(String(localized: "library.section.transfer", table: libraryStringsTableName)) {
                NavigationLink(value: LibraryNavigationDestination.exportData) {
                    LibraryRow(
                        title: LibrarySection.exportData.localizedTitle,
                        subtitle: nil,
                        systemImage: LibrarySection.exportData.systemImage,
                        count: nil
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.libraryExportRow)
            }
        }
        .listStyle(.insetGrouped)
        .accessibilityIdentifier(UITestIdentifier.libraryScreen)
        .nativeNavigationTitle(AppTab.library.localizedTitle)
        #if !targetEnvironment(macCatalyst)
        .toolbar {
            AICompanionToolbarItem()
        }
        #endif
        .task(id: self.tagsSourceKey) {
            await self.reloadTagsCount()
        }
    }

    /// The same source as the Tags screen, so the count matches its rows.
    @MainActor
    private func reloadTagsCount() async {
        guard let database = self.store.database, let workspaceId = self.store.workspace?.workspaceId else {
            self.tagsCount = 0
            return
        }

        do {
            self.tagsCount = try database.loadWorkspaceTagsSummary(workspaceId: workspaceId).tags.count
        } catch {
            self.store.presentTechnicalError(error)
        }
    }
}

private struct LibraryRow: View {
    let title: String
    let subtitle: String?
    let systemImage: String
    let count: Int?

    var body: some View {
        LabeledContent {
            if let count = self.count {
                Text(count.formatted())
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
        } label: {
            Label {
                VStack(alignment: .leading, spacing: 2) {
                    Text(self.title)
                        .foregroundStyle(Color.primary)
                    if let subtitle = self.subtitle {
                        Text(subtitle)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
            } icon: {
                Image(systemName: self.systemImage)
            }
        }
    }
}

#Preview {
    NavigationStack {
        LibraryScreen()
            .environment(FlashcardsStore())
            .environment(AppNavigationModel())
    }
}
