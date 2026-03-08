import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var store: FlashcardsStore

    @State private var screenErrorMessage: String = ""

    var body: some View {
        List {
            if store.globalErrorMessage.isEmpty == false {
                Section {
                    Text(store.globalErrorMessage)
                        .foregroundStyle(.red)
                }
            }

            if screenErrorMessage.isEmpty == false {
                Section {
                    Text(screenErrorMessage)
                        .foregroundStyle(.red)
                }
            }

            Section("App") {
                LabeledContent("Client") {
                    Text("SwiftUI + SQLite")
                }

                LabeledContent("Workspace") {
                    Text(store.workspace?.name ?? "Unavailable")
                }

                LabeledContent("Cards") {
                    Text("\(store.homeSnapshot.totalCards)")
                }

                LabeledContent("Decks") {
                    Text("\(store.homeSnapshot.deckCount)")
                }
            }

            Section("Cloud account") {
                if let cloudSettings = store.cloudSettings {
                    LabeledContent("State") {
                        Text(cloudSettings.cloudState.title)
                    }

                    LabeledContent("Device ID") {
                        Text(cloudSettings.deviceId)
                            .font(.caption.monospaced())
                            .multilineTextAlignment(.trailing)
                    }

                    if let linkedEmail = cloudSettings.linkedEmail {
                        LabeledContent("Linked email") {
                            Text(linkedEmail)
                        }
                    }

                    Text("Local mode always works. Cloud auth and sync will plug into this optional state later.")
                        .foregroundStyle(.secondary)

                    switch cloudSettings.cloudState {
                    case .disconnected:
                        Button("Prepare cloud link") {
                            self.prepareCloudLink()
                        }
                    case .linkingReady:
                        Button("Preview linked state") {
                            self.previewLinkedState()
                        }

                        Button("Reset local cloud state", role: .destructive) {
                            self.disconnectCloudAccount()
                        }
                    case .linked:
                        Button("Disconnect cloud account", role: .destructive) {
                            self.disconnectCloudAccount()
                        }
                    }
                } else {
                    Text("Cloud settings are unavailable.")
                        .foregroundStyle(.secondary)
                }
            }

            Section("Local data") {
                Label("No login is required to create cards, save decks, or review.", systemImage: "internaldrive")
                Label("Future sync stays scoped to the current workspace only.", systemImage: "lock.shield")
                Label("The schema stays close to the backend without pulling remote data by default.", systemImage: "externaldrive.badge.checkmark")
            }

            Section("Today") {
                LabeledContent("Due") {
                    Text("\(store.homeSnapshot.dueCount)")
                }

                LabeledContent("New") {
                    Text("\(store.homeSnapshot.newCount)")
                }

                LabeledContent("Reviewed") {
                    Text("\(store.homeSnapshot.reviewedCount)")
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Settings")
    }

    private func prepareCloudLink() {
        do {
            try store.prepareCloudLink()
            self.screenErrorMessage = ""
        } catch {
            self.screenErrorMessage = localizedMessage(error: error)
        }
    }

    private func previewLinkedState() {
        do {
            try store.previewLinkedCloudAccount()
            self.screenErrorMessage = ""
        } catch {
            self.screenErrorMessage = localizedMessage(error: error)
        }
    }

    private func disconnectCloudAccount() {
        do {
            try store.disconnectCloudAccount()
            self.screenErrorMessage = ""
        } catch {
            self.screenErrorMessage = localizedMessage(error: error)
        }
    }
}

#Preview {
    NavigationStack {
        SettingsView()
            .environmentObject(FlashcardsStore())
    }
}
