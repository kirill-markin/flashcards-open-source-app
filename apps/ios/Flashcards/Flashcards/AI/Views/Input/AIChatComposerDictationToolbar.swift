import SwiftUI

/// The toolbar takes the composer's single row, so the pill keeps its height.
let aiChatDictationToolbarHeight: CGFloat = appMinimumTouchTarget
private let aiChatDictationCrossfadeSeconds: Double = 0.2
private let aiChatDictationFinishCircleSize: CGFloat = 30
private let aiChatDictationWaveformHeight: CGFloat = 32
private let aiChatDictationWaveformMinimumBarHeight: CGFloat = 2
private let aiChatDictationWaveformBarWidth: CGFloat = 2
/// About one bar per this many points of the waveform's width.
private let aiChatDictationWaveformBarPitch: CGFloat = 5
private let aiChatDictationWaveformSmoothingSeconds: Double = 0.1

/// T3 Code's inline recording toolbar: Cancel, the live level with the elapsed time, and Finish, in the row the draft
/// and its controls leave.
struct AIChatComposerDictationToolbar: View {
    let phase: AIChatDictationState
    let runtime: AIChatDictationRuntime
    /// Only the chat on screen draws the live waveform; the side chats of other sections share the same store.
    let isOnScreen: Bool
    let canFinish: Bool
    let onCancel: () -> Void
    let onFinish: () -> Void

    var body: some View {
        HStack(spacing: 0) {
            Button(action: self.onCancel) {
                Image(systemName: "xmark")
                    .font(.system(size: 17, weight: .medium))
                    .foregroundStyle(.primary)
                    .frame(width: aiChatDictationToolbarHeight, height: aiChatDictationToolbarHeight)
                    .contentShape(Rectangle())
            }
            .nativeInlineActionButtonStyle()
            .accessibilityLabel(aiSettingsLocalized("ai.composer.dictation.cancel", "Cancel dictation"))
            .accessibilityIdentifier(UITestIdentifier.aiComposerDictationCancelButton)

            AIChatDictationStatus(phase: self.phase, runtime: self.runtime, isOnScreen: self.isOnScreen)
                .frame(maxWidth: .infinity)

            Button(action: self.onFinish) {
                ZStack {
                    if self.phase == .recording {
                        Circle()
                            .fill(Color.accentColor)
                        Image(systemName: "checkmark")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(.white)
                    } else {
                        Circle()
                            .fill(.quaternary)
                        ProgressView()
                            .controlSize(.small)
                    }
                }
                .frame(width: aiChatDictationFinishCircleSize, height: aiChatDictationFinishCircleSize)
                .frame(width: aiChatDictationToolbarHeight, height: aiChatDictationToolbarHeight)
                .contentShape(Rectangle())
            }
            .nativeInlineActionButtonStyle()
            .disabled(self.canFinish == false)
            .accessibilityLabel(
                self.phase == .recording
                    ? aiSettingsLocalized("ai.composer.dictation.finish", "Finish dictation")
                    : aiChatDictationStatusText(phase: self.phase, elapsedSeconds: 0)
            )
            .accessibilityIdentifier(UITestIdentifier.aiComposerDictationFinishButton)
        }
        .frame(height: aiChatDictationToolbarHeight)
    }
}

private struct AIChatDictationStatus: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let phase: AIChatDictationState
    let runtime: AIChatDictationRuntime
    let isOnScreen: Bool

    var body: some View {
        let elapsedSeconds = self.phase == .recording ? self.runtime.elapsedSeconds : 0

        Group {
            if self.phase == .recording {
                if self.reduceMotion || self.isOnScreen == false {
                    HStack(spacing: 8) {
                        Circle()
                            .fill(Color.accentColor)
                            .frame(width: 8, height: 8)
                        self.elapsedTimeText(elapsedSeconds: elapsedSeconds)
                    }
                } else {
                    HStack(spacing: 8) {
                        AIChatDictationWaveform(runtime: self.runtime)
                        self.elapsedTimeText(elapsedSeconds: elapsedSeconds)
                    }
                    .padding(.horizontal, 4)
                }
            } else {
                Text(aiChatDictationStatusText(phase: self.phase, elapsedSeconds: 0))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        // One element read on demand: it is never a live region, so recording announces nothing as the time moves.
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(aiChatDictationStatusText(phase: self.phase, elapsedSeconds: elapsedSeconds))
        .accessibilityIdentifier(UITestIdentifier.aiDictationStatus)
    }

    private func elapsedTimeText(elapsedSeconds: Int) -> some View {
        Text(aiChatDictationElapsedTimeText(seconds: elapsedSeconds))
            .font(.footnote)
            .monospacedDigit()
            .foregroundStyle(.secondary)
            .lineLimit(1)
            .fixedSize()
    }
}

/// Bars of the latest levels, newest on the trailing edge, each easing to its next height.
private struct AIChatDictationWaveform: View {
    let runtime: AIChatDictationRuntime
    @State private var barCount: Int = 0

    var body: some View {
        let levels = self.runtime.levels
        let barCount = min(self.barCount, levels.count)

        HStack(spacing: 0) {
            ForEach(0..<barCount, id: \.self) { index in
                let level = levels[levels.count - barCount + index]
                Capsule()
                    .fill(.primary)
                    .frame(
                        width: aiChatDictationWaveformBarWidth,
                        height: aiChatDictationWaveformMinimumBarHeight
                            + level * (aiChatDictationWaveformHeight - aiChatDictationWaveformMinimumBarHeight)
                    )
                    .opacity(0.22 + level * 0.78)
                    .frame(maxWidth: .infinity)
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: aiChatDictationWaveformHeight)
        .animation(.easeOut(duration: aiChatDictationWaveformSmoothingSeconds), value: levels)
        .onGeometryChange(for: Int.self) { geometry in
            max(1, min(aiChatDictationWaveformSampleCount, Int(geometry.size.width / aiChatDictationWaveformBarPitch)))
        } action: { barCount in
            self.barCount = barCount
        }
        .accessibilityHidden(true)
    }
}

/// A network or transcription failure, shown above the composer until dismissed or the next attempt starts.
struct AIChatDictationErrorNotice: View {
    let message: String
    let onDismiss: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: 8) {
            Text(self.message)
                .font(.footnote)
                .foregroundStyle(.red)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityIdentifier(UITestIdentifier.aiDictationError)
            Button(action: self.onDismiss) {
                Image(systemName: "xmark")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .frame(width: 28, height: 28)
                    // The glyph stays small while its target reaches the platform minimum.
                    .padding((appMinimumTouchTarget - 28) / 2)
                    .contentShape(Rectangle())
                    .padding(-(appMinimumTouchTarget - 28) / 2)
            }
            .nativeInlineActionButtonStyle()
            .accessibilityLabel(aiSettingsLocalized("ai.composer.dictation.dismissError", "Dismiss dictation error"))
        }
        .aiChatComposerNoticeBackground()
    }
}

/// Dictation hides the draft and its controls in place. The text view keeps its slot, so its state survives, while
/// the shell takes the toolbar's single-row height.
struct AIChatComposerDictationDraftLock: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let isLocked: Bool
    /// The single row's height, which grows with large text.
    let lockedHeight: CGFloat

    func body(content: Content) -> some View {
        content
            .frame(height: self.isLocked ? self.lockedHeight : nil, alignment: .top)
            .animation(self.reduceMotion ? nil : .easeInOut(duration: aiChatDictationCrossfadeSeconds)) { content in
                content.opacity(self.isLocked ? 0 : 1)
            }
            .allowsHitTesting(self.isLocked == false)
            .accessibilityHidden(self.isLocked)
    }
}

/// Crossfades in over the hidden draft; Reduce Motion swaps it at once.
private struct AIChatComposerDictationOverlay: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let chatStore: AIChatStore
    let isOnScreen: Bool

    var body: some View {
        let phase = self.chatStore.dictationState
        if phase != .idle {
            AIChatComposerDictationToolbar(
                phase: phase,
                runtime: self.chatStore.dictationRuntime,
                isOnScreen: self.isOnScreen,
                canFinish: self.chatStore.canUseDictation && phase == .recording,
                onCancel: { self.chatStore.cancelDictation() },
                onFinish: { self.chatStore.finishDictation() }
            )
            .transition(
                self.reduceMotion
                    ? .identity
                    : .opacity.animation(.easeInOut(duration: aiChatDictationCrossfadeSeconds))
            )
        }
    }
}

extension AIChatView {
    var composerDictationToolbar: some View {
        AIChatComposerDictationOverlay(chatStore: self.chatStore, isOnScreen: self.isPresentationActive)
    }

    @ViewBuilder
    var composerDictationErrorNotice: some View {
        if let message = self.chatStore.dictationRuntime.inlineErrorMessage {
            AIChatDictationErrorNotice(message: message) {
                self.chatStore.dismissDictationError()
            }
        }
    }
}

func aiChatDictationStatusText(phase: AIChatDictationState, elapsedSeconds: Int) -> String {
    switch phase {
    case .idle:
        return ""
    case .requestingPermission:
        return aiSettingsLocalized("ai.composer.dictation.preparing", "Preparing")
    case .recording:
        return aiSettingsLocalizedFormat(
            "ai.composer.dictation.recording",
            "Recording %@",
            aiChatDictationElapsedTimeText(seconds: elapsedSeconds)
        )
    case .transcribing:
        return aiSettingsLocalized("ai.composer.dictation.transcribing", "Transcribing...")
    }
}

/// `m:ss`, in the locale's digits.
func aiChatDictationElapsedTimeText(seconds: Int) -> String {
    Duration.seconds(max(0, seconds)).formatted(.time(pattern: .minuteSecond))
}
