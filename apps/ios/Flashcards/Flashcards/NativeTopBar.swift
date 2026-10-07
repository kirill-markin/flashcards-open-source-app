import SwiftUI

extension View {
    @ViewBuilder
    func nativeTopBar<Content: View>(
        alignment: HorizontalAlignment,
        @ViewBuilder content: () -> Content
    ) -> some View {
        if #available(iOS 26.0, *) {
            self.safeAreaBar(edge: .top, alignment: alignment, spacing: 0, content: content)
        } else {
            self.safeAreaInset(edge: .top, alignment: alignment, spacing: 0) {
                content()
                    .frame(maxWidth: .infinity, alignment: Alignment(horizontal: alignment, vertical: .center))
                    .background(.bar)
            }
        }
    }
}
