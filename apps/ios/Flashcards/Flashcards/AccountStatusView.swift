import SwiftUI

struct SyncStatusIndicatorView: View {
    let presentation: SyncStatusPresentation

    var body: some View {
        HStack(spacing: 6) {
            if let toneColor = self.toneColor {
                Circle()
                    .fill(toneColor)
                    .frame(width: 8, height: 8)
            }

            Text(presentation.title)
                .multilineTextAlignment(.trailing)
        }
    }

    private var toneColor: Color? {
        switch presentation.tone {
        case .success:
            return .green
        case .inProgress:
            return .yellow
        case .failure:
            return .red
        case .neutral:
            return nil
        }
    }
}

struct AccountStatusView: View {
    @EnvironmentObject private var store: FlashcardsStore

    @State private var screenErrorMessage: String = ""
    @State private var isCloudSignInPresented: Bool = false
    @State private var isDisconnectConfirmationPresented: Bool = false

    var body: some View {
        List {
            if screenErrorMessage.isEmpty == false {
                Section {
                    CopyableErrorMessageView(message: screenErrorMessage)
                }
            }

            Section("Account Status") {
                if let cloudSettings = store.cloudSettings {
                    let syncStatusPresentation = makeSyncStatusPresentation(
                        status: store.syncStatus,
                        cloudState: cloudSettings.cloudState
                    )

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
                        SyncStatusIndicatorView(presentation: syncStatusPresentation)
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
                            self.isDisconnectConfirmationPresented = true
                        }
                    }
                } else {
                    Text("Cloud settings are unavailable.")
                        .foregroundStyle(.secondary)
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Account Status")
        .sheet(isPresented: self.$isCloudSignInPresented) {
            CloudSignInSheet()
                .environmentObject(store)
        }
        .alert("Disconnect this device?", isPresented: self.$isDisconnectConfirmationPresented) {
            Button("Cancel", role: .cancel) {}
            Button("Disconnect", role: .destructive) {
                self.disconnectCloudAccount()
            }
        } message: {
            Text("This device will stop syncing with the current cloud account until you sign in again.")
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

#Preview {
    NavigationStack {
        AccountStatusView()
            .environmentObject(FlashcardsStore())
    }
}
