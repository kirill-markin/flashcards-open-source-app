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

/// An error message with a known code shows the client copy in place of its stored English text.
private func aiChatDisplayedMessageContent(message: AIChatMessage) -> [AIChatContentPart] {
    guard message.isError, let terminalErrorMessage = aiChatTerminalErrorMessage(errorCode: message.errorCode) else {
        return message.content
    }

    return [.text(terminalErrorMessage)]
}

func aiChatShouldShowTypingIndicator(
    message: AIChatMessage,
    isLastMessage: Bool,
    isStreaming: Bool,
    optimisticAssistantMessageId: String?
) -> Bool {
    guard message.role == .assistant && isLastMessage else {
        return false
    }

    if isStreaming {
        return true
    }

    guard let optimisticAssistantMessageId else {
        return false
    }

    return optimisticAssistantMessageId == message.id
        && message.isError == false
        && message.isStopped == false
        && isOptimisticAIChatStatusContent(content: message.content)
}

func aiChatTypingIndicatorActiveDotCount(date: Date) -> Int {
    let animationStep = Int(
        floor(date.timeIntervalSinceReferenceDate / aiChatTypingIndicatorAnimationStepSeconds)
    )
    return animationStep.quotientAndRemainder(dividingBy: aiChatTypingIndicatorDotCount + 1).remainder
}

/// The whole line toggles, because a system `DisclosureGroup` on Mac Catalyst toggles only from its chevron.
private struct AIChatDisclosureToggleButton<Label: View>: View {
    @Binding var isExpanded: Bool
    let onExpand: () -> Void
    let label: () -> Label

    var body: some View {
        Button {
            self.toggleExpansion()
        } label: {
            HStack(alignment: .center, spacing: 6) {
                self.label()
                Image(systemName: "chevron.right")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .rotationEffect(.degrees(self.isExpanded ? 90 : 0))
                    .accessibilityHidden(true)
                Spacer(minLength: 0)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func toggleExpansion() {
        let didExpand = self.isExpanded == false
        withAnimation {
            self.isExpanded.toggle()
        }

        if didExpand {
            self.onExpand()
        }
    }
}

private struct AIChatExpandableDisclosureGroup<Label: View, Content: View>: View {
    @State private var isExpanded: Bool
    /// Nil keeps the identifier inherited from the enclosing row.
    let toggleAccessibilityIdentifier: String?
    let onExpand: () -> Void
    let content: () -> Content
    let label: () -> Label

    init(
        toggleAccessibilityIdentifier: String?,
        onExpand: @escaping () -> Void,
        @ViewBuilder content: @escaping () -> Content,
        @ViewBuilder label: @escaping () -> Label
    ) {
        self._isExpanded = State(initialValue: false)
        self.toggleAccessibilityIdentifier = toggleAccessibilityIdentifier
        self.onExpand = onExpand
        self.content = content
        self.label = label
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let toggleAccessibilityIdentifier = self.toggleAccessibilityIdentifier {
                self.toggleButton
                    .accessibilityIdentifier(toggleAccessibilityIdentifier)
            } else {
                self.toggleButton
            }

            if self.isExpanded {
                self.content()
            }
        }
    }

    private var toggleButton: some View {
        AIChatDisclosureToggleButton(isExpanded: self.$isExpanded, onExpand: self.onExpand, label: self.label)
    }
}

/// Work is every part up to and including the last tool call or reasoning step; the answer is the rest.
struct AIChatWorkContentSplit {
    let workParts: [AIChatContentPart]
    let answerParts: [AIChatContentPart]
}

/// Nil when the content has no tool call or reasoning step, so the message renders without a work block.
func aiChatWorkContentSplit(content: [AIChatContentPart]) -> AIChatWorkContentSplit? {
    guard let lastWorkIndex = content.lastIndex(where: { part in
        switch part {
        case .toolCall, .reasoningSummary:
            return true
        case .text, .image, .file, .card, .accountUpgradePrompt, .unknown:
            return false
        }
    }) else {
        return nil
    }

    return AIChatWorkContentSplit(
        workParts: Array(content[...lastWorkIndex]),
        answerParts: Array(content[content.index(after: lastWorkIndex)...])
    )
}

/// After the run ends, a block stays open only when the user would otherwise see no answer text.
func aiChatWorkBlockAutomaticIsExpanded(
    message: AIChatMessage,
    isRunActive: Bool,
    answerParts: [AIChatContentPart]
) -> Bool {
    if isRunActive || message.isStopped || message.isError {
        return true
    }

    let hasAnswerText = answerParts.contains { part in
        guard let text = part.textValue else {
            return false
        }

        return text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
    }
    return hasAnswerText == false
}

enum AIChatWorkBlockTiming {
    case running(startedAt: Date)
    case finished(durationSeconds: Int)
    case finishedWithoutDuration
}

/// An unparseable timestamp has no duration; `completedAt` is on the server clock, so a negative difference is clamped to zero.
func aiChatWorkBlockTiming(message: AIChatMessage, isRunActive: Bool) -> AIChatWorkBlockTiming {
    guard let startedAt = parseIsoTimestamp(value: message.timestamp) else {
        return .finishedWithoutDuration
    }

    if isRunActive {
        return .running(startedAt: startedAt)
    }

    guard let completedAt = message.completedAt else {
        return .finishedWithoutDuration
    }

    let startedAtMilliseconds = Int((startedAt.timeIntervalSince1970 * 1000).rounded())
    return .finished(durationSeconds: max(0, completedAt - startedAtMilliseconds) / 1000)
}

private let aiChatWorkDurationFormatter: DateComponentsFormatter = {
    let formatter = DateComponentsFormatter()
    formatter.unitsStyle = .abbreviated
    formatter.allowedUnits = [.hour, .minute, .second]
    formatter.maximumUnitCount = 2
    return formatter
}()

func aiChatWorkDurationText(seconds: Int) -> String {
    aiChatWorkDurationFormatter.string(from: TimeInterval(seconds)) ?? seconds.formatted()
}

func aiChatWorkBlockTitle(timing: AIChatWorkBlockTiming, now: Date) -> String {
    switch timing {
    case .running(let startedAt):
        return aiSettingsLocalizedFormat(
            "ai.message.work.running",
            "Working for %@",
            aiChatWorkDurationText(seconds: max(0, Int(now.timeIntervalSince(startedAt))))
        )
    case .finished(let durationSeconds):
        return aiSettingsLocalizedFormat(
            "ai.message.work.finished",
            "Worked for %@",
            aiChatWorkDurationText(seconds: durationSeconds)
        )
    case .finishedWithoutDuration:
        return aiSettingsLocalized("ai.message.work.finishedWithoutDuration", "Worked")
    }
}

/// Follows the automatic open state whenever it changes, such as when the run ends, and otherwise keeps the user's toggle.
private struct AIChatWorkBlock<WorkContent: View>: View {
    @State private var isExpanded: Bool
    let automaticIsExpanded: Bool
    let timing: AIChatWorkBlockTiming
    let onExpand: () -> Void
    let workContent: () -> WorkContent

    init(
        automaticIsExpanded: Bool,
        timing: AIChatWorkBlockTiming,
        onExpand: @escaping () -> Void,
        @ViewBuilder workContent: @escaping () -> WorkContent
    ) {
        self._isExpanded = State(initialValue: automaticIsExpanded)
        self.automaticIsExpanded = automaticIsExpanded
        self.timing = timing
        self.onExpand = onExpand
        self.workContent = workContent
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            AIChatDisclosureToggleButton(isExpanded: self.$isExpanded, onExpand: self.onExpand) {
                self.title
            }
            .accessibilityIdentifier(UITestIdentifier.aiWorkBlockToggle)

            Divider()

            if self.isExpanded {
                VStack(alignment: .leading, spacing: 8) {
                    self.workContent()
                }
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier(UITestIdentifier.aiWorkBlockContent)

                Divider()
            }
        }
        .onChange(of: self.automaticIsExpanded) { _, nextIsExpanded in
            withAnimation {
                self.isExpanded = nextIsExpanded
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(UITestIdentifier.aiWorkBlock)
    }

    @ViewBuilder
    private var title: some View {
        switch self.timing {
        case .running(let startedAt):
            TimelineView(.periodic(from: startedAt, by: 1)) { context in
                self.titleText(now: context.date)
            }
        case .finished, .finishedWithoutDuration:
            self.titleText(now: .now)
        }
    }

    private func titleText(now: Date) -> some View {
        Text(aiChatWorkBlockTitle(timing: self.timing, now: now))
            .font(.footnote)
            .foregroundStyle(.secondary)
            .padding(.vertical, aiChatActivityRowVerticalPadding)
    }
}

/// One muted line for a tool call or reasoning step; a finished step shows no status.
private struct AIChatActivityRowLabel: View {
    let title: String
    let status: AIChatToolCallStatus

    var body: some View {
        HStack(alignment: .center, spacing: 6) {
            Text(self.title)
                .lineLimit(1)
                .truncationMode(.tail)
            if self.status == .started {
                ProgressView()
                    .controlSize(.small)
                    .accessibilityLabel(aiChatToolStatusLabel(status: self.status))
            }
        }
        .font(.footnote)
        .foregroundStyle(.secondary)
        .padding(.vertical, aiChatActivityRowVerticalPadding)
    }
}

private let aiChatActivityRowLeadingIndent: CGFloat = 4
/// Added to the 8pt part spacing, it puts activity rows at the markdown paragraph rhythm.
private let aiChatActivityRowVerticalPadding: CGFloat = 2

/// Renders one transcript message; the live chat and the read-only history reader share it.
struct AIChatMessageRow: View {
    let message: AIChatMessage
    /// True only for the transcript's latest assistant message while its run streams.
    let isRunActive: Bool
    let repairStatus: AIChatRepairAttemptStatus?
    let showsTypingIndicator: Bool
    let onExpandContent: () -> Void
    let onOpenAccountStatus: () -> Void

    var body: some View {
        self.messageRow(
            message: self.message,
            repairStatus: self.repairStatus,
            showsTypingIndicator: self.showsTypingIndicator
        )
    }

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
                .accessibilityElement(children: .contain)
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

    @ViewBuilder
    func messageBubble(
        message: AIChatMessage,
        repairStatus: AIChatRepairAttemptStatus?,
        showsTypingIndicator: Bool
    ) -> some View {
        let displayedContent = aiChatDisplayedMessageContent(message: message)
        let workContentSplit = message.role == .assistant ? aiChatWorkContentSplit(content: displayedContent) : nil
        let content = VStack(alignment: .leading, spacing: 8) {
            if let workContentSplit {
                AIChatWorkBlock(
                    automaticIsExpanded: aiChatWorkBlockAutomaticIsExpanded(
                        message: message,
                        isRunActive: self.isRunActive,
                        answerParts: workContentSplit.answerParts
                    ),
                    timing: aiChatWorkBlockTiming(message: message, isRunActive: self.isRunActive),
                    onExpand: {
                        self.onExpandContent()
                    }
                ) {
                    ForEach(Array(workContentSplit.workParts.enumerated()), id: \.offset) { _, part in
                        self.messageContent(part: part, message: message)
                    }
                }
                ForEach(Array(workContentSplit.answerParts.enumerated()), id: \.offset) { _, part in
                    self.messageContent(part: part, message: message)
                }
            } else {
                ForEach(Array(displayedContent.enumerated()), id: \.offset) { _, part in
                    self.messageContent(part: part, message: message)
                }
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

        if message.role == .user {
            content
                .padding(12)
                .background(.tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        } else {
            content
        }
    }

    @ViewBuilder
    func messageContent(part: AIChatContentPart, message: AIChatMessage) -> some View {
        switch part {
        case .text(let text):
            if message.role == .assistant {
                AIChatLongTextView(text: text, isSelectable: true)
                    .textSelection(.enabled)
                    .accessibilityIdentifier(UITestIdentifier.aiAssistantVisibleText)
            } else {
                AIChatLongTextView(text: text)
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
                toggleAccessibilityIdentifier: nil,
                onExpand: {
                    self.onExpandContent()
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
                    Label {
                        MathContentText(text: aiChatCardAttachmentLabel(card: card), textStyle: .subheadline, weight: .semibold, parsedBlocks: aiChatCardAttachmentMathBlocks(card: card))
                    } icon: {
                        Image(systemName: "square.stack")
                    }
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
            let sections = aiChatToolSections(input: toolCall.input, output: toolCall.output)
            AIChatExpandableDisclosureGroup(
                toggleAccessibilityIdentifier: UITestIdentifier.aiToolCallSummary,
                onExpand: {
                    self.onExpandContent()
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
                                Button {
                                    UIPasteboard.general.string = section.text
                                } label: {
                                    Text(section.copyButtonTitle)
                                        .contentShape(Rectangle())
                                }
                                .nativeInlineActionButtonStyle()
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
                .padding(.top, 8)
            } label: {
                AIChatActivityRowLabel(
                    title: aiChatToolSummaryText(name: toolCall.name, input: toolCall.input),
                    status: toolCall.status
                )
            }
            .padding(.leading, aiChatActivityRowLeadingIndent)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier(aiChatToolStatusAccessibilityIdentifier(status: toolCall.status))
        case .reasoningSummary(let reasoningSummary):
            AIChatExpandableDisclosureGroup(
                toggleAccessibilityIdentifier: nil,
                onExpand: {
                    self.onExpandContent()
                }
            ) {
                AIChatLongTextView(
                    text: reasoningSummary.summary.isEmpty
                        ? aiSettingsLocalized("ai.message.reasoning.thinking", "Thinking...")
                        : reasoningSummary.summary,
                    textStyle: .subheadline,
                    isSelectable: true
                )
                    .font(.subheadline)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
                    .accessibilityIdentifier(UITestIdentifier.aiAssistantVisibleText)
                    .padding(.top, 8)
            } label: {
                AIChatActivityRowLabel(
                    title: aiSettingsLocalized("ai.message.reasoning.title", "Reasoning"),
                    status: reasoningSummary.status
                )
            }
            .padding(.leading, aiChatActivityRowLeadingIndent)
        case .accountUpgradePrompt(let message, let buttonTitle):
            VStack(alignment: .leading, spacing: 12) {
                Text(message)
                Button(buttonTitle) {
                    self.onOpenAccountStatus()
                }
                .nativeProminentActionButtonStyle()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        case .unknown(let unknownContent):
            AIChatUnknownContentPlaceholderView(content: unknownContent)
        }
    }

    private func messageRowAccessibilityLabel(message: AIChatMessage) -> String {
        let text = aiChatDisplayedMessageContent(message: message).reduce(into: "") { partialResult, part in
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
