import SwiftUI

private let libraryStringsTableName: String = "Foundation"

/// The Library tab's root: every workspace content screen, pushed on the Library stack.
struct LibraryScreen: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore

    let tagsCount: Int?

    var body: some View {
        List {
            Section(String(localized: "library.section.your_cards", table: libraryStringsTableName)) {
                NavigationLink(value: LibraryNavigationDestination.cards) {
                    LibraryRow(
                        title: LibrarySection.cards.localizedTitle,
                        subtitle: LibrarySection.cards.localizedWorkspaceSubtitle,
                        systemImage: LibrarySection.cards.systemImage,
                        count: self.store.cards.count
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.libraryCardsRow)

                NavigationLink(value: LibraryNavigationDestination.tags) {
                    LibraryRow(
                        title: LibrarySection.tags.localizedTitle,
                        subtitle: LibrarySection.tags.localizedWorkspaceSubtitle,
                        systemImage: LibrarySection.tags.systemImage,
                        count: self.tagsCount
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.libraryTagsRow)

                NavigationLink(value: LibraryNavigationDestination.decks) {
                    LibraryRow(
                        title: LibrarySection.decks.localizedTitle,
                        subtitle: LibrarySection.decks.localizedWorkspaceSubtitle,
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
                        subtitle: WorkspaceImportFormat.allCases.map(\.localizedFormatName).joined(separator: "\n"),
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
    }
}

private struct LibraryRow: View {
    let title: String
    let subtitle: String?
    let systemImage: String
    let count: Int?

    var body: some View {
        HStack {
            LibraryRowLabel(title: self.title, subtitle: self.subtitle, systemImage: self.systemImage)
                .frame(maxWidth: .infinity, alignment: .leading)

            if let count = self.count {
                Text(count.formatted())
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: true, vertical: false)
            }
        }
    }
}

struct LibraryRowLabel: View {
    let title: String
    let subtitle: String?
    let systemImage: String

    private var titleText: some View {
        Text(self.title)
        #if !targetEnvironment(macCatalyst)
            .foregroundStyle(Color.primary)
        #endif
    }

    var body: some View {
        Label {
            if let subtitle = self.subtitle {
                VStack(alignment: .leading, spacing: 2) {
                    self.titleText
                    Text(subtitle)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(nil)
                        .fixedSize(horizontal: false, vertical: true)
                }
            } else {
                self.titleText
            }
        } icon: {
            Image(systemName: self.systemImage)
        }
    }
}

extension LibrarySection {
    var localizedWorkspaceSubtitle: String? {
        switch self {
        case .cards: String(localized: "library.row.cards.subtitle", table: libraryStringsTableName)
        case .tags: String(localized: "library.row.tags.subtitle", table: libraryStringsTableName)
        case .decks: String(localized: "library.row.decks.subtitle", table: libraryStringsTableName)
        case .deckCatalog, .importData, .exportData: nil
        }
    }
}

#Preview {
    NavigationStack {
        LibraryScreen(tagsCount: nil)
            .environment(FlashcardsStore())
            .environment(AppNavigationModel())
    }
}
