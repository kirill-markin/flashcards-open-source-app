import MarkdownUI
import SwiftUI

enum ReviewCardSurfaceStyle {
    case front
    case back
}

@MainActor
private func makeReviewMarkdownTheme(surfaceStyle: ReviewCardSurfaceStyle) -> Theme {
    Theme.gitHub
        .text {
            ForegroundColor(reviewMarkdownTextColor(surfaceStyle: surfaceStyle))
            BackgroundColor(nil)
            FontSize(surfaceStyle == .front ? 18 : 17)
        }
        .code {
            FontFamilyVariant(.monospaced)
            FontSize(.em(0.88))
            ForegroundColor(reviewMarkdownInlineCodeTextColor(surfaceStyle: surfaceStyle))
            BackgroundColor(reviewMarkdownInlineCodeBackgroundColor(surfaceStyle: surfaceStyle))
        }
        .heading1 { configuration in
            configuration.label
                .relativeLineSpacing(.em(0.1))
                .markdownMargin(top: 0, bottom: 14)
                .markdownTextStyle {
                    FontWeight(.bold)
                    FontSize(.em(1.5))
                }
        }
        .heading2 { configuration in
            configuration.label
                .relativeLineSpacing(.em(0.1))
                .markdownMargin(top: 0, bottom: 14)
                .markdownTextStyle {
                    FontWeight(.bold)
                    FontSize(.em(1.3))
                }
        }
        .heading3 { configuration in
            configuration.label
                .relativeLineSpacing(.em(0.1))
                .markdownMargin(top: 0, bottom: 12)
                .markdownTextStyle {
                    FontWeight(.semibold)
                    FontSize(.em(1.15))
                }
        }
        .heading4 { configuration in
            configuration.label
                .markdownMargin(top: 0, bottom: 12)
                .markdownTextStyle {
                    FontWeight(.semibold)
                }
        }
        .heading5 { configuration in
            configuration.label
                .markdownMargin(top: 0, bottom: 10)
                .markdownTextStyle {
                    FontWeight(.semibold)
                    FontSize(.em(0.95))
                }
        }
        .heading6 { configuration in
            configuration.label
                .markdownMargin(top: 0, bottom: 10)
                .markdownTextStyle {
                    FontWeight(.semibold)
                    FontSize(.em(0.9))
                    ForegroundColor(reviewMarkdownSecondaryTextColor(surfaceStyle: surfaceStyle))
                }
        }
        .paragraph { configuration in
            configuration.label
                .fixedSize(horizontal: false, vertical: true)
                .relativeLineSpacing(.em(0.2))
                .markdownMargin(top: 0, bottom: 14)
        }
        .blockquote { configuration in
            HStack(alignment: .top, spacing: 12) {
                RoundedRectangle(cornerRadius: 6)
                    .fill(reviewMarkdownBorderColor(surfaceStyle: surfaceStyle))
                    .frame(width: 4)

                configuration.label
                    .fixedSize(horizontal: false, vertical: true)
                    .markdownTextStyle {
                        ForegroundColor(reviewMarkdownSecondaryTextColor(surfaceStyle: surfaceStyle))
                    }
            }
            .padding(.vertical, 2)
        }
        .codeBlock { configuration in
            ScrollView(.horizontal, showsIndicators: false) {
                configuration.label
                    .fixedSize(horizontal: false, vertical: true)
                    .relativeLineSpacing(.em(0.2))
                    .markdownTextStyle {
                        FontFamilyVariant(.monospaced)
                        FontSize(.em(0.88))
                        ForegroundColor(reviewMarkdownTextColor(surfaceStyle: surfaceStyle))
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
            }
            .background(reviewMarkdownCodeBlockBackgroundColor(surfaceStyle: surfaceStyle))
            .overlay {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(reviewMarkdownBorderColor(surfaceStyle: surfaceStyle), lineWidth: 1)
            }
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .markdownMargin(top: 0, bottom: 14)
        }
        .listItem { configuration in
            configuration.label
                .fixedSize(horizontal: false, vertical: true)
                .markdownMargin(top: .em(0.22))
        }
        .table { configuration in
            configuration.label
                .fixedSize(horizontal: false, vertical: true)
                .markdownTableBorderStyle(.init(color: reviewMarkdownBorderColor(surfaceStyle: surfaceStyle)))
                .markdownTableBackgroundStyle(
                    .alternatingRows(
                        reviewMarkdownTablePrimaryBackgroundColor(surfaceStyle: surfaceStyle),
                        reviewMarkdownTableSecondaryBackgroundColor(surfaceStyle: surfaceStyle)
                    )
                )
                .markdownMargin(top: 0, bottom: 14)
        }
        .tableCell { configuration in
            configuration.label
                .markdownTextStyle {
                    if configuration.row == 0 {
                        FontWeight(.semibold)
                    }

                    BackgroundColor(nil)
                }
                .fixedSize(horizontal: false, vertical: true)
                .padding(.vertical, 6)
                .padding(.horizontal, 10)
                .relativeLineSpacing(.em(0.2))
        }
        .thematicBreak {
            Divider()
                .overlay(reviewMarkdownBorderColor(surfaceStyle: surfaceStyle))
                .markdownMargin(top: 16, bottom: 16)
        }
}

private func reviewMarkdownTextColor(surfaceStyle: ReviewCardSurfaceStyle) -> Color {
    switch surfaceStyle {
    case .front:
        return Color.primary
    case .back:
        return Color(uiColor: .label)
    }
}

private func reviewMarkdownSecondaryTextColor(surfaceStyle: ReviewCardSurfaceStyle) -> Color {
    switch surfaceStyle {
    case .front:
        return Color.secondary
    case .back:
        return Color(uiColor: .secondaryLabel)
    }
}

private func reviewMarkdownInlineCodeTextColor(surfaceStyle: ReviewCardSurfaceStyle) -> Color {
    switch surfaceStyle {
    case .front:
        return Color.primary
    case .back:
        return Color(uiColor: .label)
    }
}

private func reviewMarkdownInlineCodeBackgroundColor(surfaceStyle: ReviewCardSurfaceStyle) -> Color {
    switch surfaceStyle {
    case .front:
        return Color.white.opacity(0.4)
    case .back:
        return Color(uiColor: .systemBackground)
    }
}

private func reviewMarkdownCodeBlockBackgroundColor(surfaceStyle: ReviewCardSurfaceStyle) -> Color {
    switch surfaceStyle {
    case .front:
        return Color.white.opacity(0.3)
    case .back:
        return Color(uiColor: .systemBackground)
    }
}

private func reviewMarkdownTablePrimaryBackgroundColor(surfaceStyle: ReviewCardSurfaceStyle) -> Color {
    switch surfaceStyle {
    case .front:
        return Color.clear
    case .back:
        return Color.primary.opacity(0.06)
    }
}

private func reviewMarkdownTableSecondaryBackgroundColor(surfaceStyle: ReviewCardSurfaceStyle) -> Color {
    switch surfaceStyle {
    case .front:
        return Color.white.opacity(0.22)
    case .back:
        return Color.primary.opacity(0.03)
    }
}

private func reviewMarkdownBorderColor(surfaceStyle: ReviewCardSurfaceStyle) -> Color {
    switch surfaceStyle {
    case .front:
        return Color.white.opacity(0.35)
    case .back:
        return Color(uiColor: .separator)
    }
}

struct ReviewMarkdownText: View {
    let markdownContent: MarkdownContent
    let surfaceStyle: ReviewCardSurfaceStyle

    var body: some View {
        Markdown(markdownContent)
            .markdownTheme(makeReviewMarkdownTheme(surfaceStyle: surfaceStyle))
            .frame(maxWidth: .infinity, alignment: .topLeading)
    }
}
