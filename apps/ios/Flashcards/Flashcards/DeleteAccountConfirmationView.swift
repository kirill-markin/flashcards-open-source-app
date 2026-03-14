import SwiftUI

struct DeleteAccountConfirmationView: View {
    @EnvironmentObject private var store: FlashcardsStore
    @Environment(\.dismiss) private var dismiss

    @State private var confirmationText: String = ""
    @FocusState private var isConfirmationFieldFocused: Bool

    private var isDeleteEnabled: Bool {
        self.confirmationText == accountDeletionConfirmationText
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 20) {
                Text("Warning! This action is permanent. You will lose all your data forever, and we will not be able to restore it.")
                    .foregroundStyle(.red)
                    .font(.headline)

                VStack(alignment: .leading, spacing: 8) {
                    Text("Type this phrase exactly to continue:")
                        .foregroundStyle(.secondary)
                    Text(accountDeletionConfirmationText)
                        .font(.body.monospaced())
                }

                TextField("delete my account", text: self.$confirmationText)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled(true)
                    .keyboardType(.asciiCapable)
                    .textFieldStyle(.roundedBorder)
                    .focused(self.$isConfirmationFieldFocused)

                Spacer()

                Button("Delete my account", role: .destructive) {
                    store.beginAccountDeletion()
                    dismiss()
                }
                .buttonStyle(.glassProminent)
                .tint(.red)
                .disabled(self.isDeleteEnabled == false)
            }
            .padding(24)
            .contentShape(Rectangle())
            .simultaneousGesture(
                TapGesture().onEnded {
                    self.isConfirmationFieldFocused = false
                }
            )
            .navigationTitle("Delete account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
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
        .environmentObject(FlashcardsStore())
}
