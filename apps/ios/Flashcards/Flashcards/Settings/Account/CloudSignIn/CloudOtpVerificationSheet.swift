import SwiftUI

/**
 * The code step's content, which SwiftUI may destroy and rebuild while the step stays on screen.
 * What the person typed, the inline error they are reading and how much of the challenge is spent
 * describe the attempt and live in `store.cloudSignInAttempt`, so a rebuild leaves them where they
 * were; keyboard focus and the technical-error inspector describe this view instance and stay here.
 */
struct CloudOtpVerificationSheet: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore

    /// The attempt this code step belongs to. Everything the step writes is a write into the store,
    /// so a request that outlives this sheet would otherwise write the previous attempt's code step
    /// into whichever attempt replaced it. The attempt is the coarser half of that check: one attempt
    /// hosts a new code step for every code it sends, so each request below also carries the
    /// `CloudOtpSheetState.id` it was started for before it writes the step's own state.
    let attemptId: String
    @Binding var otpSheetState: CloudOtpSheetState?
    let onVerified: (CloudVerifiedAuthContext) -> Void
    let onReturnToEmail: () -> Void

    @State private var technicalErrorPresentation: TechnicalErrorPresentation?
    @FocusState private var isCodeFieldFocused: Bool

    init(
        attemptId: String,
        otpSheetState: Binding<CloudOtpSheetState?>,
        onVerified: @escaping (CloudVerifiedAuthContext) -> Void,
        onReturnToEmail: @escaping () -> Void
    ) {
        self.attemptId = attemptId
        self._otpSheetState = otpSheetState
        self.onVerified = onVerified
        self.onReturnToEmail = onReturnToEmail
    }

    var body: some View {
        @Bindable var store = self.store

        NavigationStack {
            ReadableContentLayout(
                maxWidth: flashcardsReadableFormMaxWidth,
                horizontalPadding: 0
            ) {
                Form {
                    if let authErrorPresentation = self.store.cloudSignInAttempt.otpAuthErrorPresentation {
                        Section {
                            CloudAuthInlineErrorView(
                                presentation: authErrorPresentation,
                                onTechnicalError: { technicalError in
                                    self.presentTechnicalError(technicalError)
                                }
                            )
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

                            if self.store.cloudSignInAttempt.otpChallengeState == .active {
                                TextField(aiSettingsLocalized("settings.account.cloudSignIn.codePlaceholder", "12345678"), text: $store.cloudSignInAttempt.otpCode)
                                    .textInputAutocapitalization(.never)
                                    .autocorrectionDisabled()
                                    .keyboardType(.numberPad)
                                    .textContentType(.oneTimeCode)
                                    .focused(self.$isCodeFieldFocused)

                                Button(aiSettingsLocalized("common.continue", "Continue")) {
                                    self.verifyCode()
                                }
                                .disabled(self.isRequestInFlight || normalizedOtpCode(self.store.cloudSignInAttempt.otpCode).isEmpty)
                            } else {
                                Button(aiSettingsLocalized("settings.account.cloudSignIn.resendCode", "Resend code")) {
                                    self.resendCode()
                                }
                                .disabled(self.isRequestInFlight)
                            }
                        }
                    }
                }
            }
            .navigationTitle(aiSettingsLocalized("settings.account.cloudSignIn.verifyCodeTitle", "Verify code"))
            .navigationBarTitleDisplayMode(.inline)
            .onChange(of: self.currentChallenge) { _, nextChallenge in
                guard nextChallenge != nil, self.store.cloudSignInAttempt.otpChallengeState == .active else {
                    return
                }

                self.scheduleCodeFieldFocus()
            }
            .onChange(of: self.store.cloudSignInAttempt.otpChallengeState) { _, nextChallengeState in
                guard nextChallengeState == .active, self.currentChallenge != nil else {
                    self.isCodeFieldFocused = false
                    return
                }

                self.scheduleCodeFieldFocus()
            }
            // Focus is one of the two things a rebuild is still allowed to lose — the open
            // technical-error inspector is the other — because both describe this view instance. A
            // new instance that opens straight onto a usable code field takes focus back, the way
            // `CloudSignInSheet` does for the email field; neither `onChange` above fires for a
            // rebuild, because nothing about the attempt changed.
            .onAppear {
                self.scheduleCodeFieldFocusIfCodeEntryVisible()
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(aiSettingsLocalized("common.back", "Back")) {
                        self.onReturnToEmail()
                    }
                    .disabled(self.isRequestInFlight || self.currentChallenge == nil)
                }

                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()

                    Button(aiSettingsLocalized("common.done", "Done")) {
                        self.isCodeFieldFocused = false
                    }
                }
            }
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

    private var currentEmail: String {
        self.currentChallenge?.email ?? self.otpSheetState?.email ?? ""
    }

    private var currentChallenge: CloudOtpChallenge? {
        self.otpSheetState?.challenge
    }

    private var isRequestInFlight: Bool {
        self.store.cloudSignInAttempt.isVerifyingOtpCode
            || self.store.cloudSignInAttempt.isResendingOtpCode
    }

    private var challengePrompt: String {
        switch self.store.cloudSignInAttempt.otpChallengeState {
        case .active:
            return aiSettingsLocalized("settings.account.cloudSignIn.challengePrompt.active", "Enter the 8-digit code from your email. If you don't see it, check your spam folder.")
        case .consumed:
            return aiSettingsLocalized("settings.account.cloudSignIn.challengePrompt.consumed", "This code was already used. Request a new code to continue.")
        case .expired:
            return aiSettingsLocalized("settings.account.cloudSignIn.challengePrompt.expired", "This code expired. Request a new code to continue.")
        case .tooManyAttempts:
            return aiSettingsLocalized("settings.account.cloudSignIn.challengePrompt.tooManyAttempts", "Too many attempts. Request a new code to continue.")
        }
    }

    private func scheduleCodeFieldFocus() {
        DispatchQueue.main.async {
            self.isCodeFieldFocused = true
        }
    }

    /// A rebuilt instance takes focus back only where the un-rebuilt one would have held it. That
    /// excludes a request in flight: `verifyCode` drops the keyboard as submission feedback, and
    /// raising it again over a disabled Continue button would put the rebuilt instance in a state the
    /// person could not have reached by staying on the screen.
    private func scheduleCodeFieldFocusIfCodeEntryVisible() {
        guard self.currentChallenge != nil,
              self.store.cloudSignInAttempt.otpChallengeState == .active,
              self.isRequestInFlight == false else {
            return
        }

        self.scheduleCodeFieldFocus()
    }

    private func verifyCode() {
        self.isCodeFieldFocused = false

        let nextCode = normalizedOtpCode(self.store.cloudSignInAttempt.otpCode)
        guard nextCode.isEmpty == false else {
            self.store.cloudSignInAttempt.otpAuthErrorPresentation = CloudAuthInlineErrorPresentation(
                message: aiSettingsLocalized("settings.account.cloudSignIn.codeRequired", "Code is required"),
                technicalError: nil
            )
            return
        }
        guard let currentOtpSheetState = self.otpSheetState,
              let currentChallenge = currentOtpSheetState.challenge else {
            self.store.cloudSignInAttempt.otpAuthErrorPresentation = CloudAuthInlineErrorPresentation(
                message: aiSettingsLocalized("settings.account.cloudSignIn.codeStillLoading", "Code is still loading"),
                technicalError: nil
            )
            return
        }

        // The code step this verify belongs to. One attempt hosts as many code steps as the person
        // asks for — `CloudSignInSheet.sendCode` opens a fresh `CloudOtpSheetState` every time — so
        // the attempt `id` alone cannot tell this challenge's result from the challenge now on
        // screen. This is the second level of `sendCode`'s own guard, applied to the step's state.
        let otpSheetStateId = currentOtpSheetState.id

        // Raised here rather than inside the task, for the reason `CloudSignInSheet.sendCode` gives:
        // the attempt that owns the request is the one that carries the flag, and a raise deferred to
        // the task's first hop could land on an attempt that replaced this one and leave its Continue
        // button disabled for good.
        self.store.cloudSignInAttempt.isVerifyingOtpCode = true

        Task { @MainActor in
            let captureContext = self.store.beginTechnicalErrorCaptureContext()
            defer {
                self.finishVerifyingCode()
            }

            do {
                let verifiedContext = try await self.store.verifyCloudOtp(
                    challenge: currentChallenge,
                    code: nextCode,
                    captureContext: captureContext
                )
                // The verify request outlives this sheet, so its result belongs to the attempt it was
                // started for and is spent against neither the screen state nor the post-auth work of
                // whichever attempt replaced that one.
                guard self.store.cloudSignInAttempt.id == self.attemptId else {
                    return
                }

                // Inside that attempt the entry state belongs to the code step this verify was
                // started for, so a superseded challenge does not spend the one on screen or wipe
                // what the person has typed into it. The verified credentials stay attempt-scoped:
                // `sendCode` completes its own `verifiedCredentials` result outside the equivalent
                // sheet-state guard, and an authentication that succeeded is still this attempt's.
                if self.store.cloudSignInAttempt.otpSheetState?.id == otpSheetStateId {
                    self.store.cloudSignInAttempt.otpCode = ""
                    self.store.cloudSignInAttempt.otpChallengeState = .consumed
                    self.store.cloudSignInAttempt.otpAuthErrorPresentation = nil
                }

                self.onVerified(verifiedContext)
            } catch {
                // Its failure belongs to that same attempt, and is neither reported nor settled
                // against the one that replaced it — the same shape as `resendCode`'s catch.
                guard self.store.cloudSignInAttempt.id == self.attemptId else {
                    return
                }
                if isRequestCancellationError(error: error) {
                    return
                }
                self.store.reportCloudSignInFailure(reason: analyticsSignInFailureReason(error: error))
                // What the challenge has left, and the message the person reads about it, belong to
                // the code step this verify was started for. Without this a superseded challenge's
                // "This code expired." lands on a code that has just arrived, over typing it wipes.
                guard self.store.cloudSignInAttempt.otpSheetState?.id == otpSheetStateId else {
                    return
                }
                self.applyOtpErrorState(error: error)
                self.presentAuthErrorPresentation(
                    makeCloudAuthInlineErrorPresentation(
                        error: error,
                        context: .verifyCode
                    ),
                    captureContext: captureContext
                )
            }
        }
    }

    /// Attempt-scoped on purpose, unlike everything the request writes into the code step: the flag
    /// says a request this attempt started is running, and only the attempt that carries it can
    /// lower it. Refusing to lower it for a superseded code step would leave the flag raised on the
    /// live attempt for good, with Continue and Back disabled underneath it.
    private func finishVerifyingCode() {
        guard self.store.cloudSignInAttempt.id == self.attemptId else {
            return
        }

        self.store.cloudSignInAttempt.isVerifyingOtpCode = false
    }

    private func resendCode() {
        // The code step this resend belongs to, captured for the same reason `verifyCode` captures
        // it. A resend keeps the step's `id` — `withChallenge` carries it over — so the challenge is
        // replaced inside the step, and the continuations below can still tell that step from one
        // `CloudSignInSheet.sendCode` opened in its place. There is nothing to resend into without
        // one, and returning here leaves the in-flight flag below unraised.
        guard let otpSheetStateId = self.otpSheetState?.id else {
            return
        }

        let currentEmail = self.currentEmail
        // Raised before the task for the same reason `verifyCode` raises its flag there.
        self.store.cloudSignInAttempt.isResendingOtpCode = true

        Task { @MainActor in
            let captureContext = self.store.beginTechnicalErrorCaptureContext()
            defer {
                self.finishResendingCode()
            }

            do {
                let sendCodeResult = try await self.store.sendCloudSignInCode(
                    email: currentEmail,
                    captureContext: captureContext
                )

                switch sendCodeResult {
                case .otpChallenge(let nextChallenge):
                    // The challenge and the empty entry state it comes with belong to the code step
                    // this resend was started for. A step that replaced it is holding a newer
                    // challenge of its own, which this one must neither overwrite nor clear.
                    guard self.store.cloudSignInAttempt.id == self.attemptId,
                          self.store.cloudSignInAttempt.otpSheetState?.id == otpSheetStateId else {
                        return
                    }

                    self.otpSheetState = self.otpSheetState?.withChallenge(nextChallenge)
                    self.store.cloudSignInAttempt.resetOtpEntryState()
                case .verifiedCredentials:
                    throw LocalStoreError.validation("Demo review sign-in cannot resend an OTP challenge")
                }
            } catch {
                // The request outlives the sheet, so the guard keeps an abandoned attempt's failure
                // and its error presentation out of whichever attempt replaced it — the same shape
                // as the catch in `CloudSignInSheet.sendCode`.
                guard self.store.cloudSignInAttempt.id == self.attemptId else {
                    return
                }
                if isRequestCancellationError(error: error) {
                    return
                }
                self.store.reportCloudSignInFailure(reason: analyticsSignInFailureReason(error: error))
                // And out of a code step that replaced the one this resend was started for, which is
                // showing a challenge this failure says nothing about.
                guard self.store.cloudSignInAttempt.otpSheetState?.id == otpSheetStateId else {
                    return
                }
                self.presentAuthErrorPresentation(
                    makeCloudAuthInlineErrorPresentation(
                        error: error,
                        context: .sendCode
                    ),
                    captureContext: captureContext
                )
            }
        }
    }

    /// Attempt-scoped for the reason `finishVerifyingCode` gives.
    private func finishResendingCode() {
        guard self.store.cloudSignInAttempt.id == self.attemptId else {
            return
        }

        self.store.cloudSignInAttempt.isResendingOtpCode = false
    }

    private func applyOtpErrorState(error: Error) {
        guard let authError = error as? CloudAuthError else {
            return
        }

        switch authError {
        case .invalidResponse(let details, _):
            if details.code == "OTP_SESSION_EXPIRED" {
                self.store.cloudSignInAttempt.otpCode = ""
                self.store.cloudSignInAttempt.otpChallengeState = .expired
            }

            if details.code == "OTP_CHALLENGE_CONSUMED" {
                self.store.cloudSignInAttempt.otpCode = ""
                self.store.cloudSignInAttempt.otpChallengeState = .consumed
            }

            if details.code == "OTP_TOO_MANY_ATTEMPTS" {
                self.store.cloudSignInAttempt.otpCode = ""
                self.store.cloudSignInAttempt.otpChallengeState = .tooManyAttempts
            }
        case .invalidBaseUrl, .invalidResponseBody:
            return
        }
    }

    private func presentTechnicalError(_ action: TechnicalErrorAction) {
        self.technicalErrorPresentation = self.store.makeTechnicalErrorPresentation(action: action)
    }

    private func presentAuthErrorPresentation(
        _ presentation: CloudAuthInlineErrorPresentation,
        captureContext: TechnicalErrorCaptureContext
    ) {
        self.store.cloudSignInAttempt.otpAuthErrorPresentation = CloudAuthInlineErrorPresentation(
            message: presentation.message,
            technicalError: presentation.technicalError.map { action in
                self.store.captureTechnicalErrorActionIfNeeded(
                    action: self.store.makeTechnicalErrorAction(
                        error: action.error,
                        captureContext: captureContext
                    )
                )
            }
        )
    }
}
