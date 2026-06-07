import SwiftUI

enum SyncStatusTone: Equatable {
    case success
    case inProgress
    case failure
    case neutral
}

struct SyncStatusPresentation: Equatable {
    let title: String
    let tone: SyncStatusTone
}

struct SettingsView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore

    private var accountStatusValue: String {
        displayCloudAccountStateTitle(cloudState: store.cloudSettings?.cloudState ?? .disconnected)
    }

    private var currentWorkspaceValue: String {
        store.workspace?.name ?? aiSettingsLocalized("common.unavailable", "Unavailable")
    }

    var body: some View {
        List {
            if store.globalErrorMessage.isEmpty == false {
                Section {
                    CopyableErrorMessageView(message: store.globalErrorMessage)
                }
            }

            Section(aiSettingsLocalized("settings.section.account", "Account")) {
                NavigationLink(value: SettingsNavigationDestination.accountStatus) {
                    SettingsNavigationRow(
                        title: aiSettingsLocalized("settings.row.accountStatus", "Account Status"),
                        value: self.accountStatusValue,
                        systemImage: "person.crop.circle"
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.settingsAccountStatusRow)

                NavigationLink(value: SettingsNavigationDestination.currentWorkspace) {
                    SettingsNavigationRow(
                        title: aiSettingsLocalized("settings.row.currentWorkspace", "Current Workspace"),
                        value: self.currentWorkspaceValue,
                        systemImage: "square.stack"
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.settingsCurrentWorkspaceRow)
            }

            Section(aiSettingsLocalized("settings.section.general", "General")) {
                NavigationLink(value: SettingsNavigationDestination.workspaceNotifications) {
                    SettingsNavigationRow(
                        title: aiSettingsLocalized("settings.row.reviewReminders", "Review Reminders"),
                        value: aiSettingsLocalized("settings.row.reviewReminders.value", "This Device"),
                        systemImage: "bell.badge"
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.settingsReviewRemindersRow)

                NavigationLink(value: SettingsNavigationDestination.language) {
                    SettingsNavigationRow(
                        title: aiSettingsLocalized("settings.row.language", "Language"),
                        value: aiSettingsLocalized("settings.row.language.value", "iOS"),
                        systemImage: "globe"
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.settingsLanguageRow)

                NavigationLink(value: SettingsNavigationDestination.access) {
                    SettingsNavigationRow(
                        title: aiSettingsLocalized("settings.row.access", "Access"),
                        value: aiSettingsLocalized("settings.row.access.permissionsCount", "3 permissions"),
                        systemImage: "hand.raised"
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.settingsAccessRow)

                NavigationLink(value: SettingsNavigationDestination.workspaceDecks) {
                    SettingsNavigationRow(
                        title: aiSettingsLocalized("settings.row.decks", "Decks"),
                        value: aiSettingsLocalized("settings.row.workspaceScoped.value", "Workspace"),
                        systemImage: "rectangle.stack"
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.settingsDecksRow)

                NavigationLink(value: SettingsNavigationDestination.workspaceTags) {
                    SettingsNavigationRow(
                        title: aiSettingsLocalized("settings.row.tags", "Tags"),
                        value: aiSettingsLocalized("settings.row.workspaceScoped.value", "Workspace"),
                        systemImage: "tag"
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.settingsTagsRow)

                NavigationLink(value: SettingsNavigationDestination.workspaceExport) {
                    SettingsNavigationRow(
                        title: aiSettingsLocalized("settings.row.export", "Export"),
                        value: "CSV",
                        systemImage: "square.and.arrow.up"
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.settingsExportRow)
            }

            Section(aiSettingsLocalized("settings.section.support", "Support")) {
                NavigationLink(value: SettingsNavigationDestination.feedback) {
                    SettingsNavigationRow(
                        title: aiSettingsLocalized("settings.row.sendFeedback", "Send Feedback"),
                        value: aiSettingsLocalized("settings.row.sendFeedback.value", "Share an idea"),
                        systemImage: "text.bubble"
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.settingsFeedbackRow)

                NavigationLink(value: SettingsNavigationDestination.accountLegalSupport) {
                    SettingsNavigationRow(
                        title: aiSettingsLocalized("settings.row.legalSupport", "Legal & Support"),
                        value: aiSettingsLocalized("settings.account.row.legalSupportValue", "Privacy + Support"),
                        systemImage: "doc.text"
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.settingsLegalSupportRow)

                NavigationLink(value: SettingsNavigationDestination.accountOpenSource) {
                    SettingsNavigationRow(
                        title: aiSettingsLocalized("settings.row.openSource", "Open Source"),
                        value: aiSettingsLocalized("settings.account.row.openSourceValue", "GitHub + MIT"),
                        systemImage: "chevron.left.forwardslash.chevron.right"
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.settingsOpenSourceRow)
            }

            Section(aiSettingsLocalized("settings.section.advanced", "Advanced")) {
                NavigationLink(value: SettingsNavigationDestination.workspaceScheduler) {
                    SettingsNavigationRow(
                        title: aiSettingsLocalized("settings.row.scheduling", "Scheduling / FSRS"),
                        value: "FSRS",
                        systemImage: "calendar.badge.clock"
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.settingsSchedulingRow)

                NavigationLink(value: SettingsNavigationDestination.accountAgentConnections) {
                    SettingsNavigationRow(
                        title: aiSettingsLocalized("settings.row.agentConnections", "Agent Connections"),
                        value: aiSettingsLocalized("settings.row.agentConnections.value", "API keys"),
                        systemImage: "link"
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.settingsAgentConnectionsRow)

                NavigationLink(value: SettingsNavigationDestination.accountServer) {
                    SettingsNavigationRow(
                        title: aiSettingsLocalized("settings.row.server", "Server"),
                        value: aiSettingsLocalized("settings.row.server.value", "Domain"),
                        systemImage: "network"
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.settingsServerRow)

                NavigationLink(value: SettingsNavigationDestination.device) {
                    SettingsNavigationRow(
                        title: aiSettingsLocalized("settings.row.deviceDiagnostics", "This Device / Diagnostics"),
                        value: aiSettingsLocalized("settings.row.deviceDiagnostics.value", "SwiftUI + SQLite"),
                        systemImage: "internaldrive"
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.settingsDeviceDiagnosticsRow)

                NavigationLink(value: SettingsNavigationDestination.resetStudyProgress) {
                    SettingsNavigationRow(
                        title: aiSettingsLocalized("settings.row.resetStudyProgress", "Reset Study Progress"),
                        value: aiSettingsLocalized("settings.row.resetStudyProgress.value", "Progress"),
                        systemImage: "arrow.counterclockwise.circle"
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.settingsResetStudyProgressRow)

                NavigationLink(value: SettingsNavigationDestination.deleteCurrentWorkspace) {
                    SettingsNavigationRow(
                        title: aiSettingsLocalized("settings.row.deleteCurrentWorkspace", "Delete Current Workspace"),
                        value: aiSettingsLocalized("settings.row.permanent.value", "Permanent"),
                        systemImage: "trash"
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.settingsDeleteCurrentWorkspaceRow)

                NavigationLink(value: SettingsNavigationDestination.accountDangerZone) {
                    SettingsNavigationRow(
                        title: aiSettingsLocalized("settings.row.deleteAccount", "Delete Account"),
                        value: aiSettingsLocalized("settings.row.permanent.value", "Permanent"),
                        systemImage: "person.crop.circle.badge.xmark"
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.settingsDeleteAccountRow)

                if store.isTestModeEnabled {
                    NavigationLink(value: SettingsNavigationDestination.test) {
                        SettingsNavigationRow(
                            title: aiSettingsLocalized("settings.row.test", "Test"),
                            value: aiSettingsLocalized("settings.row.test.itemCount", "2 items"),
                            systemImage: "wrench.and.screwdriver"
                        )
                    }
                    .accessibilityIdentifier(UITestIdentifier.settingsTestRow)
                }
            }
        }
        .listStyle(.insetGrouped)
        .accessibilityIdentifier(UITestIdentifier.settingsScreen)
        .navigationTitle(aiSettingsLocalized("settings.title", "Settings"))
    }
}

struct SettingsNavigationRow: View {
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

func makeSyncStatusPresentation(status: SyncStatus, cloudState: CloudAccountState) -> SyncStatusPresentation {
    switch status {
    case .idle:
        switch cloudState {
        case .linked:
            return SyncStatusPresentation(
                title: aiSettingsLocalized("settings.sync.success", "Successfully synced"),
                tone: .success
            )
        case .guest:
            return SyncStatusPresentation(
                title: aiSettingsLocalized("settings.sync.guestAiActive", "Guest AI is active"),
                tone: .neutral
            )
        case .disconnected, .linkingReady:
            return SyncStatusPresentation(
                title: aiSettingsLocalized("settings.sync.notSyncing", "Not syncing"),
                tone: .neutral
            )
        }
    case .syncing:
        return SyncStatusPresentation(
            title: aiSettingsLocalized("settings.sync.syncing", "Syncing"),
            tone: .inProgress
        )
    case .blocked(let message):
        return SyncStatusPresentation(
            title: aiSettingsLocalizedFormat("settings.sync.blocked", "Sync blocked: %@", message),
            tone: .failure
        )
    case .failed(let message):
        return SyncStatusPresentation(
            title: aiSettingsLocalizedFormat("settings.sync.failed", "Sync failed: %@", message),
            tone: .failure
        )
    }
}

func displayCloudAccountStateTitle(cloudState: CloudAccountState) -> String {
    switch cloudState {
    case .linked:
        return localizedCloudAccountStateTitle(cloudState)
    case .guest:
        return localizedCloudAccountStateTitle(cloudState)
    case .disconnected, .linkingReady:
        return localizedCloudAccountStateTitle(.disconnected)
    }
}

func isSyncInFlight(status: SyncStatus) -> Bool {
    switch status {
    case .syncing:
        return true
    case .idle, .blocked, .failed:
        return false
    }
}

#Preview("Default") {
    NavigationStack {
        SettingsView()
            .environment(FlashcardsStore())
    }
}

#Preview("Arabic RTL") {
    NavigationStack {
        SettingsView()
            .environment(FlashcardsStore())
    }
    .arabicRTLPreview()
}
