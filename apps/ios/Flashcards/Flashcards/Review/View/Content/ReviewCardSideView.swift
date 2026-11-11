import SwiftUI
import UIKit

private let reviewCardsStringsTableName: String = "ReviewCards"
let reviewContentSurfaceCornerRadius: CGFloat = 24
private let reviewCardSideCopiedFeedbackDuration: Duration = .seconds(3)

/// A keyboard request to copy one card side; every request has a new id, so repeating it copies again.
struct ReviewCardSideCopyRequest: Equatable {
    let id: UUID
    let side: ReviewCardSurfaceStyle
}

struct ReviewCardSideView: View {
    let label: String
    let content: ReviewRenderedContent
    let sourceText: String
    let onSelectText: () -> Void
    let isSpeechPlaying: Bool
    let onToggleSpeech: () -> Void
    let showsSpeechButton: Bool
    let showsAiButton: Bool
    let aiButtonAccentColor: AccountAccentColor
    let onOpenAi: () -> Void
    let surfaceStyle: ReviewCardSurfaceStyle
    /// Only the side the R and C keys act on shows their hints.
    let showsShortcutHints: Bool
    let copyRequest: ReviewCardSideCopyRequest?

    @State private var hasCopied: Bool = false
    /// Restarts the copied-feedback reset task on every successful copy.
    @State private var successfulCopyCount: Int = 0
    @State private var copyError: String?

    init(
        label: String,
        content: ReviewRenderedContent,
        sourceText: String,
        onSelectText: @escaping () -> Void,
        isSpeechPlaying: Bool,
        onToggleSpeech: @escaping () -> Void,
        showsSpeechButton: Bool,
        showsAiButton: Bool,
        aiButtonAccentColor: AccountAccentColor,
        onOpenAi: @escaping () -> Void,
        surfaceStyle: ReviewCardSurfaceStyle,
        showsShortcutHints: Bool,
        copyRequest: ReviewCardSideCopyRequest?
    ) {
        self.label = label
        self.content = content
        self.sourceText = sourceText
        self.onSelectText = onSelectText
        self.isSpeechPlaying = isSpeechPlaying
        self.onToggleSpeech = onToggleSpeech
        self.showsSpeechButton = showsSpeechButton
        self.showsAiButton = showsAiButton
        self.aiButtonAccentColor = aiButtonAccentColor
        self.onOpenAi = onOpenAi
        self.surfaceStyle = surfaceStyle
        self.showsShortcutHints = showsShortcutHints
        self.copyRequest = copyRequest
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Button(action: self.onSelectText) {
                Text(self.label)
                    .font(.caption)
                    .textCase(.uppercase)
                    .foregroundStyle(.secondary)
                    #if targetEnvironment(macCatalyst)
                    .frame(minWidth: appMinimumTouchTarget, minHeight: appMinimumTouchTarget, alignment: .leading)
                    #endif
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier(self.surfaceStyle == .front
                ? UITestIdentifier.reviewFrontTextSelectionButton
                : UITestIdentifier.reviewBackTextSelectionButton)
            .accessibilityLabel(
                Text(self.label) + Text(", ") + Text(String(
                    localized: "review.text_selection.action",
                    defaultValue: "Select text",
                    table: reviewCardsStringsTableName,
                    comment: "Accessibility action appended to the Front or Back card caption button"
                ))
            )
            .accessibilityHint(String(
                localized: "review.text_selection.hint",
                defaultValue: "Opens the complete text for selection and copying.",
                table: reviewCardsStringsTableName,
                comment: "Accessibility hint for opening a card side in the native text selection sheet"
            ))

            ReviewSelectableTextView(sourceText: self.sourceText, content: self.content, surfaceStyle: self.surfaceStyle)
                .accessibilityIdentifier(self.surfaceStyle == .front
                    ? UITestIdentifier.reviewFrontSelectableText : UITestIdentifier.reviewBackSelectableText)
                .frame(maxWidth: .infinity, alignment: .leading)

            HStack(spacing: 8) {
                Spacer(minLength: 0)

                let copyButton = Button(action: self.copySide) {
                    Image(systemName: self.hasCopied ? "checkmark" : "square.on.square")
                        .font(.callout.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .padding(6)
                        .frame(minWidth: 32, minHeight: 32)
                        .background(.thinMaterial, in: Capsule())
                        .frame(minWidth: appMinimumTouchTarget, minHeight: appMinimumTouchTarget)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier(self.surfaceStyle == .front
                    ? UITestIdentifier.reviewFrontCopyButton : UITestIdentifier.reviewBackCopyButton)
                .accessibilityLabel(Text(self.copyActionLabel) + Text(", ") + Text(self.label))
                // The shortcut hint replaces the copy help, so the Mac never shows two tooltips.
                if self.showsShortcutHints {
                    copyButton.reviewCardSideShortcutHint(key: "C")
                } else {
                    copyButton.help(self.copyActionLabel)
                }

                if self.showsSpeechButton {
                    let speechButton = Button(action: self.onToggleSpeech) {
                        Image(systemName: self.isSpeechPlaying ? "speaker.wave.2.fill" : "speaker.wave.2")
                            .font(.callout.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .padding(6)
                            .frame(minWidth: 32, minHeight: 32)
                            .background(.thinMaterial, in: Capsule())
                            .frame(minWidth: appMinimumTouchTarget, minHeight: appMinimumTouchTarget)
                            .contentShape(Rectangle())
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
                    if self.showsShortcutHints {
                        speechButton.reviewCardSideShortcutHint(key: "R")
                    } else {
                        speechButton
                    }
                }

                if self.showsAiButton {
                    Button(action: self.onOpenAi) {
                        Text(String(localized: "AI", table: reviewCardsStringsTableName))
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(self.aiButtonAccentColor.contrastingForegroundColor)
                            .padding(.vertical, 6)
                            .padding(.horizontal, 11)
                            .frame(minHeight: 32)
                            .background(self.aiButtonAccentColor.color, in: Capsule())
                            .frame(minWidth: appMinimumTouchTarget, minHeight: appMinimumTouchTarget)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier(UITestIdentifier.reviewAiButton)
                    .accessibilityLabel(String(localized: "Open card in AI chat", table: reviewCardsStringsTableName))
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(24)
        .onChange(of: self.sourceText) {
            self.hasCopied = false
        }
        .onChange(of: self.copyRequest) { _, request in
            if request?.side == self.surfaceStyle {
                self.copySide()
            }
        }
        .task(id: self.successfulCopyCount) {
            await self.resetCopiedFeedbackAfterDelay()
        }
        .background(backgroundStyle, in: RoundedRectangle(cornerRadius: reviewContentSurfaceCornerRadius, style: .continuous))
        .alert(
            String(localized: "Copy", table: reviewCardsStringsTableName),
            isPresented: Binding(
                get: { self.copyError != nil },
                set: { if $0 == false { self.copyError = nil } }
            )
        ) {
            Button(String(localized: "OK", table: reviewCardsStringsTableName), role: .cancel) {
                self.copyError = nil
            }
        } message: {
            Text(self.copyError ?? "")
        }
        .reviewKeyboardBlockingPresentation(isPresented: self.copyError != nil)
    }

    private func copySide() {
        do {
            UIPasteboard.general.string = try reviewCardSideCopyText(sourceText: self.sourceText)
            self.hasCopied = true
            self.successfulCopyCount += 1
            UIAccessibility.post(notification: .announcement, argument: self.copyActionLabel)
        } catch {
            self.hasCopied = false
            self.copyError = error.localizedDescription
        }
    }

    private func resetCopiedFeedbackAfterDelay() async {
        guard self.hasCopied else {
            return
        }

        do {
            try await Task.sleep(for: reviewCardSideCopiedFeedbackDuration)
        } catch {
            return
        }

        self.hasCopied = false
    }

    private var copyActionLabel: String {
        self.hasCopied
            ? String(localized: "Copied", table: reviewCardsStringsTableName)
            : String(localized: "Copy", table: reviewCardsStringsTableName)
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

private extension View {
    func reviewCardSideShortcutHint(key: String) -> some View {
        #if targetEnvironment(macCatalyst)
        self.catalystReviewShortcutHint(key: key)
        #else
        self.reviewCardsShortcutHelp(key: key)
        #endif
    }
}
