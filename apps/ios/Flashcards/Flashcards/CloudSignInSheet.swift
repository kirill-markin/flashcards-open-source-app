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
                title: "Signed in, but initial sync failed.",
                retryAction: .syncOnly
            )
        }

        return CloudPostAuthFailurePresentation(
            title: "Signed in, but cloud setup failed.",
            retryAction: .completeLink(linkContext: linkContext, selection: selection)
        )
    case .completeGuestLink(let linkContext, let selection):
        return CloudPostAuthFailurePresentation(
            title: "Signed in, but account upgrade failed.",
            retryAction: .completeGuestLink(linkContext: linkContext, selection: selection)
        )
    case .syncOnly:
        return CloudPostAuthFailurePresentation(
            title: "Signed in, but initial sync failed.",
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

struct CloudPostAuthSyncPresentation: Equatable {
    let title: String
    let message: String
}

func makeCloudPostAuthSyncPresentation() -> CloudPostAuthSyncPresentation {
    CloudPostAuthSyncPresentation(
        title: "Your account is syncing with the cloud.",
        message: "Please do not turn off your phone. This usually takes a few minutes."
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
    @State private var errorMessage: String = ""
    @State private var isSendingCode: Bool = false
    @State private var isLogoutConfirmationPresented: Bool = false

    var body: some View {
        NavigationStack {
            ReadableContentLayout(
                maxWidth: flashcardsReadableFormMaxWidth,
                horizontalPadding: 0
            ) {
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
                            .submitLabel(.send)
                            .focused(self.$isEmailFieldFocused)
                            .onSubmit {
                                self.sendCode()
                            }

                        Button("Send code") {
                            self.sendCode()
                        }
                        .disabled(self.isSendingCode || isValidCloudEmail(self.email) == false)
                    }
                }
            }
            .navigationTitle("Sign in")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") {
                        self.dismiss()
                    }
                    .disabled(self.isSendingCode)
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
                    .task(id: loadingState.id) {
                        self.prepareCloudLink(verifiedContext: loadingState.verifiedContext)
                    }
            }
            .sheet(item: self.$postAuthSyncState) { syncState in
                CloudPostAuthSyncSheet()
                    .task(id: syncState.id) {
                        self.runPostAuthSync(syncState)
                    }
            }
            .sheet(item: self.$workspaceLinkContext) { linkContext in
                CloudWorkspaceSelectionSheet(
                    linkContext: linkContext,
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
            .alert("Log out and clear this device?", isPresented: self.$isLogoutConfirmationPresented) {
                Button("Cancel", role: .cancel) {}
                Button("Log out", role: .destructive) {
                    self.logoutAndDismiss()
                }
            } message: {
                Text("All local workspaces and synced data will be removed from this device.")
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
        self.isEmailFieldFocused = false

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
                self.errorMessage = Flashcards.errorMessage(error: error)
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
        self.postAuthSyncState = nil
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
                self.postAuthSyncState = nil
                self.presentPostAuthFailure(
                    title: "Signed in, but cloud setup failed.",
                    message: Flashcards.errorMessage(error: error),
                    retryAction: .prepareLink(verifiedContext: verifiedContext)
                )
            }
        }
    }

    private func completeLink(linkContext: CloudWorkspaceLinkContext, selection: CloudWorkspaceLinkSelection) {
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
            self.prepareCloudLink(verifiedContext: verifiedContext)
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

        self.errorMessage = ""
        self.postAuthLoadingState = nil
        self.postAuthSyncState = nil
        self.workspaceLinkContext = nil
        self.postAuthFailureState = nil

        DispatchQueue.main.async {
            self.postAuthSyncState = nextState
        }
    }

    private func runPostAuthSync(_ syncState: CloudPostAuthSyncState) {
        Task { @MainActor in
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
                    try await self.store.syncCloudNow()
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
    }

    private func presentPostAuthFailure(
        title: String,
        message: String,
        retryAction: CloudPostAuthRetryAction
    ) {
        self.errorMessage = ""
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
            self.errorMessage = Flashcards.errorMessage(error: error)
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
    @State private var errorMessage: String = ""
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
                                    .focused(self.$isCodeFieldFocused)

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

                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()

                    Button("Done") {
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
            return "Enter the 8-digit code from your email."
        case .consumed:
            return "This code was already used. Request a new code to continue."
        case .expired:
            return "This code expired. Request a new code to continue."
        }
    }

    private func verifyCode() {
        self.isCodeFieldFocused = false

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
                let message = Flashcards.errorMessage(error: error)
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
                self.errorMessage = Flashcards.errorMessage(error: error)
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
                    Section("Workspace") {
                        Text("Choose one option to continue: link this device to an existing cloud workspace or create a new cloud workspace.")
                            .foregroundStyle(.secondary)
                    }

                    if self.selectionItems.isEmpty == false {
                        Section("Choose workspace") {
                            ForEach(self.selectionItems) { item in
                                Button {
                                    self.onSelection(item.selection)
                                } label: {
                                    CloudWorkspaceSelectionRow(item: item)
                                }
                                .buttonStyle(.plain)
                            }
                        }
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
                }
            }
        }
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
        return "Create new workspace"
    }

    return "Create new workspace from \"\(localWorkspaceName)\""
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

                        Button("Log out", role: .destructive) {
                            self.onLogout()
                        }
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
            ReadableContentLayout(
                maxWidth: flashcardsReadableFormMaxWidth,
                horizontalPadding: 0
            ) {
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
            }
            .navigationTitle("Cloud sync")
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
        .environment(FlashcardsStore())
}
