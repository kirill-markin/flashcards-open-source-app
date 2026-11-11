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
    /// Shown beside the caption; nil hides it.
    let repetitionCount: Int?
    let isSpeechPlaying: Bool
    let onToggleSpeech: () -> Void
    let showsSpeechButton: Bool
    /// Shown as the last bottom action; nil hides it.
    let onEdit: (() -> Void)?
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
    /// The widest action glyph, the speaker; every action is a circle of this width with six points around it.
    @ScaledMetric(relativeTo: .callout) private var actionGlyphWidth: CGFloat = 24

    init(
        label: String,
        content: ReviewRenderedContent,
        sourceText: String,
        onSelectText: @escaping () -> Void,
        repetitionCount: Int?,
        isSpeechPlaying: Bool,
        onToggleSpeech: @escaping () -> Void,
        showsSpeechButton: Bool,
        onEdit: (() -> Void)?,
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
        self.repetitionCount = repetitionCount
        self.isSpeechPlaying = isSpeechPlaying
        self.onToggleSpeech = onToggleSpeech
        self.showsSpeechButton = showsSpeechButton
        self.onEdit = onEdit
        self.showsAiButton = showsAiButton
        self.aiButtonAccentColor = aiButtonAccentColor
        self.onOpenAi = onOpenAi
        self.surfaceStyle = surfaceStyle
        self.showsShortcutHints = showsShortcutHints
        self.copyRequest = copyRequest
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 12) {
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

                if let repetitionCount = self.repetitionCount {
                    Spacer(minLength: 0)
                    reviewRepetitionCount(reps: repetitionCount)
                }
            }

            ReviewSelectableTextView(sourceText: self.sourceText, content: self.content, surfaceStyle: self.surfaceStyle)
                .accessibilityIdentifier(self.surfaceStyle == .front
                    ? UITestIdentifier.reviewFrontSelectableText : UITestIdentifier.reviewBackSelectableText)
                .frame(maxWidth: .infinity, alignment: .leading)

            HStack(spacing: 8) {
                Spacer(minLength: 0)

                let copyButton = Button(action: self.copySide) {
                    reviewCardSideActionIcon(
                        systemName: self.hasCopied ? "checkmark" : "square.on.square",
                        diameter: self.actionDiameter
                    )
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
                        reviewCardSideActionIcon(
                            systemName: self.isSpeechPlaying ? "speaker.wave.2.fill" : "speaker.wave.2",
                            diameter: self.actionDiameter
                        )
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

                if let onEdit = self.onEdit {
                    let editLabel = String(localized: "Edit card", table: reviewCardsStringsTableName)
                    Button(action: onEdit) {
                        reviewCardSideActionIcon(systemName: "pencil", diameter: self.actionDiameter)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier(UITestIdentifier.reviewEditCardButton)
                    .accessibilityLabel(editLabel)
                    .help(editLabel)
                }

                if self.showsAiButton {
                    Button(action: self.onOpenAi) {
                        Text(String(localized: "AI", table: reviewCardsStringsTableName))
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(self.aiButtonAccentColor.contrastingForegroundColor)
                            // "AI" fits inside the shared circle; a long translation widens it at the same height.
                            .padding(.horizontal, 6)
                            .frame(minWidth: self.actionDiameter, minHeight: self.actionDiameter)
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

    private var actionDiameter: CGFloat {
        self.actionGlyphWidth + 12
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

/// The icon of a card-side action: a material circle inside the minimum touch target.
private func reviewCardSideActionIcon(systemName: String, diameter: CGFloat) -> some View {
    Image(systemName: systemName)
        .font(.callout.weight(.semibold))
        .foregroundStyle(.secondary)
        .frame(width: diameter, height: diameter)
        .background(.thinMaterial, in: Circle())
        .frame(minWidth: appMinimumTouchTarget, minHeight: appMinimumTouchTarget)
        .contentShape(Rectangle())
}

/// Caption-sized metadata, because a material capsule would vanish on the card's own material.
private func reviewRepetitionCount(reps: Int) -> some View {
    let accessibilityLabel = String(localized: "Reps", table: reviewCardsStringsTableName)
    let accessibilityValue = reps == 0
        ? String(localized: "New", table: reviewCardsStringsTableName)
        : localizedCardCountValue(count: reps)

    return HStack(spacing: 4) {
        // At caption size the symbol is taller than the caption line, so a Label would make the caption row taller.
        Image(systemName: "arrow.clockwise")
            .font(.caption2)
        Text(accessibilityValue)
    }
    .font(.caption.monospacedDigit())
    .foregroundStyle(.secondary)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(accessibilityLabel)
    .accessibilityValue(accessibilityValue)
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
