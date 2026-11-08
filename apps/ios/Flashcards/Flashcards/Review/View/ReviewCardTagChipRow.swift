import SwiftUI

private let reviewCardsStringsTableName: String = "ReviewCards"
private let reviewCardTagChipSpacing: CGFloat = 6

/// Captured when a chip is tapped, so the alert variant and wording stay fixed while it is open.
struct ReviewTagFilterRequest: Equatable {
    let tag: String
    let currentFilterTitle: String
    let isRequestedTagFilterSelected: Bool
}

/// Whole chips on a single line so the card header height stays stable; tags that do not fit move into a
/// trailing "+N" menu instead of being clipped.
struct ReviewCardTagChipRow: View {
    let tags: [String]
    let onSelectTag: (String) -> Void

    var body: some View {
        if self.tags.isEmpty {
            Label(localizedNoTagsLabel(), systemImage: "tag")
        } else {
            // A plain HStack instead of Label, so VoiceOver reaches each chip as its own button rather than
            // one merged title; the default spacing and inherited font and color keep the Label look.
            HStack {
                Image(systemName: "tag")
                    .accessibilityHidden(true)
                // ViewThatFits shows the first candidate that fits: every chip, then one chip fewer plus the
                // overflow menu at a time, down to the overflow menu alone.
                ViewThatFits(in: .horizontal) {
                    ForEach(Array(stride(from: self.tags.count, through: 0, by: -1)), id: \.self) { visibleTagCount in
                        self.chips(visibleTagCount: visibleTagCount)
                    }
                }
            }
        }
    }

    private func chips(visibleTagCount: Int) -> some View {
        HStack(spacing: reviewCardTagChipSpacing) {
            ForEach(self.tags.prefix(visibleTagCount), id: \.self) { tag in
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

            if visibleTagCount < self.tags.count {
                self.overflowMenu(hiddenTags: Array(self.tags.dropFirst(visibleTagCount)))
            }
        }
    }

    private func overflowMenu(hiddenTags: [String]) -> some View {
        let hiddenTagCount = hiddenTags.count
        return Menu {
            ForEach(hiddenTags, id: \.self) { tag in
                Button(tag) {
                    self.onSelectTag(tag)
                }
            }
        } label: {
            Text(
                String(
                    localized: "review.tag_chip.overflow_label",
                    defaultValue: "+\(hiddenTagCount)",
                    table: reviewCardsStringsTableName,
                    comment: "Review card chip that opens a menu with the tags that do not fit on the chip row"
                )
            )
        }
        .menuStyle(.button)
        .menuIndicator(.hidden)
        .reviewCardTagChipStyle()
        .accessibilityLabel(
            String(
                localized: "More tags: \(hiddenTagCount)",
                table: reviewCardsStringsTableName,
                comment: "Accessibility label for the Review card chip that opens a menu with the tags that do not fit on the chip row"
            )
        )
        .accessibilityIdentifier(UITestIdentifier.reviewCardTagOverflowMenu)
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
