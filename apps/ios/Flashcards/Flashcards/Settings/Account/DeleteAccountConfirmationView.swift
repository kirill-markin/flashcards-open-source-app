import SwiftUI

struct DeleteAccountConfirmationView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @Environment(AppleSubscriptionService.self) private var subscriptions: AppleSubscriptionService
    @Environment(\.dismiss) private var dismiss

    @State private var confirmationText: String = ""
    @FocusState private var isConfirmationFieldFocused: Bool
    private var isDeleteEnabled: Bool {
        self.confirmationText == accountDeletionConfirmationText
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text(
                        aiSettingsLocalized(
                            "settings.account.deleteConfirmation.warning",
                            "Warning! This action is permanent. You will lose all your data forever, and we will not be able to restore it."
                        )
                    )
                        .foregroundStyle(.red)
                        .font(.headline)

                    if self.subscriptions.currentPurchases.isEmpty == false {
                        Text(aiSettingsLocalized(
                            "premium.apple.deleteWarning",
                            "You have an active Apple subscription. Deleting your account does not cancel it. Manage or cancel it in the App Store."
                        ))
                        .foregroundStyle(.orange)
                        .accessibilityIdentifier(UITestIdentifier.accountDeletionAppleWarning)
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        Text(aiSettingsLocalized("common.typePhraseToContinue", "Type this phrase exactly to continue:"))
                            .foregroundStyle(.secondary)
                        ConfirmationPhraseText(text: accountDeletionConfirmationText)
                    }

                    TextField(aiSettingsLocalized("settings.account.deleteConfirmation.placeholder", "delete my account"), text: self.$confirmationText)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled(true)
                        .keyboardType(.asciiCapable)
                        #if targetEnvironment(macCatalyst)
                        .textFieldStyle(.roundedBorder)
                        #else
                        .textFieldStyle(.plain)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .frame(minHeight: appMinimumTouchTarget)
                        .nativeTextInputFocusTarget(isFocused: self.$isConfirmationFieldFocused)
                        .nativeTextInputBackground(cornerRadius: 12)
                        #endif
                        .submitLabel(.done)
                        .focused(self.$isConfirmationFieldFocused)
                        .onSubmit {
                            self.isConfirmationFieldFocused = false
                        }

                    Button(aiSettingsLocalized("settings.account.dangerZone.deleteAccount", "Delete my account"), role: .destructive) {
                        store.beginAccountDeletion()
                        dismiss()
                    }
                    .nativeProminentActionButtonStyle()
                    .tint(.red)
                    .disabled(self.isDeleteEnabled == false)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(24)
            }
            .pageNavigationTitle(aiSettingsLocalized("settings.account.deleteConfirmation.title", "Delete account"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(aiSettingsLocalized("common.cancel", "Cancel")) {
                        dismiss()
                    }
                }
            }
        }
        .interactiveDismissDisabled(false)
    }
}

#Preview {
    let store = FlashcardsStore()
    DeleteAccountConfirmationView()
        .environment(store)
        .environment(AppleSubscriptionService(store: store, session: .shared))
}
