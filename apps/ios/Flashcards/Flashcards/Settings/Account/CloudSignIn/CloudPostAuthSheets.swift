import SwiftUI

struct CloudAuthInlineErrorView: View {
    let presentation: CloudAuthInlineErrorPresentation
    let onTechnicalError: (TechnicalErrorAction) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(self.presentation.message)
                .foregroundStyle(.red)
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
                .accessibilityIdentifier(UITestIdentifier.cloudSignInInlineAuthErrorMessage)

            if let technicalError = self.presentation.technicalError {
                Button {
                    self.onTechnicalError(technicalError)
                } label: {
                    Label(
                        aiSettingsLocalized("settings.account.cloudSignIn.technicalDetails", "Technical details"),
                        systemImage: "info.circle"
                    )
                }
                .tint(.secondary)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(UITestIdentifier.cloudSignInInlineAuthError)
    }
}

struct CloudPostAuthRecoveryNeededSheet: View {
    let state: CloudPostAuthRecoveryNeededState
    let allowsLogoutAction: Bool
    let onClose: () -> Void
    let onLogout: () -> Void

    var body: some View {
        NavigationStack {
            ReadableContentLayout(
                maxWidth: flashcardsReadableFormMaxWidth,
                horizontalPadding: 0
            ) {
                Form {
                    Section(aiSettingsLocalized("settings.account.cloudSignIn.section.cloudAccount", "Cloud account")) {
                        Text(self.state.title)
                            .font(.headline)
                        Text(self.state.message)
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                            .accessibilityIdentifier(UITestIdentifier.cloudSignInPostAuthFailureMessage)
                    }

                    Section {
                        Button(aiSettingsLocalized("common.close", "Close")) {
                            self.onClose()
                        }

                        if self.allowsLogoutAction {
                            Button(aiSettingsLocalized("settings.account.status.logOut", "Log out"), role: .destructive) {
                                self.onLogout()
                            }
                        }
                    }
                }
            }
            .accessibilityIdentifier(UITestIdentifier.cloudSignInPostAuthFailureScreen)
            .navigationTitle(aiSettingsLocalized("settings.account.cloudSignIn.cloudSyncTitle", "Cloud sync"))
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

struct CloudPostAuthFailureSheet: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @State private var technicalErrorPresentation: TechnicalErrorPresentation?

    let state: CloudPostAuthFailureState
    let isRetryDisabled: Bool
    let allowsCloseAction: Bool
    let allowsLogoutAction: Bool
    let onRetry: () -> Void
    let onClose: () -> Void
    let onLogout: () -> Void

    private var isRetryButtonDisabled: Bool {
        if self.isRetryDisabled {
            return true
        }

        guard self.state.kind == .standard else {
            return false
        }

        return isCloudSignInSyncInFlight(status: self.store.syncStatus)
    }

    var body: some View {
        NavigationStack {
            ReadableContentLayout(
                maxWidth: flashcardsReadableFormMaxWidth,
                horizontalPadding: 0
            ) {
                Form {
                    Section(aiSettingsLocalized("settings.account.cloudSignIn.section.cloudAccount", "Cloud account")) {
                        Text(self.state.title)
                            .font(.headline)
                        Text(self.failureDescription)
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                            .accessibilityIdentifier(UITestIdentifier.cloudSignInPostAuthFailureMessage)
                    }

                    if let technicalError = self.state.technicalError {
                        Section {
                            Button {
                                self.presentTechnicalError(technicalError)
                            } label: {
                                Label(
                                    aiSettingsLocalized("settings.account.cloudSignIn.technicalDetails", "Technical details"),
                                    systemImage: "info.circle"
                                )
                            }
                            .tint(.secondary)
                        }
                    }

                    Section {
                        Button(aiSettingsLocalized("common.retry", "Retry")) {
                            self.onRetry()
                        }
                        .disabled(self.isRetryButtonDisabled)

                        if self.allowsCloseAction {
                            Button(aiSettingsLocalized("common.close", "Close")) {
                                self.onClose()
                            }
                        }

                        if self.allowsLogoutAction {
                            Button(aiSettingsLocalized("settings.account.status.logOut", "Log out"), role: .destructive) {
                                self.onLogout()
                            }
                        }
                    }
                }
            }
            .accessibilityIdentifier(UITestIdentifier.cloudSignInPostAuthFailureScreen)
            .navigationTitle(aiSettingsLocalized("settings.account.cloudSignIn.cloudSyncTitle", "Cloud sync"))
            .navigationBarTitleDisplayMode(.inline)
            .sheet(item: self.$technicalErrorPresentation) { presentation in
                TechnicalErrorSheet(
                    presentation: presentation,
                    onClose: {
                        self.technicalErrorPresentation = nil
                    }
                )
            }
        }
    }

    private var failureDescription: String {
        switch self.state.kind {
        case .standard:
            return self.state.message
        case .guestLocalRecovery:
            return self.state.message
        }
    }

    private func presentTechnicalError(_ action: TechnicalErrorAction) {
        self.technicalErrorPresentation = self.store.makeTechnicalErrorPresentation(action: action)
    }
}

struct CloudPostAuthGuestLocalRecoveryPreparationSheet: View {
    var body: some View {
        NavigationStack {
            ReadableContentLayout(
                maxWidth: flashcardsReadableFormMaxWidth,
                horizontalPadding: 24
            ) {
                VStack(spacing: 16) {
                    ProgressView()
                        .progressViewStyle(.circular)

                    Text(
                        aiSettingsLocalized(
                            "settings.account.cloudSignIn.guestLocalRecovery.prepare.title",
                            "Preparing recovered workspace..."
                        )
                    )
                    .font(.headline)
                    .multilineTextAlignment(.center)

                    Text(
                        aiSettingsLocalized(
                            "settings.account.cloudSignIn.guestLocalRecovery.prepare.message",
                            "Local data is still on this device. Keep this screen open while iOS prepares a recovered workspace."
                        )
                    )
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .accessibilityIdentifier(UITestIdentifier.cloudSignInPostAuthSyncScreen)
            .navigationTitle(aiSettingsLocalized("settings.account.cloudSignIn.cloudSyncTitle", "Cloud sync"))
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

struct CloudPostAuthLoadingSheet: View {
    var body: some View {
        NavigationStack {
            ReadableContentLayout(
                maxWidth: flashcardsReadableFormMaxWidth,
                horizontalPadding: 0
            ) {
                Form {
                    Section(aiSettingsLocalized("settings.account.cloudSignIn.section.cloudSync", "Cloud sync")) {
                        Text(aiSettingsLocalized("settings.account.cloudSignIn.loadingWorkspaces", "Loading workspaces…"))
                            .font(.headline)

                        Text(
                            aiSettingsLocalized(
                                "settings.account.cloudSignIn.loadingWorkspacesDescription",
                                "Your sign-in succeeded. The app is now loading the cloud workspace step."
                            )
                        )
                            .foregroundStyle(.secondary)

                        HStack {
                            Spacer()
                            ProgressView()
                                .progressViewStyle(.circular)
                            Spacer()
                        }
                        .padding(.vertical, 8)
                    }
                }
            }
            .accessibilityIdentifier(UITestIdentifier.cloudSignInPostAuthLoadingScreen)
            .navigationTitle(aiSettingsLocalized("settings.account.cloudSignIn.cloudSyncTitle", "Cloud sync"))
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

struct CloudPostAuthSyncSheet: View {
    private let presentation: CloudPostAuthSyncPresentation

    init(operation: CloudPostAuthSyncOperation) {
        self.presentation = makeCloudPostAuthSyncPresentation(operation: operation)
    }

    var body: some View {
        NavigationStack {
            ReadableContentLayout(
                maxWidth: flashcardsReadableFormMaxWidth,
                horizontalPadding: 24
            ) {
                VStack(spacing: 16) {
                    ProgressView()
                        .progressViewStyle(.circular)

                    Text(self.presentation.title)
                        .font(.headline)
                        .multilineTextAlignment(.center)

                    Text(self.presentation.message)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .accessibilityIdentifier(UITestIdentifier.cloudSignInPostAuthSyncScreen)
            .navigationTitle(aiSettingsLocalized("settings.account.cloudSignIn.cloudSyncTitle", "Cloud sync"))
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}
