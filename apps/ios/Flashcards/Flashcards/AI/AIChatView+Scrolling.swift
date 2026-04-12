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
    let distanceToBottom = max(scrollGeometry.contentSize.height - scrollGeometry.visibleRect.maxY, 0)
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

extension AIChatView {
    func scheduleDeferredBottomSyncIfNeeded() {
        guard self.navigation.selectedTab == .ai else {
            return
        }
        guard self.accessState == .ready else {
            return
        }
        guard self.chatStore.bootstrapPhase == .ready else {
            return
        }
        guard self.isAutoFollowEnabled else {
            return
        }

        self.cancelDeferredBottomSync()
        self.deferredBottomSyncTask = Task { @MainActor in
            await Task.yield()

            guard Task.isCancelled == false else {
                return
            }
            guard self.navigation.selectedTab == .ai else {
                self.deferredBottomSyncTask = nil
                return
            }
            guard self.accessState == .ready else {
                self.deferredBottomSyncTask = nil
                return
            }
            guard self.chatStore.bootstrapPhase == .ready else {
                self.deferredBottomSyncTask = nil
                return
            }

            self.scrollToBottomIfNeeded(isAnimated: false)
            self.deferredBottomSyncTask = nil
        }
    }

    func cancelDeferredBottomSync() {
        self.deferredBottomSyncTask?.cancel()
        self.deferredBottomSyncTask = nil
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
