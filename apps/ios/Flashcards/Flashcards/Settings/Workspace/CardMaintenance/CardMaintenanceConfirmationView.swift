import SwiftUI

struct CardMaintenanceButton: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore

    let scope: CardMaintenanceScope
    let isAvailable: Bool
    let onDismiss: () -> Void
    let onCompleted: () -> Void

    @State private var isPresented = false
    @State private var didComplete = false

    var body: some View {
        Button(self.scope.kind.actionTitle, role: .destructive) {
            self.isPresented = true
        }
        .disabled(self.isAvailable == false)
        .sheet(isPresented: self.$isPresented, onDismiss: {
            self.onDismiss()
            if self.didComplete {
                self.didComplete = false
                self.onCompleted()
            }
        }) {
            CardMaintenanceConfirmationView(scope: self.scope) {
                self.didComplete = true
            }
            .technicalErrorSheetHost(store: self.store)
        }
    }
}

private struct CardMaintenanceConfirmationView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @Environment(\.dismiss) private var dismiss

    let scope: CardMaintenanceScope
    let onCompleted: () -> Void

    @State private var preview: CardMaintenancePreview?
    @State private var refreshStatus: CardMaintenanceRefreshStatus?
    @State private var acknowledgedPreview: CardMaintenancePreview?
    @State private var deckRulesChanged = false
    @State private var confirmationText = ""
    @State private var message: String?
    @State private var didPreviewChange = false
    @State private var isWorking = true

    private var toolbarTitle: String {
        if self.refreshStatus != nil || self.deckRulesChanged {
            return aiSettingsLocalized("common.close", "Close")
        }
        return aiSettingsLocalized("common.cancel", "Cancel")
    }

    var body: some View {
        NavigationStack {
            Form {
                if self.isWorking {
                    Section {
                        ProgressView(aiSettingsLocalized("common.loading", "Loading..."))
                    }
                }

                if let refreshStatus {
                    Section {
                        if refreshStatus == .acknowledged {
                            Text(aiSettingsLocalized(
                                "settings.workspace.cardMaintenance.applied",
                                "Changes were saved on the server. Sync this device to see them here."
                            ))
                        } else {
                            Text(CardMaintenanceError.refreshRequiredMessage)
                        }
                        if let message {
                            Text(message).foregroundStyle(.secondary)
                        }
                        if self.isWorking == false {
                            Button(aiSettingsLocalized("common.retry", "Retry")) {
                                self.startWork { await self.refresh() }
                            }
                        }
                    }
                } else if let preview {
                    self.previewSections(preview: preview)
                } else if self.isWorking == false, let message {
                    Section {
                        Text(message)
                        if self.deckRulesChanged == false {
                            Button(aiSettingsLocalized("common.retry", "Retry")) {
                                self.startWork { await self.loadPreview() }
                            }
                        }
                    }
                }
            }
            .navigationTitle(self.scope.kind.actionTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(self.toolbarTitle) {
                        self.dismiss()
                    }
                    .disabled(self.isWorking)
                }
            }
        }
        .interactiveDismissDisabled(self.isWorking)
        .task {
            if self.isWorking && self.preview == nil && self.refreshStatus == nil {
                await self.loadPreview()
            }
        }
    }

    @ViewBuilder
    private func previewSections(preview: CardMaintenancePreview) -> some View {
        let response = preview.response
        Section {
            if self.didPreviewChange {
                Text(aiSettingsLocalized(
                    "settings.workspace.cardMaintenance.previewChanged",
                    "The scope changed. Review the updated preview and confirm again."
                ))
                .foregroundStyle(.orange)
            }

            LabeledContent(
                self.scope.kind == .removeTag
                    ? aiSettingsLocalized("settings.workspace.overview.cards", "Cards")
                    : aiSettingsLocalized("settings.workspace.resetConfirmation.cardsToReset", "Cards to reset"),
                value: response.affectedCardsCount.formatted()
            )

            if self.scope.kind == .removeTag {
                LabeledContent(
                    aiSettingsLocalized("settings.workspace.cardMaintenance.deckRulesWithTag", "Deck rules using this tag"),
                    value: response.affectedDecksCount.formatted()
                )
                Text(aiSettingsLocalized("settings.workspace.cardMaintenance.cardsRemain", "Your cards will remain."))
                    .foregroundStyle(.secondary)
            } else if response.affectedCardsCount > 0 {
                Text(aiSettingsLocalized(
                    "settings.workspace.resetConfirmation.previewDescription",
                    "Cards will remain in the workspace. Only their study progress will be cleared."
                ))
                .foregroundStyle(.secondary)

                if self.scope.kind == .resetDeck || self.scope.kind == .resetTag {
                    Text(aiSettingsLocalized(
                        "settings.workspace.cardMaintenance.overlap",
                        "These cards may also appear in other decks or tags."
                    ))
                    .foregroundStyle(.secondary)
                }
            }
            if self.scope.kind == .resetDeck && response.includesAllCards {
                Text(aiSettingsLocalized(
                    "settings.workspace.decks.emptyRulesIncludesAllCards",
                    "This deck has no rules, so it includes all cards."
                ))
                .foregroundStyle(.secondary)
            }
        } header: {
            Text(response.targetName)
                .textCase(nil)
        }

        if response.affectedCardsCount == 0 {
            Section {
                Text(aiSettingsLocalized("settings.workspace.cardMaintenance.noCards", "There are no cards to change."))
                    .foregroundStyle(.secondary)
            }
        } else {
            Section {
                Text(aiSettingsLocalized("common.typePhraseToContinue", "Type this phrase exactly to continue:"))
                ConfirmationPhraseText(text: response.confirmationText)
                TextField(response.confirmationText, text: self.$confirmationText)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled(true)
                    .keyboardType(.asciiCapable)
                    .disabled(self.isWorking)

                if let message {
                    Text(message).foregroundStyle(.red)
                }

                Button(self.scope.kind.actionTitle, role: .destructive) {
                    self.startWork { await self.execute(preview: preview) }
                }
                .disabled(self.isWorking || self.confirmationText.utf8.elementsEqual(response.confirmationText.utf8) == false)
            }
        }
    }

    private func startWork(_ operation: @escaping @MainActor () async -> Void) {
        guard self.isWorking == false else { return }
        self.isWorking = true
        self.message = nil
        Task { await operation() }
    }

    private func loadPreview() async {
        defer { self.isWorking = false }
        do {
            if try await self.showPendingRefreshIfNeeded() == false {
                self.preview = try await self.store.loadCardMaintenancePreview(scope: self.scope)
            }
        } catch {
            self.presentError(error: error)
        }
    }

    private func showPendingRefreshIfNeeded() async throws -> Bool {
        guard let pending = try self.store.pendingCardMaintenanceRefresh(workspaceId: self.scope.workspaceId) else {
            return false
        }
        self.refreshStatus = pending.status
        await self.refresh()
        return true
    }

    private func execute(preview: CardMaintenancePreview) async {
        do {
            try await self.store.executeCardMaintenance(preview: preview, confirmationText: self.confirmationText)
        } catch CardMaintenanceError.previewChanged {
            self.preview = nil
            self.confirmationText = ""
            self.didPreviewChange = true
            await self.loadPreview()
            return
        } catch CardMaintenanceError.executionUnconfirmed(let details) {
            self.refreshStatus = .unresolved
            self.message = details
            self.isWorking = false
            return
        } catch CardMaintenanceError.refreshRequired {
            self.preview = nil
            self.confirmationText = ""
            await self.loadPreview()
            return
        } catch {
            self.isWorking = false
            self.presentError(error: error)
            return
        }

        self.refreshStatus = .acknowledged
        self.acknowledgedPreview = preview
        await self.refresh()
    }

    private func refresh() async {
        defer { self.isWorking = false }
        do {
            try await self.store.refreshAfterCardMaintenance(
                scope: self.scope,
                acknowledgedPreview: self.acknowledgedPreview
            )
            if self.acknowledgedPreview != nil {
                self.onCompleted()
            }
            self.dismiss()
        } catch CardMaintenanceError.refreshRequired {
            self.message = nil
        } catch {
            self.presentError(error: error)
        }
    }

    private func presentError(error: Error) {
        if isRequestCancellationError(error: error) {
            return
        }
        if let error = error as? CardMaintenanceError {
            switch error {
            case .signInRequired:
                self.message = aiSettingsLocalized("settings.workspace.cardMaintenance.signIn", "Sign in and link this workspace to continue.")
            case .workspaceChanged:
                self.message = aiSettingsLocalized("settings.workspace.cardMaintenance.workspaceChanged", "The workspace changed. Close this screen and open the action again.")
            case .targetNotFound:
                self.message = aiSettingsLocalized("settings.workspace.cardMaintenance.targetMissing", "This item is no longer available in the workspace.")
            case .confirmationInvalid:
                self.confirmationText = ""
                self.message = aiSettingsLocalized("common.typePhraseToContinue", "Type this phrase exactly to continue:")
            case .previewChanged:
                self.message = aiSettingsLocalized("settings.workspace.cardMaintenance.previewChanged", "The scope changed. Review the updated preview and confirm again.")
            case .deckRulesChanged:
                self.preview = nil
                self.deckRulesChanged = true
                self.message = aiSettingsLocalized(
                    "settings.workspace.cardMaintenance.deckRulesChanged",
                    "Deck rules changed. Close this screen and review them."
                )
            case .refreshRequired:
                self.message = CardMaintenanceError.refreshRequiredMessage
            case .executionRejected(let details):
                self.message = details
            case .executionUnconfirmed(let details):
                self.message = details
            }
        } else if let guidance = self.store.workspaceOperationGuidanceMessage(error: error) {
            self.message = guidance
        } else {
            self.message = Flashcards.errorMessage(error: error)
            if self.refreshStatus == nil {
                self.store.presentTechnicalError(error)
            }
        }
    }
}

private extension CardMaintenanceKind {
    var actionTitle: String {
        switch self {
        case .resetCard, .resetDeck, .resetTag:
            return aiSettingsLocalized("settings.row.resetStudyProgress", "Reset Study Progress")
        case .removeTag:
            return aiSettingsLocalized("settings.workspace.cardMaintenance.removeTag", "Remove tag from cards")
        }
    }
}
