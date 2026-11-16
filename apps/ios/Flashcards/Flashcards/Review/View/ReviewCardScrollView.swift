import SwiftUI

enum ReviewCardScrollTarget: Hashable {
    case front
    case back
}

struct ReviewCardScrollView<Content: View>: View {
    let cardId: String
    let isAnswerVisible: Bool
    @ViewBuilder let content: () -> Content

    @Environment(ReviewScreenModel.self) private var reviewScreen: ReviewScreenModel
    @State private var position = ScrollPosition(edge: .top)

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(content: self.content)
                .scrollPosition(self.$position)
                .onScrollGeometryChange(for: CGFloat.self) { geometry in
                    geometry.contentOffset.y + geometry.contentInsets.top
                } action: { _, offsetY in
                    self.reviewScreen.cardScrollOffset = ReviewCardScrollOffset(cardId: self.cardId, y: offsetY)
                }
                .onAppear(perform: self.restoreOffset)
                .onChange(of: self.isAnswerVisible) { wasVisible, isVisible in
                    if !wasVisible && isVisible {
                        proxy.scrollTo(ReviewCardScrollTarget.back, anchor: .top)
                    }
                }
                .onChange(of: self.cardId) {
                    proxy.scrollTo(ReviewCardScrollTarget.front, anchor: .top)
                }
        }
    }

    private func restoreOffset() {
        guard let offset = self.reviewScreen.cardScrollOffset, offset.cardId == self.cardId else {
            self.position.scrollTo(edge: .top)
            return
        }
        self.position.scrollTo(y: offset.y)
    }
}
