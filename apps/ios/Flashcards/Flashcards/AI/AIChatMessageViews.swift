import SwiftUI
import UIKit

struct AIChatTypingIndicator: View {
    var body: some View {
        TimelineView(.animation(minimumInterval: aiChatTypingIndicatorAnimationStepSeconds)) { context in
            let activeDotCount = aiChatTypingIndicatorActiveDotCount(date: context.date)

            HStack(spacing: 5) {
                ForEach(0..<aiChatTypingIndicatorDotCount, id: \.self) { index in
                    Circle()
                        .fill(Color.secondary)
                        .frame(width: 6, height: 6)
                        .opacity(index < activeDotCount ? 1 : 0.25)
                }
            }
            .padding(.top, 2)
            .accessibilityLabel("Assistant is typing")
        }
    }
}

func aiChatShouldShowTypingIndicator(
    message: AIChatMessage,
    isLastMessage: Bool,
    isStreaming: Bool
) -> Bool {
    message.role == .assistant && isLastMessage && isStreaming
}

func aiChatTypingIndicatorActiveDotCount(date: Date) -> Int {
    let animationStep = Int(
        floor(date.timeIntervalSinceReferenceDate / aiChatTypingIndicatorAnimationStepSeconds)
    )
    return animationStep.quotientAndRemainder(dividingBy: aiChatTypingIndicatorDotCount + 1).remainder
}

extension AIChatView {
    func messageRow(
        message: AIChatMessage,
        repairStatus: AIChatRepairAttemptStatus?,
        showsTypingIndicator: Bool
    ) -> some View {
        HStack(alignment: .bottom, spacing: 0) {
            if message.role == .assistant {
                self.messageBubble(
                    message: message,
                    repairStatus: repairStatus,
                    showsTypingIndicator: showsTypingIndicator
                )
                Spacer(minLength: 0)
            } else {
                Spacer(minLength: 0)
                self.messageBubble(
                    message: message,
                    repairStatus: repairStatus,
                    showsTypingIndicator: showsTypingIndicator
                )
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityIdentifier(UITestIdentifier.aiMessageRow)
    }

    func messageBubble(
        message: AIChatMessage,
        repairStatus: AIChatRepairAttemptStatus?,
        showsTypingIndicator: Bool
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(message.role == .user ? "You" : "Assistant")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)

            ForEach(Array(message.content.enumerated()), id: \.offset) { _, part in
                self.messageContent(part: part)
            }

            if let repairStatus {
                HStack(spacing: 8) {
                    ProgressView()
                        .controlSize(.small)
                    Text(repairStatus.displayText)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            if showsTypingIndicator {
                AIChatTypingIndicator()
            }
        }
        .frame(maxWidth: aiChatBubbleMaximumWidth, alignment: .leading)
        .padding(12)
        .background(
            message.role == .user
                ? AnyShapeStyle(Color.accentColor.opacity(0.12))
                : AnyShapeStyle(.thinMaterial),
            in: RoundedRectangle(cornerRadius: 14, style: .continuous)
        )
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(message.isError ? Color.red.opacity(0.5) : Color.clear, lineWidth: 1)
        )
        .accessibilityIdentifier(self.messageBubbleAccessibilityIdentifier(message: message))
    }

    @ViewBuilder
    func messageContent(part: AIChatContentPart) -> some View {
        switch part {
        case .text(let text):
            Text(text)
                .textSelection(.enabled)
        case .image:
            Label("Image attached", systemImage: "photo")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        case .file(let fileName, _, _):
            Label(fileName, systemImage: "doc")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        case .toolCall(let toolCall):
            let summaryText = aiChatToolSummaryText(name: toolCall.name, input: toolCall.input)
            let sections = aiChatToolSections(input: toolCall.input, output: toolCall.output)
            VStack(alignment: .leading, spacing: 0) {
                DisclosureGroup {
                    VStack(alignment: .leading, spacing: 12) {
                        ForEach(Array(sections.enumerated()), id: \.element.id) { index, section in
                            VStack(alignment: .leading, spacing: 8) {
                                HStack(alignment: .firstTextBaseline, spacing: 12) {
                                    Text(section.title)
                                        .font(.caption.weight(.semibold))
                                        .foregroundStyle(.secondary)
                                    Spacer(minLength: 0)
                                    Button(section.copyButtonTitle) {
                                        UIPasteboard.general.string = section.text
                                    }
                                    .buttonStyle(.plain)
                                    .font(.caption.weight(.semibold))
                                    .accessibilityLabel(section.copyAccessibilityLabel)
                                }

                                Text(section.text)
                                    .font(.caption.monospaced())
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .textSelection(.enabled)
                            }

                            if index < sections.count - 1 {
                                Divider()
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, 4)
                } label: {
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        Text(summaryText)
                            .lineLimit(1)
                            .truncationMode(.tail)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Text(aiChatToolStatusLabel(status: toolCall.status))
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .accessibilityIdentifier(aiChatToolStatusAccessibilityIdentifier(status: toolCall.status))
                    }
                    .font(.subheadline)
                }
                .tint(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(
                        aiChatToolBorderColor(status: toolCall.status),
                        style: aiChatToolBorderStrokeStyle(status: toolCall.status)
                    )
            )
        case .accountUpgradePrompt(let message, let buttonTitle):
            VStack(alignment: .leading, spacing: 12) {
                Text(message)
                Button(buttonTitle) {
                    self.navigation.openSettings(destination: .accountStatus)
                }
                .buttonStyle(.glassProminent)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
    }

    private func messageBubbleAccessibilityIdentifier(message: AIChatMessage) -> String {
        guard message.role == .assistant, message.isError else {
            return ""
        }

        return UITestIdentifier.aiAssistantErrorMessage
    }
}

private func aiChatToolStatusAccessibilityIdentifier(status: AIChatToolCallStatus) -> String {
    switch status {
    case .started:
        return ""
    case .completed:
        return UITestIdentifier.aiToolCallCompletedStatus
    }
}
