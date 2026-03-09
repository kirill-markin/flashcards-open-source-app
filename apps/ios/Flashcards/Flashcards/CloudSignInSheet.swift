import SwiftUI
import UIKit

private struct CloudOtpSheetState: Identifiable, Hashable {
    let id: String
    let challenge: CloudOtpChallenge

    init(challenge: CloudOtpChallenge) {
        self.id = UUID().uuidString
        self.challenge = challenge
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

struct CloudSignInSheet: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: FlashcardsStore

    @State private var email: String = ""
    @State private var otpSheetState: CloudOtpSheetState?
    @State private var workspaceLinkContext: CloudWorkspaceLinkContext?
    @State private var postAuthFailureState: CloudPostAuthFailureState?
    @State private var errorMessage: String = ""
    @State private var isSendingCode: Bool = false
    @State private var isAutoLinkingWorkspace: Bool = false

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
                    CloudEmailTextField(text: self.$email)

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
                    challenge: otpState.challenge,
                    onVerified: { verifiedContext in
                        self.handleVerifiedAuthContext(verifiedContext)
                    },
                    onReturnToEmail: { message in
                        self.otpSheetState = nil
                        self.workspaceLinkContext = nil
                        self.postAuthFailureState = nil
                        self.errorMessage = message
                    }
                )
                .environmentObject(self.store)
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
                        self.disconnectAndDismiss()
                    }
                )
                .environmentObject(self.store)
            }
        }
    }

    private func sendCode() {
        guard isValidCloudEmail(self.email) else {
            self.errorMessage = "Enter a valid email address"
            return
        }

        let nextEmail = normalizedCloudEmail(self.email)
        Task { @MainActor in
            self.isSendingCode = true
            defer {
                self.isSendingCode = false
            }

            do {
                let nextChallenge = try await self.store.sendCloudSignInCode(email: nextEmail)
                self.email = nextChallenge.email
                self.errorMessage = ""
                self.otpSheetState = CloudOtpSheetState(challenge: nextChallenge)
            } catch {
                self.errorMessage = localizedMessage(error: error)
            }
        }
    }

    private func handlePreparedLinkContext(_ linkContext: CloudWorkspaceLinkContext) {
        self.errorMessage = ""

        if linkContext.workspaces.isEmpty == false {
            self.workspaceLinkContext = linkContext
            return
        }

        self.completeLink(linkContext: linkContext, selection: .createNew)
    }

    private func handleVerifiedAuthContext(_ verifiedContext: CloudVerifiedAuthContext) {
        self.otpSheetState = nil
        self.workspaceLinkContext = nil
        self.errorMessage = ""
        self.prepareCloudLink(verifiedContext: verifiedContext)
    }

    private func prepareCloudLink(verifiedContext: CloudVerifiedAuthContext) {
        Task { @MainActor in
            do {
                let linkContext = try await self.store.prepareCloudLink(verifiedContext: verifiedContext)
                self.postAuthFailureState = nil
                self.handlePreparedLinkContext(linkContext)
            } catch {
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

        self.postAuthFailureState = nil
        self.workspaceLinkContext = nil
        self.otpSheetState = nil
        self.dismiss()
    }
}

private struct CloudOtpVerificationSheet: View {
    @EnvironmentObject private var store: FlashcardsStore

    let onVerified: (CloudVerifiedAuthContext) -> Void
    let onReturnToEmail: (String) -> Void

    @State private var currentChallenge: CloudOtpChallenge
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
        challenge: CloudOtpChallenge,
        onVerified: @escaping (CloudVerifiedAuthContext) -> Void,
        onReturnToEmail: @escaping (String) -> Void
    ) {
        self.onVerified = onVerified
        self.onReturnToEmail = onReturnToEmail
        self._currentChallenge = State(initialValue: challenge)
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
                    Text(self.currentChallenge.email)
                        .textSelection(.enabled)
                }

                Section("One-time code") {
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

                Section {
                    Button("Use different email") {
                        self.onReturnToEmail("")
                    }
                    .disabled(self.isVerifyingCode || self.isSendingCode)
                }
            }
            .navigationTitle("Verify code")
            .navigationBarTitleDisplayMode(.inline)
        }
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

        Task { @MainActor in
            self.isVerifyingCode = true
            defer {
                self.isVerifyingCode = false
            }

            do {
                let verifiedContext = try await self.store.verifyCloudOtp(
                    challenge: self.currentChallenge,
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
        Task { @MainActor in
            self.isSendingCode = true
            defer {
                self.isSendingCode = false
            }

            do {
                let nextChallenge = try await self.store.sendCloudSignInCode(email: self.currentChallenge.email)
                self.currentChallenge = nextChallenge
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

                Section {
                    Button(self.createButtonTitle) {
                        self.completeLink(selection: .createNew)
                    }
                    .disabled(self.isLinking)
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

private struct CloudEmailTextField: UIViewRepresentable {
    @Binding var text: String

    func makeCoordinator() -> Coordinator {
        Coordinator(text: self.$text)
    }

    func makeUIView(context: Context) -> UITextField {
        let textField = UITextField(frame: .zero)
        textField.delegate = context.coordinator
        textField.addTarget(context.coordinator, action: #selector(Coordinator.textDidChange(_:)), for: .editingChanged)
        // SwiftUI prompt styling inside Form kept inheriting tint, so use UITextField
        // to get the standard iOS placeholder color and behavior reliably.
        textField.placeholder = "you@example.com"
        textField.attributedPlaceholder = NSAttributedString(
            string: "you@example.com",
            attributes: [.foregroundColor: UIColor.placeholderText]
        )
        textField.keyboardType = .emailAddress
        textField.textContentType = .emailAddress
        textField.autocapitalizationType = .none
        textField.autocorrectionType = .no
        textField.clearButtonMode = .whileEditing
        textField.returnKeyType = .done
        textField.borderStyle = .none
        textField.backgroundColor = .clear
        textField.textColor = .label
        textField.adjustsFontForContentSizeCategory = true
        textField.font = UIFont.preferredFont(forTextStyle: .body)
        return textField
    }

    func updateUIView(_ uiView: UITextField, context: Context) {
        if uiView.text != self.text {
            uiView.text = self.text
        }
    }

    final class Coordinator: NSObject, UITextFieldDelegate {
        private let text: Binding<String>

        init(text: Binding<String>) {
            self.text = text
        }

        @objc
        func textDidChange(_ textField: UITextField) {
            self.text.wrappedValue = textField.text ?? ""
        }

        func textFieldShouldReturn(_ textField: UITextField) -> Bool {
            textField.resignFirstResponder()
            return true
        }
    }
}

#Preview {
    CloudSignInSheet()
        .environmentObject(FlashcardsStore())
}
