import SwiftUI

struct AIChatScrollState: Equatable {
    let isNearBottom: Bool
    let isUserScrolling: Bool
}

func aiChatScrollState(
    scrollPhase: ScrollPhase,
    scrollGeometry: ScrollGeometry,
    bottomThreshold: CGFloat
) -> AIChatScrollState {
    let distanceToBottom = max(scrollGeometry.contentSize.height - scrollGeometry.visibleRect.maxY, 0)
    return AIChatScrollState(
        isNearBottom: distanceToBottom <= bottomThreshold,
        isUserScrolling: scrollPhase.isScrolling
    )
}

extension AIChatView {
    func scrollToBottomIfNeeded(isAnimated: Bool) {
        guard self.isNearBottom else {
            return
        }

        guard self.isUserScrolling == false else {
            return
        }

        guard self.chatStore.messages.isEmpty == false else {
            self.scrollToBottom(isAnimated: isAnimated)
            return
        }

        self.scrollToBottom(isAnimated: isAnimated)
    }

    func scrollToBottom(isAnimated: Bool) {
        if isAnimated {
            withAnimation(.easeOut(duration: aiChatAutoScrollAnimationDurationSeconds)) {
                self.scrollPosition.scrollTo(edge: .bottom)
            }
            return
        }

        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) {
            self.scrollPosition.scrollTo(edge: .bottom)
        }
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
