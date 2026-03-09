import SwiftUI
import UIKit

struct CloudSignInSheet: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: FlashcardsStore

    @State private var email: String = ""
    @State private var code: String = ""
    @State private var challenge: CloudOtpChallenge?
    @State private var errorMessage: String = ""
    @State private var isSendingCode: Bool = false
    @State private var isVerifyingCode: Bool = false

    private var isBusy: Bool {
        self.isSendingCode || self.isVerifyingCode
    }

    var body: some View {
        NavigationStack {
            Form {
                if self.errorMessage.isEmpty == false {
                    Section {
                        Text(self.errorMessage)
                            .foregroundStyle(.red)
                    }
                }

                Section("Cloud sync") {
                    Text("Sign in with email and a one-time code. Existing and new accounts use the same flow.")
                        .foregroundStyle(.secondary)
                }

                if let challenge = self.challenge {
                    self.codeSection(challenge: challenge)
                } else {
                    self.emailSection
                }
            }
            .navigationTitle(self.challenge == nil ? "Sign in" : "Verify code")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") {
                        self.dismiss()
                    }
                    .disabled(self.isBusy)
                }
            }
        }
    }

    @ViewBuilder
    private var emailSection: some View {
        Section("Email") {
            CloudEmailTextField(text: self.$email)

            Button("Send code") {
                self.sendCode()
            }
            .disabled(self.isBusy || isValidCloudEmail(self.email) == false)
        }
    }

    @ViewBuilder
    private func codeSection(challenge: CloudOtpChallenge) -> some View {
        Section("Email") {
            Text(challenge.email)
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

            Button("Verify and sync") {
                self.verifyCode(challenge: challenge)
            }
            .disabled(self.isBusy || normalizedOtpCode(self.code).isEmpty)
        }

        Section {
            Button("Resend code") {
                self.sendCode()
            }
            .disabled(self.isBusy)

            Button("Use different email") {
                self.challenge = nil
                self.code = ""
                self.errorMessage = ""
            }
            .disabled(self.isBusy)
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
                self.challenge = nextChallenge
                self.code = ""
                self.errorMessage = ""
            } catch {
                self.errorMessage = localizedMessage(error: error)
            }
        }
    }

    private func verifyCode(challenge: CloudOtpChallenge) {
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
                try await self.store.verifyCloudSignIn(
                    challenge: challenge,
                    code: nextCode
                )
                self.errorMessage = ""
                self.dismiss()
            } catch {
                if shouldResetOtpFlow(error: error) {
                    self.challenge = nil
                    self.code = ""
                }

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
