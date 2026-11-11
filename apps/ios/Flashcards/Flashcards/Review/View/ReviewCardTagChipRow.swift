import SwiftUI

private let reviewCardsStringsTableName: String = "ReviewCards"
private let reviewCardTagChipSpacing: CGFloat = 6

/// Captured when a chip is tapped, so the alert variant and wording stay fixed while it is open.
struct ReviewTagFilterRequest: Equatable {
    let tag: String
    let currentFilterTitle: String
    let isRequestedTagFilterSelected: Bool
}

/// A fixed tag button that opens Library Tags, then every chip on one horizontally scrolling line, so the card
/// header height stays stable.
struct ReviewCardTagChipRow: View {
    let tags: [String]
    /// Padding the tag button's hit area reaches into, so its glyph stays on the content edge and close to the chips.
    let leadingBleed: CGFloat
    /// Padding the chips scroll into past the card's trailing edge.
    let trailingBleed: CGFloat
    let onOpenTags: () -> Void
    let onSelectTag: (String) -> Void

    var body: some View {
        HStack(spacing: 0) {
            Button(action: self.onOpenTags) {
                Image(systemName: "tag")
                    .padding(.leading, self.leadingBleed)
                    .padding(.trailing, 8)
                    .frame(minWidth: appMinimumTouchTarget, alignment: .leading)
                    // The touch target reaches the minimum height above and below the line without making it taller.
                    .background {
                        Color.clear
                            .frame(height: appMinimumTouchTarget)
                            .contentShape(Rectangle())
                    }
            }
            .buttonStyle(.plain)
            .padding(.leading, -self.leadingBleed)
            .accessibilityLabel(LibrarySection.tags.localizedTitle)
            .accessibilityIdentifier(UITestIdentifier.reviewCardTagsButton)
            .help(LibrarySection.tags.localizedTitle)

            if self.tags.isEmpty {
                // A hidden chip holds the line at chip height, so the card sits where it does below a tagged card.
                ZStack(alignment: .leading) {
                    Button(localizedNoTagsLabel()) {}
                        .reviewCardTagChipStyle()
                        .hidden()
                        .accessibilityHidden(true)
                    Text(localizedNoTagsLabel())
                }
            } else {
                ScrollView(.horizontal) {
                    self.chips
                }
                #if targetEnvironment(macCatalyst)
                // A plain mouse wheel scrolls vertically, so the Mac keeps a draggable indicator.
                .scrollIndicators(.automatic)
                #else
                .scrollIndicators(.hidden)
                #endif
                .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
                .contentMargins(.trailing, self.trailingBleed, for: .scrollContent)
                .padding(.trailing, -self.trailingBleed)
            }
        }
    }

    private var chips: some View {
        HStack(spacing: reviewCardTagChipSpacing) {
            ForEach(self.tags, id: \.self) { tag in
                Button {
                    self.onSelectTag(tag)
                } label: {
                    Text(tag)
                }
                .accessibilityIdentifier(UITestIdentifier.reviewCardTagChipPrefix + tag)
                .reviewCardTagChipStyle()
                .accessibilityHint(
                    String(
                        localized: "review.tag_chip.accessibility_hint",
                        defaultValue: "Asks to review only cards with this tag.",
                        table: reviewCardsStringsTableName,
                        comment: "Accessibility hint for a tag chip on the Review card; tapping it asks before switching the review filter to that tag"
                    )
                )
            }
        }
    }
}

private extension View {
    func reviewCardTagChipStyle() -> some View {
        self
            .buttonStyle(.bordered)
            .buttonBorderShape(.capsule)
            #if !targetEnvironment(macCatalyst)
            .controlSize(.small)
            #endif
            .lineLimit(1)
    }
}
