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
            Section {
                NavigationLink(value: LibraryNavigationDestination.cards) {
                    LibraryRow(
                        title: String(localized: "Cards", table: "ReviewCards"),
                        subtitle: String(localized: "library.row.cards.subtitle", table: libraryStringsTableName),
                        systemImage: "rectangle.stack",
                        count: self.store.cards.count
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.libraryCardsRow)

                NavigationLink(value: LibraryNavigationDestination.tags) {
                    LibraryRow(
                        title: aiSettingsLocalized("settings.workspace.row.tags", "Tags"),
                        subtitle: String(localized: "library.row.tags.subtitle", table: libraryStringsTableName),
                        systemImage: "tag",
                        count: self.tagsCount
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.libraryTagsRow)

                NavigationLink(value: LibraryNavigationDestination.decks) {
                    LibraryRow(
                        title: aiSettingsLocalized("settings.workspace.row.decks", "Decks"),
                        subtitle: String(localized: "library.row.decks.subtitle", table: libraryStringsTableName),
                        systemImage: "square.stack.3d.up",
                        count: self.store.decks.count
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.libraryDecksRow)
            }

            Section(String(localized: "library.section.import_export", table: libraryStringsTableName)) {
                NavigationLink(value: LibraryNavigationDestination.importData) {
                    LibraryRow(
                        title: aiSettingsLocalized("settings.workspace.import.title", "Import"),
                        subtitle: String(localized: "library.row.import.subtitle", table: libraryStringsTableName),
                        systemImage: "square.and.arrow.down",
                        count: nil
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.libraryImportRow)

                NavigationLink(value: LibraryNavigationDestination.exportData) {
                    LibraryRow(
                        title: aiSettingsLocalized("settings.workspace.row.export", "Export"),
                        subtitle: String(localized: "library.row.export.subtitle", table: libraryStringsTableName),
                        systemImage: "square.and.arrow.up",
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
    let subtitle: String
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
                    Text(self.subtitle)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
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
