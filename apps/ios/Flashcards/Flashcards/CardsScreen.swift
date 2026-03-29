import SwiftUI

enum CardEditorPresentation: Hashable, Identifiable {
    case create
    case edit(cardId: String)

    var title: String {
        switch self {
        case .create:
            return "New card"
        case .edit:
            return "Edit card"
        }
    }

    var isEditing: Bool {
        switch self {
        case .create:
            return false
        case .edit:
            return true
        }
    }

    var editingCardId: String? {
        switch self {
        case .create:
            return nil
        case .edit(let cardId):
            return cardId
        }
    }

    var id: String {
        switch self {
        case .create:
            return "create"
        case .edit(let cardId):
            return "edit-\(cardId)"
        }
    }
}

struct CardsScreen: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @Environment(AppNavigationModel.self) private var navigation: AppNavigationModel
    @Environment(\.dismissSearch) private var dismissSearch
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    @State private var editorPresentation: CardEditorPresentation? = nil
    @State private var isFilterSheetPresented: Bool = false
    @State private var isSearchPresented: Bool = false
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
    @State private var cardsSnapshot: CardsListSnapshot = CardsListSnapshot(cards: [], totalCount: 0)
    @State private var availableTagSuggestions: [TagSuggestion] = []
    @State private var isLoading: Bool = true

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
                if self.isLoading {
                    Text("Loading cards…")
                        .foregroundStyle(.secondary)
                } else if self.cardsSnapshot.totalCount == 0 {
                    Text("You haven't created any cards yet.")
                        .foregroundStyle(.secondary)
                } else if self.cardsSnapshot.cards.isEmpty {
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
                    ForEach(self.cardsSnapshot.cards) { card in
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
        .accessibilityIdentifier(UITestIdentifier.cardsScreen)
        .navigationTitle("Cards")
        .searchable(
            text: self.$searchText,
            isPresented: self.$isSearchPresented,
            placement: .automatic,
            prompt: "Search cards"
        )
        .searchToolbarBehavior(preferredNativeSearchToolbarBehavior(horizontalSizeClass: self.horizontalSizeClass))
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
                .accessibilityIdentifier(UITestIdentifier.cardsAddButton)
            }
        }
        .sheet(item: self.$editorPresentation) { presentation in
            NavigationStack {
                CardEditorScreen(
                    title: presentation.title,
                    isEditing: presentation.isEditing,
                    errorMessage: self.screenErrorMessage,
                    availableTagSuggestions: self.availableTagSuggestions,
                    formState: self.$cardFormState,
                    onCancel: {
                        self.editorPresentation = nil
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
            self.handleCardsPresentationRequest(request: navigation.cardsPresentationRequest)
        }
        .onChange(of: navigation.cardsPresentationRequest) { _, request in
            self.handleCardsPresentationRequest(request: request)
        }
        .task(id: self.queryReloadKey) {
            await self.reloadCardsSnapshot()
        }
    }

    private var queryReloadKey: String {
        "\(self.searchText)|\(self.committedFilter?.tags.joined(separator: ",") ?? "")|\(self.committedFilter?.effort.map(\.rawValue).joined(separator: ",") ?? "")|\(store.localReadVersion)"
    }

    private func beginCreating() {
        self.dismissCardsSearch()
        self.cardFormState = CardFormState(
            frontText: "",
            backText: "",
            tags: [],
            effortLevel: .fast
        )
        self.screenErrorMessage = ""
        self.editorPresentation = .create
    }

    private func beginEditing(card: Card) {
        self.dismissCardsSearch()
        self.cardFormState = CardFormState(
            frontText: card.frontText,
            backText: card.backText,
            tags: card.tags,
            effortLevel: card.effortLevel
        )
        self.screenErrorMessage = ""
        self.editorPresentation = .edit(cardId: card.cardId)
    }

    private func beginFiltering() {
        self.dismissCardsSearch()
        self.draftFilter = self.committedFilter
        self.isFilterSheetPresented = true
    }

    private func dismissCardsSearch() {
        self.dismissSearch()
        self.isSearchPresented = false
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
                editingCardId: self.editorPresentation?.editingCardId
            )
            self.screenErrorMessage = ""
            self.editorPresentation = nil
        } catch {
            self.screenErrorMessage = Flashcards.errorMessage(error: error)
        }
    }

    private func deleteCard(cardId: String) {
        do {
            try store.deleteCard(cardId: cardId)
            self.screenErrorMessage = ""
        } catch {
            self.screenErrorMessage = Flashcards.errorMessage(error: error)
        }
    }

    private func deleteEditingCard() {
        guard let editingCardId = self.editorPresentation?.editingCardId else {
            self.screenErrorMessage = "Card not found."
            return
        }

        do {
            try store.deleteCard(cardId: editingCardId)
            self.screenErrorMessage = ""
            self.editorPresentation = nil
        } catch {
            self.screenErrorMessage = Flashcards.errorMessage(error: error)
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
            navigation.clearCardsPresentationRequest()
        }
    }

    @MainActor
    private func reloadCardsSnapshot() async {
        guard let database = store.database, let workspaceId = store.workspace?.workspaceId else {
            self.cardsSnapshot = CardsListSnapshot(cards: [], totalCount: 0)
            self.availableTagSuggestions = []
            self.isLoading = false
            return
        }

        self.isLoading = true
        if self.screenErrorMessage == "Loading cards…" {
            self.screenErrorMessage = ""
        }

        do {
            self.cardsSnapshot = try database.loadCardsListSnapshot(
                workspaceId: workspaceId,
                searchText: self.searchText,
                filter: self.committedFilter
            )
            let tagsSummary = try database.loadWorkspaceTagsSummary(workspaceId: workspaceId)
            self.availableTagSuggestions = tagsSummary.tags.map { tagSummary in
                TagSuggestion(
                    tag: tagSummary.tag,
                    countState: .ready(cardsCount: tagSummary.cardsCount)
                )
            }
        } catch {
            self.screenErrorMessage = Flashcards.errorMessage(error: error)
        }

        self.isLoading = false
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
                Label(formatOptionalIsoTimestampForDisplay(value: card.dueAt), systemImage: "clock")
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
            .environment(FlashcardsStore())
            .environment(AppNavigationModel())
    }
}
