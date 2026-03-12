import SwiftUI

struct AccountSettingsView: View {
    @EnvironmentObject private var store: FlashcardsStore

    @State private var screenErrorMessage: String = ""
    @State private var isCloudSignInPresented: Bool = false
    @State private var isDisconnectConfirmationPresented: Bool = false
    @State private var isDeleteAccountAlertPresented: Bool = false
    @State private var isDeleteAccountConfirmationPresented: Bool = false
    @State private var agentConnections: [AgentApiKeyConnection] = []
    @State private var agentConnectionsInstructions: String = ""
    @State private var isLoadingAgentConnections: Bool = false
    @State private var revokingConnectionId: String?

    var body: some View {
        List {
            if screenErrorMessage.isEmpty == false {
                Section {
                    CopyableErrorMessageView(message: screenErrorMessage)
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
                            self.isDisconnectConfirmationPresented = true
                        }
                    }
                } else {
                    Text("Cloud settings are unavailable.")
                        .foregroundStyle(.secondary)
                }
            }

            Section("Agent connections") {
                if store.cloudSettings?.cloudState == .linked {
                    if self.agentConnectionsInstructions.isEmpty == false {
                        Text(self.agentConnectionsInstructions)
                            .foregroundStyle(.secondary)
                    }

                    if self.isLoadingAgentConnections {
                        Text("Loading agent connections...")
                            .foregroundStyle(.secondary)
                    } else if self.agentConnections.isEmpty {
                        Text("No long-lived bot connections were created for this account.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(self.agentConnections) { connection in
                            VStack(alignment: .leading, spacing: 8) {
                                Text(connection.label)
                                Text(connection.connectionId)
                                    .font(.caption.monospaced())
                                    .foregroundStyle(.secondary)
                                LabeledContent("Created") {
                                    Text(connection.createdAt)
                                        .font(.caption.monospaced())
                                }
                                LabeledContent("Last used") {
                                    Text(connection.lastUsedAt ?? "Never")
                                        .font(.caption.monospaced())
                                }
                                LabeledContent("Revoked") {
                                    Text(connection.revokedAt ?? "Not revoked")
                                        .font(.caption.monospaced())
                                }
                                Button("Revoke", role: .destructive) {
                                    self.revokeAgentConnection(connectionId: connection.connectionId)
                                }
                                .disabled(connection.revokedAt != nil || self.revokingConnectionId == connection.connectionId)
                            }
                        }
                    }
                } else {
                    Text("Sign in to the cloud account to manage long-lived bot connections.")
                        .foregroundStyle(.secondary)
                }
            }

            Section("Delete account") {
                Text("Permanently delete this account and all cloud data.")
                    .foregroundStyle(.secondary)

                Button("Delete my account", role: .destructive) {
                    self.isDeleteAccountAlertPresented = true
                }
                .disabled(store.cloudSettings?.cloudState != .linked)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Account")
        .sheet(isPresented: self.$isCloudSignInPresented) {
            CloudSignInSheet()
                .environmentObject(store)
        }
        .task(id: store.cloudSettings?.cloudState == .linked) {
            await self.reloadAgentConnectionsIfNeeded()
        }
        .alert("Disconnect this device?", isPresented: self.$isDisconnectConfirmationPresented) {
            Button("Cancel", role: .cancel) {}
            Button("Disconnect", role: .destructive) {
                self.disconnectCloudAccount()
            }
        } message: {
            Text("This device will stop syncing with the current cloud account until you sign in again.")
        }
        .alert("Delete this account?", isPresented: self.$isDeleteAccountAlertPresented) {
            Button("Cancel", role: .cancel) {}
            Button("Continue", role: .destructive) {
                self.isDeleteAccountConfirmationPresented = true
            }
        } message: {
            Text("This permanently deletes the account and all cloud data.")
        }
        .fullScreenCover(isPresented: self.$isDeleteAccountConfirmationPresented) {
            DeleteAccountConfirmationView()
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

    private func reloadAgentConnectionsIfNeeded() async {
        guard store.cloudSettings?.cloudState == .linked else {
            self.agentConnections = []
            self.agentConnectionsInstructions = ""
            return
        }

        self.isLoadingAgentConnections = true
        defer {
            self.isLoadingAgentConnections = false
        }

        do {
            let result = try await store.listAgentApiKeys()
            self.agentConnections = result.connections
            self.agentConnectionsInstructions = result.instructions
            self.screenErrorMessage = ""
        } catch {
            self.screenErrorMessage = localizedMessage(error: error)
        }
    }

    private func revokeAgentConnection(connectionId: String) {
        Task { @MainActor in
            self.revokingConnectionId = connectionId
            defer {
                self.revokingConnectionId = nil
            }

            do {
                let result = try await store.revokeAgentApiKey(connectionId: connectionId)
                self.agentConnections = self.agentConnections.map { connection in
                    connection.connectionId == result.connection.connectionId ? result.connection : connection
                }
                self.agentConnectionsInstructions = result.instructions
                self.screenErrorMessage = ""
            } catch {
                self.screenErrorMessage = localizedMessage(error: error)
            }
        }
    }
}

#Preview {
    NavigationStack {
        AccountSettingsView()
            .environmentObject(FlashcardsStore())
    }
}
