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
                if let preview {
                    self.previewContent(preview: preview)
                } else {
                    self.confirmationContent()
                }
            }
            .padding(24)
            .navigationTitle(self.preview == nil ? "Reset all progress" : "Confirm reset")
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
            if self.preview == nil {
                self.isConfirmationFieldFocused = true
            }
        }
        .interactiveDismissDisabled(self.isOperationInProgress)
    }

    @ViewBuilder
    private func confirmationContent() -> some View {
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

    @ViewBuilder
    private func previewContent(preview: CloudWorkspaceResetProgressPreview) -> some View {
        Text("Warning! This action is permanent. It will reset \(preview.cardsToResetCount) cards in \(preview.workspaceName).")
            .foregroundStyle(.red)
            .font(.headline)

        Text("Cards will remain in the workspace. Only their study progress will be cleared.")
            .foregroundStyle(.secondary)

        VStack(alignment: .leading, spacing: 8) {
            Text("Cards to reset")
                .foregroundStyle(.secondary)
            Text("\(preview.cardsToResetCount)")
                .font(.largeTitle.bold().monospacedDigit())
                .accessibilityIdentifier(UITestIdentifier.resetWorkspaceProgressCardsCount)
        }

        if self.resetErrorMessage.isEmpty == false {
            CopyableErrorMessageView(message: self.resetErrorMessage)
        }

        if self.isResetting {
            ProgressView()
            Text("Resetting progress...")
                .foregroundStyle(.secondary)
        }

        Spacer()

        Button(self.isResetting ? "Resetting..." : "Reset all progress", role: .destructive) {
            self.requestReset(preview: preview)
        }
        .buttonStyle(.glassProminent)
        .tint(.red)
        .disabled(self.isResetting)
        .accessibilityIdentifier(UITestIdentifier.resetWorkspaceProgressButton)
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
            self.isLoadingPreview = false
        } catch {
            self.preview = nil
            self.previewErrorMessage = Flashcards.errorMessage(error: error)
            self.isLoadingPreview = false
        }
    }

    private func requestReset(preview: CloudWorkspaceResetProgressPreview) {
        guard self.preview != nil else {
            return
        }
        guard self.isResetting == false else {
            return
        }

        self.isResetting = true
        self.resetErrorMessage = ""

        Task {
            await self.performReset(preview: preview)
        }
    }

    @MainActor
    private func performReset(preview: CloudWorkspaceResetProgressPreview) async {
        guard self.preview != nil else {
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

#Preview {
    ResetWorkspaceProgressConfirmationView(isPresented: .constant(true))
        .environment(FlashcardsStore())
}
