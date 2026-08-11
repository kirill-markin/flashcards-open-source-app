import SwiftUI

enum AIChatTranscriptScrollTarget: Hashable {
    case bottom
}

extension AIChatView {
    var chatScrollSurface: some View {
        // Keep programmatic navigation tied to stable native List row IDs through
        // ScrollViewReader; ScrollPosition reopened physical-iPhone transcripts at
        // the top instead of resolving the tail.
        ScrollViewReader { proxy in
            self.chatScrollContent
                .accessibilityIdentifier(UITestIdentifier.aiConversationScrollSurface)
                .defaultScrollAnchor(.bottom, for: .initialOffset)
                .defaultScrollAnchor(.bottom, for: .alignment)
                .contentMargins(.horizontal, aiChatMessageListHorizontalPadding, for: .scrollContent)
                // The zero-height anchor's row gap preserves the existing bottom spacing.
                .contentMargins(.top, 12, for: .scrollContent)
                .contentMargins(.bottom, 0, for: .scrollContent)
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
                            self.scrollToBottom(
                                proxy: proxy,
                                isAnimated: false
                            )
                        }
                        return
                    }
                }
                .onAppear {
                    self.isAutoFollowEnabled = true
                    self.hasActiveUserScrollGesture = false
                    self.scrollToBottom(proxy: proxy, isAnimated: false)
                }
                .onChange(of: self.navigation.selectedTab) { _, nextTab in
                    guard nextTab == .ai else {
                        return
                    }

                    self.isAutoFollowEnabled = true
                    self.hasActiveUserScrollGesture = false
                    self.scrollToBottom(proxy: proxy, isAnimated: false)
                }
                .onChange(of: self.chatStore.bootstrapPhase) { _, nextPhase in
                    guard nextPhase == .ready else {
                        return
                    }

                    self.scrollToBottomIfNeeded(proxy: proxy, isAnimated: false)
                }
                .onChange(of: self.isComposerFocused) { _, isFocused in
                    guard isFocused else {
                        return
                    }

                    self.scrollToBottomIfNeeded(proxy: proxy, isAnimated: false)
                }
                .onChange(of: self.chatStore.messages) { previousMessages, messages in
                    guard messages.isEmpty == false else {
                        self.isAutoFollowEnabled = true
                        self.hasActiveUserScrollGesture = false
                        return
                    }

                    let didAppendTail: Bool = aiChatMessageListUpdateAppendsTail(
                        previousMessages: previousMessages,
                        nextMessages: messages
                    )
                    let didChangeTailIdentity: Bool = previousMessages.last?.id != messages.last?.id
                    let didChangeStreamingTail: Bool = self.chatStore.isStreaming
                        && aiChatMessageListUpdateChangesExistingTail(
                            previousMessages: previousMessages,
                            nextMessages: messages
                        )
                    guard didAppendTail || didChangeTailIdentity || didChangeStreamingTail else {
                        return
                    }
                    self.scrollToBottomIfNeeded(
                        proxy: proxy,
                        isAnimated: previousMessages.isEmpty == false && self.chatStore.isStreaming == false
                    )
                }
                .onChange(of: self.chatStore.isStreaming) { _, isStreaming in
                    guard isStreaming == false else {
                        return
                    }

                    self.scrollToBottomIfNeeded(proxy: proxy, isAnimated: true)
                }
        }
    }

    @ViewBuilder
    var chatScrollContent: some View {
        // Keep List: LazyVStack produced blank transcript content during keyboard-driven
        // relayout, while non-lazy VStack could not virtualize long transcripts.
        List {
            if self.chatStore.messages.isEmpty == false {
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

            // Never use a message ID here: messages can be cleared or replaced while
            // a pending ScrollViewReader request still needs a mounted target.
            Color.clear
                .frame(height: 0)
                .id(AIChatTranscriptScrollTarget.bottom)
                .listRowInsets(EdgeInsets())
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
                .accessibilityHidden(true)
                .allowsHitTesting(false)
        }
        .listStyle(.plain)
        .listRowSpacing(12)
        .environment(\.defaultMinListRowHeight, 0)
        .scrollContentBackground(.hidden)
        .overlay {
            // Keep the empty state in the full List viewport: placing it in a row clipped
            // its description on a physical iPhone.
            if self.chatStore.messages.isEmpty {
                self.emptyChatState
            }
        }
    }
}
