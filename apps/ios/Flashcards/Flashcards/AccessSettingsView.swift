import SwiftUI

struct AccessSettingsView: View {
    var body: some View {
        List {
            Section("Permissions") {
                ForEach(AccessPermissionKind.allCases) { kind in
                    NavigationLink {
                        AccessPermissionDetailView(kind: kind)
                    } label: {
                        HStack(spacing: 12) {
                            Label(kind.title, systemImage: kind.systemImage)
                            Spacer()
                            Text(accessPermissionStatus(kind: kind).title)
                                .font(.subheadline.monospacedDigit())
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }

            Section {
                Text("Flashcards requests only the access needed for attachments and chat dictation.")
                    .foregroundStyle(.secondary)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Access")
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

            Section(self.kind.title) {
                LabeledContent("Status") {
                    Text(self.status.title)
                }

                Text(accessPermissionGuidance(kind: self.kind, status: self.status))
                    .foregroundStyle(.secondary)
            }

            if let primaryActionTitle = accessPermissionPrimaryActionTitle(status: self.status) {
                Section {
                    Button(primaryActionTitle) {
                        self.handlePrimaryAction()
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(self.kind.title)
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
            self.screenErrorMessage = "This access is unavailable on the current device."
        }
    }
}
