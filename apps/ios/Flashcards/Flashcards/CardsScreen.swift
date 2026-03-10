import SwiftUI

struct CardsScreen: View {
    @EnvironmentObject private var store: FlashcardsStore

    @State private var isEditorPresented: Bool = false
    @State private var editingCardId: String? = nil
    @State private var searchText: String = ""
    @State private var cardFormState: CardFormState = CardFormState(
        frontText: "",
        backText: "",
        tags: [],
        effortLevel: .fast
    )
    @State private var screenErrorMessage: String = ""

    private var filteredCards: [Card] {
        cardsMatchingSearchText(cards: store.cards, searchText: searchText)
    }

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
                } else if filteredCards.isEmpty {
                    ContentUnavailableView(
                        "No Matching Cards",
                        systemImage: "magnifyingglass",
                        description: Text("Try a different search.")
                    )
                } else {
                    ForEach(filteredCards) { card in
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
        .searchable(text: $searchText, prompt: "Search cards")
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
                CardEditorScreen(
                    title: editingCardId == nil ? "New card" : "Edit card",
                    isEditing: editingCardId != nil,
                    errorMessage: screenErrorMessage,
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

#Preview {
    NavigationStack {
        CardsScreen()
            .environmentObject(FlashcardsStore())
    }
}
