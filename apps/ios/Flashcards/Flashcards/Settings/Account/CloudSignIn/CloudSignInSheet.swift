import SwiftUI

private struct CloudSignInPostAuthTaskHandle {
    let stateId: String
    let task: Task<Void, Never>
}

struct CloudSignInSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @FocusState private var isEmailFieldFocused: Bool

    let presentationContext: CloudSignInPresentationContext

    @State private var email: String = ""
    @State private var otpSheetState: CloudOtpSheetState?
    @State private var postAuthLoadingState: CloudPostAuthLoadingState?
    @State private var postAuthGuestLocalRecoveryPreparationState: CloudPostAuthGuestLocalRecoveryPreparationState?
    @State private var postAuthSyncState: CloudPostAuthSyncState?
    @State private var workspaceLinkContext: CloudWorkspaceLinkContext?
    @State private var postAuthRecoveryNeededState: CloudPostAuthRecoveryNeededState?
    @State private var postAuthFailureState: CloudPostAuthFailureState?
    @State private var authErrorPresentation: CloudAuthInlineErrorPresentation?
    @State private var isSendingCode: Bool = false
    @State private var isLogoutConfirmationPresented: Bool = false
    @State private var hasRecordedActivePresentation: Bool = false
    @State private var postAuthLoadingTask: CloudSignInPostAuthTaskHandle?
    @State private var postAuthGuestLocalRecoveryPreparationTask: CloudSignInPostAuthTaskHandle?
    @State private var postAuthSyncTask: CloudSignInPostAuthTaskHandle?

    init(presentationContext: CloudSignInPresentationContext) {
        self.presentationContext = presentationContext
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

                    Section(aiSettingsLocalized("settings.account.cloudSignIn.section.cloudSync", "Cloud sync")) {
                        Text(
                            aiSettingsLocalized(
                                "settings.account.cloudSignIn.description",
                                "Sign in with email and continue through the code and workspace steps. Local data stays on this device until you choose a cloud workspace."
                            )
                        )
                            .foregroundStyle(.secondary)
                    }

                    Section(aiSettingsLocalized("common.email", "Email")) {
                        TextField(aiSettingsLocalized("settings.account.cloudSignIn.emailPlaceholder", "Your email"), text: self.$email)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .keyboardType(.emailAddress)
                            .textContentType(.emailAddress)
                            .submitLabel(.send)
                            .focused(self.$isEmailFieldFocused)
                            .accessibilityIdentifier(UITestIdentifier.cloudSignInEmailField)
                            .onSubmit {
                                self.sendCode()
                            }
                    }

                    Section {
                        Button(aiSettingsLocalized("settings.account.cloudSignIn.sendOneTimeCode", "Send one-time code")) {
                            self.sendCode()
                        }
                        .disabled(self.isSendingCode || isValidCloudEmail(self.email) == false)
                        .accessibilityIdentifier(UITestIdentifier.cloudSignInSendCodeButton)
                    }
                }
            }
            .navigationTitle(aiSettingsLocalized("settings.account.cloudSignIn.title", "Sign in"))
            .navigationBarTitleDisplayMode(.inline)
            .accessibilityIdentifier(UITestIdentifier.cloudSignInScreen)
            .interactiveDismissDisabled(self.isPostAuthActionInFlight)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(aiSettingsLocalized("common.close", "Close")) {
                        self.dismiss()
                    }
                    .disabled(self.isSendingCode || self.isPostAuthActionInFlight)
                }
            }
            .sheet(item: self.$otpSheetState) { otpState in
                CloudOtpVerificationSheet(
                    otpSheetState: self.$otpSheetState,
                    onVerified: { verifiedContext in
                        self.handleVerifiedAuthContext(verifiedContext)
                    },
                    onReturnToEmail: {
                        self.cancelPostAuthTasksAndClearInFlightState()
                        self.otpSheetState = nil
                        self.workspaceLinkContext = nil
                        self.postAuthRecoveryNeededState = nil
                        self.postAuthFailureState = nil
                        self.scheduleEmailFieldFocus()
                    }
                )
                .environment(self.store)
            }
            .sheet(item: self.$postAuthLoadingState) { loadingState in
                CloudPostAuthLoadingSheet()
                    .interactiveDismissDisabled(true)
            }
            .sheet(item: self.$postAuthGuestLocalRecoveryPreparationState) { recoveryState in
                CloudPostAuthGuestLocalRecoveryPreparationSheet()
                    .interactiveDismissDisabled(true)
            }
            .sheet(item: self.$postAuthSyncState) { syncState in
                CloudPostAuthSyncSheet(operation: syncState.operation)
                    .interactiveDismissDisabled(true)
            }
            .sheet(item: self.$workspaceLinkContext) { linkContext in
                CloudWorkspaceSelectionSheet(
                    linkContext: linkContext,
                    isSelectionDisabled: self.isPostAuthActionInFlight,
                    onSelection: { selection in
                        self.completeLink(linkContext: linkContext, selection: selection)
                    },
                    onCancelled: {
                        self.workspaceLinkContext = nil
                    }
                )
                .environment(self.store)
            }
            .sheet(item: self.$postAuthRecoveryNeededState) { recoveryState in
                CloudPostAuthRecoveryNeededSheet(
                    state: recoveryState,
                    allowsLogoutAction: self.presentationContext == .standard,
                    onClose: {
                        self.postAuthRecoveryNeededState = nil
                        self.dismiss()
                    },
                    onLogout: {
                        self.isLogoutConfirmationPresented = true
                    }
                )
            }
            .sheet(item: self.$postAuthFailureState) { failureState in
                CloudPostAuthFailureSheet(
                    state: failureState,
                    isRetryDisabled: self.isPostAuthActionInFlight,
                    allowsCloseAction: failureState.allowsAccountExitActions
                        || self.presentationContext == .credentialRecoveryGate,
                    allowsLogoutAction: failureState.allowsAccountExitActions
                        && self.presentationContext == .standard,
                    onRetry: {
                        self.retryPostAuthFailure(failureState)
                    },
                    onClose: {
                        self.postAuthFailureState = nil
                        self.dismiss()
                    },
                    onLogout: {
                        self.isLogoutConfirmationPresented = true
                    }
                )
                .interactiveDismissDisabled(failureState.kind == .guestLocalRecovery)
                .environment(self.store)
            }
            .alert(aiSettingsLocalized("settings.account.status.logoutAlertTitle", "Log out and clear this device?"), isPresented: self.$isLogoutConfirmationPresented) {
                Button(aiSettingsLocalized("common.cancel", "Cancel"), role: .cancel) {}
                Button(aiSettingsLocalized("settings.account.status.logOut", "Log out"), role: .destructive) {
                    self.logoutAndDismiss()
                }
            } message: {
                Text(aiSettingsLocalized("settings.account.status.logoutAlertMessage", "All local workspaces and synced data will be removed from this device."))
            }
            .onAppear {
                self.recordActivePresentationIfNeeded()
                self.scheduleEmailFieldFocus()
            }
            .onDisappear {
                self.cancelPostAuthTasksAndClearInFlightState()
                self.clearActivePresentationIfNeeded()
            }
        }
        .accessibilityIdentifier(UITestIdentifier.cloudSignInScreen)
    }

    private var isPostAuthActionInFlight: Bool {
        self.postAuthLoadingState != nil
            || self.postAuthGuestLocalRecoveryPreparationState != nil
            || self.postAuthSyncState != nil
    }

    private func cancelPostAuthTasks() {
        self.postAuthLoadingTask?.task.cancel()
        self.postAuthLoadingTask = nil
        self.postAuthGuestLocalRecoveryPreparationTask?.task.cancel()
        self.postAuthGuestLocalRecoveryPreparationTask = nil
        self.postAuthSyncTask?.task.cancel()
        self.postAuthSyncTask = nil
    }

    private func cancelPostAuthTasksAndClearInFlightState() {
        self.cancelPostAuthTasks()
        self.postAuthLoadingState = nil
        self.postAuthGuestLocalRecoveryPreparationState = nil
        self.postAuthSyncState = nil
    }

    private func clearPostAuthLoadingTaskIfCurrent(stateId: String) {
        guard self.postAuthLoadingTask?.stateId == stateId else {
            return
        }
        self.postAuthLoadingTask = nil
    }

    private func clearPostAuthGuestLocalRecoveryPreparationTaskIfCurrent(stateId: String) {
        guard self.postAuthGuestLocalRecoveryPreparationTask?.stateId == stateId else {
            return
        }
        self.postAuthGuestLocalRecoveryPreparationTask = nil
    }

    private func clearPostAuthSyncTaskIfCurrent(stateId: String) {
        guard self.postAuthSyncTask?.stateId == stateId else {
            return
        }
        self.postAuthSyncTask = nil
    }

    private func startPostAuthLoadingTask(_ loadingState: CloudPostAuthLoadingState) {
        self.postAuthLoadingTask?.task.cancel()
        let task = Task { @MainActor in
            await self.prepareCloudLink(loadingState)
            self.clearPostAuthLoadingTaskIfCurrent(stateId: loadingState.id)
        }
        self.postAuthLoadingTask = CloudSignInPostAuthTaskHandle(stateId: loadingState.id, task: task)
    }

    private func startPostAuthGuestLocalRecoveryPreparationTask(
        _ recoveryState: CloudPostAuthGuestLocalRecoveryPreparationState
    ) {
        self.postAuthGuestLocalRecoveryPreparationTask?.task.cancel()
        let task = Task { @MainActor in
            await Task.yield()
            await self.runGuestLocalRecoveryPreparation(recoveryState)
            self.clearPostAuthGuestLocalRecoveryPreparationTaskIfCurrent(stateId: recoveryState.id)
        }
        self.postAuthGuestLocalRecoveryPreparationTask = CloudSignInPostAuthTaskHandle(
            stateId: recoveryState.id,
            task: task
        )
    }

    private func startPostAuthSyncTask(_ syncState: CloudPostAuthSyncState) {
        self.postAuthSyncTask?.task.cancel()
        let task = Task { @MainActor in
            await self.runPostAuthSync(syncState)
            self.clearPostAuthSyncTaskIfCurrent(stateId: syncState.id)
        }
        self.postAuthSyncTask = CloudSignInPostAuthTaskHandle(stateId: syncState.id, task: task)
    }

    private func scheduleEmailFieldFocus() {
        DispatchQueue.main.async {
            self.isEmailFieldFocused = true
        }
    }

    private func recordActivePresentationIfNeeded() {
        guard self.hasRecordedActivePresentation == false else {
            return
        }

        self.hasRecordedActivePresentation = true
        self.store.beginCloudSignInSheetPresentation()
    }

    private func clearActivePresentationIfNeeded() {
        guard self.hasRecordedActivePresentation else {
            return
        }

        self.hasRecordedActivePresentation = false
        self.store.endCloudSignInSheetPresentation()
    }

    private func sendCode() {
        self.isEmailFieldFocused = false

        guard isValidCloudEmail(self.email) else {
            self.authErrorPresentation = CloudAuthInlineErrorPresentation(
                message: aiSettingsLocalized("settings.account.cloudSignIn.enterValidEmail", "Enter a valid email address"),
                technicalDetails: nil
            )
            return
        }

        let nextEmail = normalizedCloudEmail(self.email)
        let nextOtpSheetState = CloudOtpSheetState(email: nextEmail, challenge: nil)
        self.email = nextEmail
        self.authErrorPresentation = nil
        self.otpSheetState = nextOtpSheetState

        Task { @MainActor in
            self.isSendingCode = true
            defer {
                self.isSendingCode = false
            }

            do {
                let sendCodeResult = try await self.store.sendCloudSignInCode(email: nextEmail)

                switch sendCodeResult {
                case .otpChallenge(let nextChallenge):
                    guard self.otpSheetState?.id == nextOtpSheetState.id else {
                        return
                    }

                    self.email = nextChallenge.email
                    self.otpSheetState = nextOtpSheetState.withChallenge(nextChallenge)
                case .verifiedCredentials(let credentials):
                    // This intentionally insecure path exists only for
                    // configured review account emails on the auth service.
                    self.otpSheetState = nil
                    self.handleVerifiedAuthContext(
                        CloudVerifiedAuthContext(
                            apiBaseUrl: try self.store.currentCloudServiceConfiguration().apiBaseUrl,
                            credentials: credentials
                        )
                    )
                }
            } catch {
                if isRequestCancellationError(error: error) {
                    if self.otpSheetState?.id == nextOtpSheetState.id {
                        self.otpSheetState = nil
                    }
                    return
                }
                if self.otpSheetState?.id == nextOtpSheetState.id {
                    self.otpSheetState = nil
                }
                self.authErrorPresentation = makeCloudAuthInlineErrorPresentation(
                    error: error,
                    context: .sendCode
                )
            }
        }
    }

    private func handlePreparedLinkContext(_ linkContext: CloudWorkspaceLinkContext) {
        self.authErrorPresentation = nil
        self.postAuthLoadingState = nil
        self.postAuthGuestLocalRecoveryPreparationState = nil
        self.postAuthRecoveryNeededState = nil
        self.postAuthFailureState = nil

        switch makeCloudWorkspacePostAuthRoute(linkContext: linkContext) {
        case .autoLink(let selection):
            if linkContext.postAuthRecoveryRoute == .guestLocalRecovery {
                let nextState = CloudPostAuthGuestLocalRecoveryPreparationState(
                    linkContext: linkContext,
                    selection: selection
                )
                self.postAuthGuestLocalRecoveryPreparationState = nextState
                self.startPostAuthGuestLocalRecoveryPreparationTask(nextState)
            } else {
                self.completeLink(linkContext: linkContext, selection: selection)
            }
        case .chooseWorkspace:
            self.workspaceLinkContext = linkContext
        case .guestLocalRecoveryNeeded:
            self.postAuthRecoveryNeededState = CloudPostAuthRecoveryNeededState(
                title: aiSettingsLocalized("settings.account.cloudSignIn.failure.cloudSetupFailed", "Signed in, but cloud setup failed."),
                message: localizedCloudCredentialRecoveryBlockedMessage(reason: .guestSessionMissing)
            )
            self.workspaceLinkContext = nil
        }
    }

    private func handleVerifiedAuthContext(_ verifiedContext: CloudVerifiedAuthContext) {
        let loadingState = CloudPostAuthLoadingState(verifiedContext: verifiedContext)
        self.otpSheetState = nil
        self.postAuthLoadingState = loadingState
        self.postAuthGuestLocalRecoveryPreparationState = nil
        self.postAuthSyncState = nil
        self.workspaceLinkContext = nil
        self.postAuthRecoveryNeededState = nil
        self.authErrorPresentation = nil

        self.startPostAuthLoadingTask(loadingState)
    }

    private func prepareCloudLink(_ loadingState: CloudPostAuthLoadingState) async {
        do {
            let linkContext = try await self.store.prepareCloudLink(verifiedContext: loadingState.verifiedContext)
            guard self.postAuthLoadingState?.id == loadingState.id else {
                return
            }
            self.postAuthFailureState = nil
            self.handlePreparedLinkContext(linkContext)
        } catch {
            guard self.postAuthLoadingState?.id == loadingState.id else {
                return
            }
            self.postAuthLoadingState = nil
            self.postAuthGuestLocalRecoveryPreparationState = nil
            self.postAuthSyncState = nil
            if self.store.cloudCredentialRecoveryState?.reason == .guestSessionMissing {
                let failurePresentation = makeGuestLocalRecoveryPostAuthFailurePresentation(
                    retryAction: .prepareLink(verifiedContext: loadingState.verifiedContext)
                )
                self.presentPostAuthFailure(
                    title: failurePresentation.title,
                    message: failurePresentation.message ?? Flashcards.errorMessage(error: error),
                    technicalDetails: Flashcards.errorMessage(error: error),
                    retryAction: failurePresentation.retryAction,
                    kind: failurePresentation.kind
                )
            } else {
                self.presentPostAuthFailure(
                    title: aiSettingsLocalized("settings.account.cloudSignIn.failure.cloudSetupFailed", "Signed in, but cloud setup failed."),
                    message: Flashcards.errorMessage(error: error),
                    technicalDetails: nil,
                    retryAction: .prepareLink(verifiedContext: loadingState.verifiedContext),
                    kind: .standard
                )
            }
        }
    }

    private func completeLink(linkContext: CloudWorkspaceLinkContext, selection: CloudWorkspaceLinkSelection) {
        guard self.isPostAuthActionInFlight == false else {
            return
        }

        self.presentPostAuthSync(
            operation: linkContext.guestUpgradeMode != nil
                ? .completeGuestLink(linkContext: linkContext, selection: selection)
                : .completeLink(linkContext: linkContext, selection: selection)
        )
    }

    private func runGuestLocalRecoveryPreparation(_ recoveryState: CloudPostAuthGuestLocalRecoveryPreparationState) async {
        guard self.postAuthGuestLocalRecoveryPreparationState?.id == recoveryState.id else {
            return
        }

        self.postAuthGuestLocalRecoveryPreparationState = nil
        self.presentPostAuthSync(
            operation: .completeLink(
                linkContext: recoveryState.linkContext,
                selection: recoveryState.selection
            )
        )
    }

    private func retryPostAuthFailure(_ failureState: CloudPostAuthFailureState) {
        self.postAuthFailureState = nil

        switch failureState.retryAction {
        case .prepareLink(let verifiedContext):
            let loadingState = CloudPostAuthLoadingState(verifiedContext: verifiedContext)
            self.postAuthLoadingState = loadingState
            self.startPostAuthLoadingTask(loadingState)
        case .completeLink(let linkContext, let selection):
            self.completeLink(linkContext: linkContext, selection: selection)
        case .completeGuestLink(let linkContext, let selection):
            self.presentPostAuthSync(operation: .completeGuestLink(linkContext: linkContext, selection: selection))
        case .syncOnly:
            self.presentPostAuthSync(operation: .syncOnly)
        }
    }

    private func presentPostAuthSync(operation: CloudPostAuthSyncOperation) {
        let nextState = CloudPostAuthSyncState(operation: operation)

        self.authErrorPresentation = nil
        self.postAuthLoadingState = nil
        self.postAuthGuestLocalRecoveryPreparationState = nil
        self.postAuthSyncState = nil
        self.workspaceLinkContext = nil
        self.postAuthRecoveryNeededState = nil
        self.postAuthFailureState = nil
        self.postAuthSyncState = nextState

        self.startPostAuthSyncTask(nextState)
    }

    private func runPostAuthSync(_ syncState: CloudPostAuthSyncState) async {
        do {
            switch syncState.operation {
            case .completeLink(let linkContext, let selection):
                try await self.store.completeCloudLink(
                    linkContext: linkContext,
                    selection: selection
                )
            case .completeGuestLink(let linkContext, let selection):
                try await self.store.completeGuestCloudLink(
                    linkContext: linkContext,
                    selection: selection
                )
            case .syncOnly:
                try await self.store.syncCloudNow(
                    trigger: CloudSyncTrigger(
                        source: .manualSyncNow,
                        now: Date(),
                        extendsFastPolling: false,
                        allowsVisibleChangeBanner: false,
                        surfacesGlobalErrorMessage: true,
                        capturesTechnicalFailures: false
                    )
                )
            }

            guard self.postAuthSyncState?.id == syncState.id else {
                return
            }

            self.postAuthFailureState = nil
            self.postAuthSyncState = nil
            self.dismiss()
        } catch {
            guard self.postAuthSyncState?.id == syncState.id else {
                return
            }

            let failurePresentation = makeCloudPostAuthFailurePresentation(
                operation: syncState.operation,
                cloudState: self.store.cloudSettings?.cloudState
            )

            self.postAuthSyncState = nil
            self.presentPostAuthFailure(
                title: failurePresentation.title,
                message: failurePresentation.message ?? Flashcards.errorMessage(error: error),
                technicalDetails: failurePresentation.kind == .guestLocalRecovery
                    ? Flashcards.errorMessage(error: error)
                    : nil,
                retryAction: failurePresentation.retryAction,
                kind: failurePresentation.kind
            )
        }
    }

    private func presentPostAuthFailure(
        title: String,
        message: String,
        technicalDetails: String?,
        retryAction: CloudPostAuthRetryAction,
        kind: CloudPostAuthFailureKind
    ) {
        self.cancelPostAuthTasks()
        self.authErrorPresentation = nil
        self.postAuthLoadingState = nil
        self.postAuthGuestLocalRecoveryPreparationState = nil
        self.postAuthSyncState = nil
        self.postAuthRecoveryNeededState = nil
        self.postAuthFailureState = CloudPostAuthFailureState(
            title: title,
            message: message,
            technicalDetails: technicalDetails,
            retryAction: retryAction,
            kind: kind
        )
    }

    private func logoutAndDismiss() {
        self.cancelPostAuthTasksAndClearInFlightState()
        do {
            try self.store.logoutCloudAccount()
        } catch {
            self.authErrorPresentation = CloudAuthInlineErrorPresentation(
                message: Flashcards.errorMessage(error: error),
                technicalDetails: nil
            )
        }

        self.postAuthFailureState = nil
        self.workspaceLinkContext = nil
        self.postAuthRecoveryNeededState = nil
        self.otpSheetState = nil
        self.dismiss()
    }
}

#Preview {
    CloudSignInSheet(presentationContext: .standard)
        .environment(FlashcardsStore())
}
