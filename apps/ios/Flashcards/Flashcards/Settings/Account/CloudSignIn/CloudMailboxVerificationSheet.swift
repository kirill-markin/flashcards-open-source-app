import SwiftUI

struct CloudMailboxVerificationSheet: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    let attemptId: String
    let screen: AnalyticsSurface
    let onVerified: (CloudVerifiedAuthContext) -> Void
    @State private var errorMessage: String?

    var body: some View {
        @Bindable var store = self.store
        NavigationStack {
            TimelineView(.periodic(from: .now, by: 1)) { timeline in
                let expired = self.store.cloudNativeSignIn.mailboxChallenge
                    .flatMap { parseIsoTimestamp(value: $0.login.response.expiresAt) }
                    .map { $0 <= timeline.date } ?? true
                Form {
                    Section {
                        Text(aiSettingsLocalized("settings.account.cloudSignIn.mailboxPrompt",
                            "Verify access to your email. Enter the 6–8 digit code. Check spam if needed."))
                        if let errorMessage = self.errorMessage { Text(errorMessage).foregroundStyle(.red) }
                        if expired || self.store.cloudSignInAttempt.mailboxNeedsRestart {
                            if self.errorMessage == nil {
                                Text(aiSettingsLocalized("settings.account.cloudSignIn.freshAttempt",
                                    "Sign-in did not finish. Start again to continue."))
                            }
                            Button(aiSettingsLocalized("settings.account.cloudSignIn.restart", "Start again")) { self.restart() }
                                .accessibilityIdentifier("cloudSignIn.mailboxRestart")
                        } else {
                            TextField(aiSettingsLocalized("common.email", "Email"), text: $store.cloudSignInAttempt.email)
                                .keyboardType(.emailAddress).textContentType(.emailAddress)
                                .textInputAutocapitalization(.never).autocorrectionDisabled()
                                .disabled(self.store.cloudSignInAttempt.isMailboxCodeSent)
                                .accessibilityIdentifier("cloudSignIn.mailboxEmail")
                            if self.store.cloudSignInAttempt.isMailboxCodeSent {
                                TextField(aiSettingsLocalized("settings.account.cloudSignIn.oneTimeCode", "One-time code"),
                                    text: $store.cloudSignInAttempt.otpCode)
                                    .keyboardType(.numberPad).textContentType(.oneTimeCode)
                                    .accessibilityIdentifier("cloudSignIn.mailboxCode")
                                Button(aiSettingsLocalized("common.continue", "Continue")) { self.verify() }
                                    .disabled(normalizedOtpCode(self.store.cloudSignInAttempt.otpCode)
                                        .range(of: "^[0-9]{6,8}$", options: .regularExpression) == nil)
                                    .accessibilityIdentifier("cloudSignIn.mailboxVerify")
                            }
                            if self.store.cloudSignInAttempt.isMailboxCodeSent {
                                Button(aiSettingsLocalized("settings.account.cloudSignIn.restart", "Start again")) { self.restart() }
                                    .accessibilityIdentifier("cloudSignIn.mailboxRestart")
                            } else {
                                Button(aiSettingsLocalized("settings.account.cloudSignIn.sendOneTimeCode", "Send one-time code")) {
                                    self.send()
                                }
                                .disabled(!isValidCloudEmail(self.store.cloudSignInAttempt.email))
                                .accessibilityIdentifier("cloudSignIn.mailboxSend")
                            }
                        }
                        if self.store.cloudSignInAttempt.isNativeRequestInFlight { ProgressView() }
                    }
                    .disabled(self.store.cloudSignInAttempt.isNativeRequestInFlight)
                }
            }
            .navigationTitle(aiSettingsLocalized("settings.account.cloudSignIn.verifyCodeTitle", "Verify code"))
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(aiSettingsLocalized("common.back", "Back")) { self.restart() }
                        .disabled(self.store.cloudSignInAttempt.isNativeRequestInFlight)
                }
            }
            .interactiveDismissDisabled(self.store.cloudSignInAttempt.isNativeRequestInFlight)
            .onChange(of: self.store.cloudSignInAttempt.isMailboxCodeSent, initial: true) { _, sent in
                if sent { Analytics.track(.authCodeFormShown(method: self.method, screen: self.screen)) }
            }
        }
    }

    private var method: AnalyticsAuthMethod { self.store.cloudSignInAttempt.selectedMethod.analyticsMethod }

    private func restart() {
        self.store.cloudNativeSignIn.resetPendingSignIn()
        self.store.cloudSignInAttempt.isMailboxPresented = false
        self.store.cloudSignInAttempt.otpCode = ""
        self.store.cloudSignInAttempt.isMailboxCodeSent = false
    }

    private func send() {
        let email = normalizedCloudEmail(self.store.cloudSignInAttempt.email)
        let method = self.method
        guard !self.store.cloudSignInAttempt.isMailboxCodeSent else { return }
        self.perform {
            do {
                try await self.store.cloudNativeSignIn.sendMailboxCode(email: email)
                guard self.store.cloudSignInAttempt.id == self.attemptId else { return }
                self.store.cloudSignInAttempt.isMailboxCodeSent = true
                self.store.cloudSignInAttempt.otpCode = ""
                Analytics.track(.authCodeRequestFinished(method: method, action: .initial, outcome: .accepted, screen: self.screen))
                Analytics.track(.signInCodeRequestedWithMethod(method: method, screen: self.screen))
            } catch {
                guard self.store.cloudSignInAttempt.id == self.attemptId,
                      !isRequestCancellationError(error: error) else { return }
                self.store.cloudSignInAttempt.mailboxNeedsRestart = true
                self.store.cloudNativeSignIn.resetPendingSignIn()
                Analytics.track(.authCodeRequestFinished(method: method, action: .initial,
                    outcome: nativeCodeRequestOutcome(error), screen: self.screen))
                throw error
            }
        }
    }

    private func verify() {
        let code = normalizedOtpCode(self.store.cloudSignInAttempt.otpCode)
        let method = self.method
        Analytics.track(.authCodeSubmitted(method: method, screen: self.screen))
        self.perform {
            do {
                let context = try await self.store.cloudNativeSignIn.verifyMailboxCode(code: code)
                guard self.store.cloudSignInAttempt.id == self.attemptId else { return }
                Analytics.track(.authCodeVerificationFinished(method: method, outcome: .verified, screen: self.screen))
                self.store.cloudSignInAttempt.usesNativeSession = true
                self.store.cloudSignInAttempt.isMailboxPresented = false
                self.onVerified(context)
            } catch {
                guard self.store.cloudSignInAttempt.id == self.attemptId,
                      !isRequestCancellationError(error: error) else { return }
                // The server may have consumed verification before token redemption failed.
                recordNativeAccountLinkError(error, method: method, screen: self.screen)
                self.store.cloudSignInAttempt.mailboxNeedsRestart = true
                self.store.cloudNativeSignIn.resetPendingSignIn()
                throw error
            }
        }
    }

    private func perform(_ operation: @escaping @MainActor () async throws -> Void) {
        guard self.store.cloudSignInAttempt.id == self.attemptId,
              !self.store.cloudSignInAttempt.isNativeRequestInFlight else { return }
        self.store.cloudSignInAttempt.isNativeRequestInFlight = true
        self.errorMessage = nil
        let id = self.attemptId
        self.store.cloudSignInAttempt.nativeTask = Task { @MainActor in
            defer {
                if self.store.cloudSignInAttempt.id == id { self.store.cloudSignInAttempt.isNativeRequestInFlight = false }
            }
            do {
                guard self.store.cloudSignInAttempt.id == id, !Task.isCancelled else { return }
                try await operation()
            }
            catch {
                guard self.store.cloudSignInAttempt.id == id, !isRequestCancellationError(error: error) else { return }
                self.errorMessage = aiSettingsLocalized("settings.account.cloudSignIn.freshAttempt",
                    "Sign-in did not finish. Start again to continue.")
                self.store.presentTechnicalError(error)
            }
        }
    }
}
