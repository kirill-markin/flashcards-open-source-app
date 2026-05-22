import SwiftUI

private let reviewCardsStringsTableName: String = "ReviewCards"

struct ReviewCardSideView: View {
    let label: String
    let content: ReviewRenderedContent
    let isSpeechPlaying: Bool
    let onToggleSpeech: () -> Void
    let showsSpeechButton: Bool
    let showsAiButton: Bool
    let onOpenAi: () -> Void
    let surfaceStyle: ReviewCardSurfaceStyle

    init(
        label: String,
        content: ReviewRenderedContent,
        isSpeechPlaying: Bool,
        onToggleSpeech: @escaping () -> Void,
        showsSpeechButton: Bool,
        showsAiButton: Bool,
        onOpenAi: @escaping () -> Void,
        surfaceStyle: ReviewCardSurfaceStyle
    ) {
        self.label = label
        self.content = content
        self.isSpeechPlaying = isSpeechPlaying
        self.onToggleSpeech = onToggleSpeech
        self.showsSpeechButton = showsSpeechButton
        self.showsAiButton = showsAiButton
        self.onOpenAi = onOpenAi
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

            if self.showsSpeechButton || self.showsAiButton {
                HStack(spacing: 8) {
                    Spacer(minLength: 0)

                    if self.showsSpeechButton {
                        Button(action: self.onToggleSpeech) {
                            Image(systemName: self.isSpeechPlaying ? "speaker.wave.2.fill" : "speaker.wave.2")
                                .font(.callout.weight(.semibold))
                                .foregroundStyle(.secondary)
                                .frame(width: 32, height: 32)
                                .background(.thinMaterial, in: Circle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(
                            self.isSpeechPlaying
                                ? String(
                                    format: String(localized: "Stop %@ speech", table: reviewCardsStringsTableName),
                                    locale: Locale.current,
                                    self.label
                                )
                                : String(
                                    format: String(localized: "Speak %@", table: reviewCardsStringsTableName),
                                    locale: Locale.current,
                                    self.label
                                )
                        )
                    }

                    if self.showsAiButton {
                        Button(action: self.onOpenAi) {
                            Text(String(localized: "AI", table: reviewCardsStringsTableName))
                                .font(.caption2.weight(.bold))
                                .foregroundStyle(.white)
                                .frame(height: 32)
                                .padding(.horizontal, 11)
                                .background(Color.accentColor, in: Capsule())
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier(UITestIdentifier.reviewAiButton)
                        .accessibilityLabel(String(localized: "Open card in AI chat", table: reviewCardsStringsTableName))
                    }
                }
            }
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
