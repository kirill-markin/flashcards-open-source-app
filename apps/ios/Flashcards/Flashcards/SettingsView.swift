import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var store: FlashcardsStore

    @State private var screenErrorMessage: String = ""
    @State private var isCloudSignInPresented: Bool = false

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
                        Text(displayCloudAccountStateTitle(cloudState: cloudSettings.cloudState))
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

                    LabeledContent("Sync status") {
                        Text(syncStatusTitle(status: store.syncStatus))
                    }

                    if let lastSuccessfulCloudSyncAt = store.lastSuccessfulCloudSyncAt {
                        LabeledContent("Last sync") {
                            Text(lastSuccessfulCloudSyncAt)
                                .font(.caption.monospaced())
                                .multilineTextAlignment(.trailing)
                        }
                    }

                    Text("Local mode always works. Once auth provides a linked cloud session, the app pushes pending writes and pulls ordered changes for the current workspace.")
                        .foregroundStyle(.secondary)

                    switch cloudSettings.cloudState {
                    case .disconnected, .linkingReady:
                        Button("Sign in for sync") {
                            self.isCloudSignInPresented = true
                        }
                    case .linked:
                        Button("Sync now") {
                            self.syncNow()
                        }
                        .disabled(isSyncInFlight(status: store.syncStatus))

                        Button("Switch account") {
                            self.isCloudSignInPresented = true
                        }

                        Button("Disconnect on this device", role: .destructive) {
                            self.disconnectCloudAccount()
                        }
                    }
                } else {
                    Text("Cloud settings are unavailable.")
                        .foregroundStyle(.secondary)
                }
            }

            Section("Scheduler") {
                if let schedulerSettings = store.schedulerSettings {
                    NavigationLink {
                        SchedulerSettingsDetailView()
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Scheduler settings")
                            Text("\(schedulerSettings.algorithm.uppercased()) - Retention \(formatSchedulerRetentionValue(value: schedulerSettings.desiredRetention))")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                    }

                    Text("These settings affect future scheduling only. Existing card state remains authoritative.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)

                    LabeledContent("Updated") {
                        Text(schedulerSettings.updatedAt)
                            .font(.caption.monospaced())
                            .multilineTextAlignment(.trailing)
                    }
                } else {
                    Text("Scheduler settings are unavailable.")
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
        .sheet(isPresented: self.$isCloudSignInPresented) {
            CloudSignInSheet()
                .environmentObject(store)
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

    private func syncNow() {
        Task { @MainActor in
            do {
                try await store.syncCloudNow()
                self.screenErrorMessage = ""
            } catch {
                self.screenErrorMessage = localizedMessage(error: error)
            }
        }
    }
}

private func syncStatusTitle(status: SyncStatus) -> String {
    switch status {
    case .idle:
        return "Idle"
    case .syncing:
        return "Syncing"
    case .failed(let message):
        return "Failed: \(message)"
    }
}

private func displayCloudAccountStateTitle(cloudState: CloudAccountState) -> String {
    switch cloudState {
    case .linked:
        return cloudState.title
    case .disconnected, .linkingReady:
        return CloudAccountState.disconnected.title
    }
}

private func isSyncInFlight(status: SyncStatus) -> Bool {
    switch status {
    case .syncing:
        return true
    case .idle, .failed:
        return false
    }
}

#Preview {
    NavigationStack {
        SettingsView()
            .environmentObject(FlashcardsStore())
    }
}
