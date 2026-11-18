import SwiftUI

func aiChatCustomInstructionsTitle() -> String {
    aiSettingsLocalized("ai.customInstructions.title", "Custom instructions")
}

private enum AIChatCustomInstructionsLoadPhase: Equatable {
    case loading
    case failed(message: String)
    case loaded(maxLength: Int, scope: AIChatCustomInstructionsScope)
}

/// Edits the current workspace's standing preferences for the in-app AI chat; saved online only.
struct AIChatCustomInstructionsView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @Environment(\.dismiss) private var dismiss
    #if targetEnvironment(macCatalyst)
    @Environment(\.macToolbarOwnerTab) private var macToolbarOwnerTab
    #endif

    @State private var text: String
    @State private var savedText: String
    @State private var loadPhase: AIChatCustomInstructionsLoadPhase = .loading
    @State private var isSaving: Bool = false
    @State private var saveErrorMessage: String? = nil
    @FocusState private var isFieldFocused: Bool

    @MainActor
    init(cachedText: String?) {
        self._text = State(initialValue: cachedText ?? "")
        self._savedText = State(initialValue: cachedText ?? "")
    }

    private var maxLength: Int? {
        if case .loaded(let maxLength, _) = self.loadPhase {
            return maxLength
        }
        return nil
    }

    private var isOverLimit: Bool {
        guard let maxLength = self.maxLength else {
            return false
        }
        return self.text.unicodeScalars.count > maxLength
    }

    private var isSaveDisabled: Bool {
        self.maxLength == nil || self.isSaving || self.isOverLimit || self.text == self.savedText
    }

    /// The Mac window toolbar cannot show a spinner on Save, so the footer shows it there.
    private var showsSavingInFooter: Bool {
        #if targetEnvironment(macCatalyst)
        true
        #else
        false
        #endif
    }

    var body: some View {
        Form {
            Section {
                TextField(
                    aiSettingsLocalized(
                        "ai.customInstructions.placeholder",
                        "For example: I study German at A2. Add an example sentence on the back of each card. Keep answers short."
                    ),
                    text: self.$text,
                    axis: .vertical
                )
                .lineLimit(6...)
                .focused(self.$isFieldFocused)
                .disabled(self.maxLength == nil || self.isSaving)
                .accessibilityIdentifier(UITestIdentifier.aiCustomInstructionsField)
            } footer: {
                self.fieldFooter
            }

            if case .failed(let message) = self.loadPhase {
                Section {
                    Text(aiSettingsLocalized("ai.customInstructions.loadFailed", "Couldn't load custom instructions."))
                    Text(message)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                    Button(aiSettingsLocalized("common.retry", "Retry")) {
                        Task { await self.load() }
                    }
                }
            }

            if let saveErrorMessage {
                Section {
                    Text(aiSettingsLocalized("ai.customInstructions.saveFailed", "Couldn't save custom instructions. Try again."))
                        .foregroundStyle(.red)
                    Text(saveErrorMessage)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                }
            }
        }
        .accessibilityIdentifier(UITestIdentifier.aiCustomInstructionsScreen)
        .nativeNavigationTitle(aiChatCustomInstructionsTitle())
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(self.isSaving)
        #if targetEnvironment(macCatalyst)
        .macToolbarContribution(MacToolbarContribution(
            tab: self.macToolbarOwnerTab ?? .ai,
            role: .navigation,
            trailing: [MacToolbarGroup(identifier: "ai.customInstructions.actions", actions: [
                MacToolbarAction(
                    identifier: UITestIdentifier.aiCustomInstructionsSaveButton,
                    symbol: "checkmark",
                    label: aiSettingsLocalized("common.save", "Save"),
                    isEnabled: self.isSaveDisabled == false
                ) { _ in self.save() }
            ])]
        ))
        #else
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button(action: self.save) {
                    if self.isSaving {
                        ProgressView()
                            .controlSize(.small)
                    } else {
                        Text(aiSettingsLocalized("common.save", "Save"))
                    }
                }
                .disabled(self.isSaveDisabled)
                .accessibilityIdentifier(UITestIdentifier.aiCustomInstructionsSaveButton)
            }
        }
        #endif
        .task(id: self.store.aiChatStore.currentCustomInstructionsScope) {
            await self.load()
        }
    }

    @ViewBuilder
    private var fieldFooter: some View {
        if self.loadPhase == .loading || (self.isSaving && self.showsSavingInFooter) {
            ProgressView()
                .controlSize(.small)
                .frame(maxWidth: .infinity, alignment: .trailing)
        } else if let maxLength = self.maxLength {
            Text(aiSettingsLocalizedFormat(
                "ai.customInstructions.count",
                "%1$lld / %2$lld",
                self.text.unicodeScalars.count,
                maxLength
            ))
            .monospacedDigit()
            .foregroundStyle(self.isOverLimit ? Color.red : Color.secondary)
            .frame(maxWidth: .infinity, alignment: .trailing)
        }
    }

    private func load() async {
        self.loadPhase = .loading
        do {
            let (response, scope) = try await self.store.aiChatStore.loadCustomInstructions()
            self.text = response.customInstructions ?? ""
            self.savedText = self.text
            self.loadPhase = .loaded(maxLength: response.maxLength, scope: scope)
            // The field enables on this update, so focus it on the next one.
            await Task.yield()
            self.isFieldFocused = true
        } catch {
            guard isRequestCancellationError(error: error) == false else {
                return
            }
            captureAIChatHistoryFailure(
                error: error,
                flashcardsStore: self.store,
                action: "chat_custom_instructions_load",
                sessionId: nil
            )
            self.loadPhase = .failed(message: errorMessage(error: error))
        }
    }

    private func save() {
        guard self.isSaveDisabled == false, case .loaded(_, let loadedScope) = self.loadPhase else {
            return
        }

        self.isSaving = true
        self.saveErrorMessage = nil
        self.isFieldFocused = false
        Task { @MainActor in
            do {
                _ = try await self.store.aiChatStore.saveCustomInstructions(text: self.text, loadedScope: loadedScope)
                self.isSaving = false
                self.dismiss()
            } catch {
                guard isRequestCancellationError(error: error) == false else {
                    self.isSaving = false
                    return
                }
                captureAIChatHistoryFailure(
                    error: error,
                    flashcardsStore: self.store,
                    action: "chat_custom_instructions_save",
                    sessionId: nil
                )
                self.saveErrorMessage = errorMessage(error: error)
                self.isSaving = false
            }
        }
    }
}
