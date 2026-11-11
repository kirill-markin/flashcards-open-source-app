import SwiftUI

enum WorkspaceImportFormat: Hashable, CaseIterable, Sendable {
    case nibomo
    case anki
    case spreadsheet

    var localizedFormatName: String {
        switch self {
        case .nibomo: aiSettingsLocalized("settings.workspace.import.format.nibomo", "Nibomo format")
        case .anki: aiSettingsLocalized("settings.workspace.import.format.anki", "Anki format")
        case .spreadsheet: aiSettingsLocalized("settings.workspace.import.format.spreadsheet", "Spreadsheet")
        }
    }

    var localizedTitle: String {
        switch self {
        case .nibomo: aiSettingsLocalized("settings.workspace.import.method.nibomo", "Import from Nibomo")
        case .anki: aiSettingsLocalized("settings.workspace.import.method.anki", "Import from Anki")
        case .spreadsheet: aiSettingsLocalized("settings.workspace.import.method.spreadsheet", "Import from a spreadsheet")
        }
    }
}

struct LibraryImportScreen: View {
    var body: some View {
        List {
            NavigationLink(value: LibraryNavigationDestination.importFormat(.nibomo)) {
                LabeledContent(WorkspaceImportFormat.nibomo.localizedTitle, value: ".zip")
            }
            .accessibilityIdentifier(UITestIdentifier.libraryNibomoImportRow)

            NavigationLink(value: LibraryNavigationDestination.importFormat(.anki)) {
                LabeledContent(WorkspaceImportFormat.anki.localizedTitle, value: ".apkg")
            }
            .accessibilityIdentifier(UITestIdentifier.libraryAnkiImportRow)

            NavigationLink(WorkspaceImportFormat.spreadsheet.localizedTitle, value: LibraryNavigationDestination.importFormat(.spreadsheet))
                .accessibilityIdentifier(UITestIdentifier.librarySpreadsheetImportRow)
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
