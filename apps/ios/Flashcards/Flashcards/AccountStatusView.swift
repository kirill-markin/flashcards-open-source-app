import SwiftUI

struct SyncStatusIndicatorView: View {
    let presentation: SyncStatusPresentation

    var body: some View {
        HStack(spacing: 6) {
            if let toneColor = self.toneColor {
                Circle()
                    .fill(toneColor)
                    .frame(width: 8, height: 8)
            }

            Text(presentation.title)
                .multilineTextAlignment(.trailing)
        }
    }

    private var toneColor: Color? {
        switch presentation.tone {
        case .success:
            return .green
        case .inProgress:
            return .yellow
        case .failure:
            return .red
        case .neutral:
            return nil
        }
    }
}

struct AccountStatusView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore

    @State private var screenErrorMessage: String = ""
    @State private var isCloudSignInPresented: Bool = false
    @State private var isLogoutConfirmationPresented: Bool = false
    @State private var linkedWorkspaces: [CloudWorkspaceSummary]? = nil
    @State private var isWorkspacePickerPresented: Bool = false
    @State private var isWorkspacePickerLoading: Bool = false

    var body: some View {
        List {
            if screenErrorMessage.isEmpty == false {
                Section {
                    CopyableErrorMessageView(message: screenErrorMessage)
                }
            }

            Section("Account Status") {
                if let cloudSettings = store.cloudSettings {
                    let syncStatusPresentation = makeSyncStatusPresentation(
                        status: store.syncStatus,
                        cloudState: cloudSettings.cloudState
                    )

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
                        SyncStatusIndicatorView(presentation: syncStatusPresentation)
                    }

                    if let lastSuccessfulCloudSyncAt = store.lastSuccessfulCloudSyncAt {
                        LabeledContent("Last sync") {
                            Text(lastSuccessfulCloudSyncAt)
                                .font(.caption.monospaced())
                                .multilineTextAlignment(.trailing)
                        }
                    }

                    Text("Guest and linked accounts sync the current workspace through the cloud. Linked accounts can also switch between workspaces on this device.")
                        .foregroundStyle(.secondary)

                    switch cloudSettings.cloudState {
                    case .disconnected, .linkingReady:
                        Button("Sign in for sync") {
                            self.isCloudSignInPresented = true
                        }
                    case .guest:
                        Button("Create account") {
                            self.isCloudSignInPresented = true
                        }

                        Button("Log out", role: .destructive) {
                            self.isLogoutConfirmationPresented = true
                        }
                    case .linked:
                        Button("Sync now") {
                            self.syncNow()
                        }
                        .disabled(isSyncInFlight(status: store.syncStatus))

                        Button(self.isWorkspacePickerLoading ? "Loading workspaces..." : "Switch workspace") {
                            self.presentWorkspacePicker()
                        }
                        .disabled(self.isWorkspacePickerLoading || isSyncInFlight(status: store.syncStatus))

                        Button("Switch account") {
                            self.isCloudSignInPresented = true
                        }

                        Button("Log out", role: .destructive) {
                            self.isLogoutConfirmationPresented = true
                        }
                    }
                } else {
                    Text("Cloud settings are unavailable.")
                        .foregroundStyle(.secondary)
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Account Status")
        .sheet(isPresented: self.$isCloudSignInPresented) {
            CloudSignInSheet()
                .environment(store)
        }
        .sheet(isPresented: self.$isWorkspacePickerPresented) {
            if let linkedWorkspaces {
                LinkedWorkspacePickerSheet(
                    workspaces: linkedWorkspaces,
                    onDismiss: {
                        self.isWorkspacePickerPresented = false
                    }
                )
                .environment(store)
            }
        }
        .alert("Log out and clear this device?", isPresented: self.$isLogoutConfirmationPresented) {
            Button("Cancel", role: .cancel) {}
            Button("Log out", role: .destructive) {
                self.logoutCloudAccount()
            }
        } message: {
            Text("All local workspaces and synced data will be removed from this device.")
        }
    }

    private func logoutCloudAccount() {
        do {
            try store.logoutCloudAccount()
            self.screenErrorMessage = ""
        } catch {
            self.screenErrorMessage = Flashcards.errorMessage(error: error)
        }
    }

    private func presentWorkspacePicker() {
        Task { @MainActor in
            self.isWorkspacePickerLoading = true
            defer {
                self.isWorkspacePickerLoading = false
            }

            do {
                self.linkedWorkspaces = try await store.listLinkedWorkspaces()
                self.isWorkspacePickerPresented = true
                self.screenErrorMessage = ""
            } catch {
                self.screenErrorMessage = Flashcards.errorMessage(error: error)
            }
        }
    }

    private func syncNow() {
        Task { @MainActor in
            do {
                try await store.syncCloudNow()
                self.screenErrorMessage = ""
            } catch {
                self.screenErrorMessage = Flashcards.errorMessage(error: error)
            }
        }
    }
}

private struct LinkedWorkspacePickerSheet: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore

    let workspaces: [CloudWorkspaceSummary]
    let onDismiss: () -> Void

    @State private var errorMessage: String = ""
    @State private var isSwitching: Bool = false

    private var selectionItems: [CloudWorkspaceSelectionItem] {
        makeCloudWorkspaceSelectionItems(workspaces: self.workspaces, localWorkspaceName: nil)
    }

    var body: some View {
        NavigationStack {
            List {
                if self.errorMessage.isEmpty == false {
                    Section {
                        CopyableErrorMessageView(message: self.errorMessage)
                    }
                }

                Section("Workspace") {
                    Text("Choose a linked workspace to open on this device, or create a new one.")
                        .foregroundStyle(.secondary)
                }

                Section("Choose workspace") {
                    ForEach(self.selectionItems) { item in
                        Button {
                            self.switchWorkspace(selection: item.selection)
                        } label: {
                            LinkedWorkspaceSelectionRow(item: item)
                        }
                        .buttonStyle(.plain)
                        .disabled(self.isSwitching)
                    }
                }
            }
            .navigationTitle("Switch workspace")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") {
                        self.onDismiss()
                    }
                    .disabled(self.isSwitching)
                }
            }
        }
    }

    private func switchWorkspace(selection: CloudWorkspaceLinkSelection) {
        Task { @MainActor in
            self.isSwitching = true
            defer {
                self.isSwitching = false
            }

            do {
                try await self.store.switchLinkedWorkspace(selection: selection)
                self.errorMessage = ""
                self.onDismiss()
            } catch {
                self.errorMessage = Flashcards.errorMessage(error: error)
            }
        }
    }
}

private struct LinkedWorkspaceSelectionRow: View {
    let item: CloudWorkspaceSelectionItem

    var body: some View {
        HStack(spacing: 12) {
            if let symbolName = self.item.symbolName {
                Image(systemName: symbolName)
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .frame(width: 20)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(self.item.title)
                    .foregroundStyle(.primary)

                if let subtitle = self.item.subtitle {
                    Text(subtitle)
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()

            if self.item.showsSelectedIndicator {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(.secondary)
            }
        }
        .contentShape(Rectangle())
        .padding(.vertical, 2)
    }
}

#Preview {
    NavigationStack {
        AccountStatusView()
            .environment(FlashcardsStore())
    }
}
