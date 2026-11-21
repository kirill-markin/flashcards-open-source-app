import SwiftUI
import UIKit

private let catalogStringsTableName: String = "Foundation"
private let catalogDeckPageCoverSize: CGFloat = 96

private enum CatalogDeckPreviewState {
    case loading
    case loaded(CatalogDeckPreview)
    case failed(message: String)
}

/// A public deck's page: the index fields at once, then its description and first cards.
/// "Study this deck" installs it into the current workspace and opens Review on its root tag.
struct CatalogDeckScreen: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @Environment(CatalogIndexStore.self) private var catalog: CatalogIndexStore
    @Environment(AppNavigationModel.self) private var navigation: AppNavigationModel
    @Environment(\.locale) private var locale
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.dismiss) private var dismiss

    let deck: CatalogBrowseIndexDeck

    @State private var previewState: CatalogDeckPreviewState = .loading
    @State private var isStudying: Bool = false
    @State private var studyErrorMessage: String? = nil
    @State private var isUnavailableAlertPresented: Bool = false
    @State private var horizontalContentMargin: CGFloat? = nil

    var body: some View {
        List {
            Section {
                self.header
            }

            Section {
                self.studyButton
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 8, leading: 0, bottom: 8, trailing: 0))
            }

            if let studyErrorMessage = self.studyErrorMessage {
                Section {
                    Label(
                        String(localized: "catalog.deck.study_failed", table: catalogStringsTableName),
                        systemImage: "exclamationmark.triangle"
                    )
                    .foregroundStyle(.secondary)
                    CopyableErrorMessageView(message: studyErrorMessage)
                        .font(.footnote)
                }
            }

            self.previewSections
        }
        .listStyle(.insetGrouped)
        .listSectionSpacing(.compact)
        .contentMargins(.horizontal, self.horizontalContentMargin, for: .scrollContent)
        .onGeometryChange(for: CGFloat?.self) { geometry in
            let margin = (geometry.size.width - flashcardsReadableContentMaxWidth) / 2
            return margin > 0 ? margin : nil
        } action: { margin in
            self.horizontalContentMargin = margin
        }
        .accessibilityIdentifier(UITestIdentifier.catalogDeckScreen)
        .nativeNavigationTitle(self.deck.title)
        #if targetEnvironment(macCatalyst)
        .macToolbarContribution(MacToolbarContribution(tab: .library, role: .navigation))
        #else
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            AICompanionToolbarItem()
        }
        #endif
        .task(id: self.deck.packageVersionId) {
            await self.loadPreview()
        }
        .alert(
            String(localized: "catalog.deck.unavailable.title", table: catalogStringsTableName),
            isPresented: self.$isUnavailableAlertPresented
        ) {
            Button(aiSettingsLocalized("common.ok", "OK"), role: .cancel) {
                self.dismiss()
            }
        }
    }

    private var header: some View {
        let titleLayout = self.dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 16))
            : AnyLayout(HStackLayout(alignment: .top, spacing: 16))
        return VStack(alignment: .leading, spacing: 10) {
            titleLayout {
                CatalogDeckCover(url: self.deck.coverImageUrl, size: catalogDeckPageCoverSize)

                Text(self.deck.title)
                    .font(.title3.weight(.semibold))
            }

            VStack(alignment: .leading, spacing: 6) {
                Text(self.deck.summary)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Text(self.metadataLine)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }

    private var metadataLine: String {
        let languages = self.deck.languageTags
            .map { tag in catalogBaseLanguageCode(languageIdentifier: tag) }
            .reduce(into: [String]()) { codes, code in
                if codes.contains(code) == false {
                    codes.append(code)
                }
            }
            .map { code in catalogLanguageDisplayName(code: code, locale: self.locale) }
        return ([
            String(localized: "catalog.list.card_count \(self.deck.cardCount)", table: catalogStringsTableName),
            String(localized: "catalog.deck.author \(self.deck.authorDisplayName)", table: catalogStringsTableName),
        ] + languages).joined(separator: " · ")
    }

    private var studyButton: some View {
        Button {
            self.study()
        } label: {
            HStack(spacing: 8) {
                if self.isStudying {
                    ProgressView()
                        .tint(.white)
                }
                Text(String(localized: "catalog.deck.study", table: catalogStringsTableName))
                    .font(.headline)
            }
            .frame(maxWidth: .infinity, minHeight: appMinimumTouchTarget)
        }
        .buttonStyle(.borderedProminent)
        // Not disabled while busy: the dimmed disabled fill hides the spinner, and study() ignores repeat taps.
        .accessibilityValue(
            self.isStudying ? String(localized: "catalog.deck.study_in_progress", table: catalogStringsTableName) : ""
        )
        .accessibilityIdentifier(UITestIdentifier.catalogDeckStudyButton)
    }

    @ViewBuilder
    private var previewSections: some View {
        switch self.previewState {
        case .loading:
            Section {
                HStack(spacing: 12) {
                    ProgressView()
                    Text(String(localized: "catalog.deck.loading", table: catalogStringsTableName))
                        .foregroundStyle(.secondary)
                }
            }
        case .failed(let message):
            Section {
                Label(
                    String(localized: "catalog.deck.load_failed", table: catalogStringsTableName),
                    systemImage: "exclamationmark.triangle"
                )
                .foregroundStyle(.secondary)
                CopyableErrorMessageView(message: message)
                    .font(.footnote)
                Button(String(localized: "catalog.list.retry", table: catalogStringsTableName)) {
                    Task {
                        await self.loadPreview()
                    }
                }
            }
        case .loaded(let preview):
            let description = preview.package.description.trimmingCharacters(in: .whitespacesAndNewlines)
            if description.isEmpty == false {
                Section(String(localized: "catalog.deck.about", table: catalogStringsTableName)) {
                    CatalogDeckMarkdownText(
                        text: catalogPreviewMarkdown(text: description, mediaAssets: preview.package.mediaAssets),
                        textStyle: .body,
                        surfaceStyle: .back,
                        textColor: .label
                    )
                }
            }

            if preview.cards.isEmpty == false {
                Section(String(localized: "catalog.deck.first_cards", table: catalogStringsTableName)) {
                    ForEach(preview.cards, id: \.ordinal) { card in
                        VStack(alignment: .leading, spacing: 8) {
                            CatalogDeckMarkdownText(
                                text: catalogPreviewMarkdown(text: card.frontText, mediaAssets: preview.package.mediaAssets),
                                textStyle: .headline,
                                surfaceStyle: .front,
                                textColor: .label
                            )
                            CatalogDeckMarkdownText(
                                text: catalogPreviewMarkdown(text: card.backText, mediaAssets: preview.package.mediaAssets),
                                textStyle: .subheadline,
                                surfaceStyle: .back,
                                textColor: .secondaryLabel
                            )
                        }
                        .padding(.vertical, 4)
                    }
                }
            }
        }
    }

    private func loadPreview() async {
        guard let apiBaseUrl = self.apiBaseUrl() else {
            return
        }

        if case .loaded = self.previewState {
            return
        }
        self.previewState = .loading
        do {
            self.previewState = .loaded(try await self.catalog.loadDeckPreview(apiBaseUrl: apiBaseUrl, deck: self.deck))
        } catch {
            if isRequestCancellationError(error: error) {
                return
            }
            if isCatalogDeckUnavailableError(error: error) {
                self.handleUnavailableDeck(apiBaseUrl: apiBaseUrl)
                return
            }
            self.previewState = .failed(message: errorMessage(error: error))
        }
    }

    private func study() {
        guard self.isStudying == false, let apiBaseUrl = self.apiBaseUrl() else {
            return
        }

        self.isStudying = true
        self.studyErrorMessage = nil
        Task { @MainActor in
            defer {
                self.isStudying = false
            }

            do {
                try await self.store.installCatalogDeckIntoCurrentWorkspace(packageVersionId: self.deck.packageVersionId)
                self.store.selectReviewFilter(reviewFilter: makeReviewTagsFilter(tags: [self.deck.reviewTag]))
                self.navigation.selectTab(.review)
            } catch {
                if isRequestCancellationError(error: error) {
                    return
                }
                if case CatalogDeckInstallError.deckUnavailable = error {
                    self.handleUnavailableDeck(apiBaseUrl: apiBaseUrl)
                    return
                }
                self.studyErrorMessage = errorMessage(error: error)
            }
        }
    }

    private func handleUnavailableDeck(apiBaseUrl: String) {
        self.isUnavailableAlertPresented = true
        Task { @MainActor in
            await self.catalog.revalidate(apiBaseUrl: apiBaseUrl)
        }
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

/// Catalog text through the card content renderer, at a list-row text style.
private struct CatalogDeckMarkdownText: View {
    let text: String
    let textStyle: UIFont.TextStyle
    let surfaceStyle: ReviewCardSurfaceStyle
    let textColor: UIColor

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        let traits = UITraitCollection(preferredContentSizeCategory: UIContentSizeCategory(self.dynamicTypeSize))
        ReviewSelectableTextView(
            sourceText: self.text,
            content: makeReviewProseRenderedContent(text: self.text),
            surfaceStyle: self.surfaceStyle,
            textFont: UIFont.preferredFont(forTextStyle: self.textStyle, compatibleWith: traits),
            textColor: self.textColor,
            isSelectable: true
        )
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
