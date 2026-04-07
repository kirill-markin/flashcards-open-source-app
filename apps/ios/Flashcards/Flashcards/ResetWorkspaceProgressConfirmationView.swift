import SwiftUI

struct ResetWorkspaceProgressConfirmationView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @Binding var isPresented: Bool

    @State private var confirmationText: String = ""
    @State private var preview: CloudWorkspaceResetProgressPreview? = nil
    @State private var previewErrorMessage: String = ""
    @State private var resetErrorMessage: String = ""
    @State private var isLoadingPreview: Bool = false
    @State private var isResetting: Bool = false
    @State private var isPreviewPresented: Bool = false
    @FocusState private var isConfirmationFieldFocused: Bool

    private var isConfirmationMatched: Bool {
        self.confirmationText == workspaceResetProgressConfirmationText
    }

    private var isOperationInProgress: Bool {
        self.isLoadingPreview || self.isResetting
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 20) {
                Text("Warning! This action is permanent. It will clear study progress for every card in this workspace.")
                    .foregroundStyle(.red)
                    .font(.headline)

                Text("Cards will remain in place. Their study progress will return to new.")
                    .foregroundStyle(.secondary)

                VStack(alignment: .leading, spacing: 8) {
                    Text("Type this phrase exactly to continue:")
                        .foregroundStyle(.secondary)
                    Text(workspaceResetProgressConfirmationText)
                        .font(.body.monospaced())
                        .accessibilityIdentifier(UITestIdentifier.resetWorkspaceProgressConfirmationPhrase)
                }

                TextField("reset all progress for all cards in this workspace", text: self.$confirmationText)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled(true)
                    .keyboardType(.asciiCapable)
                    .textFieldStyle(.roundedBorder)
                    .submitLabel(.done)
                    .focused(self.$isConfirmationFieldFocused)
                    .onSubmit {
                        self.isConfirmationFieldFocused = false
                        self.requestPreview()
                    }
                    .onChange(of: self.confirmationText) { _, _ in
                        self.previewErrorMessage = ""
                    }
                    .accessibilityIdentifier(UITestIdentifier.resetWorkspaceProgressConfirmationField)

                if self.previewErrorMessage.isEmpty == false {
                    CopyableErrorMessageView(message: self.previewErrorMessage)
                }

                if self.isLoadingPreview {
                    ProgressView()
                    Text("Loading reset preview...")
                        .foregroundStyle(.secondary)
                }

                Spacer()

                Button(self.isLoadingPreview ? "Loading..." : "Continue") {
                    self.requestPreview()
                }
                .buttonStyle(.glassProminent)
                .tint(.red)
                .disabled(self.isConfirmationMatched == false || self.isOperationInProgress)
                .accessibilityIdentifier(UITestIdentifier.resetWorkspaceProgressContinueButton)
            }
            .padding(24)
            .navigationTitle("Reset all progress")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        self.isPresented = false
                    }
                    .disabled(self.isOperationInProgress)
                }
            }
        }
        .task {
            self.isConfirmationFieldFocused = true
        }
        .interactiveDismissDisabled(self.isOperationInProgress)
        .navigationDestination(isPresented: self.$isPreviewPresented) {
            if let preview = self.preview {
                ResetWorkspaceProgressPreviewView(
                    preview: preview,
                    isResetting: self.isResetting,
                    errorMessage: self.resetErrorMessage,
                    onCancel: {
                        self.isPresented = false
                    },
                    onReset: {
                        self.requestReset()
                    }
                )
            }
        }
    }

    private func requestPreview() {
        guard self.isConfirmationMatched else {
            return
        }
        guard self.isOperationInProgress == false else {
            return
        }

        self.isLoadingPreview = true
        self.previewErrorMessage = ""

        Task {
            await self.loadPreview()
        }
    }

    @MainActor
    private func loadPreview() async {
        do {
            let preview = try await self.store.loadCurrentWorkspaceResetProgressPreview()
            self.preview = preview
            self.isPreviewPresented = true
        } catch {
            self.preview = nil
            self.previewErrorMessage = Flashcards.errorMessage(error: error)
        }

        self.isLoadingPreview = false
    }

    private func requestReset() {
        guard self.preview != nil else {
            return
        }
        guard self.isResetting == false else {
            return
        }

        self.isResetting = true
        self.resetErrorMessage = ""

        Task {
            await self.performReset()
        }
    }

    @MainActor
    private func performReset() async {
        guard let preview = self.preview else {
            self.isResetting = false
            return
        }

        do {
            try await self.store.resetCurrentWorkspaceProgress(confirmationText: preview.confirmationText)
            self.isResetting = false
            self.isPresented = false
        } catch {
            self.resetErrorMessage = Flashcards.errorMessage(error: error)
            self.isResetting = false
        }
    }
}

private struct ResetWorkspaceProgressPreviewView: View {
    let preview: CloudWorkspaceResetProgressPreview
    let isResetting: Bool
    let errorMessage: String
    let onCancel: () -> Void
    let onReset: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Warning! This action is permanent. It will reset \(self.preview.cardsToResetCount) cards in \(self.preview.workspaceName).")
                .foregroundStyle(.red)
                .font(.headline)

            Text("Cards will remain in the workspace. Only their study progress will be cleared.")
                .foregroundStyle(.secondary)

            VStack(alignment: .leading, spacing: 8) {
                Text("Cards to reset")
                    .foregroundStyle(.secondary)
                Text("\(self.preview.cardsToResetCount)")
                    .font(.largeTitle.bold().monospacedDigit())
                    .accessibilityIdentifier(UITestIdentifier.resetWorkspaceProgressCardsCount)
            }

            if self.errorMessage.isEmpty == false {
                CopyableErrorMessageView(message: self.errorMessage)
            }

            if self.isResetting {
                ProgressView()
                Text("Resetting progress...")
                    .foregroundStyle(.secondary)
            }

            Spacer()

            Button(self.isResetting ? "Resetting..." : "Reset all progress", role: .destructive) {
                self.onReset()
            }
            .buttonStyle(.glassProminent)
            .tint(.red)
            .disabled(self.isResetting)
            .accessibilityIdentifier(UITestIdentifier.resetWorkspaceProgressButton)
        }
        .padding(24)
        .navigationTitle("Confirm reset")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel") {
                    self.onCancel()
                }
                .disabled(self.isResetting)
            }
        }
        .interactiveDismissDisabled(self.isResetting)
    }
}

#Preview {
    ResetWorkspaceProgressConfirmationView(isPresented: .constant(true))
        .environment(FlashcardsStore())
}
