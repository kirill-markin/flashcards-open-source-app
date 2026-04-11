import SwiftUI
import UIKit

private struct CloudOtpSheetState: Identifiable, Hashable {
    let id: String
    let email: String
    let challenge: CloudOtpChallenge?

    init(email: String, challenge: CloudOtpChallenge?) {
        self.init(id: UUID().uuidString, email: email, challenge: challenge)
    }

    private init(id: String, email: String, challenge: CloudOtpChallenge?) {
        self.id = id
        self.email = email
        self.challenge = challenge
    }

    func withChallenge(_ challenge: CloudOtpChallenge) -> CloudOtpSheetState {
        CloudOtpSheetState(id: self.id, email: challenge.email, challenge: challenge)
    }
}

enum CloudPostAuthRetryAction: Hashable {
    case prepareLink(verifiedContext: CloudVerifiedAuthContext)
    case completeLink(linkContext: CloudWorkspaceLinkContext, selection: CloudWorkspaceLinkSelection)
    case completeGuestLink(linkContext: CloudWorkspaceLinkContext, selection: CloudWorkspaceLinkSelection)
    case syncOnly
}

enum CloudPostAuthSyncOperation: Hashable {
    case completeLink(linkContext: CloudWorkspaceLinkContext, selection: CloudWorkspaceLinkSelection)
    case completeGuestLink(linkContext: CloudWorkspaceLinkContext, selection: CloudWorkspaceLinkSelection)
    case syncOnly
}

struct CloudPostAuthFailurePresentation: Equatable {
    let title: String
    let retryAction: CloudPostAuthRetryAction
}

func makeCloudPostAuthFailurePresentation(
    operation: CloudPostAuthSyncOperation,
    cloudState: CloudAccountState?
) -> CloudPostAuthFailurePresentation {
    switch operation {
    case .completeLink(let linkContext, let selection):
        if cloudState == .linked {
            return CloudPostAuthFailurePresentation(
                title: aiSettingsLocalized("settings.account.cloudSignIn.failure.initialSyncFailed", "Signed in, but initial sync failed."),
                retryAction: .syncOnly
            )
        }

        return CloudPostAuthFailurePresentation(
            title: aiSettingsLocalized("settings.account.cloudSignIn.failure.cloudSetupFailed", "Signed in, but cloud setup failed."),
            retryAction: .completeLink(linkContext: linkContext, selection: selection)
        )
    case .completeGuestLink(let linkContext, let selection):
        return CloudPostAuthFailurePresentation(
            title: aiSettingsLocalized("settings.account.cloudSignIn.failure.accountUpgradeFailed", "Signed in, but account upgrade failed."),
            retryAction: .completeGuestLink(linkContext: linkContext, selection: selection)
        )
    case .syncOnly:
        return CloudPostAuthFailurePresentation(
            title: aiSettingsLocalized("settings.account.cloudSignIn.failure.initialSyncFailed", "Signed in, but initial sync failed."),
            retryAction: .syncOnly
        )
    }
}

private struct CloudPostAuthFailureState: Identifiable, Hashable {
    let id: String
    let title: String
    let message: String
    let retryAction: CloudPostAuthRetryAction

    init(title: String, message: String, retryAction: CloudPostAuthRetryAction) {
        self.id = UUID().uuidString
        self.title = title
        self.message = message
        self.retryAction = retryAction
    }
}

private struct CloudPostAuthLoadingState: Identifiable, Hashable {
    let id: String
    let verifiedContext: CloudVerifiedAuthContext

    init(verifiedContext: CloudVerifiedAuthContext) {
        self.id = UUID().uuidString
        self.verifiedContext = verifiedContext
    }
}

private struct CloudPostAuthSyncState: Identifiable, Hashable {
    let id: String
    let operation: CloudPostAuthSyncOperation

    init(operation: CloudPostAuthSyncOperation) {
        self.id = UUID().uuidString
        self.operation = operation
    }
}

private struct CloudAuthInlineErrorView: View {
    let presentation: CloudAuthInlineErrorPresentation

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(self.presentation.message)
                .foregroundStyle(.red)
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
                .accessibilityIdentifier(UITestIdentifier.cloudSignInInlineAuthErrorMessage)

            if let technicalDetails = self.presentation.technicalDetails {
                DisclosureGroup(aiSettingsLocalized("settings.account.cloudSignIn.technicalDetails", "Technical details")) {
                    Text(technicalDetails)
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .textSelection(.enabled)
                        .padding(.top, 4)
                        .contextMenu {
                            Button(aiSettingsLocalized("settings.account.cloudSignIn.copyTechnicalDetails", "Copy technical details")) {
                                UIPasteboard.general.string = technicalDetails
                            }
                        }
                }
                .tint(.secondary)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(UITestIdentifier.cloudSignInInlineAuthError)
    }
}

struct CloudPostAuthSyncPresentation: Equatable {
    let title: String
    let message: String
}

func makeCloudPostAuthSyncPresentation() -> CloudPostAuthSyncPresentation {
    CloudPostAuthSyncPresentation(
        title: aiSettingsLocalized("settings.account.cloudSignIn.sync.title", "Your account is syncing with the cloud."),
        message: aiSettingsLocalized("settings.account.cloudSignIn.sync.message", "Please do not turn off your phone. This usually takes a few minutes.")
    )
}

enum CloudWorkspacePostAuthRoute: Equatable {
    case autoLink(CloudWorkspaceLinkSelection)
    case chooseWorkspace
}

func makeCloudWorkspacePostAuthRoute(workspaces: [CloudWorkspaceSummary]) -> CloudWorkspacePostAuthRoute {
    if workspaces.isEmpty {
        return .autoLink(.createNew)
    }

    if workspaces.count == 1, let workspace = workspaces.first {
        return .autoLink(.existing(workspaceId: workspace.workspaceId))
    }

    return .chooseWorkspace
}

struct CloudSignInSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @FocusState private var isEmailFieldFocused: Bool

    @State private var email: String = ""
    @State private var otpSheetState: CloudOtpSheetState?
    @State private var postAuthLoadingState: CloudPostAuthLoadingState?
    @State private var postAuthSyncState: CloudPostAuthSyncState?
    @State private var workspaceLinkContext: CloudWorkspaceLinkContext?
    @State private var postAuthFailureState: CloudPostAuthFailureState?
    @State private var authErrorPresentation: CloudAuthInlineErrorPresentation?
    @State private var isSendingCode: Bool = false
    @State private var isLogoutConfirmationPresented: Bool = false

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
                        self.otpSheetState = nil
                        self.postAuthLoadingState = nil
                        self.postAuthSyncState = nil
                        self.workspaceLinkContext = nil
                        self.postAuthFailureState = nil
                        self.scheduleEmailFieldFocus()
                    }
                )
                .environment(self.store)
            }
            .sheet(item: self.$postAuthLoadingState) { loadingState in
                CloudPostAuthLoadingSheet()
                    .interactiveDismissDisabled(true)
                    .task(id: loadingState.id) {
                        await self.prepareCloudLink(verifiedContext: loadingState.verifiedContext)
                    }
            }
            .sheet(item: self.$postAuthSyncState) { syncState in
                CloudPostAuthSyncSheet()
                    .interactiveDismissDisabled(true)
                    .task(id: syncState.id) {
                        await self.runPostAuthSync(syncState)
                    }
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
            .sheet(item: self.$postAuthFailureState) { failureState in
                CloudPostAuthFailureSheet(
                    state: failureState,
                    isRetryDisabled: self.isPostAuthActionInFlight,
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
                self.scheduleEmailFieldFocus()
            }
        }
        .accessibilityIdentifier(UITestIdentifier.cloudSignInScreen)
    }

    private var isPostAuthActionInFlight: Bool {
        self.postAuthLoadingState != nil || self.postAuthSyncState != nil
    }

    private func scheduleEmailFieldFocus() {
        DispatchQueue.main.async {
            self.isEmailFieldFocused = true
        }
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
                    // configured review/demo emails on the auth service.
                    self.otpSheetState = nil
                    self.handleVerifiedAuthContext(
                        CloudVerifiedAuthContext(
                            apiBaseUrl: try self.store.currentCloudServiceConfiguration().apiBaseUrl,
                            credentials: credentials
                        )
                    )
                }
            } catch {
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

        switch makeCloudWorkspacePostAuthRoute(workspaces: linkContext.workspaces) {
        case .autoLink(let selection):
            self.completeLink(linkContext: linkContext, selection: selection)
        case .chooseWorkspace:
            self.workspaceLinkContext = linkContext
        }
    }

    private func handleVerifiedAuthContext(_ verifiedContext: CloudVerifiedAuthContext) {
        self.otpSheetState = nil
        self.postAuthLoadingState = CloudPostAuthLoadingState(verifiedContext: verifiedContext)
        self.postAuthSyncState = nil
        self.workspaceLinkContext = nil
        self.authErrorPresentation = nil
    }

    private func prepareCloudLink(verifiedContext: CloudVerifiedAuthContext) async {
        do {
            let linkContext = try await self.store.prepareCloudLink(verifiedContext: verifiedContext)
            self.postAuthFailureState = nil
            self.handlePreparedLinkContext(linkContext)
        } catch {
            self.postAuthLoadingState = nil
            self.postAuthSyncState = nil
            self.presentPostAuthFailure(
                title: aiSettingsLocalized("settings.account.cloudSignIn.failure.cloudSetupFailed", "Signed in, but cloud setup failed."),
                message: Flashcards.errorMessage(error: error),
                retryAction: .prepareLink(verifiedContext: verifiedContext)
            )
        }
    }

    private func completeLink(linkContext: CloudWorkspaceLinkContext, selection: CloudWorkspaceLinkSelection) {
        guard self.isPostAuthActionInFlight == false else {
            return
        }

        self.presentPostAuthSync(
            operation: linkContext.guestUpgradeMode == .mergeRequired
                ? .completeGuestLink(linkContext: linkContext, selection: selection)
                : .completeLink(linkContext: linkContext, selection: selection)
        )
    }

    private func retryPostAuthFailure(_ failureState: CloudPostAuthFailureState) {
        self.postAuthFailureState = nil

        switch failureState.retryAction {
        case .prepareLink(let verifiedContext):
            self.postAuthLoadingState = CloudPostAuthLoadingState(verifiedContext: verifiedContext)
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
        self.postAuthSyncState = nil
        self.workspaceLinkContext = nil
        self.postAuthFailureState = nil
        self.postAuthSyncState = nextState
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
                        surfacesGlobalErrorMessage: true
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
                message: Flashcards.errorMessage(error: error),
                retryAction: failurePresentation.retryAction
            )
        }
    }

    private func presentPostAuthFailure(
        title: String,
        message: String,
        retryAction: CloudPostAuthRetryAction
    ) {
        self.authErrorPresentation = nil
        self.postAuthLoadingState = nil
        self.postAuthSyncState = nil
        self.postAuthFailureState = CloudPostAuthFailureState(
            title: title,
            message: message,
            retryAction: retryAction
        )
    }

    private func logoutAndDismiss() {
        do {
            try self.store.logoutCloudAccount()
        } catch {
            self.authErrorPresentation = CloudAuthInlineErrorPresentation(
                message: Flashcards.errorMessage(error: error),
                technicalDetails: nil
            )
        }

        self.postAuthLoadingState = nil
        self.postAuthSyncState = nil
        self.postAuthFailureState = nil
        self.workspaceLinkContext = nil
        self.otpSheetState = nil
        self.dismiss()
    }
}

private struct CloudOtpVerificationSheet: View {
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
            return aiSettingsLocalized("settings.account.cloudSignIn.challengePrompt.active", "Enter the 8-digit code from your email.")
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

private struct CloudWorkspaceSelectionSheet: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore

    let linkContext: CloudWorkspaceLinkContext
    let isSelectionDisabled: Bool
    let onSelection: (CloudWorkspaceLinkSelection) -> Void
    let onCancelled: () -> Void

    private var selectionItems: [CloudWorkspaceSelectionItem] {
        makeCloudWorkspaceSelectionItems(
            workspaces: self.linkContext.workspaces,
            localWorkspaceName: self.store.workspace?.name
        )
    }

    var body: some View {
        NavigationStack {
            ReadableContentLayout(
                maxWidth: flashcardsReadableFormMaxWidth,
                horizontalPadding: 0
            ) {
                List {
                    Section(aiSettingsLocalized("settings.account.cloudSignIn.section.workspace", "Workspace")) {
                        Text(
                            aiSettingsLocalized(
                                "settings.account.cloudSignIn.workspaceDescription",
                                "Choose one option to continue: link this device to an existing cloud workspace or create a new cloud workspace."
                            )
                        )
                            .foregroundStyle(.secondary)
                    }

                    if self.selectionItems.isEmpty == false {
                        Section(aiSettingsLocalized("settings.currentWorkspace.section.chooseWorkspace", "Choose workspace")) {
                            ForEach(self.selectionItems) { item in
                                Button {
                                    self.onSelection(item.selection)
                                } label: {
                                    CloudWorkspaceSelectionRow(item: item)
                                }
                                .buttonStyle(.plain)
                                .disabled(self.isSelectionDisabled)
                                .accessibilityIdentifier(cloudWorkspaceSelectionButtonIdentifier(selection: item.selection))
                            }
                        }
                    }
                }
            }
            .accessibilityIdentifier(UITestIdentifier.cloudWorkspaceChooserScreen)
            .navigationTitle(aiSettingsLocalized("settings.currentWorkspace.chooseWorkspaceTitle", "Choose workspace"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(aiSettingsLocalized("common.close", "Close")) {
                        self.onCancelled()
                    }
                }
            }
        }
    }
}

private func cloudWorkspaceSelectionButtonIdentifier(selection: CloudWorkspaceLinkSelection) -> String {
    switch selection {
    case .createNew:
        return UITestIdentifier.cloudSignInCreateWorkspaceButton
    case .existing(let workspaceId):
        return "cloudSignIn.existingWorkspace.\(workspaceId)"
    }
}

struct CloudWorkspaceSelectionItem: Identifiable, Hashable {
    let id: String
    let title: String
    let subtitle: String?
    let symbolName: String?
    let showsSelectedIndicator: Bool
    let selection: CloudWorkspaceLinkSelection
}

func makeCloudWorkspaceSelectionItems(
    workspaces: [CloudWorkspaceSummary],
    localWorkspaceName: String?
) -> [CloudWorkspaceSelectionItem] {
    let existingWorkspaceItems = workspaces.map { workspace in
        CloudWorkspaceSelectionItem(
            id: workspace.workspaceId,
            title: workspace.name,
            subtitle: workspace.createdAt,
            symbolName: nil,
            showsSelectedIndicator: workspace.isSelected,
            selection: .existing(workspaceId: workspace.workspaceId)
        )
    }
    let createWorkspaceTitle = makeCreateWorkspaceSelectionTitle(localWorkspaceName: localWorkspaceName)

    return existingWorkspaceItems + [
        CloudWorkspaceSelectionItem(
            id: "create-new-workspace",
            title: createWorkspaceTitle,
            subtitle: nil,
            symbolName: "plus.circle",
            showsSelectedIndicator: false,
            selection: .createNew
        )
    ]
}

func makeCreateWorkspaceSelectionTitle(localWorkspaceName: String?) -> String {
    guard let localWorkspaceName, localWorkspaceName.isEmpty == false else {
        return aiSettingsLocalized("settings.currentWorkspace.createNew", "Create new workspace")
    }

    return aiSettingsLocalizedFormat(
        "settings.currentWorkspace.createFromCurrent",
        "Create new workspace from \"%@\"",
        localWorkspaceName
    )
}

private struct CloudWorkspaceSelectionRow: View {
    let item: CloudWorkspaceSelectionItem

    var body: some View {
        HStack(spacing: 12) {
            if let symbolName = self.item.symbolName {
                Image(systemName: symbolName)
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .frame(width: 20)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(self.item.title)
                    .foregroundStyle(.primary)

                if let subtitle = self.item.subtitle {
                    Text(subtitle)
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()

            if self.item.showsSelectedIndicator {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(.secondary)
            }
        }
        .contentShape(Rectangle())
        .padding(.vertical, 2)
    }
}

private struct CloudPostAuthFailureSheet: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore

    let state: CloudPostAuthFailureState
    let isRetryDisabled: Bool
    let onRetry: () -> Void
    let onClose: () -> Void
    let onLogout: () -> Void

    var body: some View {
        NavigationStack {
            ReadableContentLayout(
                maxWidth: flashcardsReadableFormMaxWidth,
                horizontalPadding: 0
            ) {
                Form {
                    Section {
                        CopyableErrorMessageView(message: self.state.message)
                            .accessibilityIdentifier(UITestIdentifier.cloudSignInPostAuthFailureMessage)
                    }

                    Section(aiSettingsLocalized("settings.account.cloudSignIn.section.cloudAccount", "Cloud account")) {
                        Text(self.state.title)
                            .font(.headline)
                        Text(
                            aiSettingsLocalized(
                                "settings.account.cloudSignIn.failureDescription",
                                "Your sign-in succeeded, but the cloud workspace setup or initial sync did not finish."
                            )
                        )
                            .foregroundStyle(.secondary)
                    }

                    Section {
                        Button(aiSettingsLocalized("common.retry", "Retry")) {
                            self.onRetry()
                        }
                        .disabled(self.isRetryDisabled || isCloudSignInSyncInFlight(status: self.store.syncStatus))

                        Button(aiSettingsLocalized("common.close", "Close")) {
                            self.onClose()
                        }

                        Button(aiSettingsLocalized("settings.account.status.logOut", "Log out"), role: .destructive) {
                            self.onLogout()
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

private struct CloudPostAuthLoadingSheet: View {
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

private struct CloudPostAuthSyncSheet: View {
    private let presentation: CloudPostAuthSyncPresentation = makeCloudPostAuthSyncPresentation()

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

private let cloudEmailPattern = "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$"

func normalizedCloudEmail(_ value: String) -> String {
    value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
}

func isValidCloudEmail(_ value: String) -> Bool {
    let normalizedValue = normalizedCloudEmail(value)
    return normalizedValue.range(of: cloudEmailPattern, options: .regularExpression) != nil
}

private func normalizedOtpCode(_ value: String) -> String {
    value.trimmingCharacters(in: .whitespacesAndNewlines)
}

private func isCloudSignInSyncInFlight(status: SyncStatus) -> Bool {
    switch status {
    case .syncing:
        return true
    case .blocked:
        return true
    case .idle, .failed:
        return false
    }
}

#Preview {
    CloudSignInSheet()
        .environment(FlashcardsStore())
}
