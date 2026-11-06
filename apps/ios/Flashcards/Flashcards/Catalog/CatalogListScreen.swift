import SwiftUI

private let catalogStringsTableName: String = "Foundation"
private let catalogDeckRowCoverSize: CGFloat = 56

/// The public deck catalog: the cached index at once, revalidated in the background.
struct CatalogListScreen: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @Environment(CatalogIndexStore.self) private var catalog: CatalogIndexStore
    @Environment(\.locale) private var locale
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    @State private var searchText: String = ""
    @State private var isSearchPresented: Bool = false
    /// Nil until the person picks a language, so the default follows the loaded index.
    @State private var languageChoice: CatalogLanguageFilter? = nil
    @State private var sortOrder: CatalogSortOrder = .relevance
    #if targetEnvironment(macCatalyst)
    @State private var isOptionsPopoverPresented: Bool = false
    #endif

    private var defaultLanguageFilter: CatalogLanguageFilter {
        defaultCatalogLanguageFilter(
            languageCodes: self.catalog.languageCodes,
            appLocaleIdentifier: currentAppUILocaleIdentifier()
        )
    }

    private func matchingDecks() -> [CatalogBrowseIndexDeck] {
        catalogDecksMatching(
            listedDecks: self.catalog.listedDecks,
            languageFilter: self.languageChoice ?? self.defaultLanguageFilter,
            searchText: self.searchText,
            sortOrder: self.sortOrder
        )
    }

    private var title: String {
        String(localized: "library.row.deck_catalog.title", table: catalogStringsTableName)
    }

    private var searchPrompt: String {
        String(localized: "catalog.list.search_prompt", table: catalogStringsTableName)
    }

    private var optionsLabel: String {
        String(localized: "catalog.list.options", table: catalogStringsTableName)
    }

    var body: some View {
        let visibleDecks = self.matchingDecks()
        List {
            if self.catalog.index == nil {
                self.indexUnavailableContent
            } else {
                self.indexContent(visibleDecks: visibleDecks)
            }
        }
        .listStyle(.insetGrouped)
        .accessibilityIdentifier(UITestIdentifier.catalogListScreen)
        .nativeNavigationTitle(self.title)
        #if targetEnvironment(macCatalyst)
        .macToolbarContribution(self.macCatalogToolbar)
        #else
        .searchable(
            text: self.$searchText,
            isPresented: self.$isSearchPresented,
            placement: .automatic,
            prompt: self.searchPrompt
        )
        .nativeSearchToolbar(horizontalSizeClass: self.horizontalSizeClass)
        .toolbar {
            AICompanionToolbarItem()
            ToolbarItem(placement: .topBarTrailing) {
                self.optionsMenu
            }
        }
        #endif
        .refreshable {
            await self.revalidate()
        }
        .task {
            await self.catalog.loadCachedIndexIfNeeded()
            await self.revalidateIfStale()
        }
        .task(id: visibleDecks.prefix(catalogDeckPreviewPrefetchCount).map(\.packageVersionId)) {
            await self.prefetchDeckPreviews(decks: visibleDecks)
        }
    }

    @ViewBuilder
    private var indexUnavailableContent: some View {
        if let failureMessage = self.catalog.failureMessage, self.catalog.isRefreshing == false {
            ContentUnavailableView {
                Label(
                    String(localized: "catalog.list.load_failed.title", table: catalogStringsTableName),
                    systemImage: "exclamationmark.triangle"
                )
            } description: {
                Text(failureMessage)
            } actions: {
                Button(String(localized: "catalog.list.retry", table: catalogStringsTableName)) {
                    Task {
                        await self.revalidate()
                    }
                }
                .buttonStyle(.borderedProminent)
                .accessibilityIdentifier(UITestIdentifier.catalogListRetryButton)
            }
        } else {
            HStack(spacing: 12) {
                ProgressView()
                Text(String(localized: "catalog.list.loading", table: catalogStringsTableName))
                    .foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private func indexContent(visibleDecks: [CatalogBrowseIndexDeck]) -> some View {
        if let failureMessage = self.catalog.failureMessage {
            Section {
                Label(
                    String(localized: "catalog.list.refresh_failed", table: catalogStringsTableName),
                    systemImage: "exclamationmark.triangle"
                )
                .foregroundStyle(.secondary)
                CopyableErrorMessageView(message: failureMessage)
                    .font(.footnote)
            }
        }

        Section {
            if self.catalog.listedDecks.isEmpty {
                ContentUnavailableView(
                    String(localized: "catalog.list.empty.title", table: catalogStringsTableName),
                    systemImage: "books.vertical"
                )
            } else if visibleDecks.isEmpty {
                ContentUnavailableView(
                    String(localized: "catalog.list.no_matches.title", table: catalogStringsTableName),
                    systemImage: "magnifyingglass",
                    description: Text(String(localized: "catalog.list.no_matches.description", table: catalogStringsTableName))
                )
            } else {
                ForEach(visibleDecks) { deck in
                    NavigationLink(value: LibraryNavigationDestination.catalogDeck(deck)) {
                        CatalogDeckRow(deck: deck)
                    }
                    .accessibilityIdentifier(UITestIdentifier.catalogListDeckRow)
                }
            }
        }
    }

    @ViewBuilder
    private var optionPickers: some View {
        CatalogLanguagePicker(
            languageChoice: self.$languageChoice,
            defaultLanguageFilter: self.defaultLanguageFilter,
            languageCodes: self.catalog.languageCodes,
            locale: self.locale
        )
        .pickerStyle(.menu)
        CatalogSortPicker(sortOrder: self.$sortOrder)
            .pickerStyle(.menu)
    }

    #if targetEnvironment(macCatalyst)
    private var macCatalogToolbar: MacToolbarContribution {
        MacToolbarContribution(
            tab: .library,
            role: .navigation,
            trailing: [MacToolbarGroup(identifier: "nibomo.catalogActions", actions: [
                MacToolbarAction(
                    identifier: UITestIdentifier.catalogListOptionsMenu,
                    symbol: "line.3.horizontal.decrease",
                    label: self.optionsLabel,
                    perform: { context in
                        self.isOptionsPopoverPresented = true
                        context.presentPopover(isPresented: self.$isOptionsPopoverPresented) {
                            Form {
                                self.optionPickers
                            }
                            .formStyle(.grouped)
                            .frame(width: 340, height: 170)
                            .environment(\.locale, self.locale)
                            .tint(self.store.displayedAccountAccentColor.color)
                        }
                    }
                )
            ])],
            search: MacToolbarSearch(
                text: self.searchText,
                prompt: self.searchPrompt,
                focusRequest: nil,
                onChange: { self.searchText = $0 },
                onFocusRequestHandled: {}
            )
        )
    }
    #else
    private var optionsMenu: some View {
        Menu {
            self.optionPickers
        } label: {
            Label(self.optionsLabel, systemImage: "line.3.horizontal.decrease.circle")
                .labelStyle(.iconOnly)
        }
        .accessibilityIdentifier(UITestIdentifier.catalogListOptionsMenu)
    }
    #endif

    private func revalidateIfStale() async {
        guard let apiBaseUrl = self.apiBaseUrl() else {
            return
        }
        await self.catalog.revalidateIfStale(apiBaseUrl: apiBaseUrl, now: Date())
    }

    private func prefetchDeckPreviews(decks: [CatalogBrowseIndexDeck]) async {
        guard self.catalog.index != nil, let apiBaseUrl = self.apiBaseUrl() else {
            return
        }
        await self.catalog.prefetchDeckPreviews(apiBaseUrl: apiBaseUrl, decks: decks)
    }

    private func revalidate() async {
        guard let apiBaseUrl = self.apiBaseUrl() else {
            return
        }
        await self.catalog.revalidate(apiBaseUrl: apiBaseUrl)
    }

    private func apiBaseUrl() -> String? {
        do {
            return try self.store.currentCloudServiceConfiguration().apiBaseUrl
        } catch {
            self.store.presentTechnicalError(error)
            return nil
        }
    }
}

/// Takes the screen's state binding itself: the Mac options popover is hosted outside the screen,
/// and only a state binding read here refreshes the shown choice there.
private struct CatalogLanguagePicker: View {
    @Binding var languageChoice: CatalogLanguageFilter?
    let defaultLanguageFilter: CatalogLanguageFilter
    let languageCodes: [String]
    let locale: Locale

    var body: some View {
        Picker(selection: Binding(
            get: { self.languageChoice ?? self.defaultLanguageFilter },
            set: { self.languageChoice = $0 }
        )) {
            Text(String(localized: "catalog.list.language.all", table: catalogStringsTableName))
                .tag(CatalogLanguageFilter.allLanguages)
            ForEach(self.languageCodes, id: \.self) { code in
                Text(catalogLanguageDisplayName(code: code, locale: self.locale))
                    .tag(CatalogLanguageFilter.language(code: code))
            }
        } label: {
            Label(String(localized: "catalog.list.language.title", table: catalogStringsTableName), systemImage: "globe")
        }
    }
}

private struct CatalogSortPicker: View {
    @Binding var sortOrder: CatalogSortOrder

    var body: some View {
        Picker(selection: self.$sortOrder) {
            ForEach(CatalogSortOrder.allCases, id: \.self) { sortOrder in
                Text(sortOrder.localizedTitle)
                    .tag(sortOrder)
            }
        } label: {
            Label(String(localized: "catalog.list.sort.title", table: catalogStringsTableName), systemImage: "arrow.up.arrow.down")
        }
    }
}

private struct CatalogDeckRow: View {
    let deck: CatalogBrowseIndexDeck

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            CatalogDeckCover(url: self.deck.coverImageUrl, size: catalogDeckRowCoverSize)

            VStack(alignment: .leading, spacing: 4) {
                Text(self.deck.title)
                    .font(.headline)
                Text(self.deck.summary)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                Text(String(localized: "catalog.list.card_count \(self.deck.cardCount)", table: catalogStringsTableName))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}

struct CatalogDeckCover: View {
    let url: URL?
    let size: CGFloat

    var body: some View {
        Group {
            if let url = self.url {
                AsyncImage(url: url) { phase in
                    if let image = phase.image {
                        image
                            .resizable()
                            .scaledToFill()
                    } else {
                        self.placeholder
                    }
                }
            } else {
                self.placeholder
            }
        }
        .frame(width: self.size, height: self.size)
        .clipShape(RoundedRectangle(cornerRadius: self.size / 5.6, style: .continuous))
        .accessibilityHidden(true)
    }

    private var placeholder: some View {
        ZStack {
            Rectangle()
                .fill(.quaternary)
            Image(systemName: "rectangle.stack")
                .foregroundStyle(.secondary)
        }
    }
}
