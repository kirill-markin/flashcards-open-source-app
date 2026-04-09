import SwiftUI

struct AccessSettingsView: View {
    var body: some View {
        List {
            Section(aiSettingsLocalized("settings.access.section.permissions", "Permissions")) {
                NavigationLink(value: SettingsNavigationDestination.workspaceNotifications) {
                    SettingsNavigationRow(
                        title: aiSettingsLocalized("settings.access.notifications", "Notifications"),
                        value: aiSettingsLocalized("settings.access.thisDevice", "This Device"),
                        systemImage: "bell.badge"
                    )
                }

                ForEach(AccessPermissionKind.allCases) { kind in
                    NavigationLink(value: SettingsNavigationDestination.accessPermissionDetail(kind)) {
                        HStack(spacing: 12) {
                            Label(localizedAccessPermissionKindTitle(kind), systemImage: kind.systemImage)
                            Spacer()
                            Text(localizedAccessPermissionStatusTitle(accessPermissionStatus(kind: kind)))
                                .font(.subheadline.monospacedDigit())
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }

            Section {
                Text(
                    aiSettingsLocalized(
                        "settings.access.footer",
                        "Flashcards Open Source App requests only the access needed for attachments and chat dictation."
                    )
                )
                    .foregroundStyle(.secondary)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(aiSettingsLocalized("settings.access.title", "Access"))
    }
}

struct AccessPermissionDetailView: View {
    @State private var status: AccessPermissionStatus
    @State private var screenErrorMessage: String

    let kind: AccessPermissionKind

    init(kind: AccessPermissionKind) {
        self.kind = kind
        self._status = State(initialValue: accessPermissionStatus(kind: kind))
        self._screenErrorMessage = State(initialValue: "")
    }

    var body: some View {
        List {
            if self.screenErrorMessage.isEmpty == false {
                Section {
                    CopyableErrorMessageView(message: self.screenErrorMessage)
                }
            }

            Section(localizedAccessPermissionKindTitle(self.kind)) {
                LabeledContent(aiSettingsLocalized("settings.access.detail.status", "Status")) {
                    Text(localizedAccessPermissionStatusTitle(self.status))
                }

                Text(localizedAccessPermissionDescription(self.kind))
                    .foregroundStyle(.secondary)

                Text(localizedAccessPermissionGuidance(kind: self.kind, status: self.status))
                    .foregroundStyle(.secondary)
            }

            if let primaryActionTitle = localizedAccessPermissionPrimaryActionTitle(self.status) {
                Section {
                    Button(primaryActionTitle) {
                        self.handlePrimaryAction()
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(localizedAccessPermissionKindTitle(self.kind))
        .onAppear {
            self.refreshStatus()
        }
    }

    private func refreshStatus() {
        self.status = accessPermissionStatus(kind: self.kind)
    }

    private func handlePrimaryAction() {
        switch self.status {
        case .askEveryTime:
            Task { @MainActor in
                self.status = await requestAccessPermission(kind: self.kind)
                self.screenErrorMessage = ""
            }
        case .allowed, .blocked, .limited:
            openApplicationSettings()
        case .unavailable:
            self.screenErrorMessage = aiSettingsLocalized(
                "settings.access.guidance.unavailable",
                "This access is unavailable on the current device."
            )
        }
    }
}
