import SwiftUI

struct AIChatScrollState: Equatable {
    let isNearBottom: Bool
    let isUserInitiatedScroll: Bool
}

func aiChatScrollState(
    scrollPhase: ScrollPhase,
    scrollGeometry: ScrollGeometry,
    bottomThreshold: CGFloat
) -> AIChatScrollState {
    let distanceToBottom = max(
        scrollGeometry.contentSize.height
            + scrollGeometry.contentInsets.bottom
            - scrollGeometry.visibleRect.maxY,
        0
    )
    let isUserInitiatedScroll: Bool
    switch scrollPhase {
    case .tracking, .interacting, .decelerating:
        isUserInitiatedScroll = true
    case .idle, .animating:
        isUserInitiatedScroll = false
    @unknown default:
        isUserInitiatedScroll = false
    }

    return AIChatScrollState(
        isNearBottom: distanceToBottom <= bottomThreshold,
        isUserInitiatedScroll: isUserInitiatedScroll
    )
}

func aiChatMessageListUpdateAppendsTail(
    previousMessages: [AIChatMessage],
    nextMessages: [AIChatMessage]
) -> Bool {
    guard nextMessages.count > previousMessages.count else {
        return false
    }

    return zip(previousMessages, nextMessages).allSatisfy { previousMessage, nextMessage in
        previousMessage == nextMessage
    }
}

func aiChatMessageListUpdateChangesExistingTail(
    previousMessages: [AIChatMessage],
    nextMessages: [AIChatMessage]
) -> Bool {
    guard previousMessages.isEmpty == false else {
        return false
    }
    guard previousMessages.count == nextMessages.count else {
        return false
    }
    guard let previousTail = previousMessages.last,
          let nextTail = nextMessages.last else {
        return false
    }
    guard previousTail.id == nextTail.id, previousTail != nextTail else {
        return false
    }

    return zip(previousMessages.dropLast(), nextMessages.dropLast())
        .allSatisfy { previousMessage, nextMessage in
            previousMessage == nextMessage
        }
}

extension AIChatView {
    func detachAutoFollow() {
        self.isAutoFollowEnabled = false
    }

    func detachAutoFollowForExpandedContent() {
        self.detachAutoFollow()
        self.recordCompanionTranscriptPosition()
    }

    func scrollToBottomIfNeeded(proxy: ScrollViewProxy, isAnimated: Bool) {
        // A chat off screen follows nothing; it takes its position when it comes back.
        guard self.isAutoFollowEnabled, self.isPresentationActive else {
            return
        }

        self.scrollToBottom(proxy: proxy, isAnimated: isAnimated)
    }

    /// The AI tab's chat opens at its newest message. A side chat coming on screen in another section takes the place
    /// the reader left in the previous one.
    func restoreTranscriptPosition(proxy: ScrollViewProxy) {
        self.hasActiveUserScrollGesture = false
        let position = self.isCompanion ? self.chatStore.companionPresentation.transcriptPosition : .bottom
        guard case .message(let messageId, let topOffset) = position,
              self.chatStore.messages.contains(where: { message in message.id == messageId }) else {
            self.transcriptRestore = nil
            self.isAutoFollowEnabled = true
            self.scrollToBottom(proxy: proxy, isAnimated: false)
            return
        }

        self.isAutoFollowEnabled = false
        // A row on screen places itself before the frame renders. Only a row off screen is first brought to the
        // viewport's top, after which it places itself the rest of the way.
        self.transcriptLayout.placedRestoreMessageId = nil
        self.transcriptRestore = AIChatTranscriptRestore(messageId: messageId, topOffset: topOffset)
        DispatchQueue.main.async {
            guard self.transcriptRestore?.messageId == messageId,
                  self.transcriptLayout.placedRestoreMessageId != messageId else { return }
            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) {
                proxy.scrollTo(messageId, anchor: .top)
            }
        }
    }

    /// Only the side chat on screen records; the topmost row still on screen anchors the place.
    func recordCompanionTranscriptPosition() {
        guard self.isCompanion, self.isPresentationActive else {
            return
        }
        guard self.isAutoFollowEnabled == false else {
            self.chatStore.companionPresentation.transcriptPosition = .bottom
            return
        }
        let viewportTop = self.transcriptLayout.viewportTop
        guard let topRow = self.transcriptLayout.rowFrames
            .filter({ _, frame in frame.maxY > viewportTop && frame.height > 0 })
            .min(by: { first, second in first.value.minY < second.value.minY }) else {
            return
        }
        self.chatStore.companionPresentation.transcriptPosition = .message(
            id: topRow.key,
            topOffset: viewportTop - topRow.value.minY
        )
    }

    func scrollToBottom(proxy: ScrollViewProxy, isAnimated: Bool) {
        if isAnimated {
            withAnimation(.easeOut(duration: aiChatAutoScrollAnimationDurationSeconds)) {
                proxy.scrollTo(AIChatTranscriptScrollTarget.bottom, anchor: .bottom)
            }
            return
        }

        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) {
            proxy.scrollTo(AIChatTranscriptScrollTarget.bottom, anchor: .bottom)
        }
    }
}
