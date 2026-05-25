import SwiftUI

struct CloudOtpVerificationSheet: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore

    @Binding var otpSheetState: CloudOtpSheetState?
    let onVerified: (CloudVerifiedAuthContext) -> Void
    let onReturnToEmail: () -> Void

    @State private var code: String = ""
    @State private var authErrorPresentation: CloudAuthInlineErrorPresentation?
    @State private var isVerifyingCode: Bool = false
    @State private var isSendingCode: Bool = false
    @State private var challengeState: OtpChallengeState = .active
    @FocusState private var isCodeFieldFocused: Bool

    private enum OtpChallengeState: Hashable {
        case active
        case consumed
        case expired
    }

    init(
        otpSheetState: Binding<CloudOtpSheetState?>,
        onVerified: @escaping (CloudVerifiedAuthContext) -> Void,
        onReturnToEmail: @escaping () -> Void
    ) {
        self._otpSheetState = otpSheetState
        self.onVerified = onVerified
        self.onReturnToEmail = onReturnToEmail
    }

    var body: some View {
        NavigationStack {
            ReadableContentLayout(
                maxWidth: flashcardsReadableFormMaxWidth,
                horizontalPadding: 0
            ) {
                Form {
                    if let authErrorPresentation = self.authErrorPresentation {
                        Section {
                            CloudAuthInlineErrorView(presentation: authErrorPresentation)
                        }
                    }

                    Section(aiSettingsLocalized("common.email", "Email")) {
                        Text(self.currentEmail)
                            .textSelection(.enabled)
                    }

                    Section(aiSettingsLocalized("settings.account.cloudSignIn.oneTimeCode", "One-time code")) {
                        if self.currentChallenge == nil {
                            Text(aiSettingsLocalized("settings.account.cloudSignIn.sendingCode", "Sending the code…"))
                                .foregroundStyle(.secondary)

                            HStack {
                                Spacer()
                                ProgressView()
                                    .progressViewStyle(.circular)
                                Spacer()
                            }
                            .padding(.vertical, 8)
                        } else {
                            Text(self.challengePrompt)
                                .foregroundStyle(.secondary)

                            if self.challengeState == .active {
                                TextField(aiSettingsLocalized("settings.account.cloudSignIn.codePlaceholder", "12345678"), text: self.$code)
                                    .textInputAutocapitalization(.never)
                                    .autocorrectionDisabled()
                                    .keyboardType(.numberPad)
                                    .textContentType(.oneTimeCode)
                                    .focused(self.$isCodeFieldFocused)

                                Button(aiSettingsLocalized("common.continue", "Continue")) {
                                    self.verifyCode()
                                }
                                .disabled(self.isVerifyingCode || self.isSendingCode || normalizedOtpCode(self.code).isEmpty)
                            } else {
                                Button(aiSettingsLocalized("settings.account.cloudSignIn.resendCode", "Resend code")) {
                                    self.resendCode()
                                }
                                .disabled(self.isSendingCode || self.isVerifyingCode)
                            }
                        }
                    }
                }
            }
            .navigationTitle(aiSettingsLocalized("settings.account.cloudSignIn.verifyCodeTitle", "Verify code"))
            .navigationBarTitleDisplayMode(.inline)
            .onChange(of: self.currentChallenge) { _, nextChallenge in
                guard nextChallenge != nil, self.challengeState == .active else {
                    return
                }

                self.scheduleCodeFieldFocus()
            }
            .onChange(of: self.challengeState) { _, nextChallengeState in
                guard nextChallengeState == .active, self.currentChallenge != nil else {
                    self.isCodeFieldFocused = false
                    return
                }

                self.scheduleCodeFieldFocus()
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(aiSettingsLocalized("common.back", "Back")) {
                        self.onReturnToEmail()
                    }
                    .disabled(self.isVerifyingCode || self.isSendingCode || self.currentChallenge == nil)
                }

                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()

                    Button(aiSettingsLocalized("common.done", "Done")) {
                        self.isCodeFieldFocused = false
                    }
                }
            }
        }
    }

    private var currentEmail: String {
        self.currentChallenge?.email ?? self.otpSheetState?.email ?? ""
    }

    private var currentChallenge: CloudOtpChallenge? {
        self.otpSheetState?.challenge
    }

    private var challengePrompt: String {
        switch self.challengeState {
        case .active:
            return aiSettingsLocalized("settings.account.cloudSignIn.challengePrompt.active", "Enter the 8-digit code from your email. If you don't see it, check your spam folder.")
        case .consumed:
            return aiSettingsLocalized("settings.account.cloudSignIn.challengePrompt.consumed", "This code was already used. Request a new code to continue.")
        case .expired:
            return aiSettingsLocalized("settings.account.cloudSignIn.challengePrompt.expired", "This code expired. Request a new code to continue.")
        }
    }

    private func scheduleCodeFieldFocus() {
        DispatchQueue.main.async {
            self.isCodeFieldFocused = true
        }
    }

    private func verifyCode() {
        self.isCodeFieldFocused = false

        let nextCode = normalizedOtpCode(self.code)
        guard nextCode.isEmpty == false else {
            self.authErrorPresentation = CloudAuthInlineErrorPresentation(
                message: aiSettingsLocalized("settings.account.cloudSignIn.codeRequired", "Code is required"),
                technicalDetails: nil
            )
            return
        }
        guard let currentChallenge = self.currentChallenge else {
            self.authErrorPresentation = CloudAuthInlineErrorPresentation(
                message: aiSettingsLocalized("settings.account.cloudSignIn.codeStillLoading", "Code is still loading"),
                technicalDetails: nil
            )
            return
        }

        Task { @MainActor in
            self.isVerifyingCode = true
            defer {
                self.isVerifyingCode = false
            }

            do {
                let verifiedContext = try await self.store.verifyCloudOtp(
                    challenge: currentChallenge,
                    code: nextCode
                )
                self.code = ""
                self.challengeState = .consumed
                self.authErrorPresentation = nil
                self.onVerified(verifiedContext)
            } catch {
                self.applyOtpErrorState(error: error)
                self.authErrorPresentation = makeCloudAuthInlineErrorPresentation(
                    error: error,
                    context: .verifyCode
                )
            }
        }
    }

    private func resendCode() {
        let currentEmail = self.currentEmail
        Task { @MainActor in
            self.isSendingCode = true
            defer {
                self.isSendingCode = false
            }

            do {
                let sendCodeResult = try await self.store.sendCloudSignInCode(email: currentEmail)

                switch sendCodeResult {
                case .otpChallenge(let nextChallenge):
                    self.otpSheetState = self.otpSheetState?.withChallenge(nextChallenge)
                    self.code = ""
                    self.authErrorPresentation = nil
                    self.challengeState = .active
                case .verifiedCredentials:
                    throw LocalStoreError.validation("Demo review sign-in cannot resend an OTP challenge")
                }
            } catch {
                self.authErrorPresentation = makeCloudAuthInlineErrorPresentation(
                    error: error,
                    context: .sendCode
                )
            }
        }
    }

    private func applyOtpErrorState(error: Error) {
        guard let authError = error as? CloudAuthError else {
            return
        }

        switch authError {
        case .invalidResponse(let details, _):
            if details.code == "OTP_SESSION_EXPIRED" {
                self.code = ""
                self.challengeState = .expired
            }

            if details.code == "OTP_CHALLENGE_CONSUMED" {
                self.code = ""
                self.challengeState = .consumed
            }
        case .invalidBaseUrl, .invalidResponseBody:
            return
        }
    }
}
