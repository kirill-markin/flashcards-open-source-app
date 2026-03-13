import SwiftUI

struct ThisDeviceSettingsView: View {
    var body: some View {
        List {
            Section("This Device") {
                LabeledContent("Client") {
                    Text("SwiftUI + SQLite")
                }

                Label("No login is required to create cards, save decks, or review.", systemImage: "internaldrive")
                Label("Future sync stays scoped to the current workspace only.", systemImage: "lock.shield")
                Label("The schema stays close to the backend without pulling remote data by default.", systemImage: "externaldrive.badge.checkmark")
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("This Device")
    }
}

#Preview {
    NavigationStack {
        ThisDeviceSettingsView()
    }
}
