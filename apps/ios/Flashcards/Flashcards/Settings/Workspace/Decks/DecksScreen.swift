import SwiftUI

struct DecksScreen: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @Environment(AppNavigationModel.self) private var navigation: AppNavigationModel
    @Environment(SettingsScrollModel.self) private var settingsScroll: SettingsScrollModel
    @Environment(\.locale) private var locale
    @Environment(\.dismissSearch) private var dismissSearch
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    @State private var isEditorPresented: Bool = false
    @State private var deckFormState: DeckFormState = emptyDeckFormState()
    @State private var editorErrorMessage: String = ""
    @State private var pendingDeletion: DeckDeletionTarget? = nil
    @State private var decksSnapshot: DecksListSnapshot = DecksListSnapshot(
        deckSummaries: [],
        allCardsStats: DeckCardStats(totalCards: 0, dueCards: 0, newCards: 0, reviewedCards: 0)
    )
    @State private var availableTagSuggestions: [TagSuggestion] = []
    @State private var isLoading: Bool = true
    @State private var isSearchPresented: Bool = false
    @State private var searchText: String = ""

    private var deckListEntries: [DeckScreenListItem] {
        makeDeckScreenListItems(decksSnapshot: self.decksSnapshot, locale: self.locale)
    }

    private var filteredDeckListEntries: [DeckScreenListItem] {
        deckScreenListItemsMatchingSearchText(
            deckListEntries: self.deckListEntries,
            searchText: self.searchText
        )
    }

    var body: some View {
        List {
            Section {
                Text(aiSettingsLocalized("settings.workspace.decks.description", "Decks are smart filters that include cards matching the tags you choose."))
                    .foregroundStyle(.secondary)
            }

            Section(aiSettingsLocalized("settings.workspace.row.decks", "Decks")) {
                if self.isLoading {
                    Text(aiSettingsLocalized("settings.workspace.decks.loading", "Loading decks…"))
                        .foregroundStyle(.secondary)
                } else if self.filteredDeckListEntries.isEmpty {
                    ContentUnavailableView(
                        aiSettingsLocalized("settings.workspace.decks.noMatching", "No Matching Decks"),
                        systemImage: "magnifyingglass",
                        description: Text(aiSettingsLocalized("common.tryDifferentSearch", "Try a different search."))
                    )
                } else {
                    ForEach(self.filteredDeckListEntries) { deckListEntry in
                        if let persistedDeckId = deckListEntry.persistedDeckId {
                            NavigationLink(value: LibraryNavigationDestination.deckDetail(deckListEntry.destination)) {
                                DeckListRow(deckListEntry: deckListEntry)
                            }
                            .rememberedListRow(id: deckListEntry.id)
                            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                Button {
                                    self.pendingDeletion = DeckDeletionTarget(
                                        deckId: persistedDeckId,
                                        name: deckListEntry.title
                                    )
                                } label: {
                                    Label(aiSettingsLocalized("common.delete", "Delete"), systemImage: "trash")
                                }
                                .tint(.red)
                            }
                        } else {
                            NavigationLink(value: LibraryNavigationDestination.deckDetail(deckListEntry.destination)) {
                                DeckListRow(deckListEntry: deckListEntry)
                            }
                            .accessibilityIdentifier(UITestIdentifier.decksAllCardsRow)
                            .rememberedListRow(id: deckListEntry.id)
                        }
                    }
                }
            }
        }
        .modifier(DeckDeletionConfirmation(pendingDeletion: self.$pendingDeletion, onDelete: self.deleteDeck))
        .listStyle(.insetGrouped)
        .rememberedListScroll(
            topRowID: self.settingsScroll.topRowID(\.decksTopRowID, whileOnPath: { self.navigation.isDecksOnLibraryPath }),
            isContentReady: self.isLoading == false
        )
        .accessibilityIdentifier(UITestIdentifier.decksScreen)
        .nativeNavigationTitle(aiSettingsLocalized("settings.workspace.row.decks", "Decks"))
        #if targetEnvironment(macCatalyst)
        .macToolbarContribution(MacToolbarContribution(
            tab: .library,
            role: .navigation,
            trailing: [MacToolbarGroup(identifier: "settings.decks.actions", actions: [
                MacToolbarAction(
                    identifier: "settings.decks.add",
                    symbol: "plus",
                    label: aiSettingsLocalized("settings.workspace.decks.newDeck", "New deck")
                ) { _ in self.beginCreating() }
            ])],
            search: MacToolbarSearch(
                text: self.searchText,
                prompt: aiSettingsLocalized("settings.workspace.decks.searchPrompt", "Search decks"),
                focusRequest: nil,
                onChange: { self.searchText = $0 },
                onFocusRequestHandled: {}
            )
        ))
        #else
        .searchable(
            text: self.$searchText,
            isPresented: self.$isSearchPresented,
            placement: .automatic,
            prompt: aiSettingsLocalized("settings.workspace.decks.searchPrompt", "Search decks")
        )
        .nativeSearchToolbar(horizontalSizeClass: self.horizontalSizeClass)
        #endif
        .task(id: "\(store.localReadVersion)|\(store.reviewScheduleVersion)") {
            await self.reloadDecksSnapshot()
        }
        .onAppear {
            Analytics.trackScreenViewed(.decks)
        }
        .onDisappear {
            // This also fires when a deck detail is pushed on top, and naming Library then would
            // record a view the person never had and hide their next real one behind the dedupe.
            // The tracker guard cannot settle that one, because it would depend on
            // `DeckDetailScreen.onAppear` winning a race SwiftUI does not order — and every deck
            // open would take that race. The Library path answers it from state instead: the push
            // appends the deck detail and leaves `decks` on the path, a tab switch away leaves it
            // there too, and only the pop back to the Library hub has removed it. This screen is
            // reachable no other way, so the path is the whole question.
            // `DeckDetailScreen.onDisappear` reads the same value for the opposite decision — the
            // list still on the path is what it lands on — so the two must stay separate rather
            // than be merged into one guard.
            guard self.navigation.isDecksOnLibraryPath == false else {
                return
            }

            Analytics.trackScreenViewedOnDismiss(of: .decks, restoring: .library)
        }
        #if !targetEnvironment(macCatalyst)
        .toolbar {
            AICompanionToolbarItem()
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    self.beginCreating()
                } label: {
                    Label(aiSettingsLocalized("settings.workspace.decks.newDeck", "New deck"), systemImage: "plus")
                }
            }
        }
        #endif
        .sheet(
            isPresented: $isEditorPresented,
            onDismiss: {
                // From the presentation, never from the content, for the reason
                // `Analytics.trackScreenViewedOnDismiss` gives. Saving pushes the new deck's detail
                // screen, which reports itself; this restore is then refused because the tracker no
                // longer holds the editor.
                Analytics.trackScreenViewedOnDismiss(of: .deckEditor, restoring: .decks)
            }
        ) {
            NavigationStack {
                DeckEditorView(
                    title: aiSettingsLocalized("settings.workspace.decks.newDeck", "New deck"),
                    availableTagSuggestions: self.availableTagSuggestions,
                    errorMessage: self.editorErrorMessage,
                    formState: $deckFormState,
                    savedDeck: nil,
                    onMaintenanceDismissed: {},
                    onCancel: {
                        isEditorPresented = false
                    },
                    onSave: {
                        self.saveDeck()
                    },
                    onDelete: nil
                )
            }
            .technicalErrorSheetHost(store: self.store)
            .onAppear {
                Analytics.trackScreenViewed(.deckEditor)
            }
        }
    }

    private func beginCreating() {
        self.dismissDecksSearch()
        self.deckFormState = emptyDeckFormState()
        self.editorErrorMessage = ""
        self.isEditorPresented = true
    }

    private func dismissDecksSearch() {
        self.dismissSearch()
        self.isSearchPresented = false
    }

    private func saveDeck() {
        if let validationMessage = deckEditorValidationMessage(formState: self.deckFormState) {
            self.editorErrorMessage = validationMessage
            return
        }

        do {
            let createdDeck: Deck = try store.createDeck(input: makeDeckEditorInput(formState: deckFormState))
            self.editorErrorMessage = ""
            self.isEditorPresented = false
            self.navigation.libraryPath.append(
                LibraryNavigationDestination.deckDetail(.deck(deckId: createdDeck.deckId))
            )
        } catch {
            self.store.presentTechnicalError(error)
        }
    }

    private func deleteDeck(deckId: String) {
        do {
            try store.deleteDeck(deckId: deckId)
        } catch {
            self.store.presentTechnicalError(error)
        }
    }

    private func reloadDecksSnapshot() async {
        do {
            let now = Date()
            let decksSnapshot = try store.loadDecksListSnapshot(now: now)
            let tagsSummary = try store.loadWorkspaceTagsSummary()
            self.decksSnapshot = decksSnapshot
            self.availableTagSuggestions = tagsSummary.tags.map { tagSummary in
                TagSuggestion(
                    tag: tagSummary.tag,
                    countState: .ready(cardsCount: tagSummary.cardsCount)
                )
            }
            self.isLoading = false
        } catch {
            self.isLoading = false
            self.store.presentTechnicalError(error)
        }
    }
}

private func deckScreenListItemsMatchingSearchText(
    deckListEntries: [DeckScreenListItem],
    searchText: String
) -> [DeckScreenListItem] {
    let normalizedSearchText = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    if normalizedSearchText.isEmpty {
        return deckListEntries
    }

    return deckListEntries.filter { deckListEntry in
        deckListEntry.title.lowercased().contains(normalizedSearchText)
            || deckListEntry.filterSummary?.lowercased().contains(normalizedSearchText) == true
    }
}

struct DeckCardSummaryRows: View {
    let stats: DeckCardStats

    var body: some View {
        SummaryRow(
            title: aiSettingsLocalized("settings.workspace.overview.cards", "Cards"),
            value: self.stats.totalCards.formatted(),
            symbolName: "square.stack.3d.up"
        )
        SummaryRow(
            title: aiSettingsLocalized("settings.workspace.decks.toStudy", "To study"),
            value: self.stats.dueCards.formatted(),
            symbolName: "clock.badge.checkmark"
        )
        SummaryRow(
            title: aiSettingsLocalized("settings.workspace.overview.new", "New"),
            value: self.stats.newCards.formatted(),
            symbolName: "plus.circle"
        )
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
                .foregroundStyle(Color.primary)

            Spacer()

            Text(value)
                .foregroundStyle(Color.primary)
                .font(.headline.monospacedDigit())
        }
        .padding(.vertical, 4)
    }
}

private struct DeckListRow: View {
    let deckListEntry: DeckScreenListItem
    /// Title width the one-line layout must leave beside the counts; a longer name wraps there instead of forcing a stacked row.
    @ScaledMetric(relativeTo: .headline) private var minimumTitleWidth: CGFloat = 80

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            // The counts never truncate: when they cannot share the title's line (long translations, accessibility sizes), they move below it, then onto separate lines that wrap.
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    self.titleText
                    Spacer(minLength: 0)
                    self.inlineCounts
                        .fixedSize()
                }

                VStack(alignment: .leading, spacing: 4) {
                    self.titleText
                    self.inlineCounts
                        .fixedSize()
                }

                VStack(alignment: .leading, spacing: 4) {
                    self.titleText
                    self.cardCountText
                    self.toStudyCountText
                }
            }
            .fixedSize(horizontal: false, vertical: true)

            if let filterSummary = deckListEntry.filterSummary {
                Text(filterSummary)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
    }

    private var titleText: some View {
        Text(deckListEntry.title)
            .foregroundStyle(Color.primary)
            .font(.headline)
            // Only the counts decide which layout fits; the name wraps in full in whichever layout is chosen, so a nested deck keeps its last part.
            .frame(idealWidth: minimumTitleWidth, alignment: .leading)
    }

    private var inlineCounts: some View {
        HStack(spacing: 4) {
            self.cardCountText
            Text(verbatim: "·")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
            self.toStudyCountText
        }
    }

    private var cardCountText: some View {
        Text(String(localized: "catalog.list.card_count \(deckListEntry.stats.totalCards)", table: "Foundation"))
            .font(.subheadline)
            .foregroundStyle(.secondary)
    }

    private var toStudyCountText: some View {
        Text(aiSettingsLocalizedFormat("settings.workspace.decks.toStudyCount", "%d to study", deckListEntry.stats.dueCards))
            .font(.subheadline)
            .foregroundStyle(.secondary)
    }
}

enum DeckScreenDestination: Hashable, Sendable {
    case allCards
    case deck(deckId: String)
}

private struct DeckScreenListItem: Identifiable, Hashable {
    let id: String
    let title: String
    /// Nil for the All cards item, whose title already says what it includes.
    let filterSummary: String?
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
            return aiSettingsLocalized("settings.workspace.decks.emptyAllCards", "You haven't created any cards yet.")
        case .deck:
            return aiSettingsLocalized("settings.workspace.decks.emptyDeck", "This deck doesn't have any matching cards yet.")
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

    var hasEmptyDeckRules: Bool {
        switch self {
        case .allCards:
            return false
        case .deck(let deckItem, _):
            return deckFilterDefinitionHasRules(filterDefinition: deckItem.deck.filterDefinition) == false
        }
    }
}

struct DeckDetailScreen: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @Environment(AppNavigationModel.self) private var navigation: AppNavigationModel
    @Environment(\.dismiss) private var dismiss

    let destination: DeckScreenDestination

    @State private var isEditorPresented: Bool = false
    @State private var editingDeck: Deck?
    @State private var deckFormState: DeckFormState = emptyDeckFormState()
    @State private var editorErrorMessage: String = ""
    @State private var pendingDeletion: DeckDeletionTarget? = nil
    @State private var didDeleteDeck: Bool = false
    @State private var detailState: DeckDetailScreenState? = nil
    @State private var availableTagSuggestions: [TagSuggestion] = []

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
            if let detailState {
                Section(aiSettingsLocalized("settings.workspace.decks.section.deckRules", "Deck rules")) {
                    DeckCardSummaryRows(stats: detailState.stats)
                    Text(detailState.filterSummary)
                        .foregroundStyle(.secondary)

                    if detailState.hasEmptyDeckRules {
                        Text(aiSettingsLocalized("settings.workspace.decks.emptyRulesIncludesAllCards", "This deck has no rules, so it includes all cards."))
                            .foregroundStyle(.secondary)
                    }
                }

                Section {
                    Button {
                        self.openReview()
                    } label: {
                        Label(reviewActionTitle(detailState: detailState), systemImage: "rectangle.on.rectangle")
                    }
                }

                Section(aiSettingsLocalized("settings.workspace.decks.section.matchingCards", "Matching cards")) {
                    if detailState.cards.isEmpty {
                        Text(detailState.emptyMessage)
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(detailState.cards) { card in
                            CardRow(card: card)
                        }
                    }
                }

            } else {
                Section {
                    Text(aiSettingsLocalized("settings.workspace.decks.notFound", "Deck not found."))
                        .foregroundStyle(.secondary)
                }
            }
        }
        .listStyle(.insetGrouped)
        .accessibilityIdentifier(UITestIdentifier.deckDetailScreen)
        .nativeNavigationTitle(detailState?.title ?? aiSettingsLocalized("settings.workspace.decks.deck", "Deck"))
        .task(id: "\(self.currentDeckId ?? "all")|\(store.localReadVersion)|\(store.reviewScheduleVersion)") {
            await self.reloadDetailState()
        }
        .onAppear {
            Analytics.trackScreenViewed(.deckDetail)
        }
        .onDisappear {
            // Popping back usually lands on the decks list, which now has a surface of its own, but
            // not always: the long-press menu on the standard back button pops several levels at
            // once, and jumping straight to the Library hub takes the list away with the detail.
            // Naming the list then would record a view the person never had and park the tracker on
            // it, so the Library arrival is never reported and their genuine next arrival on the
            // list is swallowed by the dedupe. The Library path is the same settled state the
            // list's own guard reads, and it still holds `decks` for as long as the list is in the
            // stack; only a pop that removed the list has cleared it. The list uses that to return
            // early on the push, this uses it to land on the Library hub — the same value, opposite
            // decisions, so the two guards must not be merged. Conditional, because this also fires
            // for a tab switch away from an open deck detail, where `selectTab` has already
            // reported the destination and the tracker guard refuses.
            Analytics.trackScreenViewedOnDismiss(
                of: .deckDetail,
                restoring: self.navigation.isDecksOnLibraryPath ? .decks : .library
            )
        }
        #if targetEnvironment(macCatalyst)
        .macToolbarContribution(MacToolbarContribution(
            tab: .library,
            role: .navigation,
            trailing: self.detailState?.allowsEditing == true ? [
                MacToolbarGroup(identifier: "settings.deckDetail.actions", actions: [
                    MacToolbarAction(
                        identifier: "settings.deckDetail.edit",
                        symbol: "pencil",
                        label: aiSettingsLocalized("common.edit", "Edit")
                    ) { _ in self.beginEditing() }
                ])
            ] : []
        ))
        #else
        .toolbar {
            AICompanionToolbarItem()
            if detailState?.allowsEditing == true {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(aiSettingsLocalized("common.edit", "Edit")) {
                        self.beginEditing()
                    }
                }
            }
        }
        #endif
        .sheet(
            isPresented: $isEditorPresented,
            onDismiss: {
                if self.didDeleteDeck {
                    Analytics.trackScreenViewedOnDismiss(of: .deckEditor, restoring: .decks)
                    self.dismiss()
                } else {
                    Analytics.trackScreenViewedOnDismiss(of: .deckEditor, restoring: .deckDetail)
                }
            }
        ) {
            NavigationStack {
                DeckEditorView(
                    title: aiSettingsLocalized("settings.workspace.decks.editDeck", "Edit deck"),
                    availableTagSuggestions: self.availableTagSuggestions,
                    errorMessage: self.editorErrorMessage,
                    formState: $deckFormState,
                    savedDeck: self.editingDeck,
                    onMaintenanceDismissed: self.reloadEditingDeckRules,
                    onCancel: {
                        isEditorPresented = false
                    },
                    onSave: {
                        self.saveDeckChanges()
                    },
                    onDelete: self.beginDeletingDeck
                )
            }
            .modifier(DeckDeletionConfirmation(pendingDeletion: self.$pendingDeletion, onDelete: self.deleteDeck))
            .technicalErrorSheetHost(store: self.store)
            .onAppear {
                Analytics.trackScreenViewed(.deckEditor)
            }
        }
    }

    private func beginEditing() {
        guard let detailState else {
            return
        }

        switch detailState {
        case .allCards:
            return
        case .deck(let deckItem, _):
            do {
                self.deckFormState = try makeDeckFormState(deck: deckItem.deck)
                self.editingDeck = deckItem.deck
                self.editorErrorMessage = ""
                self.isEditorPresented = true
            } catch {
                self.store.presentTechnicalError(error)
            }
        }
    }

    private func saveDeckChanges() {
        guard let editingDeck else {
            self.editorErrorMessage = aiSettingsLocalized("settings.workspace.decks.notFound", "Deck not found.")
            return
        }

        if let validationMessage = deckEditorValidationMessage(formState: self.deckFormState) {
            self.editorErrorMessage = validationMessage
            return
        }

        do {
            try store.updateDeck(
                deckId: editingDeck.deckId,
                input: makeDeckEditorInput(formState: self.deckFormState),
                observedTags: editingDeck.filterDefinition.tags
            )
            self.editorErrorMessage = ""
            self.isEditorPresented = false
        } catch LocalStoreError.validation(let message) {
            self.reloadEditingDeckRules()
            self.editorErrorMessage = message
        } catch {
            self.store.presentTechnicalError(error)
        }
    }

    private func reloadEditingDeckRules() {
        guard let editingDeck else {
            return
        }
        do {
            let latestDeck = try self.store.loadDeck(deckId: editingDeck.deckId)
            self.deckFormState = self.formStateByReconcilingDeckRules(latestDeck: latestDeck)
            self.editingDeck = latestDeck
        } catch LocalStoreError.notFound {
            self.editingDeck = nil
            self.editorErrorMessage = aiSettingsLocalized("settings.workspace.decks.notFound", "Deck not found.")
        } catch {
            self.store.presentTechnicalError(error)
        }
    }

    private func formStateByReconcilingDeckRules(latestDeck: Deck) -> DeckFormState {
        guard let editingDeck else {
            return self.deckFormState
        }
        var formState = self.deckFormState
        formState.tags = reconcileDraftTags(
            draftTags: formState.tags,
            observedTags: editingDeck.filterDefinition.tags,
            refreshedTags: latestDeck.filterDefinition.tags
        )
        return formState
    }

    private func beginDeletingDeck() {
        guard let deckId = self.currentDeckId else {
            return
        }

        do {
            let deck = try self.store.loadDeck(deckId: deckId)
            self.pendingDeletion = DeckDeletionTarget(deckId: deck.deckId, name: deck.name)
        } catch {
            self.store.presentTechnicalError(error)
        }
    }

    private func deleteDeck(deckId: String) {
        do {
            try self.store.deleteDeck(deckId: deckId)
            self.didDeleteDeck = true
            self.isEditorPresented = false
        } catch {
            self.store.presentTechnicalError(error)
        }
    }

    private func openReview() {
        store.selectReviewFilter(reviewFilter: reviewFilter)
        navigation.selectTab(.review)
    }

    private func reloadDetailState() async {
        do {
            let tagsSummary = try store.loadWorkspaceTagsSummary()
            self.availableTagSuggestions = tagsSummary.tags.map { tagSummary in
                TagSuggestion(
                    tag: tagSummary.tag,
                    countState: .ready(cardsCount: tagSummary.cardsCount)
                )
            }

            switch self.destination {
            case .allCards:
                let cards = try store.loadCardsMatchingDeck(
                    filterDefinition: DeckFilterDefinition(version: 2, tags: [])
                )
                self.detailState = .allCards(
                    stats: makeDeckCardStats(cards: cards, now: Date()),
                    cards: cards
                )
            case .deck(let deckId):
                let deck: Deck
                do {
                    deck = try store.loadDeck(deckId: deckId)
                } catch LocalStoreError.notFound(_) {
                    self.detailState = nil
                    return
                }

                let cards = try store.loadCardsMatchingDeck(filterDefinition: deck.filterDefinition)
                self.detailState = .deck(
                    deckItem: makeDeckListItem(deck: deck, cards: cards, now: Date()),
                    cards: cards
                )
            }
        } catch {
            self.detailState = nil
            self.store.presentTechnicalError(error)
        }
    }
}

private struct DeckEditorView: View {
    let title: String
    let availableTagSuggestions: [TagSuggestion]
    let errorMessage: String
    @Binding var formState: DeckFormState
    let savedDeck: Deck?
    let onMaintenanceDismissed: () -> Void
    let onCancel: () -> Void
    let onSave: () -> Void
    let onDelete: (() -> Void)?

    var body: some View {
        ReadableContentLayout(
            maxWidth: flashcardsReadableFormMaxWidth,
            horizontalPadding: 0
        ) {
            Form {
                if errorMessage.isEmpty == false {
                    Section {
                        Text(errorMessage)
                            .foregroundStyle(.red)
                    }
                }

                Section {
                    Text(aiSettingsLocalized("settings.workspace.decks.editorSmartFilterDescription", "A Deck is a smart filter."))
                    Text(aiSettingsLocalized("settings.workspace.decks.editorMatchingRulesDescription", "Cards match by the tags you select. You can select the Deck from the top-left menu on Review."))
                }
                .foregroundStyle(.secondary)

                Section(aiSettingsLocalized("settings.workspace.decks.section.name", "Name")) {
                    TextField(aiSettingsLocalized("settings.workspace.decks.deckName", "Deck name"), text: $formState.name)
                }

                Section(aiSettingsLocalized("settings.workspace.row.tags", "Tags")) {
                    NavigationLink {
                        TagPickerView(
                            selectedTags: $formState.tags,
                            suggestions: availableTagSuggestions
                        )
                    } label: {
                        TagsFieldRow(summary: formatTagSelectionSummary(tags: formState.tags))
                    }

                    Text(
                        formatDeckFilterDefinition(
                            filterDefinition: buildDeckFilterDefinition(
                                tags: formState.tags
                            )
                        )
                    )
                    .foregroundStyle(.secondary)
                }

                if let savedDeck, let onDelete {
                    let rulesChanged = Set(self.formState.tags) != Set(savedDeck.filterDefinition.tags)
                    Section {
                        CardMaintenanceButton(
                            scope: CardMaintenanceScope(
                                workspaceId: savedDeck.workspaceId,
                                kind: .resetDeck,
                                target: savedDeck.deckId,
                                expectedDeckFilter: savedDeck.filterDefinition
                            ),
                            isAvailable: rulesChanged == false,
                            onDismiss: self.onMaintenanceDismissed,
                            onCompleted: {}
                        )

                        if rulesChanged {
                            Text(aiSettingsLocalized(
                                "settings.workspace.cardMaintenance.saveDeckRules",
                                "Save the deck rules before resetting study progress."
                            ))
                            .foregroundStyle(.secondary)
                        }

                        Button(aiSettingsLocalized("settings.workspace.decks.deleteDeck", "Delete deck"), role: .destructive, action: onDelete)
                    }
                }
            }
        }
        .navigationTitle(title)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button(aiSettingsLocalized("common.cancel", "Cancel"), action: onCancel)
            }

            ToolbarItem(placement: .topBarTrailing) {
                Button(aiSettingsLocalized("common.save", "Save"), action: onSave)
            }
        }
    }
}

private struct DeckFormState {
    var name: String
    var tags: [String]
}

private func emptyDeckFormState() -> DeckFormState {
    DeckFormState(
        name: "",
        tags: []
    )
}

private func makeDeckEditorInput(formState: DeckFormState) -> DeckEditorInput {
    DeckEditorInput(
        name: formState.name.trimmingCharacters(in: .whitespacesAndNewlines),
        filterDefinition: buildDeckFilterDefinition(
            tags: formState.tags
        )
    )
}

private func makeDeckFormState(deck: Deck) throws -> DeckFormState {
    return DeckFormState(
        name: deck.name,
        tags: deck.filterDefinition.tags
    )
}

private func deckFormStateHasFilterRules(formState: DeckFormState) -> Bool {
    deckFilterDefinitionHasRules(
        filterDefinition: buildDeckFilterDefinition(
            tags: formState.tags
        )
    )
}

private func deckEditorValidationMessage(formState: DeckFormState) -> String? {
    let trimmedName = formState.name.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmedName.isEmpty {
        return deckEditorEmptyNameValidationMessage()
    }

    if deckFormStateHasFilterRules(formState: formState) == false {
        return deckEditorEmptyRulesValidationMessage()
    }

    return nil
}

private func deckFilterDefinitionHasRules(filterDefinition: DeckFilterDefinition) -> Bool {
    filterDefinition.tags.isEmpty == false
}

private func deckEditorEmptyNameValidationMessage() -> String {
    aiSettingsLocalized(
        "settings.workspace.decks.emptyNameValidation",
        "Enter a deck name."
    )
}

private func reviewActionTitle(detailState: DeckDetailScreenState) -> String {
    switch detailState {
    case .allCards:
        return aiSettingsLocalized("settings.workspace.decks.openReview", "Open review")
    case .deck:
        return aiSettingsLocalized("settings.workspace.decks.reviewThisDeck", "Review this deck")
    }
}

private func makeDeckScreenListItems(decksSnapshot: DecksListSnapshot, locale: Locale) -> [DeckScreenListItem] {
    let sortedDeckSummaries = decksSnapshot.deckSummaries.sorted { left, right in
        deckNamePrecedes(
            leftName: left.name,
            leftId: left.deckId,
            rightName: right.name,
            rightId: right.deckId,
            locale: locale
        )
    }
    return [makeAllCardsDeckScreenListItem(stats: decksSnapshot.allCardsStats)] + sortedDeckSummaries.map { deckSummary in
        DeckScreenListItem(
            id: deckSummary.id,
            title: deckSummary.name,
            filterSummary: formatDeckFilterDefinition(filterDefinition: deckSummary.filterDefinition),
            stats: DeckCardStats(
                totalCards: deckSummary.totalCards,
                dueCards: deckSummary.dueCards,
                newCards: deckSummary.newCards,
                reviewedCards: deckSummary.reviewedCards
            ),
            destination: .deck(deckId: deckSummary.deckId),
            persistedDeckId: deckSummary.deckId
        )
    }
}

private func makeAllCardsDeckScreenListItem(stats: DeckCardStats) -> DeckScreenListItem {
    return DeckScreenListItem(
        id: "system-all-cards",
        title: allCardsDeckLabel,
        filterSummary: nil,
        stats: stats,
        destination: .allCards,
        persistedDeckId: nil
    )
}

private struct DeckDeletionTarget {
    let deckId: String
    let name: String
}

private struct DeckDeletionConfirmation: ViewModifier {
    @Binding var pendingDeletion: DeckDeletionTarget?
    let onDelete: (String) -> Void

    func body(content: Content) -> some View {
        content.confirmationDialog(
            aiSettingsLocalizedFormat(
                "settings.workspace.decks.deleteConfirmation.title",
                "Delete “%@”?",
                self.pendingDeletion?.name ?? ""
            ),
            isPresented: Binding(
                get: { self.pendingDeletion != nil },
                set: { isPresented in
                    if isPresented == false {
                        self.pendingDeletion = nil
                    }
                }
            ),
            titleVisibility: .visible,
            presenting: self.pendingDeletion
        ) { target in
            Button(aiSettingsLocalized("settings.workspace.decks.deleteDeck", "Delete deck"), role: .destructive) {
                self.onDelete(target.deckId)
            }
            Button(aiSettingsLocalized("common.cancel", "Cancel"), role: .cancel) {}
        } message: { _ in
            Text(aiSettingsLocalized(
                "settings.workspace.decks.deleteConfirmation.message",
                "Your cards will remain. This removes only the saved deck filter."
            ))
        }
    }
}
