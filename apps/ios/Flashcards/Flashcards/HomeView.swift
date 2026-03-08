import SwiftUI

struct CardsScreen: View {
    @EnvironmentObject private var store: FlashcardsStore

    @State private var isEditorPresented: Bool = false
    @State private var editingCardId: String? = nil
    @State private var cardFormState: CardFormState = CardFormState(
        frontText: "",
        backText: "",
        tagsText: "",
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
                Text("Cards are stored locally in SQLite with backend-shaped fields.")
                    .foregroundStyle(.secondary)
            }

            Section("Cards") {
                if store.cards.isEmpty {
                    Text("No cards yet.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(store.cards) { card in
                        Button {
                            self.beginEditing(card: card)
                        } label: {
                            CardRow(card: card)
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
                    formState: $cardFormState,
                    onCancel: {
                        isEditorPresented = false
                    },
                    onSave: {
                        self.saveCard()
                    }
                )
            }
        }
    }

    private func beginCreating() {
        self.editingCardId = nil
        self.cardFormState = CardFormState(
            frontText: "",
            backText: "",
            tagsText: "",
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
            tagsText: formatTags(tags: card.tags),
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
                    tags: normalizeTags(rawValue: cardFormState.tagsText),
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
}

struct DecksScreen: View {
    @EnvironmentObject private var store: FlashcardsStore

    @State private var isEditorPresented: Bool = false
    @State private var deckFormState: DeckFormState = DeckFormState(
        name: "",
        combineWith: .and,
        selectedEffortLevels: [],
        tagsOperator: .containsAny,
        tagsText: ""
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
                Text("Desks reuse the backend deck contract: name plus filter definition.")
                    .foregroundStyle(.secondary)
            }

            Section("Desks") {
                if store.deckItems.isEmpty {
                    Text("No desks yet.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(store.deckItems) { deckItem in
                        NavigationLink {
                            DeckDetailScreen(deckItem: deckItem)
                        } label: {
                            DeckListRow(deckItem: deckItem)
                        }
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button(role: .destructive) {
                                self.deleteDeck(deckId: deckItem.deck.deckId)
                            } label: {
                                Label("Delete", systemImage: "trash")
                            }
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Desks")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    self.beginCreating()
                } label: {
                    Label("New desk", systemImage: "plus")
                }
            }
        }
        .sheet(isPresented: $isEditorPresented) {
            NavigationStack {
                DeckEditorView(
                    formState: $deckFormState,
                    onCancel: {
                        isEditorPresented = false
                    },
                    onSave: {
                        self.saveDeck()
                    }
                )
            }
        }
    }

    private func beginCreating() {
        self.deckFormState = DeckFormState(
            name: "",
            combineWith: .and,
            selectedEffortLevels: [],
            tagsOperator: .containsAny,
            tagsText: ""
        )
        self.screenErrorMessage = ""
        self.isEditorPresented = true
    }

    private func saveDeck() {
        do {
            try store.createDeck(
                input: DeckEditorInput(
                    name: deckFormState.name.trimmingCharacters(in: .whitespacesAndNewlines),
                    filterDefinition: buildDeckFilterDefinition(
                        effortLevels: deckFormState.selectedEffortLevels,
                        combineWith: deckFormState.combineWith,
                        tagsOperator: deckFormState.tagsOperator,
                        tags: normalizeTags(rawValue: deckFormState.tagsText)
                    )
                )
            )
            self.screenErrorMessage = ""
            self.isEditorPresented = false
        } catch {
            self.screenErrorMessage = localizedMessage(error: error)
        }
    }

    private func deleteDeck(deckId: String) {
        do {
            try store.deleteDeck(deckId: deckId)
            self.screenErrorMessage = ""
        } catch {
            self.screenErrorMessage = localizedMessage(error: error)
        }
    }
}

private struct SummaryRow: View {
    let title: String
    let value: String
    let symbolName: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: symbolName)
                .font(.title3)
                .foregroundStyle(.tint)
                .frame(width: 28)

            Text(title)

            Spacer()

            Text(value)
                .font(.headline.monospacedDigit())
        }
        .padding(.vertical, 4)
    }
}

private struct CardRow: View {
    let card: Card

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(card.frontText)
                .font(.headline)
                .foregroundStyle(.primary)

            Text(card.backText)
                .lineLimit(2)
                .foregroundStyle(.secondary)

            HStack(spacing: 12) {
                Label(card.effortLevel.title, systemImage: "timer")
                Label(card.tags.isEmpty ? "No tags" : formatTags(tags: card.tags), systemImage: "tag")
                Label(displayTimestamp(value: card.dueAt), systemImage: "clock")
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }
}

private struct DeckListRow: View {
    let deckItem: DeckListItem

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(deckItem.deck.name)
                    .font(.headline)

                Spacer()

                Text("\(deckItem.dueCards) due")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            Text(formatDeckFilterDefinition(filterDefinition: deckItem.deck.filterDefinition))
                .font(.subheadline)
                .foregroundStyle(.secondary)

            HStack(spacing: 12) {
                Label("\(deckItem.totalCards) cards", systemImage: "square.stack.3d.up")
                Label("\(deckItem.newCards) new", systemImage: "plus.circle")
                Label("\(deckItem.reviewedCards) reviewed", systemImage: "checkmark.circle")
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }
}

private struct DeckDetailScreen: View {
    @EnvironmentObject private var store: FlashcardsStore

    let deckItem: DeckListItem

    private var matchingCards: [Card] {
        store.cardsMatchingDeck(deck: deckItem.deck)
    }

    var body: some View {
        List {
            Section("Filter") {
                SummaryRow(
                    title: "Cards",
                    value: "\(deckItem.totalCards)",
                    symbolName: "square.stack.3d.up"
                )
                SummaryRow(
                    title: "Due",
                    value: "\(deckItem.dueCards)",
                    symbolName: "clock.badge.checkmark"
                )
                SummaryRow(
                    title: "New",
                    value: "\(deckItem.newCards)",
                    symbolName: "plus.circle"
                )
                Text(formatDeckFilterDefinition(filterDefinition: deckItem.deck.filterDefinition))
                    .foregroundStyle(.secondary)
            }

            Section("Matching cards") {
                if matchingCards.isEmpty {
                    Text("No cards match this filter.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(matchingCards) { card in
                        CardRow(card: card)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(deckItem.deck.name)
    }
}

private struct CardEditorView: View {
    let title: String
    @Binding var formState: CardFormState
    let onCancel: () -> Void
    let onSave: () -> Void

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

                TextField("Tags (comma separated)", text: $formState.tagsText)
                    .textInputAutocapitalization(.never)
            }
        }
        .navigationTitle(title)
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

private struct DeckEditorView: View {
    @Binding var formState: DeckFormState
    let onCancel: () -> Void
    let onSave: () -> Void

    var body: some View {
        Form {
            Section("Name") {
                TextField("Filter name", text: $formState.name)
            }

            Section("Effort") {
                ForEach(EffortLevel.allCases) { effortLevel in
                    Toggle(
                        effortLevel.title,
                        isOn: Binding(
                            get: {
                                formState.selectedEffortLevels.contains(effortLevel)
                            },
                            set: { isSelected in
                                formState.selectedEffortLevels = toggleEffortLevel(
                                    effortLevels: formState.selectedEffortLevels,
                                    effortLevel: effortLevel,
                                    isSelected: isSelected
                                )
                            }
                        )
                    )
                }
            }

            Section("Tags") {
                Picker("Operator", selection: $formState.tagsOperator) {
                    ForEach(DeckTagsOperator.allCases) { tagsOperator in
                        Text(tagsOperator.title).tag(tagsOperator)
                    }
                }

                TextField("Tags (comma separated)", text: $formState.tagsText)
                    .textInputAutocapitalization(.never)
            }

            Section("Combine predicates") {
                Picker("Combine with", selection: $formState.combineWith) {
                    ForEach(DeckCombineOperator.allCases) { combineOperator in
                        Text(combineOperator.title).tag(combineOperator)
                    }
                }

                Text(
                    formatDeckFilterDefinition(
                        filterDefinition: buildDeckFilterDefinition(
                            effortLevels: formState.selectedEffortLevels,
                            combineWith: formState.combineWith,
                            tagsOperator: formState.tagsOperator,
                            tags: normalizeTags(rawValue: formState.tagsText)
                        )
                    )
                )
                .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("New filter")
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
    var tagsText: String
    var effortLevel: EffortLevel
}

private struct DeckFormState {
    var name: String
    var combineWith: DeckCombineOperator
    var selectedEffortLevels: [EffortLevel]
    var tagsOperator: DeckTagsOperator
    var tagsText: String
}

private func toggleEffortLevel(
    effortLevels: [EffortLevel],
    effortLevel: EffortLevel,
    isSelected: Bool
) -> [EffortLevel] {
    if isSelected {
        if effortLevels.contains(effortLevel) {
            return effortLevels
        }

        return effortLevels + [effortLevel]
    }

    return effortLevels.filter { value in
        value != effortLevel
    }
}

#Preview {
    NavigationStack {
        CardsScreen()
            .environmentObject(FlashcardsStore())
    }
}
