import SwiftUI

extension ReviewView {
    func normalizedEditedCardInput() -> CardEditorInput {
        CardEditorInput(
            frontText: cardFormState.frontText.trimmingCharacters(in: .whitespacesAndNewlines),
            backText: cardFormState.backText.trimmingCharacters(in: .whitespacesAndNewlines),
            tags: cardFormState.tags,
            effortLevel: cardFormState.effortLevel
        )
    }

    func editingCard() -> Card? {
        guard let editingCardId else {
            return nil
        }

        return store.effectiveReviewQueue.first { card in
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
            || normalizedInput.effortLevel != editingCard.effortLevel
            || normalizedInput.tags != editingCard.tags
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
                editingCardId: editingCardId
            )
            self.screenErrorMessage = ""
            return AIChatCardReference(
                cardId: editingCardId,
                frontText: normalizedInput.frontText,
                backText: normalizedInput.backText,
                tags: normalizedInput.tags,
                effortLevel: normalizedInput.effortLevel
            )
        } catch {
            self.screenErrorMessage = Flashcards.errorMessage(error: error)
            return nil
        }
    }

    func beginEditing(card: Card) {
        self.editingCardId = card.cardId
        self.cardFormState = CardFormState(
            frontText: card.frontText,
            backText: card.backText,
            tags: card.tags,
            effortLevel: card.effortLevel
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
                editingCardId: editingCardId
            )
            self.screenErrorMessage = ""
            self.isEditorPresented = false
        } catch {
            self.screenErrorMessage = Flashcards.errorMessage(error: error)
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
            self.isEditorPresented = false
            self.editingCardId = nil
        } catch {
            self.screenErrorMessage = Flashcards.errorMessage(error: error)
        }
    }
}
