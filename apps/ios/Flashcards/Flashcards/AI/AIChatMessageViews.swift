import SwiftUI
import UIKit

func aiChatUnknownContentPlaceholderTitle() -> String {
    aiSettingsLocalized("ai.message.unsupportedContent", "Unsupported content")
}

func aiChatUnknownContentPlaceholderSubtitle(content: AIChatUnknownContentPart) -> String {
    aiSettingsLocalizedFormat("ai.message.unsupportedContent.type", "Type: %@", content.originalType)
}

struct AIChatUnknownContentPlaceholderView: View {
    let content: AIChatUnknownContentPart

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(aiChatUnknownContentPlaceholderTitle(), systemImage: "questionmark.square.dashed")
                .font(.subheadline.weight(.semibold))
            Text(aiChatUnknownContentPlaceholderSubtitle(content: content))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

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
            .accessibilityLabel(aiSettingsLocalized("ai.message.assistantTyping", "Assistant is typing"))
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

private struct AIChatExpandableDisclosureGroup<Label: View, Content: View>: View {
    @State private var isExpanded: Bool
    let onExpand: () -> Void
    let content: () -> Content
    let label: () -> Label

    init(
        onExpand: @escaping () -> Void,
        @ViewBuilder content: @escaping () -> Content,
        @ViewBuilder label: @escaping () -> Label
    ) {
        self._isExpanded = State(initialValue: false)
        self.onExpand = onExpand
        self.content = content
        self.label = label
    }

    var body: some View {
        DisclosureGroup(isExpanded: self.isExpandedBinding) {
            self.content()
        } label: {
            self.label()
        }
    }

    private var isExpandedBinding: Binding<Bool> {
        Binding(
            get: {
                self.isExpanded
            },
            set: { nextValue in
                let didExpand = self.isExpanded == false && nextValue
                self.isExpanded = nextValue

                if didExpand {
                    self.onExpand()
                }
            }
        )
    }
}

extension AIChatView {
    @ViewBuilder
    func messageRow(
        message: AIChatMessage,
        repairStatus: AIChatRepairAttemptStatus?,
        showsTypingIndicator: Bool
    ) -> some View {
        let row = HStack(alignment: .bottom, spacing: 0) {
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

        if message.role == .assistant, message.isError {
            row
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(self.messageRowAccessibilityLabel(message: message))
                .accessibilityIdentifier(UITestIdentifier.aiAssistantErrorMessage)
        } else if message.role == .assistant {
            row
                .accessibilityIdentifier(UITestIdentifier.aiAssistantVisibleText)
                .accessibilityValue(self.messageRowAccessibilityLabel(message: message))
        } else {
            row
                .accessibilityIdentifier(UITestIdentifier.aiMessageRow)
        }
    }

    func messageBubble(
        message: AIChatMessage,
        repairStatus: AIChatRepairAttemptStatus?,
        showsTypingIndicator: Bool
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(
                message.role == .user
                    ? aiSettingsLocalized("ai.message.role.you", "You")
                    : aiSettingsLocalized("ai.message.role.assistant", "Assistant")
            )
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)

            ForEach(Array(message.content.enumerated()), id: \.offset) { _, part in
                self.messageContent(part: part, message: message)
            }

            if let repairStatus {
                HStack(spacing: 8) {
                    ProgressView()
                        .controlSize(.small)
                    Text(
                        aiSettingsLocalizedFormat(
                            "ai.message.repairStatus",
                            "%@ %d/%d",
                            repairStatus.message,
                            repairStatus.attempt,
                            repairStatus.maxAttempts
                        )
                    )
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
    }

    @ViewBuilder
    func messageContent(part: AIChatContentPart, message: AIChatMessage) -> some View {
        switch part {
        case .text(let text):
            if message.role == .assistant {
                Text(text)
                    .textSelection(.enabled)
                    .accessibilityIdentifier(UITestIdentifier.aiAssistantVisibleText)
            } else {
                Text(text)
            }
        case .image:
            Label(aiSettingsLocalized("ai.message.imageAttached", "Image attached"), systemImage: "photo")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        case .file(let fileName, _, _):
            Label(fileName, systemImage: "doc")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        case .card(let card):
            AIChatExpandableDisclosureGroup(
                onExpand: {
                    self.detachAutoFollowForExpandedContent()
                }
            ) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(buildAIChatCardContextXML(card: card))
                        .font(.caption.monospaced())
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .textSelection(.enabled)
                    if card.tags.isEmpty == false {
                        Text(
                            aiSettingsLocalizedFormat(
                                "ai.message.card.tags",
                                "Tags: %@",
                                card.tags.joined(separator: ", ")
                            )
                        )
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.top, 4)
            } label: {
                VStack(alignment: .leading, spacing: 4) {
                    Label(aiChatCardAttachmentLabel(card: card), systemImage: "square.stack")
                        .font(.subheadline.weight(.semibold))
                    Text(aiSettingsLocalized("ai.message.card.promptContext", "Prompt context"))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .tint(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        case .toolCall(let toolCall):
            let summaryText = aiChatToolSummaryText(name: toolCall.name, input: toolCall.input)
            let sections = aiChatToolSections(input: toolCall.input, output: toolCall.output)
            VStack(alignment: .leading, spacing: 0) {
                AIChatExpandableDisclosureGroup(
                    onExpand: {
                        self.detachAutoFollowForExpandedContent()
                    }
                ) {
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
                                    .accessibilityIdentifier(aiChatToolSectionAccessibilityIdentifier(sectionId: section.id))
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
                            .accessibilityIdentifier(UITestIdentifier.aiToolCallSummary)
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
        case .reasoningSummary(let reasoningSummary):
            AIChatExpandableDisclosureGroup(
                onExpand: {
                    self.detachAutoFollowForExpandedContent()
                }
            ) {
                Text(
                    reasoningSummary.summary.isEmpty
                        ? aiSettingsLocalized("ai.message.reasoning.thinking", "Thinking...")
                        : reasoningSummary.summary
                )
                    .font(.subheadline)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
                    .accessibilityIdentifier(UITestIdentifier.aiAssistantVisibleText)
                    .padding(.top, 4)
            } label: {
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    Text(aiSettingsLocalized("ai.message.reasoning.title", "Reasoning"))
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Text(
                        reasoningSummary.status == .started
                            ? aiSettingsLocalized("ai.message.reasoning.status.running", "RUNNING")
                            : aiSettingsLocalized("ai.message.reasoning.status.done", "DONE")
                    )
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
            }
            .tint(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(
                        aiChatToolBorderColor(status: reasoningSummary.status),
                        style: aiChatToolBorderStrokeStyle(status: reasoningSummary.status)
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
        case .unknown(let unknownContent):
            AIChatUnknownContentPlaceholderView(content: unknownContent)
        }
    }

    private func messageRowAccessibilityLabel(message: AIChatMessage) -> String {
        let text = message.content.reduce(into: "") { partialResult, part in
            switch part {
            case .text(let text):
                partialResult.append(text)
            case .reasoningSummary(let reasoningSummary):
                if partialResult.isEmpty == false {
                    partialResult.append("\n")
                }
                partialResult.append(
                    reasoningSummary.summary.isEmpty
                        ? aiSettingsLocalized("ai.message.reasoning.thinking", "Thinking...")
                        : reasoningSummary.summary
                )
            case .unknown(let unknownContent):
                if partialResult.isEmpty == false {
                    partialResult.append("\n")
                }
                partialResult.append(unknownContent.summaryText)
            case .toolCall, .image, .file, .card, .accountUpgradePrompt:
                break
            }
        }
        let trimmedText = text.trimmingCharacters(in: .whitespacesAndNewlines)

        return trimmedText.isEmpty ? aiSettingsLocalized("ai.message.role.assistant", "Assistant") : trimmedText
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

private func aiChatToolSectionAccessibilityIdentifier(sectionId: String) -> String {
    switch sectionId {
    case "request":
        return UITestIdentifier.aiToolCallRequestText
    case "response":
        return UITestIdentifier.aiToolCallResponseText
    default:
        return ""
    }
}
