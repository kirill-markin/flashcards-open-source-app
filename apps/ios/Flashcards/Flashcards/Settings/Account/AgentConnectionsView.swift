import SwiftUI

struct AgentConnectionsView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore

    @State private var screenErrorMessage: String = ""
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

            Section(aiSettingsLocalized("settings.account.agentConnections.section.agentConnections", "Agent Connections")) {
                if store.cloudSettings?.cloudState == .linked {
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
            self.agentConnections = result.connections
            self.agentConnectionsInstructions = result.instructions
            self.screenErrorMessage = ""
        } catch {
            self.screenErrorMessage = Flashcards.errorMessage(error: error)
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
                self.screenErrorMessage = Flashcards.errorMessage(error: error)
            }
        }
    }
}

#Preview {
    NavigationStack {
        AgentConnectionsView()
            .environment(FlashcardsStore())
    }
}
