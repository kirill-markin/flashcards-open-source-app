import SwiftUI

struct AgentConnectionsView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore

    @State private var agentConnections: [AgentApiKeyConnection] = []
    @State private var agentConnectionsInstructions: String = ""
    @State private var isLoadingAgentConnections: Bool = false
    @State private var revokingConnectionId: String?
    @State private var guidanceMessage: String = ""

    var body: some View {
        List {
            Section(aiSettingsLocalized("settings.account.agentConnections.section.agentConnections", "Agent Connections")) {
                if store.cloudSettings?.cloudState == .linked {
                    if self.guidanceMessage.isEmpty == false {
                        Text(self.guidanceMessage)
                            .foregroundStyle(.secondary)
                    }

                    if self.agentConnectionsInstructions.isEmpty == false {
                        Text(self.agentConnectionsInstructions)
                            .foregroundStyle(.secondary)
                    }

                    if self.isLoadingAgentConnections {
                        Text(aiSettingsLocalized("settings.account.agentConnections.loading", "Loading agent connections..."))
                            .foregroundStyle(.secondary)
                    } else if self.agentConnections.isEmpty {
                        Text(
                            aiSettingsLocalized(
                                "settings.account.agentConnections.empty",
                                "No long-lived bot connections were created for this account."
                            )
                        )
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(self.agentConnections) { connection in
                            VStack(alignment: .leading, spacing: 8) {
                                Text(connection.label)
                                Text(connection.connectionId)
                                    .font(.caption.monospaced())
                                    .foregroundStyle(.secondary)
                                LabeledContent(aiSettingsLocalized("settings.account.agentConnections.created", "Created")) {
                                    Text(connection.createdAt)
                                        .font(.caption.monospaced())
                                }
                                LabeledContent(aiSettingsLocalized("settings.account.agentConnections.lastUsed", "Last used")) {
                                    Text(connection.lastUsedAt ?? aiSettingsLocalized("settings.account.agentConnections.never", "Never"))
                                        .font(.caption.monospaced())
                                }
                                LabeledContent(aiSettingsLocalized("settings.account.agentConnections.revoked", "Revoked")) {
                                    Text(connection.revokedAt ?? aiSettingsLocalized("settings.account.agentConnections.notRevoked", "Not revoked"))
                                        .font(.caption.monospaced())
                                }
                                Button(aiSettingsLocalized("settings.account.agentConnections.revoke", "Revoke"), role: .destructive) {
                                    self.revokeAgentConnection(connectionId: connection.connectionId)
                                }
                                .disabled(connection.revokedAt != nil || self.revokingConnectionId == connection.connectionId)
                            }
                        }
                    }
                } else {
                    Text(
                        aiSettingsLocalized(
                            "settings.account.agentConnections.signInRequired",
                            "Sign in to the cloud account to manage long-lived bot connections."
                        )
                    )
                        .foregroundStyle(.secondary)
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(aiSettingsLocalized("settings.account.agentConnections.title", "Agent Connections"))
        .task(id: store.cloudSettings?.cloudState == .linked) {
            await self.reloadAgentConnectionsIfNeeded()
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
            self.guidanceMessage = ""
            self.agentConnections = result.connections
            self.agentConnectionsInstructions = result.instructions
        } catch {
            self.handleAgentConnectionFailure(error: error)
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
                self.guidanceMessage = ""
                self.agentConnections = self.agentConnections.map { connection in
                    connection.connectionId == result.connection.connectionId ? result.connection : connection
                }
                self.agentConnectionsInstructions = result.instructions
            } catch {
                self.handleAgentConnectionFailure(error: error)
            }
        }
    }

    private func handleAgentConnectionFailure(error: Error) {
        if isRequestCancellationError(error: error) {
            return
        }
        if isRetryableNetworkTransportFailure(error: error) {
            self.guidanceMessage = aiSettingsLocalized("settings.sync.failed.generic", "Sync failed")
            return
        }
        if let guidanceMessage = self.store.blockedCloudIdentityConflictMessage(error: error) {
            self.guidanceMessage = guidanceMessage
            return
        }

        self.store.presentTechnicalError(error)
    }
}

#Preview {
    NavigationStack {
        AgentConnectionsView()
            .environment(FlashcardsStore())
    }
}
