import SwiftUI

enum ReviewCardScrollTarget: Hashable {
    case front
    case back
}

enum ReviewCardScrollSpace {
    case content
}

struct ReviewWidgetAnswerFrame: Equatable {
    let request: UUID
    let rect: CGRect
}

struct ReviewCardScrollView<Content: View>: View {
    let cardId: String
    let isAnswerVisible: Bool
    let widgetAnswerScrollRequest: UUID?
    @ViewBuilder let content: (@escaping (ReviewWidgetAnswerFrame?) -> Void) -> Content

    @Environment(ReviewScreenModel.self) private var reviewScreen: ReviewScreenModel
    @State private var position: ScrollPosition
    @State private var widgetAnswerFrame: ReviewWidgetAnswerFrame?
    @State private var widgetAnswerViewport: ReviewCardScrollViewport?

    init(
        cardId: String,
        isAnswerVisible: Bool,
        widgetAnswerScrollRequest: UUID?,
        @ViewBuilder content: @escaping (@escaping (ReviewWidgetAnswerFrame?) -> Void) -> Content
    ) {
        self.cardId = cardId
        self.isAnswerVisible = isAnswerVisible
        self.widgetAnswerScrollRequest = widgetAnswerScrollRequest
        self.content = content
        self._position = State(initialValue: widgetAnswerScrollRequest == nil
            ? ScrollPosition(idType: ReviewCardScrollTarget.self, edge: .top)
            : ScrollPosition(id: ReviewCardScrollTarget.back, anchor: .top))
    }

    var body: some View {
        let presentation = self.presentation
        let isPositioningWidgetAnswer = presentation.widgetAnswerScrollRequest != nil
        ScrollViewReader { proxy in
            ScrollView {
                self.content { frame in
                    self.widgetAnswerFrame = frame
                    self.finishWidgetAnswerScroll(presentation: presentation)
                }
                .coordinateSpace(name: ReviewCardScrollSpace.content)
            }
            .scrollPosition(self.$position)
            .onScrollGeometryChange(for: ReviewCardScrollViewport.self) { geometry in
                ReviewCardScrollViewport(
                    request: presentation.widgetAnswerScrollRequest,
                    offsetY: geometry.contentOffset.y + geometry.contentInsets.top,
                    height: geometry.containerSize.height
                )
            } action: { _, viewport in
                if isPositioningWidgetAnswer {
                    self.widgetAnswerViewport = viewport
                    self.finishWidgetAnswerScroll(presentation: presentation)
                } else {
                    self.reviewScreen.cardScrollOffset = ReviewCardScrollOffset(cardId: presentation.cardId, y: viewport.offsetY)
                }
            }
            .onChange(of: presentation, initial: true) { previous, current in
                if current.widgetAnswerScrollRequest != nil {
                    self.position.scrollTo(id: ReviewCardScrollTarget.back, anchor: .top)
                } else if previous == current {
                    if let offset = self.reviewScreen.cardScrollOffset, offset.cardId == current.cardId {
                        self.position.scrollTo(y: offset.y)
                    } else if current.target == .front {
                        self.position.scrollTo(edge: .top)
                    } else {
                        proxy.scrollTo(current.target, anchor: .top)
                    }
                } else if previous.cardId != current.cardId || previous.target != current.target {
                    proxy.scrollTo(current.target, anchor: .top)
                }
            }
            .opacity(isPositioningWidgetAnswer ? 0 : 1)
            .allowsHitTesting(!isPositioningWidgetAnswer)
            .accessibilityHidden(isPositioningWidgetAnswer)
            .overlay {
                if isPositioningWidgetAnswer {
                    ProgressView()
                        .controlSize(.large)
                }
            }
        }
    }

    private func finishWidgetAnswerScroll(presentation: ReviewCardScrollPresentation) {
        guard let request = presentation.widgetAnswerScrollRequest,
              let viewport = self.widgetAnswerViewport, viewport.request == request,
              let answerFrame = self.widgetAnswerFrame, answerFrame.request == request,
              answerFrame.rect.height > 0, viewport.height > 0 else {
            return
        }
        // Back may be shorter than the viewport and reach the end before it aligns to the top.
        let readableHeight = min(answerFrame.rect.height, viewport.height)
        let alignmentTolerance: CGFloat = 1
        guard viewport.offsetY <= answerFrame.rect.minY + alignmentTolerance,
              viewport.offsetY + viewport.height >= answerFrame.rect.minY + readableHeight - alignmentTolerance,
              self.reviewScreen.consumeWidgetAnswerScrollRequest(request, cardId: presentation.cardId) else {
            return
        }
        self.position.scrollTo(y: viewport.offsetY)
        self.reviewScreen.cardScrollOffset = ReviewCardScrollOffset(cardId: presentation.cardId, y: viewport.offsetY)
    }

    private var presentation: ReviewCardScrollPresentation {
        ReviewCardScrollPresentation(
            cardId: self.cardId,
            target: self.isAnswerVisible ? .back : .front,
            widgetAnswerScrollRequest: self.widgetAnswerScrollRequest
        )
    }
}

private struct ReviewCardScrollPresentation: Equatable {
    let cardId: String
    let target: ReviewCardScrollTarget
    let widgetAnswerScrollRequest: UUID?
}

private struct ReviewCardScrollViewport: Equatable {
    let request: UUID?
    let offsetY: CGFloat
    let height: CGFloat
}
