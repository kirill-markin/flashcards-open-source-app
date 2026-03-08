import SwiftUI

struct DecksScreen: View {
    @EnvironmentObject private var store: FlashcardsStore

    @State private var isEditorPresented: Bool = false
    @State private var deckFormState: DeckFormState = DeckFormState(
        name: "",
        combineWith: .and,
        selectedEffortLevels: [],
        tagsOperator: .containsAny,
        tags: []
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
                Text("Decks reuse the backend deck contract: name plus filter definition.")
                    .foregroundStyle(.secondary)
            }

            Section("Decks") {
                if store.deckItems.isEmpty {
                    Text("No decks yet.")
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
        .navigationTitle("Decks")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    self.beginCreating()
                } label: {
                    Label("New deck", systemImage: "plus")
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
            tags: []
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
                        tags: deckFormState.tags
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
            Section("Deck rules") {
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
                    Text("No cards match this deck.")
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

private struct DeckEditorView: View {
    @EnvironmentObject private var store: FlashcardsStore

    @Binding var formState: DeckFormState
    let onCancel: () -> Void
    let onSave: () -> Void

    private var availableTagSuggestions: [String] {
        tagSuggestions(cards: store.cards)
    }

    var body: some View {
        Form {
            Section("Name") {
                TextField("Deck name", text: $formState.name)
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
                            tags: formState.tags
                        )
                    )
                )
                .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("New deck")
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

private struct DeckFormState {
    var name: String
    var combineWith: DeckCombineOperator
    var selectedEffortLevels: [EffortLevel]
    var tagsOperator: DeckTagsOperator
    var tags: [String]
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
