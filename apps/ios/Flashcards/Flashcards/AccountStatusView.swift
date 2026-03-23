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
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore

    @State private var screenErrorMessage: String = ""
    @State private var isCloudSignInPresented: Bool = false
    @State private var isLogoutConfirmationPresented: Bool = false

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

                    Text("Guest and linked accounts sync the current workspace through the cloud. Linked accounts can manage workspaces from Current Workspace in Settings.")
                        .foregroundStyle(.secondary)

                    switch cloudSettings.cloudState {
                    case .disconnected, .linkingReady:
                        Button("Sign in or sign up") {
                            self.isCloudSignInPresented = true
                        }
                    case .guest:
                        Button("Sign in or sign up") {
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

                        Button("Log out", role: .destructive) {
                            self.isLogoutConfirmationPresented = true
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
                .environment(store)
        }
        .alert("Log out and clear this device?", isPresented: self.$isLogoutConfirmationPresented) {
            Button("Cancel", role: .cancel) {}
            Button("Log out", role: .destructive) {
                self.logoutCloudAccount()
            }
        } message: {
            Text("All local workspaces and synced data will be removed from this device.")
        }
    }

    private func logoutCloudAccount() {
        do {
            try store.logoutCloudAccount()
            self.screenErrorMessage = ""
        } catch {
            self.screenErrorMessage = Flashcards.errorMessage(error: error)
        }
    }

    private func syncNow() {
        Task { @MainActor in
            do {
                try await store.syncCloudNow()
                self.screenErrorMessage = ""
            } catch {
                self.screenErrorMessage = Flashcards.errorMessage(error: error)
            }
        }
    }
}

#Preview {
    NavigationStack {
        AccountStatusView()
            .environment(FlashcardsStore())
    }
}
