import SwiftUI

struct CardsScreen: View {
    @EnvironmentObject private var store: FlashcardsStore

    @State private var isEditorPresented: Bool = false
    @State private var editingCardId: String? = nil
    @State private var cardFormState: CardFormState = CardFormState(
        frontText: "",
        backText: "",
        tags: [],
        effortLevel: .fast
    )
    @State private var screenErrorMessage: String = ""

    var body: some View {
        List {
            if screenErrorMessage.isEmpty == false {
                Section {
                    Text(screenErrorMessage)
                        .foregroundStyle(.red)
                }
            }

            Section {
                Text("Cards are the prompts and answers you review to learn and remember.")
                    .foregroundStyle(.secondary)
            }

            Section("Cards") {
                if store.cards.isEmpty {
                    Text("You haven't created any cards yet.")
                        .foregroundStyle(.secondary)
                } else {
                    // TODO: Replace this with IncrementalItemsView when the cards list is upgraded for large collections.
                    ForEach(store.cards) { card in
                        Button {
                            self.beginEditing(card: card)
                        } label: {
                            CardRow(card: card)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button(role: .destructive) {
                                self.deleteCard(cardId: card.cardId)
                            } label: {
                                Label("Delete", systemImage: "trash")
                            }
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Cards")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    self.beginCreating()
                } label: {
                    Label("Add card", systemImage: "plus")
                }
            }
        }
        .sheet(isPresented: $isEditorPresented) {
            NavigationStack {
                CardEditorView(
                    title: editingCardId == nil ? "New card" : "Edit card",
                    isEditing: editingCardId != nil,
                    formState: $cardFormState,
                    onCancel: {
                        isEditorPresented = false
                    },
                    onSave: {
                        self.saveCard()
                    },
                    onDelete: {
                        self.deleteEditingCard()
                    }
                )
            }
        }
        .onAppear {
            self.handleCardsPresentationRequest(request: store.cardsPresentationRequest)
        }
        .onChange(of: store.cardsPresentationRequest) { _, request in
            self.handleCardsPresentationRequest(request: request)
        }
    }

    private func beginCreating() {
        self.editingCardId = nil
        self.cardFormState = CardFormState(
            frontText: "",
            backText: "",
            tags: [],
            effortLevel: .fast
        )
        self.screenErrorMessage = ""
        self.isEditorPresented = true
    }

    private func beginEditing(card: Card) {
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

    private func saveCard() {
        do {
            try store.saveCard(
                input: CardEditorInput(
                    frontText: cardFormState.frontText.trimmingCharacters(in: .whitespacesAndNewlines),
                    backText: cardFormState.backText.trimmingCharacters(in: .whitespacesAndNewlines),
                    tags: cardFormState.tags,
                    effortLevel: cardFormState.effortLevel
                ),
                editingCardId: editingCardId
            )
            self.screenErrorMessage = ""
            self.isEditorPresented = false
        } catch {
            self.screenErrorMessage = localizedMessage(error: error)
        }
    }

    private func deleteCard(cardId: String) {
        do {
            try store.deleteCard(cardId: cardId)
            self.screenErrorMessage = ""
        } catch {
            self.screenErrorMessage = localizedMessage(error: error)
        }
    }

    private func deleteEditingCard() {
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
            self.screenErrorMessage = localizedMessage(error: error)
        }
    }

    private func handleCardsPresentationRequest(request: CardsPresentationRequest?) {
        guard let request else {
            return
        }

        switch request {
        case .createCard:
            self.beginCreating()
            store.clearCardsPresentationRequest()
        }
    }
}

struct CardRow: View {
    let card: Card

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(card.frontText)
                .font(.headline)
                .foregroundStyle(.primary)

            HStack(spacing: 12) {
                Label(card.effortLevel.title, systemImage: "timer")
                Label(card.tags.isEmpty ? "No tags" : formatTags(tags: card.tags), systemImage: "tag")
                Label(displayTimestamp(value: card.dueAt), systemImage: "clock")
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }
}

private struct CardEditorView: View {
    @EnvironmentObject private var store: FlashcardsStore
    @State private var isDeleteConfirmationPresented: Bool = false

    let title: String
    let isEditing: Bool
    @Binding var formState: CardFormState
    let onCancel: () -> Void
    let onSave: () -> Void
    let onDelete: () -> Void

    private var availableTagSuggestions: [String] {
        tagSuggestions(cards: store.cards)
    }

    var body: some View {
        Form {
            Section("Text") {
                TextField("Front", text: $formState.frontText, axis: .vertical)
                    .lineLimit(3...)
                TextField("Back", text: $formState.backText, axis: .vertical)
                    .lineLimit(3...)
            }

            Section("Metadata") {
                Picker("Effort", selection: $formState.effortLevel) {
                    ForEach(EffortLevel.allCases) { effortLevel in
                        Text(effortLevel.title).tag(effortLevel)
                    }
                }

                NavigationLink {
                    TagPickerView(
                        selectedTags: formState.tags,
                        suggestions: availableTagSuggestions,
                        onSave: { nextTags in
                            formState.tags = nextTags
                        }
                    )
                } label: {
                    TagsFieldRow(summary: formatTagSelectionSummary(tags: formState.tags))
                }
            }

            if isEditing {
                Section("Actions") {
                    Button("Delete card", role: .destructive) {
                        self.isDeleteConfirmationPresented = true
                    }
                }
            }
        }
        .navigationTitle(title)
        .alert("Delete this card?", isPresented: self.$isDeleteConfirmationPresented) {
            Button("Cancel", role: .cancel) {}
            Button("Delete", role: .destructive, action: onDelete)
        } message: {
            Text("Deleting removes this card from the local list and from the next sync.")
        }
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button("Cancel", action: onCancel)
            }

            ToolbarItem(placement: .topBarTrailing) {
                Button("Save", action: onSave)
            }
        }
    }
}

private struct CardFormState {
    var frontText: String
    var backText: String
    var tags: [String]
    var effortLevel: EffortLevel
}

#Preview {
    NavigationStack {
        CardsScreen()
            .environmentObject(FlashcardsStore())
    }
}
