import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var store: FlashcardsStore

    private var tagsCount: Int {
        workspaceTagsSummary(cards: store.cards).tags.count
    }

    var body: some View {
        List {
            if store.globalErrorMessage.isEmpty == false {
                Section {
                    CopyableErrorMessageView(message: store.globalErrorMessage)
                }
            }

            Section("Manage content") {
                NavigationLink(value: SettingsNavigationDestination.decks) {
                    SettingsNavigationRow(
                        title: "Decks",
                        value: "\(store.homeSnapshot.deckCount)",
                        systemImage: "line.3.horizontal.decrease.circle"
                    )
                }

                NavigationLink(value: SettingsNavigationDestination.tags) {
                    SettingsNavigationRow(
                        title: "Tags",
                        value: "\(self.tagsCount)",
                        systemImage: "tag"
                    )
                }
            }

            Section("Workspace") {
                LabeledContent("Workspace") {
                    Text(store.workspace?.name ?? "Unavailable")
                }

                LabeledContent("Client") {
                    Text("SwiftUI + SQLite")
                }

                LabeledContent("Cards") {
                    Text("\(store.homeSnapshot.totalCards)")
                }

                LabeledContent("Decks") {
                    Text("\(store.homeSnapshot.deckCount)")
                }
            }

            Section("Account") {
                NavigationLink(value: SettingsNavigationDestination.account) {
                    SettingsNavigationRow(
                        title: "Account settings",
                        value: displayCloudAccountStateTitle(cloudState: store.cloudSettings?.cloudState ?? .disconnected),
                        systemImage: "person.crop.circle"
                    )
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
    }
}

private struct SettingsNavigationRow: View {
    let title: String
    let value: String
    let systemImage: String

    var body: some View {
        HStack(spacing: 12) {
            Label(title, systemImage: systemImage)

            Spacer()

            Text(value)
                .font(.subheadline.monospacedDigit())
                .foregroundStyle(.secondary)
        }
    }
}

func syncStatusTitle(status: SyncStatus) -> String {
    switch status {
    case .idle:
        return "Idle"
    case .syncing:
        return "Syncing"
    case .failed(let message):
        return "Failed: \(message)"
    }
}

func displayCloudAccountStateTitle(cloudState: CloudAccountState) -> String {
    switch cloudState {
    case .linked:
        return cloudState.title
    case .disconnected, .linkingReady:
        return CloudAccountState.disconnected.title
    }
}

func isSyncInFlight(status: SyncStatus) -> Bool {
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
