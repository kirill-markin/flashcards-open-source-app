import SwiftUI

struct DeleteAccountConfirmationView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
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

                    VStack(alignment: .leading, spacing: 8) {
                        Text(aiSettingsLocalized("common.typePhraseToContinue", "Type this phrase exactly to continue:"))
                            .foregroundStyle(.secondary)
                        ConfirmationPhraseText(text: accountDeletionConfirmationText)
                    }

                    TextField(aiSettingsLocalized("settings.account.deleteConfirmation.placeholder", "delete my account"), text: self.$confirmationText)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled(true)
                        .keyboardType(.asciiCapable)
                        .textFieldStyle(.roundedBorder)
                        .submitLabel(.done)
                        .focused(self.$isConfirmationFieldFocused)
                        .onSubmit {
                            self.isConfirmationFieldFocused = false
                        }

                    Button(aiSettingsLocalized("settings.account.dangerZone.deleteAccount", "Delete my account"), role: .destructive) {
                        store.beginAccountDeletion()
                        dismiss()
                    }
                    .buttonStyle(.glassProminent)
                    .tint(.red)
                    .disabled(self.isDeleteEnabled == false)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(24)
            }
            .navigationTitle(aiSettingsLocalized("settings.account.deleteConfirmation.title", "Delete account"))
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
    DeleteAccountConfirmationView()
        .environment(FlashcardsStore())
}
