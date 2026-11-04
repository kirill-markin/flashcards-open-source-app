import SwiftUI

/**
 * The email step, pushed onto the sign-in stack. It owns its `@FocusState`: a field on a pushed
 * destination does not take focus from state declared by the view that pushed it.
 */
struct CloudSignInEmailForm<ErrorSection: View>: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @FocusState private var isEmailFieldFocused: Bool

    let errorSection: ErrorSection
    let onSendCode: () -> Void

    init(errorSection: ErrorSection, onSendCode: @escaping () -> Void) {
        self.errorSection = errorSection
        self.onSendCode = onSendCode
    }

    var body: some View {
        @Bindable var store = self.store

        return ReadableContentLayout(
            maxWidth: flashcardsReadableFormMaxWidth,
            horizontalPadding: 0
        ) {
            Form {
                self.errorSection
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
                .disabled(self.store.cloudSignInAttempt.isMethodChangeBlocked)

                Section {
                    Button(aiSettingsLocalized("settings.account.cloudSignIn.sendOneTimeCode", "Send one-time code")) {
                        self.sendCode()
                    }
                    .disabled(
                        self.store.cloudSignInAttempt.isMethodChangeBlocked
                            || isValidCloudEmail(self.store.cloudSignInAttempt.email) == false
                    )
                    .accessibilityIdentifier(UITestIdentifier.cloudSignInSendCodeButton)
                }
            }
        }
        .onAppear {
            self.scheduleEmailFieldFocusIfShowingEmailForm()
        }
    }

    private func sendCode() {
        self.isEmailFieldFocused = false
        self.onSendCode()
    }

    private func scheduleEmailFieldFocusIfShowingEmailForm() {
        guard self.store.cloudSignInAttempt.isEmailSelected,
              self.store.cloudSignInAttempt.isStepAboveEmailFormPresented == false else {
            return
        }

        DispatchQueue.main.async {
            self.isEmailFieldFocused = true
        }
    }
}
