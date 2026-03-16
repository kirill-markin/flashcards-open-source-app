import SwiftUI

struct ReviewCardSideView: View {
    let label: String
    let content: ReviewRenderedContent
    let surfaceStyle: ReviewCardSurfaceStyle

    init(label: String, content: ReviewRenderedContent, surfaceStyle: ReviewCardSurfaceStyle) {
        self.label = label
        self.content = content
        self.surfaceStyle = surfaceStyle
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(label)
                .font(.caption)
                .textCase(.uppercase)
                .foregroundStyle(.secondary)

            contentView
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(24)
        .background(backgroundStyle, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    @ViewBuilder
    private var contentView: some View {
        switch content {
        case .shortPlain(let text):
            Text(text)
                .font(shortPlainFont)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity, alignment: .center)
        case .paragraphPlain(let text):
            Text(text)
                .font(.body)
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .topLeading)
        case .markdown(let markdownContent):
            ReviewMarkdownText(
                markdownContent: markdownContent,
                surfaceStyle: surfaceStyle
            )
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
    }

    private var shortPlainFont: Font {
        switch surfaceStyle {
        case .front:
            return .title2.weight(.semibold)
        case .back:
            return .title3.weight(.medium)
        }
    }

    private var backgroundStyle: AnyShapeStyle {
        switch surfaceStyle {
        case .front:
            return AnyShapeStyle(.thinMaterial)
        case .back:
            return AnyShapeStyle(.regularMaterial)
        }
    }
}
