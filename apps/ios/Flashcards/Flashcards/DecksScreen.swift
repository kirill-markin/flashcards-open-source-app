import SwiftUI

struct DecksScreen: View {
    @EnvironmentObject private var store: FlashcardsStore

    @State private var isEditorPresented: Bool = false
    @State private var deckFormState: DeckFormState = emptyDeckFormState()
    @State private var screenErrorMessage: String = ""

    private var deckListEntries: [DeckScreenListItem] {
        makeDeckScreenListItems(deckItems: store.deckItems, cards: store.cards)
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
                Text("Decks group related cards so you can study a topic together.")
                    .foregroundStyle(.secondary)
            }

            Section("Decks") {
                ForEach(deckListEntries) { deckListEntry in
                    if let persistedDeckId = deckListEntry.persistedDeckId {
                        NavigationLink {
                            DeckDetailScreen(destination: deckListEntry.destination)
                        } label: {
                            DeckListRow(deckListEntry: deckListEntry)
                        }
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button(role: .destructive) {
                                self.deleteDeck(deckId: persistedDeckId)
                            } label: {
                                Label("Delete", systemImage: "trash")
                            }
                        }
                    } else {
                        NavigationLink {
                            DeckDetailScreen(destination: deckListEntry.destination)
                        } label: {
                            DeckListRow(deckListEntry: deckListEntry)
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
                    title: "New deck",
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
        self.deckFormState = emptyDeckFormState()
        self.screenErrorMessage = ""
        self.isEditorPresented = true
    }

    private func saveDeck() {
        do {
            try store.createDeck(input: makeDeckEditorInput(formState: deckFormState))
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
    let deckListEntry: DeckScreenListItem

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(deckListEntry.title)
                    .font(.headline)

                Spacer()

                Text("\(deckListEntry.stats.dueCards) due")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            Text(deckListEntry.filterSummary)
                .font(.subheadline)
                .foregroundStyle(.secondary)

            HStack(spacing: 12) {
                Label("\(deckListEntry.stats.totalCards) cards", systemImage: "square.stack.3d.up")
                Label("\(deckListEntry.stats.newCards) new", systemImage: "plus.circle")
                Label("\(deckListEntry.stats.reviewedCards) reviewed", systemImage: "checkmark.circle")
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }
}

private enum DeckScreenDestination: Hashable {
    case allCards
    case deck(deckId: String)
}

private struct DeckScreenListItem: Identifiable, Hashable {
    let id: String
    let title: String
    let filterSummary: String
    let stats: DeckCardStats
    let destination: DeckScreenDestination
    let persistedDeckId: String?
}

private enum DeckDetailScreenState {
    case allCards(stats: DeckCardStats, cards: [Card])
    case deck(deckItem: DeckListItem, cards: [Card])

    var title: String {
        switch self {
        case .allCards:
            return allCardsDeckLabel
        case .deck(let deckItem, _):
            return deckItem.deck.name
        }
    }

    var filterSummary: String {
        switch self {
        case .allCards:
            return allCardsDeckLabel
        case .deck(let deckItem, _):
            return formatDeckFilterDefinition(filterDefinition: deckItem.deck.filterDefinition)
        }
    }

    var stats: DeckCardStats {
        switch self {
        case .allCards(let stats, _):
            return stats
        case .deck(let deckItem, _):
            return DeckCardStats(
                totalCards: deckItem.totalCards,
                dueCards: deckItem.dueCards,
                newCards: deckItem.newCards,
                reviewedCards: deckItem.reviewedCards
            )
        }
    }

    var cards: [Card] {
        switch self {
        case .allCards(_, let cards):
            return cards
        case .deck(_, let cards):
            return cards
        }
    }

    var emptyMessage: String {
        switch self {
        case .allCards:
            return "You haven't created any cards yet."
        case .deck:
            return "This deck doesn't have any matching cards yet."
        }
    }

    var allowsEditing: Bool {
        switch self {
        case .allCards:
            return false
        case .deck:
            return true
        }
    }
}

private struct DeckDetailScreen: View {
    @EnvironmentObject private var store: FlashcardsStore
    @Environment(\.dismiss) private var dismiss

    let destination: DeckScreenDestination

    @State private var isEditorPresented: Bool = false
    @State private var deckFormState: DeckFormState = emptyDeckFormState()
    @State private var screenErrorMessage: String = ""

    private var detailState: DeckDetailScreenState? {
        switch destination {
        case .allCards:
            let cards = activeCards(cards: store.cards)
            let stats = makeDeckCardStats(cards: cards, now: Date())
            return .allCards(stats: stats, cards: cards)
        case .deck(let deckId):
            guard let deckItem = store.deckItems.first(where: { deckListItem in
                deckListItem.deck.deckId == deckId
            }) else {
                return nil
            }

            return .deck(deckItem: deckItem, cards: store.cardsMatchingDeck(deck: deckItem.deck))
        }
    }

    private var currentDeckId: String? {
        switch destination {
        case .allCards:
            return nil
        case .deck(let deckId):
            return deckId
        }
    }

    private var reviewFilter: ReviewFilter {
        switch destination {
        case .allCards:
            return .allCards
        case .deck(let deckId):
            return .deck(deckId: deckId)
        }
    }

    var body: some View {
        List {
            if screenErrorMessage.isEmpty == false {
                Section {
                    Text(screenErrorMessage)
                        .foregroundStyle(.red)
                }
            }

            if let detailState {
                Section("Deck rules") {
                    SummaryRow(
                        title: "Cards",
                        value: "\(detailState.stats.totalCards)",
                        symbolName: "square.stack.3d.up"
                    )
                    SummaryRow(
                        title: "Due",
                        value: "\(detailState.stats.dueCards)",
                        symbolName: "clock.badge.checkmark"
                    )
                    SummaryRow(
                        title: "New",
                        value: "\(detailState.stats.newCards)",
                        symbolName: "plus.circle"
                    )
                    Text(detailState.filterSummary)
                        .foregroundStyle(.secondary)
                }

                Section {
                    Button {
                        self.openReview()
                    } label: {
                        Label("Open review", systemImage: "rectangle.on.rectangle")
                    }
                }

                Section("Matching cards") {
                    if detailState.cards.isEmpty {
                        Text(detailState.emptyMessage)
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(detailState.cards) { card in
                            CardRow(card: card)
                        }
                    }
                }

                if detailState.allowsEditing {
                    Section {
                        Button("Delete deck", role: .destructive) {
                            self.deleteDeck()
                        }
                    }
                }
            } else {
                Section {
                    Text("Deck not found.")
                        .foregroundStyle(.secondary)
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(detailState?.title ?? "Deck")
        .toolbar {
            if detailState?.allowsEditing == true {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Edit") {
                        self.beginEditing()
                    }
                }
            }
        }
        .sheet(isPresented: $isEditorPresented) {
            NavigationStack {
                DeckEditorView(
                    title: "Edit deck",
                    formState: $deckFormState,
                    onCancel: {
                        isEditorPresented = false
                    },
                    onSave: {
                        self.saveDeckChanges()
                    }
                )
            }
        }
    }

    private func beginEditing() {
        guard let detailState else {
            self.screenErrorMessage = "Deck not found."
            return
        }

        switch detailState {
        case .allCards:
            self.screenErrorMessage = "System deck cannot be edited."
        case .deck(let deckItem, _):
            do {
                self.deckFormState = try makeDeckFormState(deck: deckItem.deck)
                self.screenErrorMessage = ""
                self.isEditorPresented = true
            } catch {
                self.screenErrorMessage = localizedMessage(error: error)
            }
        }
    }

    private func saveDeckChanges() {
        guard let deckId = currentDeckId else {
            self.screenErrorMessage = "Deck not found."
            return
        }

        do {
            try store.updateDeck(deckId: deckId, input: makeDeckEditorInput(formState: deckFormState))
            self.screenErrorMessage = ""
            self.isEditorPresented = false
        } catch {
            self.screenErrorMessage = localizedMessage(error: error)
        }
    }

    private func deleteDeck() {
        guard let deckId = currentDeckId else {
            self.screenErrorMessage = "Deck not found."
            return
        }

        do {
            try store.deleteDeck(deckId: deckId)
            self.screenErrorMessage = ""
            dismiss()
        } catch {
            self.screenErrorMessage = localizedMessage(error: error)
        }
    }

    private func openReview() {
        store.openReview(reviewFilter: reviewFilter)
    }
}

private struct DeckEditorView: View {
    @EnvironmentObject private var store: FlashcardsStore

    let title: String
    @Binding var formState: DeckFormState
    let onCancel: () -> Void
    let onSave: () -> Void

    private var availableTagSuggestions: [TagSuggestion] {
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

                Text(
                    formatDeckFilterDefinition(
                        filterDefinition: buildDeckFilterDefinition(
                            effortLevels: formState.selectedEffortLevels,
                            tags: formState.tags
                        )
                    )
                )
                .foregroundStyle(.secondary)
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

private struct DeckFormState {
    var name: String
    var selectedEffortLevels: [EffortLevel]
    var tags: [String]
}

private func emptyDeckFormState() -> DeckFormState {
    DeckFormState(
        name: "",
        selectedEffortLevels: [],
        tags: []
    )
}

private func makeDeckEditorInput(formState: DeckFormState) -> DeckEditorInput {
    DeckEditorInput(
        name: formState.name.trimmingCharacters(in: .whitespacesAndNewlines),
        filterDefinition: buildDeckFilterDefinition(
            effortLevels: formState.selectedEffortLevels,
            tags: formState.tags
        )
    )
}

private func makeDeckFormState(deck: Deck) throws -> DeckFormState {
    return DeckFormState(
        name: deck.name,
        selectedEffortLevels: deck.filterDefinition.effortLevels,
        tags: deck.filterDefinition.tags
    )
}

private func makeDeckScreenListItems(deckItems: [DeckListItem], cards: [Card]) -> [DeckScreenListItem] {
    [makeAllCardsDeckScreenListItem(cards: cards)] + deckItems.map { deckItem in
        DeckScreenListItem(
            id: deckItem.id,
            title: deckItem.deck.name,
            filterSummary: formatDeckFilterDefinition(filterDefinition: deckItem.deck.filterDefinition),
            stats: DeckCardStats(
                totalCards: deckItem.totalCards,
                dueCards: deckItem.dueCards,
                newCards: deckItem.newCards,
                reviewedCards: deckItem.reviewedCards
            ),
            destination: .deck(deckId: deckItem.deck.deckId),
            persistedDeckId: deckItem.deck.deckId
        )
    }
}

private func makeAllCardsDeckScreenListItem(cards: [Card]) -> DeckScreenListItem {
    let allCards = activeCards(cards: cards)

    return DeckScreenListItem(
        id: "system-all-cards",
        title: allCardsDeckLabel,
        filterSummary: allCardsDeckLabel,
        stats: makeDeckCardStats(cards: allCards, now: Date()),
        destination: .allCards,
        persistedDeckId: nil
    )
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
