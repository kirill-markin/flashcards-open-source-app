import SwiftUI

private struct AccessPermissionSummary: Identifiable {
    let kind: AccessPermissionKind
    let status: AccessPermissionStatus

    var id: AccessPermissionKind { self.kind }
}

private func accessPermissionSummaries() -> [AccessPermissionSummary] {
    AccessPermissionKind.allCases.map { kind in
        AccessPermissionSummary(kind: kind, status: accessPermissionStatus(kind: kind))
    }
}

struct AccessSettingsView: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var permissions: [AccessPermissionSummary] = accessPermissionSummaries()

    var body: some View {
        List {
            Section(aiSettingsLocalized("settings.access.section.permissions", "Permissions")) {
                ForEach(self.permissions) { permission in
                    NavigationLink(value: SettingsNavigationDestination.accessPermissionDetail(permission.kind)) {
                        HStack(spacing: 12) {
                            Label {
                                Text(localizedAccessPermissionKindTitle(permission.kind))
                                    .foregroundStyle(Color.primary)
                            } icon: {
                                Image(systemName: permission.kind.systemImage)
                            }
                            Spacer()
                            Text(localizedAccessPermissionStatusTitle(permission.status))
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
                        "Camera and microphone access are used for capture and dictation. You can choose photo attachments without library access."
                    )
                )
                    .foregroundStyle(.secondary)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(aiSettingsLocalized("settings.access.title", "Access"))
        .accessibilityIdentifier(UITestIdentifier.accessSettingsScreen)
        .onAppear {
            self.permissions = accessPermissionSummaries()
        }
        .onChange(of: self.scenePhase) { _, nextPhase in
            if nextPhase == .active {
                self.permissions = accessPermissionSummaries()
            }
        }
    }
}

struct AccessPermissionDetailView: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var status: AccessPermissionStatus
    @State private var guidanceMessage: String
    @State private var isPerformingAction: Bool = false

    let kind: AccessPermissionKind

    init(kind: AccessPermissionKind) {
        self.kind = kind
        self._status = State(initialValue: accessPermissionStatus(kind: kind))
        self._guidanceMessage = State(initialValue: "")
    }

    var body: some View {
        List {
            if self.guidanceMessage.isEmpty == false {
                Section {
                    Text(self.guidanceMessage)
                        .foregroundStyle(.secondary)
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

                #if targetEnvironment(macCatalyst)
                if self.status == .allowed || self.status == .blocked || self.status == .limited {
                    Text(
                        String(
                            localized: "access_permission_guidance.mac_settings",
                            defaultValue: "In System Settings, open Privacy & Security and select this permission.",
                            table: "Foundation"
                        )
                    )
                    .foregroundStyle(.secondary)
                }
                #endif
            }

            if let primaryActionTitle = localizedAccessPermissionPrimaryActionTitle(self.status) {
                Section {
                    Button {
                        self.handlePrimaryAction()
                    } label: {
                        HStack {
                            Text(primaryActionTitle)
                            if self.isPerformingAction {
                                ProgressView()
                            }
                        }
                    }
                    .disabled(self.isPerformingAction)
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(localizedAccessPermissionKindTitle(self.kind))
        .onAppear {
            self.refreshStatus()
        }
        .onChange(of: self.scenePhase) { _, nextPhase in
            if nextPhase == .active {
                self.refreshStatus()
            }
        }
    }

    private func refreshStatus() {
        self.status = accessPermissionStatus(kind: self.kind)
    }

    private func handlePrimaryAction() {
        guard self.isPerformingAction == false else {
            return
        }

        let status = self.status
        self.isPerformingAction = true
        self.guidanceMessage = ""
        Task { @MainActor in
            defer {
                self.isPerformingAction = false
            }

            switch status {
            case .askEveryTime:
                self.status = await requestAccessPermission(kind: self.kind)
            case .allowed, .blocked, .limited:
                do {
                    try await openApplicationSettings()
                } catch {
                    self.guidanceMessage = errorMessage(error: error)
                }
            case .unavailable:
                self.guidanceMessage = aiSettingsLocalized(
                    "settings.access.guidance.unavailable",
                    "This access is unavailable on the current device."
                )
            }
        }
    }
}
