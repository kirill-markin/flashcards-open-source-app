import SwiftUI

private let reviewCardsStringsTableName: String = "ReviewCards"

enum CardEditorPresentation: Hashable, Identifiable {
    case create
    case edit(cardId: String)

    var title: String {
        switch self {
        case .create:
            return String(localized: "New card", table: reviewCardsStringsTableName)
        case .edit:
            return String(localized: "Edit card", table: reviewCardsStringsTableName)
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
                Text(String(localized: "Cards are the prompts and answers you review to learn and remember.", table: reviewCardsStringsTableName))
                    .foregroundStyle(.secondary)
            }

            Section {
                if self.isLoading {
                    Text(String(localized: "Loading cards…", table: reviewCardsStringsTableName))
                        .foregroundStyle(.secondary)
                } else if self.cardsSnapshot.totalCount == 0 {
                    Text(String(localized: "You haven't created any cards yet.", table: reviewCardsStringsTableName))
                        .foregroundStyle(.secondary)
                } else if self.cardsSnapshot.cards.isEmpty {
                    ContentUnavailableView(
                        String(localized: "No Matching Cards", table: reviewCardsStringsTableName),
                        systemImage: activeFilterDimensionCount == 0 ? "magnifyingglass" : "line.3.horizontal.decrease.circle",
                        description: Text(
                            searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && activeFilterDimensionCount > 0
                                ? String(localized: "Try clearing filters.", table: reviewCardsStringsTableName)
                                : String(localized: "Try a different search or clear filters.", table: reviewCardsStringsTableName)
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
                        .accessibilityIdentifier(UITestIdentifier.cardsCardRow)
                        .buttonStyle(.plain)
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button(role: .destructive) {
                                self.deleteCard(cardId: card.cardId)
                            } label: {
                                Label(String(localized: "Delete", table: reviewCardsStringsTableName), systemImage: "trash")
                            }
                        }
                    }
                }
            } header: {
                Text(String(localized: "Cards", table: reviewCardsStringsTableName))
            }
        }
        .listStyle(.insetGrouped)
        .accessibilityIdentifier(UITestIdentifier.cardsScreen)
        .navigationTitle(String(localized: "Cards", table: reviewCardsStringsTableName))
        .searchable(
            text: self.$searchText,
            isPresented: self.$isSearchPresented,
            placement: .automatic,
            prompt: String(localized: "Search cards", table: reviewCardsStringsTableName)
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
                .accessibilityLabel(
                    activeFilterDimensionCount == 0
                        ? String(localized: "Filter cards", table: reviewCardsStringsTableName)
                        : String(
                            format: String(localized: "Filter cards (%@ active)", table: reviewCardsStringsTableName),
                            locale: Locale.current,
                            activeFilterDimensionCount.formatted()
                        )
                )
            }

            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    self.beginCreating()
                } label: {
                    Label(String(localized: "Add card", table: reviewCardsStringsTableName), systemImage: "plus")
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
                    onEditWithAI: presentation.editingCardId.map { editingCardId in
                        {
                            let cardReference: AIChatCardReference?
                            if self.isEditingCardDirty() {
                                cardReference = self.saveEditingCardForAIHandoff()
                            } else {
                                let normalizedInput = self.normalizedCardEditorInput()
                                cardReference = AIChatCardReference(
                                    cardId: editingCardId,
                                    frontText: normalizedInput.frontText,
                                    backText: normalizedInput.backText,
                                    tags: normalizedInput.tags,
                                    effortLevel: normalizedInput.effortLevel
                                )
                            }
                            guard let cardReference else {
                                return
                            }
                            self.editorPresentation = nil
                            Task { @MainActor in
                                self.navigation.openAICardHandoff(card: cardReference)
                            }
                        }
                    },
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
            .accessibilityIdentifier(UITestIdentifier.cardEditorScreen)
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

    private func normalizedCardEditorInput() -> CardEditorInput {
        CardEditorInput(
            frontText: self.cardFormState.frontText.trimmingCharacters(in: .whitespacesAndNewlines),
            backText: self.cardFormState.backText.trimmingCharacters(in: .whitespacesAndNewlines),
            tags: self.cardFormState.tags,
            effortLevel: self.cardFormState.effortLevel
        )
    }

    private func editingCard() -> Card? {
        guard let editingCardId = self.editorPresentation?.editingCardId else {
            return nil
        }

        return self.cardsSnapshot.cards.first { card in
            card.cardId == editingCardId
        }
    }

    private func isEditingCardDirty() -> Bool {
        guard self.editorPresentation?.editingCardId != nil else {
            return false
        }
        guard let editingCard = self.editingCard() else {
            return true
        }

        let normalizedInput = self.normalizedCardEditorInput()
        return normalizedInput.frontText != editingCard.frontText
            || normalizedInput.backText != editingCard.backText
            || normalizedInput.effortLevel != editingCard.effortLevel
            || normalizedInput.tags != editingCard.tags
    }

    private func saveEditingCardForAIHandoff() -> AIChatCardReference? {
        guard let editingCardId = self.editorPresentation?.editingCardId else {
            self.screenErrorMessage = String(localized: "Card not found.", table: reviewCardsStringsTableName)
            return nil
        }

        let normalizedInput = self.normalizedCardEditorInput()

        do {
            try store.saveCard(
                input: normalizedInput,
                editingCardId: editingCardId
            )
            self.screenErrorMessage = ""
            Task { @MainActor in
                await self.reloadCardsSnapshot()
            }
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

    private func dismissCardsSearch() {
        guard self.isSearchPresented else {
            return
        }
        self.dismissSearch()
        self.isSearchPresented = false
    }

    private func saveCard() {
        do {
            try store.saveCard(
                input: self.normalizedCardEditorInput(),
                editingCardId: self.editorPresentation?.editingCardId
            )
            self.screenErrorMessage = ""
            self.editorPresentation = nil
            Task { @MainActor in
                await self.reloadCardsSnapshot()
            }
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
            self.screenErrorMessage = String(localized: "Card not found.", table: reviewCardsStringsTableName)
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
        if self.screenErrorMessage == String(localized: "Loading cards…", table: reviewCardsStringsTableName) {
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
            Section {
                ForEach(EffortLevel.allCases) { effortLevel in
                    Toggle(
                        localizedEffortTitle(effortLevel: effortLevel),
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
            } header: {
                Text(String(localized: "Effort", table: reviewCardsStringsTableName))
            }

            Section {
                NavigationLink {
                    TagPickerView(
                        selectedTags: draftTags,
                        suggestions: suggestions,
                        onSave: { nextTags in
                            updateDraftFilter(tags: nextTags, effort: draftEffort)
                        }
                    )
                } label: {
                    TagsFieldRow(summary: localizedTagSelectionSummary(tags: draftTags))
                }
            } header: {
                Text(String(localized: "Tags", table: reviewCardsStringsTableName))
            }

            Section {
                Text(formatCardFilterSummary(filter: draftFilter))
                    .foregroundStyle(.secondary)
            } header: {
                Text(String(localized: "Summary", table: reviewCardsStringsTableName))
            }

            Section {
                Button(String(localized: "Clear filters", table: reviewCardsStringsTableName)) {
                    updateDraftFilter(tags: [], effort: [])
                }
                .disabled(cardFilterActiveDimensionCount(filter: draftFilter) == 0)
            } header: {
                Text(String(localized: "Actions", table: reviewCardsStringsTableName))
            }
        }
        .navigationTitle(String(localized: "Filters", table: reviewCardsStringsTableName))
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button(String(localized: "Cancel", table: reviewCardsStringsTableName), action: onCancel)
            }

            ToolbarItem(placement: .topBarTrailing) {
                Button(String(localized: "Apply", table: reviewCardsStringsTableName), action: onApply)
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
                Label(localizedEffortTitle(effortLevel: card.effortLevel), systemImage: "timer")
                Label(card.tags.isEmpty ? localizedNoTagsLabel() : formatTags(tags: card.tags), systemImage: "tag")
                Label(localizedDueDateLabel(value: card.dueAt), systemImage: "clock")
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

private func localizedDueDateLabel(value: String?) -> String {
    guard let value else {
        return String(localized: "New", table: reviewCardsStringsTableName)
    }

    guard let date = parseIsoTimestamp(value: value) else {
        return value
    }

    return date.formatted(date: .abbreviated, time: .shortened)
}
