import SwiftUI

struct LibraryExportScreen: View {
    var body: some View {
        List {
            NavigationLink(value: LibraryNavigationDestination.exportFormat(.nibomo)) {
                LabeledContent(WorkspacePackageExportFormat.nibomo.localizedTitle, value: ".zip")
            }
            .accessibilityIdentifier(UITestIdentifier.libraryNibomoExportRow)

            NavigationLink(value: LibraryNavigationDestination.exportFormat(.anki)) {
                LabeledContent(WorkspacePackageExportFormat.anki.localizedTitle, value: ".apkg")
            }
            .accessibilityIdentifier(UITestIdentifier.libraryAnkiExportRow)
        }
        .listStyle(.insetGrouped)
        .nativeNavigationTitle(LibrarySection.exportData.localizedTitle)
        #if !targetEnvironment(macCatalyst)
        .toolbar {
            AICompanionToolbarItem()
        }
        #endif
    }
}
