import SwiftUI

struct CloudNativeSignInOptions: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    let screen: AnalyticsSurface
    let onVerified: (CloudVerifiedAuthContext) -> Void
    @ScaledMetric(relativeTo: .body) private var buttonHeight: CGFloat = 48
    @State private var hintError: String?
    @State private var metadataError: String?
    @State private var metadataRequest = UUID()

    var body: some View {
        Section {
            VStack(spacing: 16) {
                if let methods = self.store.cloudSignInAttempt.nativeMethods {
                    if case .native = methods.methods.apple {
                        self.providerButton(.apple)
                    }
                    if case .native = methods.methods.google {
                        self.providerButton(.google)
                    }
                } else if self.metadataError == nil {
                    ProgressView().frame(maxWidth: .infinity)
                } else {
                    Button(aiSettingsLocalized("common.retry", "Retry")) {
                        self.metadataError = nil
                        self.metadataRequest = UUID()
                    }
                    .buttonStyle(.bordered)
                }
                CloudEmailSignInButton {
                    guard !self.store.cloudSignInAttempt.isMethodChangeBlocked else { return }
                    self.store.cloudSignInAttempt.authErrorPresentation = nil
                    self.store.cloudNativeSignIn.resetPendingSignIn()
                    self.store.cloudSignInAttempt.usesNativeSession = false
                    self.store.cloudSignInAttempt.isEmailSelected = true
                    self.store.cloudSignInAttempt.selectedMethod = .email
                    Analytics.track(.authMethodSelected(method: .email, screen: self.screen))
                }
                .frame(maxWidth: .infinity)
                .frame(height: self.buttonHeight)
                .accessibilityIdentifier(UITestIdentifier.cloudSignInEmailMethodButton)
                .modifier(CloudLastSignInBadge(method: .email))
                if self.store.cloudSignInAttempt.isNativeRequestInFlight {
                    ProgressView().frame(maxWidth: .infinity)
                }
                if let hintError = self.hintError {
                    Text(hintError).foregroundStyle(.red)
                    Button(aiSettingsLocalized("common.retry", "Retry")) {
                        self.metadataRequest = UUID()
                    }
                    .buttonStyle(.bordered)
                }
                if let metadataError = self.metadataError { Text(metadataError).foregroundStyle(.red) }
            }
            .padding(.vertical, 12)
            .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0))
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
        }
        .listSectionSeparator(.hidden)
        .disabled(self.store.cloudSignInAttempt.isMethodChangeBlocked)
        .task(id: self.metadataRequest) {
            let id = self.store.cloudSignInAttempt.id
            do {
                try self.store.cloudNativeSignIn.loadRememberedHint()
                self.hintError = nil
            } catch {
                self.presentHintError(error)
            }
            do {
                let configuration = try self.store.currentCloudServiceConfiguration()
                let methods = try await CloudSocialAuthService(session: .shared).metadata(
                    client: .currentNative, authBaseUrl: configuration.authBaseUrl)
                guard self.store.cloudSignInAttempt.id == id,
                      try self.store.currentCloudServiceConfiguration() == configuration else { return }
                self.metadataError = nil
                self.store.cloudSignInAttempt.nativeMethods = methods
            } catch {
                guard self.store.cloudSignInAttempt.id == id,
                      !isRequestCancellationError(error: error) else { return }
                self.metadataError = aiSettingsLocalized("settings.account.cloudSignIn.freshAttempt", "Sign-in did not finish. Start again to continue.")
                self.store.presentTechnicalError(error)
            }
        }
    }

    private func providerButton(_ provider: CloudAuthProvider) -> some View {
        CloudBrandedProviderButton(provider: provider, onPress: { presenter in
            self.begin(provider: provider, presenter: presenter)
        })
        .accessibilityIdentifier("cloudSignIn.\(provider.rawValue)")
        .modifier(CloudLastSignInBadge(method: CloudSignInMethod(provider: provider)))
    }

    private func begin(provider: CloudAuthProvider, presenter: UIViewController) {
        guard !self.store.cloudSignInAttempt.isMethodChangeBlocked else { return }
        let id = self.store.cloudSignInAttempt.id
        self.store.cloudSignInAttempt.selectedMethod = CloudSignInMethod(provider: provider)
        self.store.cloudSignInAttempt.usesNativeSession = false
        self.store.cloudSignInAttempt.isEmailSelected = false
        self.store.cloudSignInAttempt.authErrorPresentation = nil
        self.store.cloudSignInAttempt.isNativeRequestInFlight = true
        self.store.cloudSignInAttempt.hasRequestedProvider = false
        Analytics.track(.authMethodSelected(method: CloudSignInMethod(provider: provider).analyticsMethod, screen: self.screen))
        self.store.cloudNativeSignIn.onStageChanged = { [weak store = self.store, screen = self.screen] stage in
            guard store?.cloudSignInAttempt.id == id else { return }
            recordNativeSignInStage(stage, screen: screen)
        }
        self.store.cloudNativeSignIn.onProviderRequested = { [weak store = self.store, screen = self.screen] provider in
            guard let store, store.cloudSignInAttempt.id == id else { return }
            store.cloudSignInAttempt.hasRequestedProvider = true
            Analytics.track(.authProviderRequested(method: provider == .apple ? .apple : .google, screen: screen))
        }
        self.store.cloudSignInAttempt.nativeTask = Task { @MainActor in
            guard self.store.cloudSignInAttempt.id == id, !Task.isCancelled else { return }
            let captureContext = self.store.beginTechnicalErrorCaptureContext()
            defer {
                if self.store.cloudSignInAttempt.id == id {
                    self.store.cloudSignInAttempt.isNativeRequestInFlight = false
                }
            }
            do {
                let result = try await self.store.cloudNativeSignIn.beginProviderSignIn(provider: provider,
                    configuration: try self.store.currentCloudServiceConfiguration(),
                    presentation: try CloudNativeAuthPresentation(viewController: presenter))
                guard self.store.cloudSignInAttempt.id == id else { return }
                switch result {
                case .sessionAccepted(let context):
                    self.store.cloudSignInAttempt.usesNativeSession = true
                    self.onVerified(context)
                case .mailboxRequired(let challenge):
                    self.store.cloudSignInAttempt.email = challenge.providerEmail ?? ""
                    self.store.cloudSignInAttempt.otpCode = ""
                    self.store.cloudSignInAttempt.isMailboxCodeSent = false
                    self.store.cloudSignInAttempt.mailboxNeedsRestart = false
                    self.store.cloudSignInAttempt.isMailboxPresented = true
                    Analytics.track(.authAccountLinkFinished(method: CloudSignInMethod(provider: provider).analyticsMethod,
                        outcome: .verificationRequired, screen: self.screen))
                }
            } catch {
                guard self.store.cloudSignInAttempt.id == id else { return }
                if self.store.cloudSignInAttempt.hasRequestedProvider {
                    recordNativeProviderError(error, stage: self.store.cloudNativeSignIn.stage, screen: self.screen)
                }
                if case CloudNativeAuthError.cancelled = error { return }
                if isRequestCancellationError(error: error) { return }
                recordNativeAccountLinkError(error, method: CloudSignInMethod(provider: provider).analyticsMethod, screen: self.screen)
                self.store.reportCloudSignInFailure(reason: analyticsSignInFailureReason(error: error))
                let isCleanupPending = isAppleSignInCleanupPending(error: error)
                self.store.cloudSignInAttempt.authErrorPresentation = CloudAuthInlineErrorPresentation(
                    role: isCleanupPending ? .information : .error,
                    message: isCleanupPending
                        ? appleSignInCleanupPendingMessage()
                        : aiSettingsLocalized("settings.account.cloudSignIn.freshAttempt", "Sign-in did not finish. Start again to continue."),
                    technicalError: self.store.makeTechnicalErrorAction(error: error, captureContext: captureContext))
            }
        }
    }

    private func presentHintError(_ error: Error) {
        self.hintError = aiSettingsLocalized("settings.account.cloudSignIn.hintFailed", "The remembered sign-in could not be updated. Try again.")
        self.store.presentTechnicalError(error)
    }
}

private struct CloudLastSignInBadge: ViewModifier {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    let method: CloudSignInMethod
    @State private var isPresented = false

    func body(content: Content) -> some View {
        if let hint = self.store.cloudNativeSignIn.rememberedHint, hint.method == self.method {
            content
                .help(hint.email.map(maskedCloudSignInEmail) ?? aiSettingsLocalized("settings.account.cloudSignIn.lastUsed", "Last used"))
                .overlay(alignment: .topTrailing) {
                    Button {
                        self.isPresented = !self.isPresented && hint.email != nil
                    } label: {
                        Text(aiSettingsLocalized("settings.account.cloudSignIn.lastUsed", "Last used"))
                            .font(.caption2)
                            .padding(.horizontal, 6).padding(.vertical, 3)
                            .background(.regularMaterial, in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .offset(y: -10)
                    .accessibilityIdentifier("cloudSignIn.lastUsed.\(self.method.rawValue)")
                    .popover(isPresented: self.$isPresented) {
                        if let email = hint.email {
                            Text(maskedCloudSignInEmail(email))
                                .font(.caption)
                                .padding(8)
                                .presentationCompactAdaptation(.popover)
                        }
                    }
                }
        } else {
            content
        }
    }
}

private func maskedCloudSignInEmail(_ email: String) -> String {
    let parts = email.split(separator: "@", maxSplits: 1)
    guard let local = parts.first, parts.count == 2 else { return "•••" }
    return "\(local.prefix(1))•••@\(parts[1])"
}
