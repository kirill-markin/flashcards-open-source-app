import SwiftUI

struct CurrentWorkspaceView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore

    @State private var screenErrorMessage: String = ""
    @State private var linkedWorkspaces: [CloudWorkspaceSummary]? = nil
    @State private var isWorkspacePickerPresented: Bool = false
    @State private var isWorkspacePickerLoading: Bool = false
    @State private var settingsBanner: SettingsOverlayBanner? = nil

    private var currentWorkspaceName: String {
        self.store.workspace?.name ?? "Unavailable"
    }

    private var isWorkspaceManagementLocked: Bool {
        self.store.cloudSettings?.cloudState != .linked
    }

    var body: some View {
        List {
            if self.screenErrorMessage.isEmpty == false {
                Section {
                    CopyableErrorMessageView(message: self.screenErrorMessage)
                }
            }

            Section {
                Button {
                    self.handleWorkspaceRowTap()
                } label: {
                    SettingsNavigationRow(
                        title: "Workspace",
                        value: self.isWorkspacePickerLoading ? "Loading..." : self.currentWorkspaceName,
                        systemImage: "square.stack"
                    )
                }
                .buttonStyle(.plain)
                .foregroundStyle(self.isWorkspaceManagementLocked ? .secondary : .primary)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Current Workspace")
        .sheet(isPresented: self.$isWorkspacePickerPresented) {
            if let linkedWorkspaces = self.linkedWorkspaces {
                CurrentWorkspacePickerSheet(
                    workspaces: linkedWorkspaces,
                    localWorkspaceName: self.currentWorkspaceName,
                    onDismiss: {
                        self.isWorkspacePickerPresented = false
                    }
                )
                .environment(self.store)
            }
        }
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

    private func handleWorkspaceRowTap() {
        guard self.isWorkspaceManagementLocked == false else {
            self.showSettingsBanner(message: settingsWorkspaceLockedBannerMessage)
            return
        }

        self.presentWorkspacePicker()
    }

    private func presentWorkspacePicker() {
        Task { @MainActor in
            self.isWorkspacePickerLoading = true
            defer {
                self.isWorkspacePickerLoading = false
            }

            do {
                self.linkedWorkspaces = try await self.store.listLinkedWorkspaces()
                self.isWorkspacePickerPresented = true
                self.screenErrorMessage = ""
            } catch {
                self.screenErrorMessage = Flashcards.errorMessage(error: error)
            }
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

private struct CurrentWorkspacePickerSheet: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore

    let workspaces: [CloudWorkspaceSummary]
    let localWorkspaceName: String
    let onDismiss: () -> Void

    @State private var errorMessage: String = ""
    @State private var isSwitching: Bool = false

    private var selectionItems: [CloudWorkspaceSelectionItem] {
        makeCloudWorkspaceSelectionItems(workspaces: self.workspaces, localWorkspaceName: self.localWorkspaceName)
    }

    var body: some View {
        NavigationStack {
            List {
                if self.errorMessage.isEmpty == false {
                    Section {
                        CopyableErrorMessageView(message: self.errorMessage)
                    }
                }

                Section {
                    Text("Choose a linked workspace to open on this device, or create a new one.")
                        .foregroundStyle(.secondary)
                }

                Section("Choose workspace") {
                    ForEach(self.selectionItems) { item in
                        Button {
                            self.switchWorkspace(selection: item.selection)
                        } label: {
                            CurrentWorkspaceSelectionRow(item: item)
                        }
                        .buttonStyle(.plain)
                        .disabled(self.isSwitching)
                    }
                }
            }
            .navigationTitle("Choose Workspace")
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

private struct CurrentWorkspaceSelectionRow: View {
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
        CurrentWorkspaceView()
            .environment(FlashcardsStore())
    }
}
