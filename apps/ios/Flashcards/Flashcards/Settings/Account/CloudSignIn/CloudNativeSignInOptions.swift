import AuthenticationServices
import GoogleSignIn
import SwiftUI

struct CloudNativeSignInOptions: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    let screen: AnalyticsSurface
    let onVerified: (CloudVerifiedAuthContext) -> Void
    @State private var hintError: String?
    @State private var metadataError: String?
    @State private var metadataRequest = UUID()

    var body: some View {
        @Bindable var store = self.store
        Section {
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
            }
            Button {
                guard !self.store.cloudSignInAttempt.isMethodChangeBlocked else { return }
                self.store.cloudNativeSignIn.resetPendingSignIn()
                self.store.cloudSignInAttempt.usesNativeSession = false
                self.store.cloudSignInAttempt.isEmailSelected = true
                self.store.cloudSignInAttempt.selectedMethod = .email
                Analytics.track(.authMethodSelected(method: .email, screen: self.screen))
            } label: {
                Label(aiSettingsLocalized("common.email", "Email"), systemImage: "envelope")
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
            .accessibilityIdentifier(UITestIdentifier.cloudSignInEmailMethodButton)
            .modifier(CloudLastSignInBadge(method: .email, onError: { self.hintError = $0 }))
            if self.store.cloudSignInAttempt.isNativeRequestInFlight {
                ProgressView().frame(maxWidth: .infinity)
            }
            if let hintError = self.hintError {
                Text(hintError).foregroundStyle(.red)
                Button(aiSettingsLocalized("settings.account.cloudSignIn.forget", "Forget this sign-in")) {
                    do {
                        try self.store.cloudNativeSignIn.forgetRememberedHint()
                        self.hintError = nil
                        self.metadataRequest = UUID()
                    } catch { self.presentHintError(error) }
                }
            }
            if let metadataError = self.metadataError { Text(metadataError).foregroundStyle(.red) }
            Toggle(aiSettingsLocalized("settings.account.cloudSignIn.remember", "Remember this sign-in on this device"),
                isOn: $store.cloudSignInAttempt.rememberSignIn)
                .accessibilityIdentifier("cloudSignIn.remember")
                .onChange(of: self.store.cloudSignInAttempt.rememberSignIn) { _, remember in
                    if !remember {
                        do { try self.store.cloudNativeSignIn.forgetRememberedHint() }
                        catch { self.presentHintError(error) }
                    }
                }
        }
        .disabled(self.store.cloudSignInAttempt.isMethodChangeBlocked)
        .task(id: self.metadataRequest) {
            let id = self.store.cloudSignInAttempt.id
            do {
                try self.store.cloudNativeSignIn.loadRememberedHint()
                if self.store.cloudNativeSignIn.rememberedHint != nil {
                    self.store.cloudSignInAttempt.rememberSignIn = true
                }
            } catch {
                self.presentHintError(error)
            }
            do {
                let configuration = try self.store.currentCloudServiceConfiguration()
                let methods = try await CloudSocialAuthService(session: .shared).metadata(
                    client: .currentNative, authBaseUrl: configuration.authBaseUrl)
                guard self.store.cloudSignInAttempt.id == id,
                      try self.store.currentCloudServiceConfiguration() == configuration else { return }
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
        .frame(height: 50)
        .accessibilityIdentifier("cloudSignIn.\(provider.rawValue)")
        .modifier(CloudLastSignInBadge(method: CloudSignInMethod(provider: provider), onError: { self.hintError = $0 }))
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
            defer {
                if self.store.cloudSignInAttempt.id == id {
                    self.store.cloudSignInAttempt.isNativeRequestInFlight = false
                }
            }
            do {
                let result = try await self.store.cloudNativeSignIn.beginProviderSignIn(provider: provider,
                    configuration: try self.store.currentCloudServiceConfiguration(),
                    presentation: try CloudNativeAuthPresentation(viewController: presenter),
                    remember: self.store.cloudSignInAttempt.rememberSignIn)
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
                self.store.cloudSignInAttempt.authErrorPresentation = CloudAuthInlineErrorPresentation(
                    message: aiSettingsLocalized("settings.account.cloudSignIn.freshAttempt", "Sign-in did not finish. Start again to continue."),
                    technicalError: self.store.makeTechnicalErrorAction(error: error))
            }
        }
    }

    private func presentHintError(_ error: Error) {
        self.hintError = aiSettingsLocalized("settings.account.cloudSignIn.hintFailed", "The remembered sign-in could not be updated. Try again.")
        self.store.presentTechnicalError(error)
    }
}

private struct CloudBrandedProviderButton: UIViewRepresentable {
    let provider: CloudAuthProvider
    let onPress: (UIViewController) -> Void

    func makeUIView(context: Context) -> UIControl {
        let button: UIControl
        switch self.provider {
        case .apple:
            button = ASAuthorizationAppleIDButton(type: .continue, style: .white)
        case .google:
            let google = GIDSignInButton()
            google.style = .wide
            google.colorScheme = .light
            button = google
        }
        button.addTarget(context.coordinator, action: #selector(Coordinator.pressed(_:)), for: .touchUpInside)
        return button
    }

    func updateUIView(_ view: UIControl, context: Context) {
        view.isEnabled = context.environment.isEnabled
        context.coordinator.onPress = self.onPress
    }
    func makeCoordinator() -> Coordinator { Coordinator(onPress: self.onPress) }

    final class Coordinator: NSObject {
        var onPress: (UIViewController) -> Void
        init(onPress: @escaping (UIViewController) -> Void) { self.onPress = onPress }
        @objc func pressed(_ sender: UIControl) {
            guard var presenter = sender.window?.rootViewController else { return }
            while let presented = presenter.presentedViewController { presenter = presented }
            self.onPress(presenter)
        }
    }
}

private struct CloudLastSignInBadge: ViewModifier {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    let method: CloudSignInMethod
    let onError: (String) -> Void
    @State private var isPresented = false
    @State private var isEmailRevealed = false
    @FocusState private var isFocused: Bool
    @FocusState private var isMethodFocused: Bool

    func body(content: Content) -> some View {
        if let hint = self.store.cloudNativeSignIn.rememberedHint, hint.method == self.method {
            content
                .help(hint.email ?? self.method.rawValue.capitalized)
                .focused(self.$isMethodFocused)
                .onChange(of: self.isMethodFocused) { _, focused in
                    self.isEmailRevealed = focused
                    self.isPresented = focused
                }
                .overlay(alignment: .topTrailing) {
                    Button {
                        self.isPresented.toggle()
                    } label: {
                        Text(aiSettingsLocalized("settings.account.cloudSignIn.lastUsed", "Last used"))
                            .font(.caption2)
                            .padding(.horizontal, 6).padding(.vertical, 3)
                            .background(.regularMaterial, in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .focused(self.$isFocused)
                    .onChange(of: self.isFocused) { _, focused in
                        self.isEmailRevealed = focused
                        self.isPresented = focused
                    }
                    .accessibilityIdentifier("cloudSignIn.lastUsed.\(self.method.rawValue)")
                    .popover(isPresented: self.$isPresented) {
                        VStack(alignment: .leading, spacing: 12) {
                            if let email = hint.email {
                                Text(self.isEmailRevealed ? email : maskedCloudSignInEmail(email))
                                    .textSelection(.enabled)
                                Button(aiSettingsLocalized("settings.account.cloudSignIn.showEmail", "Show email")) {
                                    self.isEmailRevealed = true
                                }
                                Button(aiSettingsLocalized("common.copy", "Copy")) { UIPasteboard.general.string = email }
                            }
                            Button(aiSettingsLocalized("settings.account.cloudSignIn.forget", "Forget this sign-in"), role: .destructive) {
                                do { try self.store.cloudNativeSignIn.forgetRememberedHint() }
                                catch {
                                    self.onError(aiSettingsLocalized("settings.account.cloudSignIn.hintFailed", "The remembered sign-in could not be updated. Try again."))
                                    self.store.presentTechnicalError(error)
                                }
                                self.isPresented = false
                            }
                        }
                        .padding()
                        .presentationCompactAdaptation(.popover)
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
