import SwiftUI

extension AIChatView {
    var chatScrollSurface: some View {
        self.chatScrollContent
        .accessibilityIdentifier(UITestIdentifier.aiConversationScrollSurface)
        .defaultScrollAnchor(.bottom, for: .initialOffset)
        .defaultScrollAnchor(.bottom, for: .alignment)
        // Let SwiftUI preserve the visible content while the viewport changes.
        // We removed the old geometry-height-driven `scrollToBottomIfNeeded` here
        // because keyboard-open resizes were getting two competing corrections:
        // `scrollPosition` preserving the current view and our forced bottom jump.
        // That over-correction was causing the temporary empty gap above the keyboard
        // until the user nudged the scroll view manually.
        .scrollPosition(self.$scrollPosition, anchor: .bottom)
        .contentMargins(.horizontal, aiChatMessageListHorizontalPadding, for: .scrollContent)
        .contentMargins(.vertical, 12, for: .scrollContent)
        .contentMargins(.horizontal, 0, for: .scrollIndicators)
        .contentShape(Rectangle())
        .onTapGesture {
            self.dismissComposerFocus()
        }
        .onScrollPhaseChange { _, nextPhase, context in
            let nextScrollState: AIChatScrollState = aiChatScrollState(
                scrollPhase: nextPhase,
                scrollGeometry: context.geometry,
                bottomThreshold: aiChatAutoScrollBottomThreshold
            )
            self.currentScrollState = nextScrollState

            // Only user-driven scrolls can detach auto-follow. Animated scrolls are
            // app-driven and should not flip the latch while assistant content grows.
            if nextScrollState.isUserInitiatedScroll {
                self.hasActiveUserScrollGesture = true
                if nextScrollState.isNearBottom == false {
                    self.detachAutoFollow()
                    return
                }
            }

            if nextPhase == .idle {
                let didCompleteUserScrollGesture: Bool = self.hasActiveUserScrollGesture
                self.hasActiveUserScrollGesture = false
                guard nextScrollState.isNearBottom else {
                    if didCompleteUserScrollGesture {
                        self.detachAutoFollow()
                    }
                    return
                }

                self.isAutoFollowEnabled = true
                if self.chatStore.isStreaming {
                    self.scrollToBottomIfNeeded(isAnimated: false)
                }
                return
            }
        }
        .onAppear {
            // Keep the one-shot deferred sync only when the previous geometry already
            // proved the reader was at the bottom, so tab return cannot override a
            // deliberate manual scroll-away.
            self.scheduleDeferredBottomSyncIfNeeded()
            if self.chatStore.isStreaming {
                self.startAutoScrollTask()
            }
        }
        .onDisappear {
            self.cancelDeferredBottomSync()
            self.stopAutoScrollTask()
        }
        .onChange(of: self.chatStore.messages) { previousMessages, messages in
            guard messages.isEmpty == false else {
                self.isAutoFollowEnabled = true
                self.currentScrollState = nil
                self.hasActiveUserScrollGesture = false
                self.scrollToBottom(isAnimated: false)
                return
            }

            let didAppendTail: Bool = aiChatMessageListUpdateAppendsTail(
                previousMessages: previousMessages,
                nextMessages: messages
            )
            let didChangeStreamingTail: Bool = self.chatStore.isStreaming
                && aiChatMessageListUpdateChangesExistingTail(
                    previousMessages: previousMessages,
                    nextMessages: messages
                )
            guard didAppendTail || didChangeStreamingTail else {
                return
            }
            self.scrollToBottomIfNeeded(isAnimated: self.chatStore.isStreaming == false)
        }
        .onChange(of: self.chatStore.isStreaming) { _, isStreaming in
            if isStreaming {
                self.startAutoScrollTask()
                return
            }

            self.stopAutoScrollTask()
            self.scrollToBottomIfNeeded(isAnimated: true)
        }
    }

    @ViewBuilder
    var chatScrollContent: some View {
        // The transcript must use a native virtualized container and stable row IDs.
        List {
            if self.chatStore.messages.isEmpty {
                self.emptyChatState
                    .frame(maxWidth: .infinity)
                    .containerRelativeFrame(.vertical, alignment: .center)
                    .listRowInsets(EdgeInsets())
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
            } else {
                let tailMessageId: String? = self.chatStore.messages.last?.id

                ForEach(self.chatStore.messages) { message in
                    self.messageRow(
                        message: message,
                        repairStatus: self.repairStatus(for: message),
                        showsTypingIndicator: aiChatShouldShowTypingIndicator(
                            message: message,
                            isLastMessage: message.id == tailMessageId,
                            isStreaming: self.chatStore.isStreaming,
                            optimisticAssistantMessageId: self.chatStore.optimisticOutgoingTurnState?.assistantMessageId
                        )
                    )
                    .id(message.id)
                    .listRowInsets(EdgeInsets())
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
                }
            }
        }
        .listStyle(.plain)
        .listRowSpacing(12)
        .scrollContentBackground(.hidden)
    }
}
