import SwiftUI

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

private enum CloudPostAuthRetryAction: Hashable {
    case prepareLink(verifiedContext: CloudVerifiedAuthContext)
    case completeLink(linkContext: CloudWorkspaceLinkContext, selection: CloudWorkspaceLinkSelection)
    case syncOnly
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
    @EnvironmentObject private var store: FlashcardsStore
    @FocusState private var isEmailFieldFocused: Bool

    @State private var email: String = ""
    @State private var otpSheetState: CloudOtpSheetState?
    @State private var postAuthLoadingState: CloudPostAuthLoadingState?
    @State private var workspaceLinkContext: CloudWorkspaceLinkContext?
    @State private var postAuthFailureState: CloudPostAuthFailureState?
    @State private var errorMessage: String = ""
    @State private var isSendingCode: Bool = false
    @State private var isAutoLinkingWorkspace: Bool = false
    @State private var isDisconnectConfirmationPresented: Bool = false

    var body: some View {
        NavigationStack {
            Form {
                if self.errorMessage.isEmpty == false {
                    Section {
                        CopyableErrorMessageView(message: self.errorMessage)
                    }
                }

                Section("Cloud sync") {
                    Text("Sign in with email and continue through the code and workspace steps. Local data stays on this device until you choose a cloud workspace.")
                        .foregroundStyle(.secondary)
                }

                Section("Email") {
                    TextField("Your email", text: self.$email)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.emailAddress)
                        .textContentType(.emailAddress)
                        .submitLabel(.done)
                        .focused(self.$isEmailFieldFocused)

                    Button("Send code") {
                        self.sendCode()
                    }
                    .disabled(self.isSendingCode || isValidCloudEmail(self.email) == false)
                }
            }
            .navigationTitle("Sign in")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") {
                        self.dismiss()
                    }
                    .disabled(self.isSendingCode || self.isAutoLinkingWorkspace)
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
                        self.workspaceLinkContext = nil
                        self.postAuthFailureState = nil
                        self.scheduleEmailFieldFocus()
                    }
                )
                .environmentObject(self.store)
            }
            .sheet(item: self.$postAuthLoadingState) { loadingState in
                CloudPostAuthLoadingSheet()
                    .task(id: loadingState.id) {
                        self.prepareCloudLink(verifiedContext: loadingState.verifiedContext)
                    }
            }
            .sheet(item: self.$workspaceLinkContext) { linkContext in
                CloudWorkspaceSelectionSheet(
                    linkContext: linkContext,
                    onLinked: {
                        self.workspaceLinkContext = nil
                        self.postAuthFailureState = nil
                        self.errorMessage = ""
                        self.dismiss()
                    },
                    onLinkFailed: { selection, message in
                        self.workspaceLinkContext = nil
                        let retryAction: CloudPostAuthRetryAction = self.store.cloudSettings?.cloudState == .linked
                            ? .syncOnly
                            : .completeLink(linkContext: linkContext, selection: selection)
                        let title = self.store.cloudSettings?.cloudState == .linked
                            ? "Signed in, but initial sync failed."
                            : "Signed in, but cloud setup failed."
                        self.presentPostAuthFailure(
                            title: title,
                            message: message,
                            retryAction: retryAction
                        )
                    },
                    onCancelled: {
                        self.workspaceLinkContext = nil
                    }
                )
                .environmentObject(self.store)
            }
            .sheet(item: self.$postAuthFailureState) { failureState in
                CloudPostAuthFailureSheet(
                    state: failureState,
                    onRetry: {
                        self.retryPostAuthFailure(failureState)
                    },
                    onClose: {
                        self.postAuthFailureState = nil
                        self.dismiss()
                    },
                    onDisconnect: {
                        self.isDisconnectConfirmationPresented = true
                    }
                )
                .environmentObject(self.store)
            }
            .alert("Disconnect this device?", isPresented: self.$isDisconnectConfirmationPresented) {
                Button("Cancel", role: .cancel) {}
                Button("Disconnect", role: .destructive) {
                    self.disconnectAndDismiss()
                }
            } message: {
                Text("This device will stop syncing with the current cloud account until you sign in again.")
            }
            .onAppear {
                self.scheduleEmailFieldFocus()
            }
        }
    }

    private func scheduleEmailFieldFocus() {
        DispatchQueue.main.async {
            self.isEmailFieldFocused = true
        }
    }

    private func sendCode() {
        guard isValidCloudEmail(self.email) else {
            self.errorMessage = "Enter a valid email address"
            return
        }

        let nextEmail = normalizedCloudEmail(self.email)
        let nextOtpSheetState = CloudOtpSheetState(email: nextEmail, challenge: nil)
        self.email = nextEmail
        self.errorMessage = ""
        self.otpSheetState = nextOtpSheetState

        Task { @MainActor in
            self.isSendingCode = true
            defer {
                self.isSendingCode = false
            }

            do {
                let nextChallenge = try await self.store.sendCloudSignInCode(email: nextEmail)
                guard self.otpSheetState?.id == nextOtpSheetState.id else {
                    return
                }

                self.email = nextChallenge.email
                self.otpSheetState = nextOtpSheetState.withChallenge(nextChallenge)
            } catch {
                if self.otpSheetState?.id == nextOtpSheetState.id {
                    self.otpSheetState = nil
                }
                self.errorMessage = localizedMessage(error: error)
            }
        }
    }

    private func handlePreparedLinkContext(_ linkContext: CloudWorkspaceLinkContext) {
        self.errorMessage = ""
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
        self.workspaceLinkContext = nil
        self.errorMessage = ""
    }

    private func prepareCloudLink(verifiedContext: CloudVerifiedAuthContext) {
        Task { @MainActor in
            do {
                let linkContext = try await self.store.prepareCloudLink(verifiedContext: verifiedContext)
                self.postAuthFailureState = nil
                self.handlePreparedLinkContext(linkContext)
            } catch {
                self.postAuthLoadingState = nil
                self.presentPostAuthFailure(
                    title: "Signed in, but cloud setup failed.",
                    message: localizedMessage(error: error),
                    retryAction: .prepareLink(verifiedContext: verifiedContext)
                )
            }
        }
    }

    private func completeLink(linkContext: CloudWorkspaceLinkContext, selection: CloudWorkspaceLinkSelection) {
        Task { @MainActor in
            self.isAutoLinkingWorkspace = true
            defer {
                self.isAutoLinkingWorkspace = false
            }

            do {
                self.postAuthLoadingState = nil
                try await self.store.completeCloudLink(
                    linkContext: linkContext,
                    selection: selection
                )
                self.postAuthFailureState = nil
                self.dismiss()
            } catch {
                let retryAction: CloudPostAuthRetryAction = self.store.cloudSettings?.cloudState == .linked
                    ? .syncOnly
                    : .completeLink(linkContext: linkContext, selection: selection)
                let title = self.store.cloudSettings?.cloudState == .linked
                    ? "Signed in, but initial sync failed."
                    : "Signed in, but cloud setup failed."
                self.postAuthLoadingState = nil
                self.workspaceLinkContext = nil
                self.presentPostAuthFailure(
                    title: title,
                    message: localizedMessage(error: error),
                    retryAction: retryAction
                )
            }
        }
    }

    private func retryPostAuthFailure(_ failureState: CloudPostAuthFailureState) {
        self.postAuthFailureState = nil

        switch failureState.retryAction {
        case .prepareLink(let verifiedContext):
            self.prepareCloudLink(verifiedContext: verifiedContext)
        case .completeLink(let linkContext, let selection):
            self.completeLink(linkContext: linkContext, selection: selection)
        case .syncOnly:
            Task { @MainActor in
                do {
                    try await self.store.syncCloudNow()
                    self.dismiss()
                } catch {
                    self.presentPostAuthFailure(
                        title: "Signed in, but initial sync failed.",
                        message: localizedMessage(error: error),
                        retryAction: .syncOnly
                    )
                }
            }
        }
    }

    private func presentPostAuthFailure(
        title: String,
        message: String,
        retryAction: CloudPostAuthRetryAction
    ) {
        self.errorMessage = ""
        self.postAuthLoadingState = nil
        self.postAuthFailureState = CloudPostAuthFailureState(
            title: title,
            message: message,
            retryAction: retryAction
        )
    }

    private func disconnectAndDismiss() {
        do {
            try self.store.disconnectCloudAccount()
        } catch {
            self.errorMessage = localizedMessage(error: error)
        }

        self.postAuthLoadingState = nil
        self.postAuthFailureState = nil
        self.workspaceLinkContext = nil
        self.otpSheetState = nil
        self.dismiss()
    }
}

private struct CloudOtpVerificationSheet: View {
    @EnvironmentObject private var store: FlashcardsStore

    @Binding var otpSheetState: CloudOtpSheetState?
    let onVerified: (CloudVerifiedAuthContext) -> Void
    let onReturnToEmail: () -> Void

    @State private var code: String = ""
    @State private var errorMessage: String = ""
    @State private var isVerifyingCode: Bool = false
    @State private var isSendingCode: Bool = false
    @State private var challengeState: OtpChallengeState = .active

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
            Form {
                if self.errorMessage.isEmpty == false {
                    Section {
                        CopyableErrorMessageView(message: self.errorMessage)
                    }
                }

                Section("Email") {
                    Text(self.currentEmail)
                        .textSelection(.enabled)
                }

                Section("One-time code") {
                    if self.currentChallenge == nil {
                        Text("Sending the code…")
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
                            TextField("12345678", text: self.$code)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .keyboardType(.numberPad)
                                .textContentType(.oneTimeCode)

                            Button("Continue") {
                                self.verifyCode()
                            }
                            .disabled(self.isVerifyingCode || self.isSendingCode || normalizedOtpCode(self.code).isEmpty)
                        } else {
                            Button("Resend code") {
                                self.resendCode()
                            }
                            .disabled(self.isSendingCode || self.isVerifyingCode)
                        }
                    }
                }

            }
            .navigationTitle("Verify code")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Back") {
                        self.onReturnToEmail()
                    }
                    .disabled(self.isVerifyingCode || self.isSendingCode || self.currentChallenge == nil)
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
            return "Enter the 8-digit code from your email."
        case .consumed:
            return "This code was already used. Request a new code to continue."
        case .expired:
            return "This code expired. Request a new code to continue."
        }
    }

    private func verifyCode() {
        let nextCode = normalizedOtpCode(self.code)
        guard nextCode.isEmpty == false else {
            self.errorMessage = "Code is required"
            return
        }
        guard let currentChallenge = self.currentChallenge else {
            self.errorMessage = "Code is still loading"
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
                self.errorMessage = ""
                self.onVerified(verifiedContext)
            } catch {
                let message = localizedMessage(error: error)
                self.applyOtpErrorState(error: error)
                self.errorMessage = message
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
                let nextChallenge = try await self.store.sendCloudSignInCode(email: currentEmail)
                self.otpSheetState = self.otpSheetState?.withChallenge(nextChallenge)
                self.code = ""
                self.errorMessage = ""
                self.challengeState = .active
            } catch {
                self.errorMessage = localizedMessage(error: error)
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
    @EnvironmentObject private var store: FlashcardsStore

    let linkContext: CloudWorkspaceLinkContext
    let onLinked: () -> Void
    let onLinkFailed: (CloudWorkspaceLinkSelection, String) -> Void
    let onCancelled: () -> Void

    @State private var isLinking: Bool = false

    private var createButtonTitle: String {
        if self.store.workspace?.name.isEmpty == false {
            return "Create new workspace from \"\(self.store.workspace?.name ?? "")\""
        }

        return "Create new workspace"
    }

    var body: some View {
        NavigationStack {
            List {
                Section("Workspace") {
                    Text("Choose which cloud workspace should be linked to the local data on this device.")
                        .foregroundStyle(.secondary)
                }

                if self.linkContext.workspaces.isEmpty == false {
                    Section("Available workspaces") {
                        ForEach(self.linkContext.workspaces) { workspace in
                            Button {
                                self.completeLink(selection: .existing(workspaceId: workspace.workspaceId))
                            } label: {
                                HStack {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(workspace.name)
                                        Text(workspace.createdAt)
                                            .font(.caption.monospaced())
                                            .foregroundStyle(.secondary)
                                    }

                                    Spacer()

                                    if workspace.isSelected {
                                        Image(systemName: "checkmark.circle.fill")
                                            .foregroundStyle(.secondary)
                                    }
                                }
                            }
                            .disabled(self.isLinking)
                        }
                    }
                }

                if self.linkContext.workspaces.count > 1 {
                    Section {
                        Button(self.createButtonTitle) {
                            self.completeLink(selection: .createNew)
                        }
                        .disabled(self.isLinking)
                    }
                }
            }
            .navigationTitle("Choose workspace")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") {
                        self.onCancelled()
                    }
                    .disabled(self.isLinking)
                }
            }
        }
    }

    private func completeLink(selection: CloudWorkspaceLinkSelection) {
        Task { @MainActor in
            self.isLinking = true
            defer {
                self.isLinking = false
            }

            do {
                try await self.store.completeCloudLink(
                    linkContext: self.linkContext,
                    selection: selection
                )
                self.onLinked()
            } catch {
                self.onLinkFailed(selection, localizedMessage(error: error))
            }
        }
    }
}

private struct CloudPostAuthFailureSheet: View {
    @EnvironmentObject private var store: FlashcardsStore

    let state: CloudPostAuthFailureState
    let onRetry: () -> Void
    let onClose: () -> Void
    let onDisconnect: () -> Void

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    CopyableErrorMessageView(message: self.state.message)
                }

                Section("Cloud account") {
                    Text(self.state.title)
                        .font(.headline)
                    Text("Your sign-in succeeded, but the cloud workspace setup or initial sync did not finish.")
                        .foregroundStyle(.secondary)
                }

                Section {
                    Button("Retry") {
                        self.onRetry()
                    }
                    .disabled(isCloudSignInSyncInFlight(status: self.store.syncStatus))

                    Button("Close") {
                        self.onClose()
                    }

                    Button("Disconnect account", role: .destructive) {
                        self.onDisconnect()
                    }
                }
            }
            .navigationTitle("Cloud sync")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

private struct CloudPostAuthLoadingSheet: View {
    var body: some View {
        NavigationStack {
            Form {
                Section("Cloud sync") {
                    Text("Loading workspaces…")
                        .font(.headline)

                    Text("Your sign-in succeeded. The app is now loading the cloud workspace step.")
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
            .navigationTitle("Cloud sync")
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
    case .idle, .failed:
        return false
    }
}

#Preview {
    CloudSignInSheet()
        .environmentObject(FlashcardsStore())
}
