import SwiftUI

extension ReviewView {
    func normalizedEditedCardInput() -> CardEditorInput {
        CardEditorInput(
            frontText: cardFormState.frontText.trimmingCharacters(in: .whitespacesAndNewlines),
            backText: cardFormState.backText.trimmingCharacters(in: .whitespacesAndNewlines),
            tags: cardFormState.tags
        )
    }

    func editingCard() -> Card? {
        guard let editingCardId else {
            return nil
        }

        return store.cards.first { card in
            card.cardId == editingCardId
        }
    }

    func isEditedCardDirty() -> Bool {
        guard self.editingCardId != nil else {
            return false
        }
        guard let editingCard = self.editingCard() else {
            return true
        }

        let normalizedInput = self.normalizedEditedCardInput()
        return normalizedInput.frontText != editingCard.frontText
            || normalizedInput.backText != editingCard.backText
            || normalizedInput.tags != editingCard.tags
    }

    func reconcileEditingCardFormState() {
        guard self.isEditorPresented,
              let refreshedCard = self.editingCard() else {
            return
        }

        self.cardFormState = cardFormStateByReconcilingMediaLifecycle(
            formState: self.cardFormState,
            refreshedCard: refreshedCard
        )
    }

    func saveEditedCardForAIHandoff() -> AIChatCardReference? {
        guard let editingCardId else {
            self.screenErrorMessage = "Card not found."
            return nil
        }

        let normalizedInput = self.normalizedEditedCardInput()

        do {
            try store.saveCard(
                input: normalizedInput,
                editingCardId: editingCardId,
                mediaAssetIdsReadyForUpload: self.cardFormState.mediaAssetIdsReadyForUpload
            )
            self.screenErrorMessage = ""
            self.finishCardEditorSession()
            return AIChatCardReference(
                cardId: editingCardId,
                frontText: normalizedInput.frontText,
                backText: normalizedInput.backText,
                tags: normalizedInput.tags
            )
        } catch {
            if let inlineErrorMessage = cardEditorInlineErrorMessage(error: error) {
                self.screenErrorMessage = inlineErrorMessage
            } else {
                self.screenErrorMessage = ""
                store.presentTechnicalError(error)
            }
            return nil
        }
    }

    func beginEditing(card: Card) {
        self.editingCardId = card.cardId
        self.cardFormState = CardFormState(
            editorSessionId: UUID(),
            readOnlyMetadata: cardEditorReadOnlyMetadata(card: card),
            frontText: card.frontText,
            backText: card.backText,
            frontTextSelection: nil,
            backTextSelection: nil,
            observedFrontText: card.frontText,
            observedBackText: card.backText,
            tags: card.tags,
            mediaAssetIdsReadyForUpload: []
        )
        self.screenErrorMessage = ""
        self.isEditorPresented = true
    }

    func saveEditedCard() {
        guard let editingCardId else {
            self.screenErrorMessage = "Card not found."
            return
        }

        do {
            try store.saveCard(
                input: self.normalizedEditedCardInput(),
                editingCardId: editingCardId,
                mediaAssetIdsReadyForUpload: self.cardFormState.mediaAssetIdsReadyForUpload
            )
            self.screenErrorMessage = ""
            self.finishCardEditorSession()
            self.isEditorPresented = false
        } catch {
            if let inlineErrorMessage = cardEditorInlineErrorMessage(error: error) {
                self.screenErrorMessage = inlineErrorMessage
            } else {
                self.screenErrorMessage = ""
                store.presentTechnicalError(error)
            }
        }
    }

    func deleteEditingCard() {
        guard let editingCardId else {
            self.screenErrorMessage = "Card not found."
            return
        }

        do {
            try store.deleteCard(cardId: editingCardId)
            self.screenErrorMessage = ""
            self.finishCardEditorSession()
            self.isEditorPresented = false
            self.editingCardId = nil
        } catch {
            if let inlineErrorMessage = cardEditorInlineErrorMessage(error: error) {
                self.screenErrorMessage = inlineErrorMessage
            } else {
                self.screenErrorMessage = ""
                store.presentTechnicalError(error)
            }
        }
    }

    func finishCardEditorSession() {
        self.cardFormState.editorSessionId = UUID()
        self.cardFormState.mediaAssetIdsReadyForUpload = []
    }
}
