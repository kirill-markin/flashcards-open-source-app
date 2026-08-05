import SwiftUI

private let reviewFilterPopoverWidth: CGFloat = 320
private let reviewFilterPopoverHeight: CGFloat = 420
private let reviewFilterSelectionColumnWidth: CGFloat = 20
private let reviewFilterRowHorizontalPadding: CGFloat = 16
private let reviewFilterRowVerticalPadding: CGFloat = 11
private let reviewFilterRowSpacing: CGFloat = 12

struct ReviewFilterPopover: View {
    @Binding var reviewFilter: ReviewFilter
    let deckSummaries: [DeckSummary]
    let tagSummaries: [WorkspaceTagSummary]
    let onEditDecks: () -> Void

    @State private var scrollPosition: ScrollPosition = ScrollPosition(idType: String.self)

    private var storedTagNames: [String] {
        self.tagSummaries.map(\.tag)
    }

    private var selectedTagKeys: Set<String> {
        let selectedTags: [String]
        switch self.reviewFilter {
        case .allCards:
            selectedTags = self.storedTagNames
        case .deck(let deckId):
            selectedTags = self.deckSummaries.first(where: { deckSummary in
                deckSummary.deckId == deckId
            }).map { deckSummary in
                selectedReviewDeckTagNames(
                    deckFilterTagNames: deckSummary.filterDefinition.tags,
                    storedTagNames: self.storedTagNames
                )
            } ?? []
        case .tags(let tags):
            selectedTags = resolveExactStoredTagNames(
                requestedTagNames: tags,
                storedTagNames: self.storedTagNames
            )
        }

        return Set(selectedTags.map(normalizeTagKey))
    }

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                self.allCardsButton
                    .id("all-cards")

                ForEach(self.deckSummaries, id: \.deckId) { deckSummary in
                    self.deckButton(deckSummary: deckSummary)
                        .id("deck:\(deckSummary.deckId)")
                }

                self.editDecksButton
                    .id("edit-decks")

                Divider()
                    .padding(.vertical, 4)

                ForEach(self.tagSummaries, id: \.tag) { tagSummary in
                    self.tagButton(tagSummary: tagSummary)
                        .id("tag:\(normalizeTagKey(tag: tagSummary.tag))")
                }
            }
            .scrollTargetLayout()
        }
        .scrollPosition(self.$scrollPosition)
        .accessibilityIdentifier(UITestIdentifier.reviewFilterScrollSurface)
        .frame(width: reviewFilterPopoverWidth, height: reviewFilterPopoverHeight)
    }

    private var allCardsButton: some View {
        let isSelected = self.reviewFilter == .allCards
        return self.selectionButton(
            title: localizedAllCardsLabel(),
            isSelected: isSelected,
            accessibilityIdentifier: UITestIdentifier.reviewFilterAllCardsAction,
            action: {
                self.reviewFilter = isSelected
                    ? makeReviewTagsFilter(tags: [])
                    : .allCards
            }
        )
    }

    private func deckButton(deckSummary: DeckSummary) -> some View {
        let deckFilter = ReviewFilter.deck(deckId: deckSummary.deckId)
        return self.selectionButton(
            title: deckSummary.name,
            isSelected: self.reviewFilter == deckFilter,
            accessibilityIdentifier: UITestIdentifier.reviewFilterDeckActionPrefix + deckSummary.deckId,
            action: {
                self.reviewFilter = deckFilter
            }
        )
    }

    private var editDecksButton: some View {
        Button(action: self.onEditDecks) {
            HStack(spacing: reviewFilterRowSpacing) {
                Image(systemName: "square.stack.3d.up")
                    .frame(width: reviewFilterSelectionColumnWidth)
                Text(String(localized: "Edit decks", table: "ReviewCards"))
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, reviewFilterRowHorizontalPadding)
            .padding(.vertical, reviewFilterRowVerticalPadding)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func tagButton(tagSummary: WorkspaceTagSummary) -> some View {
        let tagKey = normalizeTagKey(tag: tagSummary.tag)
        return self.selectionButton(
            title: "\(tagSummary.tag) (\(tagSummary.cardsCount.formatted()))",
            isSelected: self.selectedTagKeys.contains(tagKey),
            accessibilityIdentifier: UITestIdentifier.reviewFilterTagTogglePrefix + tagSummary.tag,
            action: {
                self.toggleTag(tag: tagSummary.tag)
            }
        )
    }

    private func selectionButton(
        title: String,
        isSelected: Bool,
        accessibilityIdentifier: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: reviewFilterRowSpacing) {
                // Always rendered so the row height does not depend on selection.
                Image(systemName: "checkmark")
                    .font(.body.weight(.semibold))
                    .opacity(isSelected ? 1 : 0)
                    .frame(width: reviewFilterSelectionColumnWidth)

                Text(title)
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, reviewFilterRowHorizontalPadding)
            .padding(.vertical, reviewFilterRowVerticalPadding)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
        .accessibilityValue(isSelected ? "1" : "0")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .accessibilityIdentifier(accessibilityIdentifier)
    }

    private func toggleTag(tag: String) {
        let tagFilter: ReviewFilter
        switch self.reviewFilter {
        case .deck(let deckId):
            let deckTags = self.deckSummaries.first(where: { deckSummary in
                deckSummary.deckId == deckId
            })?.filterDefinition.tags ?? []
            tagFilter = makeReviewTagsFilter(
                tags: selectedReviewDeckTagNames(
                    deckFilterTagNames: deckTags,
                    storedTagNames: self.storedTagNames
                )
            )
        case .allCards, .tags:
            tagFilter = self.reviewFilter
        }

        self.reviewFilter = reviewFilterByTogglingTag(
            reviewFilter: tagFilter,
            tag: tag,
            decks: [],
            storedTagNames: self.storedTagNames
        )
    }
}
