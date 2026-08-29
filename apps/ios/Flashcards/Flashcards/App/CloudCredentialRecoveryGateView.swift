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
        .onAppear {
            // The gate replaces the whole app root, so it is a screen of its own rather than
            // something over a tab, and while it is up the tab root does not exist to report one.
            Analytics.trackScreenViewed(.credentialRecovery)
        }
        .onDisappear {
            // Clearing the gate swaps the tab root back in with the visible tab unchanged, which the
            // tab root reports as a launch-time view and therefore stays silent about. This is the
            // only place the screen the person lands on can be named.
            //
            // `signin` is accepted alongside the gate's own surface because the flow the gate exists
            // for ends while its sign-in sheet is still on screen: `completeCloudLink` and
            // `completeGuestLocalRecoveryCloudLink` clear the recovery state from under it, and
            // removing the gate destroys that sheet's presenter without an `onDismiss`, so
            // `endCloudSignInAttempt` never runs to hand the surface back. Restoring from `signin`
            // too is what keeps that success path from leaving the tracker parked on the sign-in
            // screen, where the next `permission_prompt_answered` would be stamped `signin` and the
            // person's genuine next arrival on this tab would be swallowed by the dedupe.
            //
            // Accepted only for the gate's *own* sheet, which is what this view's own presentation
            // state answers and no shared counter can. A gate that opened and closed over a sheet
            // the tab root was already presenting leaves that binding true, so `RootTabView` installs
            // a fresh `CloudSignInSheetModifier` that presents immediately and reports `signin` — and
            // whether that lands before or after this callback is not ordered. Accepting `signin`
            // unconditionally would lose that race by parking the tracker on the tab while the sheet
            // is on screen, and `endCloudSignInAttempt` would then refuse its own restore. The gate
            // never presented that sheet, so this flag is false for it either way round.
            Analytics.trackScreenViewedOnDismiss(
                ofAnyOf: self.isCloudSignInPresented
                    ? [.credentialRecovery, .signin]
                    : [.credentialRecovery],
                restoring: analyticsSurface(tab: self.store.currentVisibleTab)
            )
        }
        .cloudSignInSheet(
            isPresented: self.$isCloudSignInPresented,
            presentationContext: .credentialRecoveryGate
        )
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
    case .linkedWorkspaceUnavailable:
        return CloudCredentialRecoveryGatePresentation(
            title: aiSettingsLocalized(
                "settings.sync.recoveryGate.linkedWorkspaceUnavailable.title",
                "Cloud workspace access changed"
            ),
            message: aiSettingsLocalized(
                "settings.sync.recoveryGate.linkedWorkspaceUnavailable.body",
                "This device can no longer access its linked cloud workspace. Your local cards, reviews, pending changes, and media are being kept safe. After the original account and workspace access are restored, sign in again to retry, or erase local data and start fresh."
            ),
            symbolName: "externaldrive.badge.exclamationmark"
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
