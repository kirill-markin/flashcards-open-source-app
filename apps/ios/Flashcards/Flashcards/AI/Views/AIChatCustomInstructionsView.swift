import SwiftUI

func aiChatCustomInstructionsTitle() -> String {
    aiSettingsLocalized("ai.customInstructions.title", "Custom instructions")
}

private enum AIChatCustomInstructionsLoadPhase: Equatable {
    case loading
    case failed(message: String)
    case loaded(AIChatCustomInstructionsResponse, scope: AIChatCustomInstructionsScope)
}

struct AIChatCustomInstructionsView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @Environment(\.dismiss) private var dismiss
    #if targetEnvironment(macCatalyst)
    @Environment(\.macToolbarOwnerTab) private var macToolbarOwnerTab
    #endif

    @State private var text: String
    @State private var savedText: String
    @State private var loadPhase: AIChatCustomInstructionsLoadPhase = .loading
    @State private var savingScope: AIChatCustomInstructionsScope? = nil
    @State private var saveErrorMessage: String? = nil
    @FocusState private var isFieldFocused: Bool

    @MainActor
    init(cachedText: String?) {
        self._text = State(initialValue: cachedText ?? "")
        self._savedText = State(initialValue: cachedText ?? "")
    }

    private var settings: AIChatCustomInstructionsResponse? {
        guard case .loaded(let settings, let scope) = self.loadPhase,
              scope == self.store.aiChatStore.currentCustomInstructionsScope else {
            return nil
        }
        return settings
    }

    private var editedText: String {
        self.text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var canEdit: Bool {
        self.settings?.canEdit == true
    }

    private var isSaving: Bool {
        guard let savingScope = self.savingScope else { return false }
        return savingScope == self.store.aiChatStore.currentCustomInstructionsScope
    }

    private var isOverLimit: Bool {
        guard let maxLength = self.settings?.maxLength else {
            return false
        }
        return self.editedText.unicodeScalars.count > maxLength
    }

    private var isSaveDisabled: Bool {
        self.canEdit == false || self.isSaving || self.isOverLimit || self.editedText == self.savedText
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
        let scope = self.store.aiChatStore.currentCustomInstructionsScope
        Form {
            Section {
                if self.canEdit {
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
                    .disabled(self.isSaving)
                    .accessibilityIdentifier(UITestIdentifier.aiCustomInstructionsField)
                } else if let text = self.settings == nil
                    ? self.store.aiChatStore.currentCustomInstructionsReading?.text
                    : self.settings?.customInstructions {
                    Text(verbatim: text)
                        .textSelection(.enabled)
                        .accessibilityIdentifier(UITestIdentifier.aiCustomInstructionsField)
                }
            } header: {
                Text(aiSettingsLocalized(
                    "ai.customInstructions.description",
                    "Preferences the AI chat follows in this workspace, such as language, level, answer length and card style."
                ))
                .textCase(nil)
            } footer: {
                self.fieldFooter
            }

            if self.canEdit && self.savedText.isEmpty == false {
                Section {
                    Button(aiSettingsLocalized("common.delete", "Delete"), role: .destructive) {
                        self.save(text: "")
                    }
                    .disabled(self.isSaving)
                }
            }

            if case .failed(let message) = self.loadPhase {
                Section {
                    Text(aiSettingsLocalized("ai.customInstructions.loadFailed", "Couldn't load custom instructions."))
                    Text(message)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                    Button(aiSettingsLocalized("common.retry", "Retry")) {
                        Task { await self.load(scope: scope) }
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
            trailing: self.canEdit ? [MacToolbarGroup(identifier: "ai.customInstructions.actions", actions: [
                MacToolbarAction(
                    identifier: UITestIdentifier.aiCustomInstructionsSaveButton,
                    symbol: "checkmark",
                    label: aiSettingsLocalized("common.save", "Save"),
                    isEnabled: self.isSaveDisabled == false
                ) { _ in self.save(text: self.editedText) }
            ])] : []
        ))
        #else
        .toolbar {
            if self.canEdit {
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        self.save(text: self.editedText)
                    } label: {
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
        }
        #endif
        .task(id: scope) {
            await self.load(scope: scope)
        }
    }

    @ViewBuilder
    private var fieldFooter: some View {
        if self.loadPhase == .loading || (self.isSaving && self.showsSavingInFooter) {
            ProgressView()
                .controlSize(.small)
                .frame(maxWidth: .infinity, alignment: .trailing)
        } else if self.canEdit, let maxLength = self.settings?.maxLength {
            Text(aiSettingsLocalizedFormat(
                "ai.customInstructions.count",
                "%1$lld / %2$lld",
                self.editedText.unicodeScalars.count,
                maxLength
            ))
            .monospacedDigit()
            .foregroundStyle(self.isOverLimit ? Color.red : Color.secondary)
            .frame(maxWidth: .infinity, alignment: .trailing)
        }
    }

    private func load(scope: AIChatCustomInstructionsScope?) async {
        guard Task.isCancelled == false,
              scope == self.store.aiChatStore.currentCustomInstructionsScope else { return }
        self.loadPhase = .loading
        self.saveErrorMessage = nil
        self.isFieldFocused = false
        guard let scope else {
            self.dismiss()
            return
        }
        do {
            let response = try await self.store.aiChatStore.loadCustomInstructions(scope: scope)
            try Task.checkCancellation()
            guard scope == self.store.aiChatStore.currentCustomInstructionsScope else {
                return
            }
            self.text = response.customInstructions ?? ""
            self.savedText = self.text
            self.loadPhase = .loaded(response, scope: scope)
            if response.canEdit {
                // The field appears on this update, so focus it on the next one.
                await Task.yield()
                if scope == self.store.aiChatStore.currentCustomInstructionsScope, Task.isCancelled == false {
                    self.isFieldFocused = self.canEdit
                }
            }
        } catch {
            guard Task.isCancelled == false,
                  scope == self.store.aiChatStore.currentCustomInstructionsScope else {
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

    private func save(text: String) {
        guard self.canEdit,
              self.isSaving == false,
              case .loaded(let settings, let loadedScope) = self.loadPhase,
              text.unicodeScalars.count <= settings.maxLength else {
            return
        }

        self.savingScope = loadedScope
        self.saveErrorMessage = nil
        self.isFieldFocused = false
        Task { @MainActor in
            defer {
                if self.savingScope == loadedScope {
                    self.savingScope = nil
                }
            }
            do {
                try await self.store.aiChatStore.saveCustomInstructions(text: text, loadedScope: loadedScope)
                if loadedScope == self.store.aiChatStore.currentCustomInstructionsScope {
                    self.dismiss()
                }
            } catch {
                guard loadedScope == self.store.aiChatStore.currentCustomInstructionsScope else {
                    return
                }
                captureAIChatHistoryFailure(
                    error: error,
                    flashcardsStore: self.store,
                    action: "chat_custom_instructions_save",
                    sessionId: nil
                )
                self.saveErrorMessage = errorMessage(error: error)
            }
        }
    }
}
