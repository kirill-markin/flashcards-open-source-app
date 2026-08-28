import SwiftUI

/**
 * The sign-in sheet's content, which SwiftUI may destroy and rebuild while the sheet stays on
 * screen. Everything that describes the attempt lives in `store.cloudSignInAttempt` so that rebuild
 * is invisible to the person; only what describes this view instance is `@State` here.
 */
struct CloudSignInSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @FocusState private var isEmailFieldFocused: Bool

    let presentationContext: CloudSignInPresentationContext

    @State private var technicalErrorPresentation: TechnicalErrorPresentation?
    @State private var isLogoutConfirmationPresented: Bool = false
    @State private var hasRecordedSurfacePresence: Bool = false

    init(presentationContext: CloudSignInPresentationContext) {
        self.presentationContext = presentationContext
    }

    var body: some View {
        @Bindable var store = self.store

        NavigationStack {
            ReadableContentLayout(
                maxWidth: flashcardsReadableFormMaxWidth,
                horizontalPadding: 0
            ) {
                Form {
                    if let authErrorPresentation = self.store.cloudSignInAttempt.authErrorPresentation {
                        Section {
                            CloudAuthInlineErrorView(
                                presentation: authErrorPresentation,
                                onTechnicalError: { technicalError in
                                    self.presentTechnicalError(technicalError)
                                }
                            )
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
                        TextField(aiSettingsLocalized("settings.account.cloudSignIn.emailPlaceholder", "Your email"), text: $store.cloudSignInAttempt.email)
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
                        .disabled(
                            self.store.cloudSignInAttempt.isSendingCode
                                || isValidCloudEmail(self.store.cloudSignInAttempt.email) == false
                        )
                        .accessibilityIdentifier(UITestIdentifier.cloudSignInSendCodeButton)
                    }
                }
            }
            .navigationTitle(aiSettingsLocalized("settings.account.cloudSignIn.title", "Sign in"))
            .navigationBarTitleDisplayMode(.inline)
            .accessibilityIdentifier(UITestIdentifier.cloudSignInScreen)
            .interactiveDismissDisabled(self.store.cloudSignInAttempt.isPostAuthActionInFlight)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(aiSettingsLocalized("common.close", "Close")) {
                        self.dismiss()
                    }
                    .disabled(
                        self.store.cloudSignInAttempt.isSendingCode
                            || self.store.cloudSignInAttempt.isPostAuthActionInFlight
                    )
                }
            }
            .sheet(item: $store.cloudSignInAttempt.otpSheetState) { otpState in
                // The code step's requests outlive it exactly as `sendCode`'s do — the OTP sheet has
                // no `interactiveDismissDisabled`, so a slow verify can still be in flight when the
                // person swipes it and the sign-in sheet away. Its write-backs carry the attempt they
                // belong to for the same reason `sendCode` does.
                let attemptId = self.store.cloudSignInAttempt.id

                CloudOtpVerificationSheet(
                    attemptId: attemptId,
                    otpSheetState: $store.cloudSignInAttempt.otpSheetState,
                    onVerified: { verifiedContext in
                        self.handleVerifiedAuthContext(verifiedContext, attemptId: attemptId)
                    },
                    onReturnToEmail: {
                        self.cancelPostAuthTasksAndClearInFlightState()
                        self.store.cloudSignInAttempt.otpSheetState = nil
                        self.store.cloudSignInAttempt.workspaceLinkContext = nil
                        self.store.cloudSignInAttempt.postAuthRecoveryNeededState = nil
                        self.store.cloudSignInAttempt.postAuthFailureState = nil
                        self.scheduleEmailFieldFocus()
                    }
                )
                .environment(self.store)
            }
            .sheet(item: $store.cloudSignInAttempt.postAuthLoadingState) { loadingState in
                CloudPostAuthLoadingSheet()
                    .interactiveDismissDisabled(true)
            }
            .sheet(item: $store.cloudSignInAttempt.postAuthGuestLocalRecoveryPreparationState) { recoveryState in
                CloudPostAuthGuestLocalRecoveryPreparationSheet()
                    .interactiveDismissDisabled(true)
            }
            .sheet(item: $store.cloudSignInAttempt.postAuthSyncState) { syncState in
                CloudPostAuthSyncSheet(operation: syncState.operation)
                    .interactiveDismissDisabled(true)
            }
            .sheet(item: $store.cloudSignInAttempt.workspaceLinkContext) { linkContext in
                CloudWorkspaceSelectionSheet(
                    linkContext: linkContext,
                    isSelectionDisabled: self.store.cloudSignInAttempt.isPostAuthActionInFlight,
                    onSelection: { selection in
                        self.completeLink(linkContext: linkContext, selection: selection)
                    },
                    onCancelled: {
                        self.store.cloudSignInAttempt.workspaceLinkContext = nil
                    }
                )
                .environment(self.store)
            }
            .sheet(item: $store.cloudSignInAttempt.postAuthRecoveryNeededState) { recoveryState in
                CloudPostAuthRecoveryNeededSheet(
                    state: recoveryState,
                    allowsLogoutAction: self.isStandardPresentation,
                    onClose: {
                        self.store.cloudSignInAttempt.postAuthRecoveryNeededState = nil
                        self.dismiss()
                    },
                    onLogout: {
                        self.isLogoutConfirmationPresented = true
                    }
                )
            }
            .sheet(item: $store.cloudSignInAttempt.postAuthFailureState) { failureState in
                CloudPostAuthFailureSheet(
                    state: failureState,
                    isRetryDisabled: self.store.cloudSignInAttempt.isPostAuthActionInFlight,
                    allowsCloseAction: failureState.allowsAccountExitActions
                        || self.presentationContext == .credentialRecoveryGate,
                    allowsLogoutAction: failureState.allowsAccountExitActions
                        && self.isStandardPresentation,
                    onRetry: {
                        self.retryPostAuthFailure(failureState)
                    },
                    onClose: {
                        self.store.cloudSignInAttempt.postAuthFailureState = nil
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
            .sheet(item: self.$technicalErrorPresentation) { presentation in
                TechnicalErrorSheet(
                    presentation: presentation,
                    onClose: {
                        self.technicalErrorPresentation = nil
                    }
                )
            }
            // The attempt decides when the presentation closes, because the work that finishes it
            // may well have been started by a view instance that no longer exists.
            .onChange(of: self.store.cloudSignInAttempt.isCompleted, initial: true) { _, isCompleted in
                guard isCompleted else {
                    return
                }

                self.dismiss()
            }
            .onAppear {
                self.recordSurfacePresenceIfNeeded()
                self.scheduleEmailFieldFocusIfShowingEmailForm()
            }
            .onDisappear {
                self.clearSurfacePresenceIfNeeded()
            }
        }
        .accessibilityIdentifier(UITestIdentifier.cloudSignInScreen)
    }

    private func cancelPostAuthTasksAndClearInFlightState() {
        self.store.cancelCloudSignInPostAuthTasks()
        self.store.cloudSignInAttempt.postAuthLoadingState = nil
        self.store.cloudSignInAttempt.postAuthGuestLocalRecoveryPreparationState = nil
        self.store.cloudSignInAttempt.postAuthSyncState = nil
    }

    private func clearPostAuthLoadingTaskIfCurrent(stateId: String) {
        guard self.store.cloudSignInAttempt.postAuthLoadingTask?.stateId == stateId else {
            return
        }
        self.store.cloudSignInAttempt.postAuthLoadingTask = nil
    }

    private func clearPostAuthGuestLocalRecoveryPreparationTaskIfCurrent(stateId: String) {
        guard self.store.cloudSignInAttempt.postAuthGuestLocalRecoveryPreparationTask?.stateId == stateId else {
            return
        }
        self.store.cloudSignInAttempt.postAuthGuestLocalRecoveryPreparationTask = nil
    }

    private func clearPostAuthSyncTaskIfCurrent(stateId: String) {
        guard self.store.cloudSignInAttempt.postAuthSyncTask?.stateId == stateId else {
            return
        }
        self.store.cloudSignInAttempt.postAuthSyncTask = nil
    }

    private func startPostAuthLoadingTask(_ loadingState: CloudPostAuthLoadingState) {
        self.store.cloudSignInAttempt.postAuthLoadingTask?.task.cancel()
        let task = Task { @MainActor in
            await self.prepareCloudLink(loadingState)
            self.clearPostAuthLoadingTaskIfCurrent(stateId: loadingState.id)
        }
        self.store.cloudSignInAttempt.postAuthLoadingTask = CloudSignInPostAuthTaskHandle(
            stateId: loadingState.id,
            task: task
        )
    }

    private func startPostAuthGuestLocalRecoveryPreparationTask(
        _ recoveryState: CloudPostAuthGuestLocalRecoveryPreparationState
    ) {
        self.store.cloudSignInAttempt.postAuthGuestLocalRecoveryPreparationTask?.task.cancel()
        let task = Task { @MainActor in
            await Task.yield()
            await self.runGuestLocalRecoveryPreparation(recoveryState)
            self.clearPostAuthGuestLocalRecoveryPreparationTaskIfCurrent(stateId: recoveryState.id)
        }
        self.store.cloudSignInAttempt.postAuthGuestLocalRecoveryPreparationTask = CloudSignInPostAuthTaskHandle(
            stateId: recoveryState.id,
            task: task
        )
    }

    private func startPostAuthSyncTask(_ syncState: CloudPostAuthSyncState) {
        self.store.cloudSignInAttempt.postAuthSyncTask?.task.cancel()
        let task = Task { @MainActor in
            await self.runPostAuthSync(syncState)
            self.clearPostAuthSyncTaskIfCurrent(stateId: syncState.id)
        }
        self.store.cloudSignInAttempt.postAuthSyncTask = CloudSignInPostAuthTaskHandle(
            stateId: syncState.id,
            task: task
        )
    }

    private func scheduleEmailFieldFocus() {
        DispatchQueue.main.async {
            self.isEmailFieldFocused = true
        }
    }

    private func scheduleEmailFieldFocusIfShowingEmailForm() {
        guard self.store.cloudSignInAttempt.isStepAboveEmailFormPresented == false else {
            return
        }

        self.scheduleEmailFieldFocus()
    }

    private var isStandardPresentation: Bool {
        switch self.presentationContext {
        case .standard:
            return true
        case .credentialRecoveryGate:
            return false
        }
    }

    private func recordSurfacePresenceIfNeeded() {
        guard self.hasRecordedSurfacePresence == false else {
            return
        }

        self.hasRecordedSurfacePresence = true
        self.store.beginCloudSignInSurfacePresence()
    }

    private func clearSurfacePresenceIfNeeded() {
        guard self.hasRecordedSurfacePresence else {
            return
        }

        self.hasRecordedSurfacePresence = false
        self.store.endCloudSignInSurfacePresence()
    }

    private func sendCode() {
        self.isEmailFieldFocused = false

        guard isValidCloudEmail(self.store.cloudSignInAttempt.email) else {
            self.store.cloudSignInAttempt.authErrorPresentation = CloudAuthInlineErrorPresentation(
                message: aiSettingsLocalized("settings.account.cloudSignIn.enterValidEmail", "Enter a valid email address"),
                technicalError: nil
            )
            return
        }

        let attemptId = self.store.cloudSignInAttempt.id
        let nextEmail = normalizedCloudEmail(self.store.cloudSignInAttempt.email)
        let nextOtpSheetState = CloudOtpSheetState(email: nextEmail, challenge: nil)
        self.store.cloudSignInAttempt.email = nextEmail
        self.store.cloudSignInAttempt.authErrorPresentation = nil
        self.store.cloudSignInAttempt.otpSheetState = nextOtpSheetState
        // Raised here rather than inside the task, so it is always the attempt that owns the request
        // that carries the flag. `finishSendingCode` lowers it only for that same attempt, and a
        // raise deferred to the task's first hop could land on an attempt that replaced this one and
        // leave it with both "Send one-time code" and Close disabled for good.
        self.store.cloudSignInAttempt.isSendingCode = true

        // This request is deliberately not tied to the sheet's lifetime: it outlives a rebuilt view
        // instance, and its result now reaches the attempt that started it instead of a view nobody
        // can see. The `attemptId` guards keep it out of whichever attempt replaced that one.
        Task { @MainActor in
            let captureContext = self.store.beginTechnicalErrorCaptureContext()
            defer {
                self.finishSendingCode(attemptId: attemptId)
            }

            do {
                let sendCodeResult = try await self.store.sendCloudSignInCode(
                    email: nextEmail,
                    captureContext: captureContext
                )

                guard self.store.cloudSignInAttempt.id == attemptId else {
                    return
                }

                switch sendCodeResult {
                case .otpChallenge(let nextChallenge):
                    guard self.store.cloudSignInAttempt.otpSheetState?.id == nextOtpSheetState.id else {
                        return
                    }

                    self.store.cloudSignInAttempt.email = nextChallenge.email
                    self.store.cloudSignInAttempt.otpSheetState = nextOtpSheetState.withChallenge(nextChallenge)
                case .verifiedCredentials(let credentials):
                    // This intentionally insecure path exists only for
                    // configured review account emails on the auth service.
                    self.store.cloudSignInAttempt.otpSheetState = nil
                    self.handleVerifiedAuthContext(
                        CloudVerifiedAuthContext(
                            apiBaseUrl: try self.store.currentCloudServiceConfiguration().apiBaseUrl,
                            credentials: credentials
                        ),
                        attemptId: attemptId
                    )
                }
            } catch {
                guard self.store.cloudSignInAttempt.id == attemptId else {
                    return
                }
                if self.store.cloudSignInAttempt.otpSheetState?.id == nextOtpSheetState.id {
                    self.store.cloudSignInAttempt.otpSheetState = nil
                }
                if isRequestCancellationError(error: error) {
                    return
                }
                self.store.reportCloudSignInFailure(reason: analyticsSignInFailureReason(error: error))
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

    private func finishSendingCode(attemptId: String) {
        guard self.store.cloudSignInAttempt.id == attemptId else {
            return
        }

        self.store.cloudSignInAttempt.isSendingCode = false
    }

    private func handlePreparedLinkContext(_ linkContext: CloudWorkspaceLinkContext) {
        self.store.cloudSignInAttempt.authErrorPresentation = nil
        self.store.cloudSignInAttempt.postAuthLoadingState = nil
        self.store.cloudSignInAttempt.postAuthGuestLocalRecoveryPreparationState = nil
        self.store.cloudSignInAttempt.postAuthRecoveryNeededState = nil
        self.store.cloudSignInAttempt.postAuthFailureState = nil

        switch makeCloudWorkspacePostAuthRoute(linkContext: linkContext) {
        case .autoLink(let selection):
            if linkContext.postAuthRecoveryRoute == .guestLocalRecovery {
                let nextState = CloudPostAuthGuestLocalRecoveryPreparationState(
                    linkContext: linkContext,
                    selection: selection
                )
                self.store.cloudSignInAttempt.postAuthGuestLocalRecoveryPreparationState = nextState
                self.startPostAuthGuestLocalRecoveryPreparationTask(nextState)
            } else {
                self.completeLink(linkContext: linkContext, selection: selection)
            }
        case .chooseWorkspace:
            self.store.cloudSignInAttempt.workspaceLinkContext = linkContext
        case .guestLocalRecoveryNeeded:
            self.store.cloudSignInAttempt.postAuthRecoveryNeededState = CloudPostAuthRecoveryNeededState(
                title: aiSettingsLocalized("settings.account.cloudSignIn.failure.cloudSetupFailed", "Signed in, but cloud setup failed."),
                message: localizedCloudCredentialRecoveryBlockedMessage(reason: .guestSessionMissing)
            )
            self.store.cloudSignInAttempt.workspaceLinkContext = nil
        }
    }

    /**
     * Credentials came back verified. Both callers reach here from a request that outlives the view
     * that started it, so the attempt this verification belongs to is checked before anything is
     * written: a verification that lands after its attempt was cancelled must not settle the attempt
     * that replaced it, and must not start post-auth work — linking a workspace and uploading local
     * data — behind a presentation nobody is showing.
     *
     * The per-state `id` guards further down cannot stand in for this one. They compare against state
     * this call would have just written, so they all pass; this is the entry point where the attempt
     * is still the only thing that can be compared.
     */
    private func handleVerifiedAuthContext(
        _ verifiedContext: CloudVerifiedAuthContext,
        attemptId: String
    ) {
        guard self.store.cloudSignInAttempt.id == attemptId else {
            return
        }

        self.store.recordCloudSignInVerified()

        let loadingState = CloudPostAuthLoadingState(verifiedContext: verifiedContext)
        self.store.cloudSignInAttempt.otpSheetState = nil
        self.store.cloudSignInAttempt.postAuthLoadingState = loadingState
        self.store.cloudSignInAttempt.postAuthGuestLocalRecoveryPreparationState = nil
        self.store.cloudSignInAttempt.postAuthSyncState = nil
        self.store.cloudSignInAttempt.workspaceLinkContext = nil
        self.store.cloudSignInAttempt.postAuthRecoveryNeededState = nil
        self.store.cloudSignInAttempt.authErrorPresentation = nil

        self.startPostAuthLoadingTask(loadingState)
    }

    private func prepareCloudLink(_ loadingState: CloudPostAuthLoadingState) async {
        do {
            let linkContext = try await self.store.prepareCloudLink(verifiedContext: loadingState.verifiedContext)
            guard self.store.cloudSignInAttempt.postAuthLoadingState?.id == loadingState.id else {
                return
            }
            self.store.cloudSignInAttempt.postAuthFailureState = nil
            self.handlePreparedLinkContext(linkContext)
        } catch {
            guard self.store.cloudSignInAttempt.postAuthLoadingState?.id == loadingState.id else {
                return
            }
            self.store.cloudSignInAttempt.postAuthLoadingState = nil
            self.store.cloudSignInAttempt.postAuthGuestLocalRecoveryPreparationState = nil
            self.store.cloudSignInAttempt.postAuthSyncState = nil
            if isRequestCancellationError(error: error) {
                return
            }
            if self.store.cloudCredentialRecoveryState?.reason == .guestSessionMissing {
                let failurePresentation = makeGuestLocalRecoveryPostAuthFailurePresentation(
                    retryAction: .prepareLink(verifiedContext: loadingState.verifiedContext)
                )
                self.presentPostAuthFailure(
                    title: failurePresentation.title,
                    message: failurePresentation.message ?? makeCloudPostAuthVisibleFailureMessage(error: error),
                    technicalError: self.isNonTechnicalPostAuthFailure(error: error)
                        ? nil
                        : makeTechnicalErrorAction(error: error),
                    retryAction: failurePresentation.retryAction,
                    kind: failurePresentation.kind
                )
            } else {
                self.presentPostAuthFailure(
                    title: aiSettingsLocalized("settings.account.cloudSignIn.failure.cloudSetupFailed", "Signed in, but cloud setup failed."),
                    message: makeCloudPostAuthVisibleFailureMessage(error: error),
                    technicalError: self.isNonTechnicalPostAuthFailure(error: error)
                        ? nil
                        : makeTechnicalErrorAction(error: error),
                    retryAction: .prepareLink(verifiedContext: loadingState.verifiedContext),
                    kind: .standard
                )
            }
        }
    }

    private func completeLink(linkContext: CloudWorkspaceLinkContext, selection: CloudWorkspaceLinkSelection) {
        guard self.store.cloudSignInAttempt.isPostAuthActionInFlight == false else {
            return
        }

        self.presentPostAuthSync(
            operation: linkContext.guestUpgradeMode != nil
                ? .completeGuestLink(linkContext: linkContext, selection: selection)
                : .completeLink(linkContext: linkContext, selection: selection)
        )
    }

    private func runGuestLocalRecoveryPreparation(_ recoveryState: CloudPostAuthGuestLocalRecoveryPreparationState) async {
        guard self.store.cloudSignInAttempt.postAuthGuestLocalRecoveryPreparationState?.id == recoveryState.id else {
            return
        }

        self.store.cloudSignInAttempt.postAuthGuestLocalRecoveryPreparationState = nil
        self.presentPostAuthSync(
            operation: .completeLink(
                linkContext: recoveryState.linkContext,
                selection: recoveryState.selection
            )
        )
    }

    private func retryPostAuthFailure(_ failureState: CloudPostAuthFailureState) {
        self.store.cloudSignInAttempt.postAuthFailureState = nil

        switch failureState.retryAction {
        case .prepareLink(let verifiedContext):
            let loadingState = CloudPostAuthLoadingState(verifiedContext: verifiedContext)
            self.store.cloudSignInAttempt.postAuthLoadingState = loadingState
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

        self.store.cloudSignInAttempt.authErrorPresentation = nil
        self.store.cloudSignInAttempt.postAuthLoadingState = nil
        self.store.cloudSignInAttempt.postAuthGuestLocalRecoveryPreparationState = nil
        self.store.cloudSignInAttempt.postAuthSyncState = nil
        self.store.cloudSignInAttempt.workspaceLinkContext = nil
        self.store.cloudSignInAttempt.postAuthRecoveryNeededState = nil
        self.store.cloudSignInAttempt.postAuthFailureState = nil
        self.store.cloudSignInAttempt.postAuthSyncState = nextState

        self.startPostAuthSyncTask(nextState)
    }

    private func runPostAuthSync(_ syncState: CloudPostAuthSyncState) async {
        let captureContext = self.store.beginTechnicalErrorCaptureContext()
        do {
            switch syncState.operation {
            case .completeLink(let linkContext, let selection):
                try await self.store.completeCloudLink(
                    linkContext: linkContext,
                    selection: selection,
                    technicalErrorCaptureContext: captureContext
                )
            case .completeGuestLink(let linkContext, let selection):
                try await self.store.completeGuestCloudLink(
                    linkContext: linkContext,
                    selection: selection,
                    technicalErrorCaptureContext: captureContext
                )
            case .syncOnly:
                try await self.store.syncCloudNow(
                    trigger: self.store.postAuthCloudSyncTrigger(
                        now: Date(),
                        technicalErrorCaptureContext: captureContext
                    )
                )
            }

            guard self.store.cloudSignInAttempt.postAuthSyncState?.id == syncState.id else {
                return
            }

            self.store.cloudSignInAttempt.postAuthFailureState = nil
            self.store.cloudSignInAttempt.postAuthSyncState = nil
            self.store.cloudSignInAttempt.isCompleted = true
        } catch {
            guard self.store.cloudSignInAttempt.postAuthSyncState?.id == syncState.id else {
                return
            }
            if isRequestCancellationError(error: error) {
                self.store.cloudSignInAttempt.postAuthSyncState = nil
                return
            }

            let failurePresentation = makeCloudPostAuthFailurePresentation(
                operation: syncState.operation,
                cloudState: self.store.cloudSettings?.cloudState
            )

            self.store.cloudSignInAttempt.postAuthSyncState = nil
            self.presentPostAuthFailure(
                title: failurePresentation.title,
                message: failurePresentation.message ?? makeCloudPostAuthVisibleFailureMessage(error: error),
                technicalError: self.isNonTechnicalPostAuthFailure(error: error)
                    ? nil
                    : self.store.makeTechnicalErrorAction(
                        error: error,
                        captureContext: captureContext
                    ),
                retryAction: failurePresentation.retryAction,
                kind: failurePresentation.kind
            )
        }
    }

    private func presentPostAuthFailure(
        title: String,
        message: String,
        technicalError: TechnicalErrorAction?,
        retryAction: CloudPostAuthRetryAction,
        kind: CloudPostAuthFailureKind
    ) {
        self.store.cancelCloudSignInPostAuthTasks()
        self.store.cloudSignInAttempt.authErrorPresentation = nil
        self.store.cloudSignInAttempt.postAuthLoadingState = nil
        self.store.cloudSignInAttempt.postAuthGuestLocalRecoveryPreparationState = nil
        self.store.cloudSignInAttempt.postAuthSyncState = nil
        self.store.cloudSignInAttempt.postAuthRecoveryNeededState = nil
        self.store.cloudSignInAttempt.postAuthFailureState = CloudPostAuthFailureState(
            title: title,
            message: message,
            technicalError: technicalError.map { action in
                self.store.captureTechnicalErrorActionIfNeeded(action: action)
            },
            retryAction: retryAction,
            kind: kind
        )
    }

    private func isNonTechnicalPostAuthFailure(error: Error) -> Bool {
        if isSafeCloudPostAuthDomainFailure(error: error) {
            return true
        }
        if isRetryableNetworkTransportFailure(error: error) {
            return true
        }
        if self.store.blockedCloudIdentityConflictMessage(error: error) != nil {
            return true
        }
        return false
    }

    private func presentAuthErrorPresentation(
        _ presentation: CloudAuthInlineErrorPresentation,
        captureContext: TechnicalErrorCaptureContext
    ) {
        self.store.cloudSignInAttempt.authErrorPresentation = CloudAuthInlineErrorPresentation(
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

    private func presentTechnicalError(_ action: TechnicalErrorAction) {
        self.technicalErrorPresentation = self.store.makeTechnicalErrorPresentationIfNeeded(action: action)
    }

    private func logoutAndDismiss() {
        self.cancelPostAuthTasksAndClearInFlightState()
        do {
            try self.store.logoutCloudAccount()
        } catch {
            self.store.cloudSignInAttempt.authErrorPresentation = CloudAuthInlineErrorPresentation(
                message: Flashcards.errorMessage(error: error),
                technicalError: nil
            )
        }

        self.store.cloudSignInAttempt.postAuthFailureState = nil
        self.store.cloudSignInAttempt.workspaceLinkContext = nil
        self.store.cloudSignInAttempt.postAuthRecoveryNeededState = nil
        self.store.cloudSignInAttempt.otpSheetState = nil
        self.dismiss()
    }
}

/**
 * The one place that decides a person closed the sign-in sheet.
 *
 * `onDismiss` fires when the presentation itself goes away. The sheet's own `onAppear`/`onDisappear`
 * do not mean that: SwiftUI rebuilds the sheet's content while the sheet stays on screen — switching
 * tabs under the Settings presenter is enough — and reading a dismissal from that reports an
 * abandoned sign-in for a sheet the person is still typing in. `CloudSignInSheet` keeps nothing of
 * the attempt for the same reason, so ending the attempt here is what tears its work down.
 *
 * Every presentation this modifier makes opens exactly one attempt, and it opens it before the sheet
 * can be closed. That needs both halves of `onChange(initial:)`, because a presentation does not
 * always start from a false→true edge this modifier can see. `RootTabView` keeps
 * `isGuestSignInCloudSignInPresented` in `@State` on itself while the `.cloudSignInSheet` that reads
 * it lives in the `else` branch of its body, so a credential-recovery gate that opens and closes
 * under a presented sheet destroys this modifier with the binding still `true` and installs a fresh
 * one that presents immediately. `initial: true` arms that presentation; without it the sheet is on
 * screen owing an event nobody opened, and the person's Close reports the previous presenter's
 * `screen` or nothing at all.
 *
 * `hasOpenedAttemptForCurrentPresentation` is what keeps that safe. `beginCloudSignInAttempt` starts
 * a *new* attempt — it re-reads the credential-recovery gate into the latch that decides whether a
 * later dismissal is the person or the system, and it clears the attempt's screen state and work —
 * so running it twice inside one presentation would re-latch the gate mid-attempt, turn a
 * system-caused teardown back into a reported cancellation, and throw away what the person typed.
 * The flag makes "one begin per presentation" a property of this modifier rather than of SwiftUI's
 * delivery order: it is `@State`, so a modifier that is destroyed and reinstalled starts clear and
 * arms its new presentation, while one that merely re-evaluates does not re-arm the presentation it
 * already owns.
 */
struct CloudSignInSheetModifier: ViewModifier {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore

    @Binding private var isPresented: Bool
    @State private var hasOpenedAttemptForCurrentPresentation: Bool = false
    private let presentationContext: CloudSignInPresentationContext

    init(isPresented: Binding<Bool>, presentationContext: CloudSignInPresentationContext) {
        self._isPresented = isPresented
        self.presentationContext = presentationContext
    }

    func body(content: Content) -> some View {
        content
            .onChange(of: self.isPresented, initial: true) { _, isNowPresented in
                self.openAttemptForPresentationIfNeeded(isNowPresented: isNowPresented)
            }
            .sheet(
                isPresented: self.$isPresented,
                onDismiss: {
                    self.hasOpenedAttemptForCurrentPresentation = false
                    self.store.endCloudSignInAttempt()
                },
                content: {
                    CloudSignInSheet(presentationContext: self.presentationContext)
                        .environment(self.store)
                }
            )
    }

    private func openAttemptForPresentationIfNeeded(isNowPresented: Bool) {
        guard isNowPresented else {
            self.hasOpenedAttemptForCurrentPresentation = false
            return
        }
        guard self.hasOpenedAttemptForCurrentPresentation == false else {
            return
        }

        self.hasOpenedAttemptForCurrentPresentation = true
        self.store.beginCloudSignInAttempt(
            originSurface: self.presentationContext.originSurface
        )
    }
}

extension View {
    func cloudSignInSheet(
        isPresented: Binding<Bool>,
        presentationContext: CloudSignInPresentationContext
    ) -> some View {
        self.modifier(
            CloudSignInSheetModifier(
                isPresented: isPresented,
                presentationContext: presentationContext
            )
        )
    }
}

#Preview {
    CloudSignInSheet(presentationContext: .standard(originSurface: .settings))
        .environment(FlashcardsStore())
}
