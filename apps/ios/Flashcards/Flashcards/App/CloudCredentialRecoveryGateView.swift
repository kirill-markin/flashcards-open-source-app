import SwiftUI

struct CloudCredentialRecoveryGateView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore

    let recoveryState: CloudCredentialRecoveryState

    @State private var isCloudSignInPresented: Bool = false
    @State private var isEraseConfirmationPresented: Bool = false
    @State private var isErasing: Bool = false

    private var presentation: CloudCredentialRecoveryGatePresentation {
        makeCloudCredentialRecoveryGatePresentation(reason: self.recoveryState.reason)
    }

    var body: some View {
        NavigationStack {
            ReadableContentLayout(
                maxWidth: flashcardsReadableFormMaxWidth,
                horizontalPadding: 0
            ) {
                Form {
                    Section {
                        VStack(spacing: 16) {
                            Image(systemName: self.presentation.symbolName)
                                .font(.system(size: 44, weight: .semibold))
                                .foregroundStyle(.orange)
                                .accessibilityHidden(true)

                            Text(self.presentation.title)
                                .font(.title2.weight(.semibold))
                                .multilineTextAlignment(.center)

                            Text(self.presentation.message)
                                .foregroundStyle(.secondary)
                                .multilineTextAlignment(.center)
                                .textSelection(.enabled)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 24)
                    }

                    if self.isErasing {
                        Section {
                            HStack(spacing: 12) {
                                ProgressView()
                                    .progressViewStyle(.circular)

                                Text(
                                    aiSettingsLocalized(
                                        "settings.sync.recoveryGate.erasing",
                                        "Erasing local data..."
                                    )
                                )
                            }
                            .accessibilityIdentifier(UITestIdentifier.cloudCredentialRecoveryGateEraseProgress)
                        }
                    }

                    Section {
                        Button {
                            self.isCloudSignInPresented = true
                        } label: {
                            Label(
                                aiSettingsLocalized(
                                    "settings.sync.recoveryGate.signInAndRecover",
                                    "Sign in and recover"
                                ),
                                systemImage: "person.crop.circle.badge.checkmark"
                            )
                        }
                        .disabled(self.isErasing)
                        .accessibilityIdentifier(UITestIdentifier.cloudCredentialRecoveryGateSignInButton)

                        Button(role: .destructive) {
                            self.isEraseConfirmationPresented = true
                        } label: {
                            Label(
                                aiSettingsLocalized(
                                    "settings.sync.recoveryGate.eraseLocalData",
                                    "Erase local data and start fresh"
                                ),
                                systemImage: "trash"
                            )
                        }
                        .disabled(self.isErasing)
                        .accessibilityIdentifier(UITestIdentifier.cloudCredentialRecoveryGateEraseButton)
                    }
                }
            }
            .accessibilityIdentifier(UITestIdentifier.cloudCredentialRecoveryGateScreen)
            .navigationTitle(self.presentation.title)
            .navigationBarTitleDisplayMode(.inline)
        }
        .sheet(isPresented: self.$isCloudSignInPresented) {
            CloudSignInSheet(presentationContext: .credentialRecoveryGate)
                .environment(self.store)
        }
        .alert(
            aiSettingsLocalized(
                "settings.sync.recoveryGate.eraseAlert.title",
                "Erase local data?"
            ),
            isPresented: self.$isEraseConfirmationPresented
        ) {
            Button(aiSettingsLocalized("common.cancel", "Cancel"), role: .cancel) {}
            Button(
                aiSettingsLocalized(
                    "settings.sync.recoveryGate.eraseAlert.confirm",
                    "Erase local data"
                ),
                role: .destructive
            ) {
                self.requestEraseLocalData()
            }
        } message: {
            Text(
                aiSettingsLocalized(
                    "settings.sync.recoveryGate.eraseAlert.message",
                    "This deletes local cards and workspaces on this device. Cloud data is not deleted."
                )
            )
        }
    }

    private func requestEraseLocalData() {
        guard self.isErasing == false else {
            return
        }

        self.isErasing = true

        Task {
            await self.eraseLocalData()
        }
    }

    @MainActor
    private func eraseLocalData() async {
        await Task.yield()

        do {
            try self.store.eraseLocalDataForCredentialRecovery()
        } catch {
            self.store.presentTechnicalError(error)
        }

        self.isErasing = false
    }
}

struct CloudCredentialRecoveryGatePresentation: Equatable {
    let title: String
    let message: String
    let symbolName: String
}

func makeCloudCredentialRecoveryGatePresentation(
    reason: CloudCredentialRecoveryReason
) -> CloudCredentialRecoveryGatePresentation {
    switch reason {
    case .guestSessionMissing:
        return CloudCredentialRecoveryGatePresentation(
            title: aiSettingsLocalized(
                "settings.sync.recoveryGate.guestSessionMissing.title",
                "Guest session needs recovery"
            ),
            message: aiSettingsLocalized(
                "settings.sync.recoveryGate.guestSessionMissing.body",
                "The guest session on this device could not be restored. Your local data is still here. Sign in with email to save it in a recovered workspace, or erase local data and start fresh."
            ),
            symbolName: "exclamationmark.triangle"
        )
    case .linkedCredentialsMissing:
        return CloudCredentialRecoveryGatePresentation(
            title: aiSettingsLocalized(
                "settings.sync.recoveryGate.linkedCredentialsMissing.title",
                "Sign in again to reconnect"
            ),
            message: aiSettingsLocalized(
                "settings.sync.recoveryGate.linkedCredentialsMissing.body",
                "Secure sign-in credentials are missing on this device. Your local data is still here. Sign in with the original cloud account to reconnect it, or erase local data and start fresh."
            ),
            symbolName: "lock.shield"
        )
    case .invalidStoredState:
        return CloudCredentialRecoveryGatePresentation(
            title: aiSettingsLocalized(
                "settings.sync.recoveryGate.invalidStoredState.title",
                "Cloud recovery data is invalid"
            ),
            message: aiSettingsLocalized(
                "settings.sync.recoveryGate.invalidStoredState.body",
                "Cloud recovery data on this device is invalid. To keep the app safe, normal use is blocked. Erase local data and start fresh, or try signing in if recovery is still possible."
            ),
            symbolName: "exclamationmark.triangle"
        )
    }
}

#Preview {
    CloudCredentialRecoveryGateView(
        recoveryState: CloudCredentialRecoveryState(
            reason: .guestSessionMissing,
            previousCloudState: .guest,
            installationId: UUID().uuidString.lowercased(),
            linkedUserId: nil,
            linkedWorkspaceId: nil,
            activeWorkspaceId: nil,
            linkedEmail: nil,
            configurationMode: .official,
            apiBaseUrl: "https://api.flashcards-open-source-app.com/v1",
            detectedAt: formatIsoTimestamp(date: Date())
        )
    )
    .environment(FlashcardsStore())
}
