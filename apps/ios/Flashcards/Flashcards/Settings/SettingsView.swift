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

    @State private var isCloudSignInPresented: Bool = false
    @State private var isFriendInvitePresented: Bool = false

    private var accountStatusValue: String {
        displayCloudAccountStateTitle(cloudState: store.cloudSettings?.cloudState ?? .disconnected)
    }

    private var currentWorkspaceValue: String {
        store.workspace?.name ?? aiSettingsLocalized("common.unavailable", "Unavailable")
    }

    private var leaderboardParticipationValue: String? {
        guard let communityProfile = store.communityPublicProfile else {
            return nil
        }

        return communityProfile.leaderboardParticipationEnabled
            ? aiSettingsLocalized("common.on", "On")
            : aiSettingsLocalized("common.off", "Off")
    }

    private var settingsAttentionSummary: SettingsAttentionSummary {
        makeSettingsAttentionSummary(
            issues: makeSettingsAttentionIssues(cloudState: store.cloudSettings?.cloudState)
        )
    }

    var body: some View {
        List {
            Section {
                self.friendInviteButton
            }

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
                        systemImage: "person.crop.circle",
                        attentionCount: self.settingsAttentionSummary.accountStatusRowCount
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.settingsAccountStatusRow)

                NavigationLink(value: SettingsNavigationDestination.currentWorkspace) {
                    SettingsNavigationRow(
                        title: aiSettingsLocalized("settings.row.currentWorkspace", "Workspace"),
                        value: self.currentWorkspaceValue,
                        systemImage: "square.stack",
                        attentionCount: nil
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.settingsCurrentWorkspaceRow)
            }

            Section(aiSettingsLocalized("settings.section.general", "General")) {
                NavigationLink(value: SettingsNavigationDestination.workspaceNotifications) {
                    SettingsNavigationRow(
                        title: aiSettingsLocalized("settings.row.reviewReminders", "Reminders"),
                        value: nil,
                        systemImage: "bell.badge",
                        attentionCount: nil
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.settingsReviewRemindersRow)

                NavigationLink(value: SettingsNavigationDestination.reviewAnimations) {
                    SettingsNavigationRow(
                        title: aiSettingsLocalized("settings.row.reviewAnimations", "Review Animations"),
                        value: store.accountPreferences.reviewReactionAnimationsEnabled
                            ? aiSettingsLocalized("common.on", "On")
                            : aiSettingsLocalized("common.off", "Off"),
                        systemImage: "sparkles",
                        attentionCount: nil
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.settingsReviewAnimationsRow)

                NavigationLink(value: SettingsNavigationDestination.leaderboardParticipation) {
                    SettingsNavigationRow(
                        title: aiSettingsLocalized("settings.row.leaderboardParticipation", "Leaderboard participation"),
                        value: self.leaderboardParticipationValue,
                        systemImage: "list.number",
                        attentionCount: nil
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.settingsLeaderboardParticipationRow)

                NavigationLink(value: SettingsNavigationDestination.language) {
                    SettingsNavigationRow(
                        title: aiSettingsLocalized("settings.row.language", "Language"),
                        value: aiSettingsLocalized("settings.row.language.value", "iOS"),
                        systemImage: "globe",
                        attentionCount: nil
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.settingsLanguageRow)

                NavigationLink(value: SettingsNavigationDestination.access) {
                    SettingsNavigationRow(
                        title: aiSettingsLocalized("settings.row.access", "Access"),
                        value: aiSettingsLocalized("settings.row.access.permissionsCount", "3 permissions"),
                        systemImage: "hand.raised",
                        attentionCount: nil
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.settingsAccessRow)

                NavigationLink(value: SettingsNavigationDestination.workspaceDecks) {
                    SettingsNavigationRow(
                        title: aiSettingsLocalized("settings.row.decks", "Decks"),
                        value: aiSettingsLocalized("settings.row.workspaceScoped.value", "Workspace"),
                        systemImage: "rectangle.stack",
                        attentionCount: nil
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.settingsDecksRow)

                NavigationLink(value: SettingsNavigationDestination.workspaceTags) {
                    SettingsNavigationRow(
                        title: aiSettingsLocalized("settings.row.tags", "Tags"),
                        value: aiSettingsLocalized("settings.row.workspaceScoped.value", "Workspace"),
                        systemImage: "tag",
                        attentionCount: nil
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.settingsTagsRow)

                NavigationLink(value: SettingsNavigationDestination.workspaceExport) {
                    SettingsNavigationRow(
                        title: aiSettingsLocalized("settings.row.export", "Export"),
                        value: "CSV",
                        systemImage: "square.and.arrow.up",
                        attentionCount: nil
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.settingsExportRow)
            }

            Section(aiSettingsLocalized("settings.section.support", "Support")) {
                NavigationLink(value: SettingsNavigationDestination.feedback) {
                    SettingsNavigationRow(
                        title: aiSettingsLocalized("settings.row.sendFeedback", "Send Feedback"),
                        value: aiSettingsLocalized("settings.row.sendFeedback.value", "Share an idea"),
                        systemImage: "text.bubble",
                        attentionCount: nil
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.settingsFeedbackRow)

                NavigationLink(value: SettingsNavigationDestination.accountSupport) {
                    SettingsNavigationRow(
                        title: aiSettingsLocalized("settings.row.support", "Support"),
                        value: nil,
                        systemImage: "questionmark.circle",
                        attentionCount: nil
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.settingsSupportRow)

                NavigationLink(value: SettingsNavigationDestination.accountLegal) {
                    SettingsNavigationRow(
                        title: aiSettingsLocalized("settings.row.legal", "Legal"),
                        value: nil,
                        systemImage: "doc.text",
                        attentionCount: nil
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.settingsLegalRow)

                NavigationLink(value: SettingsNavigationDestination.accountOpenSource) {
                    SettingsNavigationRow(
                        title: aiSettingsLocalized("settings.row.openSource", "Open Source"),
                        value: aiSettingsLocalized("settings.account.row.openSourceValue", "GitHub + MIT"),
                        systemImage: "chevron.left.forwardslash.chevron.right",
                        attentionCount: nil
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.settingsOpenSourceRow)
            }

            Section(aiSettingsLocalized("settings.section.advanced", "Advanced")) {
                NavigationLink(value: SettingsNavigationDestination.workspaceScheduler) {
                    SettingsNavigationRow(
                        title: aiSettingsLocalized("settings.row.scheduling", "Scheduling / FSRS"),
                        value: "FSRS",
                        systemImage: "calendar.badge.clock",
                        attentionCount: nil
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.settingsSchedulingRow)

                NavigationLink(value: SettingsNavigationDestination.accountAgentConnections) {
                    SettingsNavigationRow(
                        title: aiSettingsLocalized("settings.row.agentConnections", "Agent Connections"),
                        value: aiSettingsLocalized("settings.row.agentConnections.value", "API keys"),
                        systemImage: "link",
                        attentionCount: nil
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.settingsAgentConnectionsRow)

                NavigationLink(value: SettingsNavigationDestination.accountServer) {
                    SettingsNavigationRow(
                        title: aiSettingsLocalized("settings.row.server", "Server"),
                        value: aiSettingsLocalized("settings.row.server.value", "Domain"),
                        systemImage: "network",
                        attentionCount: nil
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.settingsServerRow)

                NavigationLink(value: SettingsNavigationDestination.device) {
                    SettingsNavigationRow(
                        title: aiSettingsLocalized("settings.row.deviceDiagnostics", "Device"),
                        value: nil,
                        systemImage: "internaldrive",
                        attentionCount: nil
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.settingsDeviceDiagnosticsRow)

                NavigationLink(value: SettingsNavigationDestination.resetStudyProgress) {
                    SettingsNavigationRow(
                        title: aiSettingsLocalized("settings.row.resetStudyProgress", "Reset Study Progress"),
                        value: aiSettingsLocalized("settings.row.resetStudyProgress.value", "Progress"),
                        systemImage: "arrow.counterclockwise.circle",
                        attentionCount: nil
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.settingsResetStudyProgressRow)

                NavigationLink(value: SettingsNavigationDestination.deleteCurrentWorkspace) {
                    SettingsNavigationRow(
                        title: aiSettingsLocalized("settings.row.deleteCurrentWorkspace", "Delete Current Workspace"),
                        value: aiSettingsLocalized("settings.row.permanent.value", "Permanent"),
                        systemImage: "trash",
                        attentionCount: nil
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.settingsDeleteCurrentWorkspaceRow)

                NavigationLink(value: SettingsNavigationDestination.accountDangerZone) {
                    SettingsNavigationRow(
                        title: aiSettingsLocalized("settings.row.deleteAccount", "Delete Account"),
                        value: aiSettingsLocalized("settings.row.permanent.value", "Permanent"),
                        systemImage: "person.crop.circle.badge.xmark",
                        attentionCount: nil
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.settingsDeleteAccountRow)

                if store.isTestModeEnabled {
                    NavigationLink(value: SettingsNavigationDestination.test) {
                        SettingsNavigationRow(
                            title: aiSettingsLocalized("settings.row.test", "Test"),
                            value: aiSettingsLocalized("settings.row.test.itemCount", "4 items"),
                            systemImage: "wrench.and.screwdriver",
                            attentionCount: nil
                        )
                    }
                    .accessibilityIdentifier(UITestIdentifier.settingsTestRow)
                }
            }
        }
        .listStyle(.insetGrouped)
        .accessibilityIdentifier(UITestIdentifier.settingsScreen)
        .navigationTitle(aiSettingsLocalized("settings.title", "Settings"))
        .onAppear {
            store.triggerCloudAccountContextRefreshIfActive(surfacesGlobalErrorMessage: false)
        }
        .sheet(isPresented: self.$isCloudSignInPresented) {
            CloudSignInSheet(presentationContext: .standard)
                .environment(self.store)
        }
        .sheet(isPresented: self.$isFriendInvitePresented) {
            ProgressFriendInviteSheet()
                .environment(self.store)
        }
    }

    private var friendInviteButton: some View {
        Button {
            self.openFriendInviteFlow()
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "person.crop.circle.badge.plus")
                    .accessibilityHidden(true)
                Text(aiSettingsLocalized("settings.inviteFriend.button", "Invite Friend"))
            }
            .frame(maxWidth: .infinity, alignment: .center)
        }
        .buttonStyle(.borderedProminent)
        .accessibilityIdentifier(UITestIdentifier.settingsInviteFriendButton)
        .accessibilityLabel(aiSettingsLocalized("settings.inviteFriend.button", "Invite Friend"))
    }

    private func openFriendInviteFlow() {
        guard self.store.cloudSettings?.cloudState == .linked else {
            self.isCloudSignInPresented = true
            return
        }

        self.isFriendInvitePresented = true
    }
}

struct SettingsNavigationRow: View {
    let title: String
    let value: String?
    let systemImage: String
    let attentionCount: Int?

    var body: some View {
        HStack(spacing: 12) {
            Label(title, systemImage: systemImage)

            Spacer()

            if let value {
                Text(value)
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(.secondary)
            }

            if let attentionCount, attentionCount > 0 {
                SettingsAttentionBadgeView(count: attentionCount)
            }
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
