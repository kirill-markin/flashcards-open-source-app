import SwiftUI

let flashcardsReadableContentMaxWidth: CGFloat = 820
let flashcardsReadableFormMaxWidth: CGFloat = 720

struct ReadableContentLayout<Content: View>: View {
    private let maxWidth: CGFloat
    private let horizontalPadding: CGFloat
    private let alignment: Alignment
    private let content: Content

    init(
        maxWidth: CGFloat,
        horizontalPadding: CGFloat,
        alignment: Alignment = .leading,
        @ViewBuilder content: () -> Content
    ) {
        self.maxWidth = maxWidth
        self.horizontalPadding = horizontalPadding
        self.alignment = alignment
        self.content = content()
    }

    var body: some View {
        HStack(spacing: 0) {
            Spacer(minLength: 0)

            self.content
                .frame(maxWidth: self.maxWidth, alignment: self.alignment)
                .frame(maxWidth: .infinity, alignment: self.alignment)

            Spacer(minLength: 0)
        }
        .padding(.horizontal, self.horizontalPadding)
        .frame(maxWidth: .infinity, alignment: .center)
    }
}
