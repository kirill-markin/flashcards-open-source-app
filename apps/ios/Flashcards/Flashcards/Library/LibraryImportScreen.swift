import SwiftUI

enum WorkspaceImportFormat: Hashable, Sendable {
    case nibomo
    case aiImport(AIImportSource)
    case spreadsheet

    var localizedTitle: String {
        switch self {
        case .nibomo: aiSettingsLocalized("settings.workspace.import.method.nibomo", "Import from Nibomo")
        case .aiImport(let source): source.localizedTitle
        case .spreadsheet: aiSettingsLocalized("settings.workspace.import.method.spreadsheet", "Import from a spreadsheet")
        }
    }
}

func libraryImportOtherAppsSectionTitle() -> String {
    aiSettingsLocalized("settings.workspace.import.section.otherApps", "From another app")
}

/// The Library hub subtitle of the Import row, one line per group entry point.
func libraryImportSummary() -> String {
    [
        libraryImportOtherAppsSectionTitle(),
        aiSettingsLocalized("settings.workspace.import.format.nibomo", "Nibomo format"),
        aiSettingsLocalized("settings.workspace.import.format.spreadsheet", "Spreadsheet"),
    ].joined(separator: "\n")
}

struct LibraryImportScreen: View {
    var body: some View {
        List {
            Section(libraryImportOtherAppsSectionTitle()) {
                ForEach(AIImportSource.allCases, id: \.self) { source in
                    NavigationLink(value: LibraryNavigationDestination.importFormat(.aiImport(source))) {
                        LabeledContent(source.localizedTitle, value: source.formatsText)
                    }
                    .accessibilityIdentifier(source.rowAccessibilityIdentifier)
                }
            }

            Section(aiSettingsLocalized("settings.workspace.import.section.yourFiles", "Your files")) {
                NavigationLink(value: LibraryNavigationDestination.importFormat(.nibomo)) {
                    LabeledContent(WorkspaceImportFormat.nibomo.localizedTitle, value: ".zip")
                }
                .accessibilityIdentifier(UITestIdentifier.libraryNibomoImportRow)

                NavigationLink(WorkspaceImportFormat.spreadsheet.localizedTitle, value: LibraryNavigationDestination.importFormat(.spreadsheet))
                    .accessibilityIdentifier(UITestIdentifier.librarySpreadsheetImportRow)
            }
        }
        .listStyle(.insetGrouped)
        .nativeNavigationTitle(LibrarySection.importData.localizedTitle)
        #if !targetEnvironment(macCatalyst)
        .toolbar {
            AICompanionToolbarItem()
        }
        #endif
    }
}
