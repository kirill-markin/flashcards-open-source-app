import SwiftUI

struct WorkspaceExportView: View {
    var body: some View {
        List {
            WorkspacePackageExportSection()
        }
        .listStyle(.insetGrouped)
        .navigationTitle(aiSettingsLocalized("settings.workspace.row.export", "Export"))
    }
}

#Preview {
    NavigationStack {
        WorkspaceExportView()
            .environment(FlashcardsStore())
    }
}
