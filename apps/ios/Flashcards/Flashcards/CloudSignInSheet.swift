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

struct CloudSignInSheet: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: FlashcardsStore

    @State private var email: String = ""
    @State private var otpSheetState: CloudOtpSheetState?
    @State private var workspaceLinkContext: CloudWorkspaceLinkContext?
    @State private var errorMessage: String = ""
    @State private var isSendingCode: Bool = false

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
                    .disabled(self.isSendingCode)
                }
            }
            .sheet(item: self.$otpSheetState) { otpState in
                CloudOtpVerificationSheet(
                    challenge: otpState.challenge,
                    onPrepared: { linkContext in
                        self.otpSheetState = nil
                        self.workspaceLinkContext = linkContext
                        self.errorMessage = ""
                    },
                    onReturnToEmail: { message in
                        self.otpSheetState = nil
                        self.workspaceLinkContext = nil
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
                        self.errorMessage = ""
                        self.dismiss()
                    },
                    onCancelled: {
                        self.workspaceLinkContext = nil
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
}

private struct CloudOtpVerificationSheet: View {
    @EnvironmentObject private var store: FlashcardsStore

    let challenge: CloudOtpChallenge
    let onPrepared: (CloudWorkspaceLinkContext) -> Void
    let onReturnToEmail: (String) -> Void

    @State private var code: String = ""
    @State private var errorMessage: String = ""
    @State private var isVerifyingCode: Bool = false

    var body: some View {
        NavigationStack {
            Form {
                if self.errorMessage.isEmpty == false {
                    Section {
                        CopyableErrorMessageView(message: self.errorMessage)
                    }
                }

                Section("Email") {
                    Text(self.challenge.email)
                        .textSelection(.enabled)
                }

                Section("One-time code") {
                    Text("Enter the 8-digit code from your email.")
                        .foregroundStyle(.secondary)

                    TextField("12345678", text: self.$code)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.numberPad)
                        .textContentType(.oneTimeCode)

                    Button("Continue") {
                        self.verifyCode()
                    }
                    .disabled(self.isVerifyingCode || normalizedOtpCode(self.code).isEmpty)
                }

                Section {
                    Button("Use different email") {
                        self.onReturnToEmail("")
                    }
                    .disabled(self.isVerifyingCode)
                }
            }
            .navigationTitle("Verify code")
            .navigationBarTitleDisplayMode(.inline)
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
                let linkContext = try await self.store.verifyCloudSignIn(
                    challenge: self.challenge,
                    code: nextCode
                )
                self.errorMessage = ""
                self.onPrepared(linkContext)
            } catch {
                let message = localizedMessage(error: error)
                if shouldResetOtpFlow(error: error) {
                    self.onReturnToEmail(message)
                    return
                }

                self.errorMessage = message
            }
        }
    }
}

private struct CloudWorkspaceSelectionSheet: View {
    @EnvironmentObject private var store: FlashcardsStore

    let linkContext: CloudWorkspaceLinkContext
    let onLinked: () -> Void
    let onCancelled: () -> Void

    @State private var errorMessage: String = ""
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
                if self.errorMessage.isEmpty == false {
                    Section {
                        CopyableErrorMessageView(message: self.errorMessage)
                    }
                }

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
                self.errorMessage = ""
                self.onLinked()
            } catch {
                self.errorMessage = localizedMessage(error: error)
            }
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

private func shouldResetOtpFlow(error: Error) -> Bool {
    guard let authError = error as? CloudAuthError else {
        return false
    }

    switch authError {
    case .invalidResponse(let details, _):
        return details.code == "OTP_SESSION_EXPIRED"
    case .invalidBaseUrl, .invalidResponseBody:
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
