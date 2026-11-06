import SwiftUI

private let catalogStringsTableName: String = "Foundation"
private let catalogDeckCoverSize: CGFloat = 56

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

    private var decks: [CatalogBrowseIndexDeck] {
        self.catalog.index?.decks ?? []
    }

    private var languageCodes: Set<String> {
        catalogLanguageCodes(decks: self.decks)
    }

    private var languageFilter: Binding<CatalogLanguageFilter> {
        Binding(
            get: {
                self.languageChoice ?? defaultCatalogLanguageFilter(
                    languageCodes: self.languageCodes,
                    appLocaleIdentifier: currentAppUILocaleIdentifier()
                )
            },
            set: { self.languageChoice = $0 }
        )
    }

    private var visibleDecks: [CatalogBrowseIndexDeck] {
        catalogDecksMatching(
            decks: self.decks,
            languageFilter: self.languageFilter.wrappedValue,
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
        List {
            if self.catalog.index == nil {
                self.indexUnavailableContent
            } else {
                self.indexContent
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
        .onAppear {
            self.catalog.loadCachedIndexIfNeeded()
        }
        .task {
            await self.revalidateIfStale()
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
    private var indexContent: some View {
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
            if self.decks.isEmpty {
                ContentUnavailableView(
                    String(localized: "catalog.list.empty.title", table: catalogStringsTableName),
                    systemImage: "books.vertical"
                )
            } else if self.visibleDecks.isEmpty {
                ContentUnavailableView(
                    String(localized: "catalog.list.no_matches.title", table: catalogStringsTableName),
                    systemImage: "magnifyingglass",
                    description: Text(String(localized: "catalog.list.no_matches.description", table: catalogStringsTableName))
                )
            } else {
                ForEach(self.visibleDecks) { deck in
                    CatalogDeckRow(deck: deck)
                }
            }
        }
    }

    @ViewBuilder
    private var optionPickers: some View {
        CatalogLanguagePicker(
            languageFilter: self.languageFilter,
            languageCodes: sortedCatalogLanguageCodes(codes: self.languageCodes, locale: self.locale),
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

private struct CatalogLanguagePicker: View {
    @Binding var languageFilter: CatalogLanguageFilter
    let languageCodes: [String]
    let locale: Locale

    var body: some View {
        Picker(selection: self.$languageFilter) {
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
            CatalogDeckCover(url: self.deck.coverImageUrl)

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

private struct CatalogDeckCover: View {
    let url: URL?

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
        .frame(width: catalogDeckCoverSize, height: catalogDeckCoverSize)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
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
