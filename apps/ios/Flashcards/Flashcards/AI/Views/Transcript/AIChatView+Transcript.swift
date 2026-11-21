import SwiftUI
import UIKit

enum AIChatTranscriptScrollTarget: Hashable {
    case bottom
}

extension AIChatView {
    var chatScrollSurface: some View {
        ScrollViewReader { proxy in
            ReadableContentLayout(
                maxWidth: flashcardsReadableContentMaxWidth,
                horizontalPadding: 0
            ) {
                self.chatScrollContent
            }
                .defaultScrollAnchor(.bottom, for: .initialOffset)
                .defaultScrollAnchor(.bottom, for: .alignment)
                // The zero-height structural row's gap preserves the existing bottom spacing.
                .contentMargins(.top, self.usesStudySpacing ? 20 : 12, for: .scrollContent)
                // Content margins add spacing beyond the safe area; keep zero extra on both iPad and iPhone.
                .contentMargins(.bottom, 0, for: .scrollContent)
                .contentMargins(.horizontal, 0, for: .scrollIndicators)
                .onGeometryChange(for: CGFloat.self) { geometry in
                    geometry.frame(in: .global).minY
                } action: { top in
                    self.transcriptLayout.viewportTop = top
                }
                .onScrollGeometryChange(for: CGFloat.self) { geometry in
                    geometry.containerSize.height - geometry.contentInsets.top - geometry.contentInsets.bottom
                } action: { _, _ in
                    guard self.hasActiveUserScrollGesture == false else { return }
                    // Keep the newest message above a resized composer or keyboard; a reader's older position stays.
                    self.scrollToBottomIfNeeded(proxy: proxy, isAnimated: false)
                }
                .onScrollGeometryChange(for: CGFloat.self) { geometry in
                    geometry.contentOffset.y
                } action: { _, _ in
                    // The place stays current while the reader scrolls, so switching sections mid-flick keeps it.
                    if self.hasActiveUserScrollGesture {
                        self.recordCompanionTranscriptPosition()
                    }
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
                        if self.transcriptRestore != nil {
                            self.transcriptRestore = nil
                        }
                        self.hasActiveUserScrollGesture = true
                        if nextScrollState.isNearBottom == false {
                            self.detachAutoFollow()
                            return
                        }
                    }

                    if nextPhase == .idle {
                        let didCompleteUserScrollGesture: Bool = self.hasActiveUserScrollGesture
                        self.hasActiveUserScrollGesture = false
                        // Only the reader moves the place; a list coming on screen settles before its restore.
                        defer {
                            if didCompleteUserScrollGesture {
                                self.recordCompanionTranscriptPosition()
                            }
                        }
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
                .overlay {
                    // Keep the empty state's internal scroll view outside transcript tracking.
                    if self.chatStore.messages.isEmpty {
                        self.emptyChatState
                    }
                }
                .contentShape(Rectangle())
                .onTapGesture {
                    self.dismissComposerFocus()
                }
                .onAppear {
                    self.restoreTranscriptPosition(proxy: proxy)
                }
                .onChange(of: self.isPresentationActive) { _, isVisible in
                    guard isVisible else {
                        return
                    }

                    self.restoreTranscriptPosition(proxy: proxy)
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
                        self.recordCompanionTranscriptPosition()
                        return
                    }

                    guard self.isAutoFollowEnabled, self.isPresentationActive else {
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
        List {
            Section {
                let messages = self.frozenTranscriptMessages ?? self.chatStore.messages
                if messages.isEmpty == false {
                    let tailMessageId: String? = messages.last?.id

                    ForEach(messages) { message in
                        AIChatMessageRow(
                            message: message,
                            isRunActive: message.role == .assistant
                                && message.id == tailMessageId
                                && self.chatStore.isStreaming,
                            repairStatus: self.repairStatus(for: message),
                            showsTypingIndicator: aiChatShouldShowTypingIndicator(
                                message: message,
                                isLastMessage: message.id == tailMessageId,
                                isStreaming: self.chatStore.isStreaming,
                                optimisticAssistantMessageId: self.chatStore.optimisticOutgoingTurnState?.assistantMessageId
                            ),
                            disclosures: self.chatStore.transcriptDisclosures[message.id] ?? [:],
                            onSetDisclosure: { [chatStore = self.chatStore, messageId = message.id] key, isExpanded in
                                chatStore.setTranscriptDisclosure(messageId: messageId, key: key, isExpanded: isExpanded)
                            },
                            onExpandContent: {
                                self.detachAutoFollowForExpandedContent()
                            },
                            onOpenAccountStatus: {
                                self.navigation.openSettings(destination: .accountStatus)
                            }
                        )
                        .equatable()
                        .modifier(AIChatTranscriptRowFrameTracking(
                            messageId: message.id,
                            layout: self.isCompanion ? self.transcriptLayout : nil,
                            restoredTopOffset: self.transcriptRestore?.messageId == message.id
                                ? self.transcriptRestore?.topOffset
                                : nil
                        ))
                        .macToolbarScrollSurface("chat")
                        .id(message.id)
                        .listRowInsets(EdgeInsets(
                            top: 0,
                            leading: self.chatContentHorizontalPadding,
                            bottom: 0,
                            trailing: self.chatContentHorizontalPadding
                        ))
                        .listRowSeparator(.hidden)
                        .listRowBackground(Color.clear)
                    }
                }

                // Keep the transcript section mounted while its dynamic rows mutate.
                Color.clear
                    .frame(height: 0)
                    .listRowInsets(EdgeInsets())
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
                    .accessibilityHidden(true)
                    .allowsHitTesting(false)
            }

            Section {
                // This separate section keeps the target fixed at section 1, item 0.
                Color.clear
                    .frame(height: 0)
                    .macToolbarScrollSurface("chat")
                    .id(AIChatTranscriptScrollTarget.bottom)
                    .listRowInsets(EdgeInsets())
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
                    .accessibilityHidden(true)
                    .allowsHitTesting(false)
            }
        }
        .listStyle(.plain)
        .listSectionSpacing(0)
        .listRowSpacing(12)
        .environment(\.defaultMinListRowHeight, 0)
        .scrollContentBackground(.hidden)
        .modifier(AIChatTranscriptTopEdgeEffect())
    }
}

/// Text scrolled under the bar controls fades out beneath them, as under any Liquid Glass bar; iOS 18 bars carry
/// their own material.
private struct AIChatTranscriptTopEdgeEffect: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content.scrollEdgeEffectStyle(.soft, for: .top)
        } else {
            content
        }
    }
}

/// Frames of the side chat's rows on screen and the top of its viewport, in window space; a List row has no scroll
/// view space of its own. Written as the transcript scrolls, so it stays out of SwiftUI state; read when the side chat
/// records where the reader is.
@MainActor
final class AIChatTranscriptLayout {
    var rowFrames: [String: CGRect] = [:]
    var viewportTop: CGFloat = 0
    /// The restored row that has placed itself; any other restored row is not on screen yet.
    var placedRestoreMessageId: String? = nil
}

/// A restored place the side chat holds until the reader scrolls.
struct AIChatTranscriptRestore: Equatable {
    let messageId: String
    let topOffset: CGFloat
}

/// Only the side chat tracks its rows; the AI tab's chat opens at its newest message.
private struct AIChatTranscriptRowFrameTracking: ViewModifier {
    let messageId: String
    let layout: AIChatTranscriptLayout?
    let restoredTopOffset: CGFloat?

    func body(content: Content) -> some View {
        if let layout = self.layout {
            content
                .onGeometryChange(for: CGRect.self) { geometry in
                    geometry.frame(in: .global)
                } action: { frame in
                    layout.rowFrames[self.messageId] = frame
                }
                .onDisappear {
                    layout.rowFrames[self.messageId] = nil
                }
                .background {
                    if let restoredTopOffset = self.restoredTopOffset {
                        AIChatTranscriptRowOffsetRestorer(
                            layout: layout,
                            messageId: self.messageId,
                            topOffset: restoredTopOffset
                        )
                            .allowsHitTesting(false)
                            .accessibilityHidden(true)
                    }
                }
        } else {
            content
        }
    }
}

/// A List's `scrollTo` places a row only at the viewport's top, center or bottom. While the restored row is on screen,
/// this view behind it moves the List's own scroll view so the row's top sits where the reader left it: at once as the
/// section comes on screen, so the first frame already shows the place, then again whenever the List's content size
/// changes, since an unfinished size can clamp the offset short. A touch on the transcript ends it.
private struct AIChatTranscriptRowOffsetRestorer: UIViewRepresentable {
    let layout: AIChatTranscriptLayout
    let messageId: String
    let topOffset: CGFloat

    func makeUIView(context: Context) -> RestorerView {
        RestorerView()
    }

    func updateUIView(_ view: RestorerView, context: Context) {
        view.layout = self.layout
        view.messageId = self.messageId
        view.topOffset = self.topOffset
        view.restoreNowAndAfterLayout()
    }

    final class RestorerView: UIView {
        weak var layout: AIChatTranscriptLayout?
        var messageId: String = ""
        var topOffset: CGFloat = 0
        private weak var observedScrollView: UIScrollView?
        private var contentSizeObservation: NSKeyValueObservation?
        private var isCancelled: Bool = false

        override func didMoveToWindow() {
            super.didMoveToWindow()
            if self.window == nil {
                self.stopObserving()
            } else {
                self.restoreNowAndAfterLayout()
            }
        }

        func restoreNowAndAfterLayout() {
            self.restore()
            DispatchQueue.main.async { [weak self] in
                self?.restore()
            }
        }

        private func restore() {
            guard self.isCancelled == false, self.window != nil, let layout = self.layout else { return }
            layout.placedRestoreMessageId = self.messageId
            var ancestor = self.superview
            while let view = ancestor, (view is UIScrollView) == false {
                ancestor = view.superview
            }
            guard let scrollView = ancestor as? UIScrollView else { return }
            if scrollView.isTracking || scrollView.isDragging || scrollView.isDecelerating {
                self.isCancelled = true
                self.stopObserving()
                return
            }
            self.observe(scrollView)
            let distance = self.convert(self.bounds, to: nil).minY - (layout.viewportTop - self.topOffset)
            guard abs(distance) >= 0.5 else { return }
            let minimumOffset = -scrollView.adjustedContentInset.top
            let maximumOffset = max(
                minimumOffset,
                scrollView.contentSize.height + scrollView.adjustedContentInset.bottom - scrollView.bounds.height
            )
            let offset = min(max(scrollView.contentOffset.y + distance, minimumOffset), maximumOffset)
            scrollView.setContentOffset(CGPoint(x: scrollView.contentOffset.x, y: offset), animated: false)
        }

        private func observe(_ scrollView: UIScrollView) {
            guard self.observedScrollView !== scrollView else { return }
            self.stopObserving()
            self.observedScrollView = scrollView
            self.contentSizeObservation = scrollView.observe(\.contentSize, options: [.new]) { [weak self] _, _ in
                MainActor.assumeIsolated {
                    self?.restore()
                }
            }
        }

        private func stopObserving() {
            self.contentSizeObservation?.invalidate()
            self.contentSizeObservation = nil
            self.observedScrollView = nil
        }
    }
}
