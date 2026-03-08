import SwiftUI

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
            TextField("you@example.com", text: self.$email)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.emailAddress)

            Button("Send code") {
                self.sendCode()
            }
            .disabled(self.isBusy || normalizedEmail(self.email).isEmpty)
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
        let nextEmail = normalizedEmail(self.email)
        guard nextEmail.isEmpty == false else {
            self.errorMessage = "Email is required"
            return
        }

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

private func normalizedEmail(_ value: String) -> String {
    value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
}

private func normalizedOtpCode(_ value: String) -> String {
    value.trimmingCharacters(in: .whitespacesAndNewlines)
}

private func shouldResetOtpFlow(error: Error) -> Bool {
    guard let authError = error as? CloudAuthError else {
        return false
    }

    switch authError {
    case .invalidResponse(_, let message):
        return message.contains("Session expired")
    case .invalidBaseUrl, .invalidResponseBody:
        return false
    }
}

#Preview {
    CloudSignInSheet()
        .environmentObject(FlashcardsStore())
}
