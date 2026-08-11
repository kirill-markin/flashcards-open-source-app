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
    }

    func scrollToBottomIfNeeded(proxy: ScrollViewProxy, isAnimated: Bool) {
        guard self.isAutoFollowEnabled else {
            return
        }

        self.scrollToBottom(proxy: proxy, isAnimated: isAnimated)
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
