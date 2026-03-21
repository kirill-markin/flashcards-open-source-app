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
    @State private var settingsBanner: SettingsOverlayBanner? = nil

    private var isWorkspaceManagementLocked: Bool {
        self.store.cloudSettings?.cloudState != .linked
    }

    var body: some View {
        List {
            if store.globalErrorMessage.isEmpty == false {
                Section {
                    CopyableErrorMessageView(message: store.globalErrorMessage)
                }
            }

            Section {
                if self.isWorkspaceManagementLocked {
                    Button {
                        self.showSettingsBanner(message: settingsWorkspaceLockedBannerMessage)
                    } label: {
                        SettingsNavigationRow(
                            title: "Current Workspace",
                            value: store.workspace?.name ?? "Unavailable",
                            systemImage: "square.stack"
                        )
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.secondary)
                } else {
                    NavigationLink(value: SettingsNavigationDestination.currentWorkspace) {
                        SettingsNavigationRow(
                            title: "Current Workspace",
                            value: store.workspace?.name ?? "Unavailable",
                            systemImage: "square.stack"
                        )
                    }
                }
            }

            Section {
                NavigationLink(value: SettingsNavigationDestination.workspace) {
                    SettingsNavigationRow(
                        title: "Workspace Settings",
                        value: store.workspace?.name ?? "Unavailable",
                        systemImage: "square.grid.2x2"
                    )
                }

                NavigationLink(value: SettingsNavigationDestination.account) {
                    SettingsNavigationRow(
                        title: "Account Settings",
                        value: displayCloudAccountStateTitle(cloudState: store.cloudSettings?.cloudState ?? .disconnected),
                        systemImage: "person.crop.circle"
                    )
                }
            }

            Section {
                NavigationLink(value: SettingsNavigationDestination.device) {
                    SettingsNavigationRow(
                        title: "This Device",
                        value: "SwiftUI + SQLite",
                        systemImage: "internaldrive"
                    )
                }

                NavigationLink(value: SettingsNavigationDestination.access) {
                    SettingsNavigationRow(
                        title: "Access",
                        value: "3 items",
                        systemImage: "hand.raised"
                    )
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Settings")
        .overlay(alignment: .top) {
            if let settingsBanner = self.settingsBanner {
                SettingsOverlayBannerView(
                    banner: settingsBanner,
                    onDismiss: {
                        self.dismissSettingsBanner()
                    }
                )
                .padding(.top, 8)
                .padding(.horizontal, 16)
                .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .task(id: self.settingsBanner?.id) {
            guard self.settingsBanner != nil else {
                return
            }

            do {
                try await Task.sleep(nanoseconds: settingsBannerDismissDelayNanoseconds)
            } catch {
                return
            }

            if Task.isCancelled {
                return
            }

            self.dismissSettingsBanner()
        }
    }

    private func showSettingsBanner(message: String) {
        withAnimation(.spring(response: 0.32, dampingFraction: 0.9)) {
            self.settingsBanner = SettingsOverlayBanner(
                id: UUID().uuidString,
                message: message
            )
        }
    }

    private func dismissSettingsBanner() {
        withAnimation(.spring(response: 0.32, dampingFraction: 0.9)) {
            self.settingsBanner = nil
        }
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
            return SyncStatusPresentation(title: "Successfully synced", tone: .success)
        case .guest:
            return SyncStatusPresentation(title: "Guest AI is active", tone: .neutral)
        case .disconnected, .linkingReady:
            return SyncStatusPresentation(title: "Not syncing", tone: .neutral)
        }
    case .syncing:
        return SyncStatusPresentation(title: "Syncing", tone: .inProgress)
    case .failed(let message):
        return SyncStatusPresentation(title: "Sync failed: \(message)", tone: .failure)
    }
}

func displayCloudAccountStateTitle(cloudState: CloudAccountState) -> String {
    switch cloudState {
    case .linked:
        return cloudState.title
    case .guest:
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
            .environment(FlashcardsStore())
    }
}
