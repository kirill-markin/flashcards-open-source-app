import SwiftUI

private enum ServerSettingsConfirmationAction {
    case apply(CloudServiceConfiguration)
    case resetToOfficial
}

private func cloudServiceConfigurationModeTitle(_ mode: CloudServiceConfigurationMode) -> String {
    switch mode {
    case .official:
        return "Official"
    case .custom:
        return "Custom"
    }
}

struct ServerSettingsView: View {
    @EnvironmentObject private var store: FlashcardsStore

    @State private var customOriginInput: String = ""
    @State private var currentConfiguration: CloudServiceConfiguration?
    @State private var previewConfiguration: CloudServiceConfiguration?
    @State private var screenErrorMessage: String = ""
    @State private var isSaving: Bool = false
    @State private var confirmationAction: ServerSettingsConfirmationAction?
    @State private var isConfirmationPresented: Bool = false
    private var isApplyDisabled: Bool {
        guard let previewConfiguration else {
            return true
        }

        return self.isSaving || self.matchesCurrentCustomConfiguration(previewConfiguration)
    }

    private var isResetDisabled: Bool {
        self.isSaving || self.currentConfiguration?.mode != .custom
    }

    private var confirmationTitle: String {
        switch self.confirmationAction {
        case .apply:
            return "Disconnect this device and switch server?"
        case .resetToOfficial:
            return "Disconnect this device and reset to the official server?"
        case nil:
            return "Confirm server change"
        }
    }

    private var confirmationButtonTitle: String {
        switch self.confirmationAction {
        case .apply:
            return "Disconnect and Apply"
        case .resetToOfficial:
            return "Disconnect and Reset"
        case nil:
            return "Confirm"
        }
    }

    var body: some View {
        Form {
            if self.screenErrorMessage.isEmpty == false {
                Section {
                    CopyableErrorMessageView(message: self.screenErrorMessage)
                }
            }

            Section("Current Server") {
                if let currentConfiguration {
                    LabeledContent("Mode") {
                        Text(cloudServiceConfigurationModeTitle(currentConfiguration.mode))
                    }

                    if let customOrigin = currentConfiguration.customOrigin {
                        LabeledContent("Domain") {
                            Text(customOrigin)
                                .font(.caption.monospaced())
                                .multilineTextAlignment(.trailing)
                        }
                    } else {
                        LabeledContent("Domain") {
                            Text("Official default")
                        }
                    }

                    LabeledContent("API URL") {
                        Text(currentConfiguration.apiBaseUrl)
                            .font(.caption.monospaced())
                            .multilineTextAlignment(.trailing)
                    }

                    LabeledContent("Auth URL") {
                        Text(currentConfiguration.authBaseUrl)
                            .font(.caption.monospaced())
                            .multilineTextAlignment(.trailing)
                    }
                } else {
                    Text("Server configuration is unavailable.")
                        .foregroundStyle(.secondary)
                }
            }

            Section("Custom Server") {
                Text("Enter your self-hosted HTTPS domain. The app will automatically use api.<domain>/v1 and auth.<domain>. Self-hosted servers may omit AI chat and dictation.")
                    .foregroundStyle(.secondary)

                TextField("https://example.com", text: self.$customOriginInput)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                    .textContentType(.URL)
                    .onChange(of: self.customOriginInput) { _, _ in
                        self.updatePreviewConfiguration()
                    }

                if let previewConfiguration {
                    LabeledContent("Expected API URL") {
                        Text(previewConfiguration.apiBaseUrl)
                            .font(.caption.monospaced())
                            .multilineTextAlignment(.trailing)
                    }

                    LabeledContent("Expected Auth URL") {
                        Text(previewConfiguration.authBaseUrl)
                            .font(.caption.monospaced())
                            .multilineTextAlignment(.trailing)
                    }
                } else {
                    Text("Enter a valid base HTTPS URL like https://example.com to preview the derived API and auth URLs.")
                        .foregroundStyle(.secondary)
                }

                Button("Apply Custom Server") {
                    self.prepareCustomServerApply()
                }
                .disabled(self.isApplyDisabled)
            }

            Section("Official Server") {
                Text("Resetting switches this device back to the bundled official server configuration. You will need to sign in again manually.")
                    .foregroundStyle(.secondary)

                Button("Reset to Official Server", role: .destructive) {
                    self.confirmationAction = .resetToOfficial
                    self.isConfirmationPresented = true
                }
                .disabled(self.isResetDisabled)
            }
        }
        .scrollDismissesKeyboard(.immediately)
        .navigationTitle("Server")
        .alert(self.confirmationTitle, isPresented: self.$isConfirmationPresented) {
            Button("Cancel", role: .cancel) {
                self.confirmationAction = nil
            }
            Button(self.confirmationButtonTitle, role: .destructive) {
                self.commitConfirmationAction()
            }
        } message: {
            Text("This device will disconnect from the current cloud server. Local data stays on this device, sync will not start automatically, and you will need to sign in again manually.")
        }
        .onAppear {
            self.loadCurrentConfiguration()
        }
    }

    private func loadCurrentConfiguration() {
        do {
            let configuration = try self.store.currentCloudServiceConfiguration()
            self.currentConfiguration = configuration
            self.customOriginInput = configuration.customOrigin ?? ""
            self.updatePreviewConfiguration()
            self.screenErrorMessage = ""
        } catch {
            self.screenErrorMessage = localizedMessage(error: error)
        }
    }

    private func updatePreviewConfiguration() {
        let trimmedValue = self.customOriginInput.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedValue.isEmpty {
            self.previewConfiguration = nil
            return
        }

        self.previewConfiguration = try? makeCustomCloudServiceConfiguration(customOrigin: trimmedValue)
    }

    private func prepareCustomServerApply() {
        guard self.isSaving == false else {
            return
        }

        Task { @MainActor in
            self.isSaving = true
            defer {
                self.isSaving = false
            }

            do {
                let configuration = try await self.store.validateCustomCloudServer(customOrigin: self.customOriginInput)
                self.confirmationAction = .apply(configuration)
                self.screenErrorMessage = ""
                self.isConfirmationPresented = true
            } catch {
                self.screenErrorMessage = localizedMessage(error: error)
            }
        }
    }

    private func commitConfirmationAction() {
        do {
            switch self.confirmationAction {
            case .apply(let configuration):
                try self.store.applyCustomCloudServer(configuration: configuration)
                self.currentConfiguration = configuration
                self.customOriginInput = configuration.customOrigin ?? ""
                self.updatePreviewConfiguration()
            case .resetToOfficial:
                try self.store.resetToOfficialCloudServer()
                let officialConfiguration = try self.store.currentCloudServiceConfiguration()
                self.currentConfiguration = officialConfiguration
                self.customOriginInput = ""
                self.updatePreviewConfiguration()
            case nil:
                return
            }

            self.screenErrorMessage = ""
            self.confirmationAction = nil
        } catch {
            self.screenErrorMessage = localizedMessage(error: error)
        }
    }

    private func matchesCurrentCustomConfiguration(_ configuration: CloudServiceConfiguration) -> Bool {
        self.currentConfiguration?.mode == .custom
            && self.currentConfiguration?.customOrigin == configuration.customOrigin
    }
}

#Preview {
    NavigationStack {
        ServerSettingsView()
            .environmentObject(FlashcardsStore())
    }
}
