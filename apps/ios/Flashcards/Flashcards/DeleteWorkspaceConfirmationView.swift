import SwiftUI

struct DeleteWorkspaceConfirmationView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @Environment(\.dismiss) private var dismiss

    let preview: CloudWorkspaceDeletePreview

    @State private var confirmationText: String = ""
    @State private var errorMessage: String = ""
    @State private var isDeleting: Bool = false
    @FocusState private var isConfirmationFieldFocused: Bool

    private var isDeleteEnabled: Bool {
        self.confirmationText == self.preview.confirmationText && self.isDeleting == false
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 20) {
                Text(
                    "Warning! This action is permanent. It will delete \(self.preview.activeCardCount) active cards from \(self.preview.workspaceName)."
                )
                    .foregroundStyle(.red)
                    .font(.headline)

                if self.preview.isLastAccessibleWorkspace {
                    Text("A new empty Personal workspace will be created immediately after deletion.")
                        .foregroundStyle(.secondary)
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text("Type this phrase exactly to continue:")
                        .foregroundStyle(.secondary)
                    Text(self.preview.confirmationText)
                        .font(.body.monospaced())
                }

                TextField("delete workspace", text: self.$confirmationText)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled(true)
                    .keyboardType(.asciiCapable)
                    .textFieldStyle(.roundedBorder)
                    .submitLabel(.done)
                    .focused(self.$isConfirmationFieldFocused)
                    .onSubmit {
                        self.isConfirmationFieldFocused = false
                    }

                if self.errorMessage.isEmpty == false {
                    CopyableErrorMessageView(message: self.errorMessage)
                }

                Spacer()

                Button(self.isDeleting ? "Deleting..." : "Delete workspace", role: .destructive) {
                    Task {
                        await self.deleteWorkspace()
                    }
                }
                .buttonStyle(.glassProminent)
                .tint(.red)
                .disabled(self.isDeleteEnabled == false)
            }
            .padding(24)
            .navigationTitle("Delete workspace")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                    .disabled(self.isDeleting)
                }
            }
        }
        .interactiveDismissDisabled(self.isDeleting)
    }

    @MainActor
    private func deleteWorkspace() async {
        self.isDeleting = true
        self.errorMessage = ""

        do {
            try await store.deleteCurrentWorkspace(confirmationText: self.confirmationText)
            dismiss()
        } catch {
            self.errorMessage = Flashcards.errorMessage(error: error)
        }

        self.isDeleting = false
    }
}

#Preview {
    DeleteWorkspaceConfirmationView(
        preview: CloudWorkspaceDeletePreview(
            workspaceId: "workspace-1",
            workspaceName: "Primary",
            activeCardCount: 12,
            confirmationText: "delete workspace",
            isLastAccessibleWorkspace: false
        )
    )
    .environment(FlashcardsStore())
}
