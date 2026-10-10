import SwiftUI

private let reviewCardsStringsTableName: String = "ReviewCards"
private let reviewCardTagChipSpacing: CGFloat = 6

/// Captured when a chip is tapped, so the alert variant and wording stay fixed while it is open.
struct ReviewTagFilterRequest: Equatable {
    let tag: String
    let currentFilterTitle: String
    let isRequestedTagFilterSelected: Bool
}

/// One chip per tag on a single line; the chips scroll horizontally instead of growing the card header.
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
                ViewThatFits(in: .horizontal) {
                    self.chips
                    ScrollView(.horizontal, showsIndicators: false) {
                        self.chips
                    }
                }
            }
        }
    }

    private var chips: some View {
        HStack(spacing: reviewCardTagChipSpacing) {
            ForEach(self.tags, id: \.self) { tag in
                Button(tag) {
                    self.onSelectTag(tag)
                }
                .accessibilityIdentifier(UITestIdentifier.reviewCardTagChipPrefix + tag)
                .buttonStyle(.bordered)
                .buttonBorderShape(.capsule)
                .controlSize(.small)
                .lineLimit(1)
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
