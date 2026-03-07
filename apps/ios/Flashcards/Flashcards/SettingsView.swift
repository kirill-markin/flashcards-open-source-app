import SwiftUI

struct SettingsView: View {
    let snapshot: HomeSnapshot

    var body: some View {
        List {
            Section("App") {
                LabeledContent("Client") {
                    Text("SwiftUI")
                }

                LabeledContent("Status") {
                    Text("Naive first pass")
                }

                LabeledContent("Decks") {
                    Text("\(snapshot.deckCount)")
                }
            }

            Section("Sync") {
                Label("Local-first storage", systemImage: "internaldrive")
                Label("Cloud sync pending", systemImage: "icloud.slash")
                Text("The iOS shell is ready for SQLite and outbox sync later.")
                    .foregroundStyle(.secondary)
            }

            Section("About") {
                LabeledContent("Version") {
                    Text("0.1.0")
                }

                LabeledContent("Today") {
                    Text("\(snapshot.dueCount) due, \(snapshot.newCount) new")
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Settings")
    }
}

#Preview {
    NavigationStack {
        SettingsView(snapshot: makeHomeSnapshot(decks: sampleDecks(), reviewCards: sampleReviewCards()))
    }
}
