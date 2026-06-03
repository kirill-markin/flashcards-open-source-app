import SwiftUI

struct FeedbackSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(FlashcardsStore.self) private var store

    let presentation: FeedbackPresentation

    @State private var message: String = ""
    @State private var hasLoadedDraft: Bool = false
    @State private var isSubmitting: Bool = false
    @State private var errorMessage: String?

    private var title: String {
        aiSettingsLocalized("feedback.sheet.title", "Have an idea for Flashcards?")
    }

    private var bodyText: String {
        aiSettingsLocalized(
            "feedback.sheet.body",
            "Share what would make the app better. The creator reads every message personally."
        )
    }

    private var placeholder: String {
        aiSettingsLocalized("feedback.sheet.placeholder", "Write your idea here")
    }

    private var sendTitle: String {
        aiSettingsLocalized("feedback.sheet.send", "Send")
    }

    private var cancelTitle: String {
        switch self.presentation.trigger {
        case .settings:
            return aiSettingsLocalized("common.cancel", "Cancel")
        case .automatic:
            return aiSettingsLocalized("feedback.sheet.notNow", "Not now")
        }
    }

    private var validationMessage: String? {
        feedbackMessageValidationError(message: self.message)
    }

    private var canSend: Bool {
        isFeedbackSendEnabled(message: self.message, isSubmitting: self.isSubmitting)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(self.bodyText)
                        .foregroundStyle(.secondary)

                    ZStack(alignment: .topLeading) {
                        TextEditor(text: self.$message)
                            .frame(minHeight: 180)
                            .accessibilityIdentifier(UITestIdentifier.feedbackMessageEditor)

                        if self.message.isEmpty {
                            Text(self.placeholder)
                                .foregroundStyle(.tertiary)
                                .padding(.horizontal, 5)
                                .padding(.vertical, 8)
                                .allowsHitTesting(false)
                        }
                    }
                }

                if let validationMessage = self.validationMessage {
                    Section {
                        Text(validationMessage)
                            .foregroundStyle(.red)
                            .accessibilityIdentifier(UITestIdentifier.feedbackErrorMessage)
                    }
                }

                if let errorMessage = self.errorMessage {
                    Section {
                        Text(errorMessage)
                            .foregroundStyle(.red)
                            .accessibilityIdentifier(UITestIdentifier.feedbackErrorMessage)
                    }
                }
            }
            .navigationTitle(self.title)
            .navigationBarTitleDisplayMode(.inline)
            .accessibilityIdentifier(UITestIdentifier.feedbackSheet)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(self.cancelTitle) {
                        self.store.dismissFeedbackSheet()
                        self.dismiss()
                    }
                    .disabled(self.isSubmitting)
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { @MainActor in
                            await self.submit()
                        }
                    } label: {
                        if self.isSubmitting {
                            ProgressView()
                                .controlSize(.small)
                        } else {
                            Text(self.sendTitle)
                        }
                    }
                    .disabled(self.canSend == false)
                    .accessibilityIdentifier(UITestIdentifier.feedbackSendButton)
                }
            }
        }
        .interactiveDismissDisabled(self.isSubmitting)
        .task {
            self.loadDraftIfNeeded()
        }
        .onChange(of: self.message) { _, nextMessage in
            self.errorMessage = nil
            self.store.saveFeedbackDraftMessage(message: nextMessage)
        }
    }

    @MainActor
    private func loadDraftIfNeeded() {
        guard self.hasLoadedDraft == false else {
            return
        }

        self.message = self.store.loadFeedbackDraftMessage()
        self.hasLoadedDraft = true
    }

    @MainActor
    private func submit() async {
        guard self.canSend else {
            return
        }

        self.isSubmitting = true
        self.errorMessage = nil
        do {
            try await self.store.submitFeedback(
                trigger: self.presentation.trigger,
                message: self.message
            )
            self.dismiss()
        } catch {
            self.errorMessage = Flashcards.errorMessage(error: error)
        }
        self.isSubmitting = false
    }
}

#Preview {
    FeedbackSheet(
        presentation: makeFeedbackPresentation(trigger: .settings)
    )
    .environment(FlashcardsStore())
}
