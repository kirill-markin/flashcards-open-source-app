import SwiftUI

struct CardsScreen: View {
    @EnvironmentObject private var store: FlashcardsStore

    @State private var isEditorPresented: Bool = false
    @State private var isFilterSheetPresented: Bool = false
    @State private var editingCardId: String? = nil
    @State private var searchText: String = ""
    @State private var committedFilter: CardFilter? = nil
    @State private var draftFilter: CardFilter? = nil
    @State private var cardFormState: CardFormState = CardFormState(
        frontText: "",
        backText: "",
        tags: [],
        effortLevel: .fast
    )
    @State private var screenErrorMessage: String = ""

    private var availableTagSuggestions: [TagSuggestion] {
        tagSuggestions(cards: store.cards)
    }

    private var filteredCards: [Card] {
        cardsMatchingSearchTextAndFilter(
            cards: store.cards,
            searchText: searchText,
            filter: committedFilter
        )
    }

    private var activeFilterDimensionCount: Int {
        cardFilterActiveDimensionCount(filter: committedFilter)
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
                        systemImage: activeFilterDimensionCount == 0 ? "magnifyingglass" : "line.3.horizontal.decrease.circle",
                        description: Text(
                            searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && activeFilterDimensionCount > 0
                                ? "Try clearing filters."
                                : "Try a different search or clear filters."
                        )
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
                    self.beginFiltering()
                } label: {
                    Image(systemName: activeFilterDimensionCount == 0
                          ? "line.3.horizontal.decrease.circle"
                          : "line.3.horizontal.decrease.circle.fill")
                }
                .accessibilityLabel(activeFilterDimensionCount == 0 ? "Filter cards" : "Filter cards (\(activeFilterDimensionCount) active)")
            }

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
        .sheet(isPresented: $isFilterSheetPresented) {
            NavigationStack {
                CardFiltersSheetView(
                    suggestions: availableTagSuggestions,
                    draftFilter: self.$draftFilter,
                    onCancel: {
                        self.isFilterSheetPresented = false
                    },
                    onApply: {
                        self.applyFilters()
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

    private func beginFiltering() {
        self.draftFilter = self.committedFilter
        self.isFilterSheetPresented = true
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

    private func applyFilters() {
        self.committedFilter = buildCardFilter(
            tags: self.draftFilter?.tags ?? [],
            effort: self.draftFilter?.effort ?? [],
            referenceTags: self.availableTagSuggestions.map(\.tag)
        )
        self.draftFilter = self.committedFilter
        self.isFilterSheetPresented = false
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

private struct CardFiltersSheetView: View {
    let suggestions: [TagSuggestion]
    @Binding var draftFilter: CardFilter?
    let onCancel: () -> Void
    let onApply: () -> Void

    private var draftTags: [String] {
        draftFilter?.tags ?? []
    }

    private var draftEffort: [EffortLevel] {
        draftFilter?.effort ?? []
    }

    private func updateDraftFilter(tags: [String], effort: [EffortLevel]) {
        self.draftFilter = buildCardFilter(tags: tags, effort: effort, referenceTags: suggestions.map(\.tag))
    }

    var body: some View {
        Form {
            Section("Effort") {
                ForEach(EffortLevel.allCases) { effortLevel in
                    Toggle(
                        effortLevel.title,
                        isOn: Binding(
                            get: {
                                draftEffort.contains(effortLevel)
                            },
                            set: { isSelected in
                                updateDraftFilter(
                                    tags: draftTags,
                                    effort: toggleCardFilterEffort(
                                        effort: draftEffort,
                                        effortLevel: effortLevel,
                                        isSelected: isSelected
                                    )
                                )
                            }
                        )
                    )
                }
            }

            Section("Tags") {
                NavigationLink {
                    TagPickerView(
                        selectedTags: draftTags,
                        suggestions: suggestions,
                        onSave: { nextTags in
                            updateDraftFilter(tags: nextTags, effort: draftEffort)
                        }
                    )
                } label: {
                    TagsFieldRow(summary: formatTagSelectionSummary(tags: draftTags))
                }
            }

            Section("Summary") {
                Text(formatCardFilterSummary(filter: draftFilter))
                    .foregroundStyle(.secondary)
            }

            Section("Actions") {
                Button("Clear filters") {
                    updateDraftFilter(tags: [], effort: [])
                }
                .disabled(cardFilterActiveDimensionCount(filter: draftFilter) == 0)
            }
        }
        .navigationTitle("Filters")
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button("Cancel", action: onCancel)
            }

            ToolbarItem(placement: .topBarTrailing) {
                Button("Apply", action: onApply)
            }
        }
    }
}

private func toggleCardFilterEffort(
    effort: [EffortLevel],
    effortLevel: EffortLevel,
    isSelected: Bool
) -> [EffortLevel] {
    if isSelected {
        if effort.contains(effortLevel) {
            return effort
        }

        return effort + [effortLevel]
    }

    return effort.filter { value in
        value != effortLevel
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
