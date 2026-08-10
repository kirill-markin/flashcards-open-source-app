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

func aiChatBottomScrollPosition(messages: [AIChatMessage]) -> ScrollPosition {
    guard let tailMessageId = messages.last?.id else {
        return ScrollPosition(idType: String.self, edge: .bottom)
    }

    return ScrollPosition(id: tailMessageId, anchor: .bottom)
}

extension AIChatView {
    func detachAutoFollow() {
        self.isAutoFollowEnabled = false
    }

    func detachAutoFollowForExpandedContent() {
        self.detachAutoFollow()
    }

    func scrollToBottomIfNeeded(isAnimated: Bool) {
        guard self.isAutoFollowEnabled else {
            return
        }

        self.scrollToBottom(isAnimated: isAnimated)
    }

    func scrollToBottom(isAnimated: Bool) {
        if isAnimated {
            withAnimation(.easeOut(duration: aiChatAutoScrollAnimationDurationSeconds)) {
                self.updateScrollPositionToBottom()
            }
            return
        }

        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) {
            self.updateScrollPositionToBottom()
        }
    }

    private func updateScrollPositionToBottom() {
        guard let tailMessageId = self.chatStore.messages.last?.id else {
            self.scrollPosition.scrollTo(edge: .bottom)
            return
        }

        self.scrollPosition.scrollTo(id: tailMessageId, anchor: .bottom)
    }

    func startAutoScrollTask() {
        self.stopAutoScrollTask()
        self.autoScrollTask = Task { @MainActor in
            while Task.isCancelled == false {
                do {
                    try await Task.sleep(for: .seconds(aiChatAutoScrollIntervalSeconds))
                } catch {
                    break
                }

                guard self.chatStore.isStreaming else {
                    continue
                }

                self.scrollToBottomIfNeeded(isAnimated: true)
            }
        }
    }

    func stopAutoScrollTask() {
        self.autoScrollTask?.cancel()
        self.autoScrollTask = nil
    }
}
