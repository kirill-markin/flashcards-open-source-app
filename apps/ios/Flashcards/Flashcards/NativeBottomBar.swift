import SwiftUI

extension View {
    @ViewBuilder
    func nativeBottomBar<Content: View>(
        alignment: HorizontalAlignment,
        usesColumnLayout: Bool = false,
        showsBackground: Bool = true,
        @ViewBuilder content: () -> Content
    ) -> some View {
        if usesColumnLayout {
            // Keep the accessory in the same layout proposal as its content.
            // Floating keyboards must not relocate an independent safe-area bar.
            VStack(spacing: 0) {
                self.frame(maxWidth: .infinity, maxHeight: .infinity)
                content()
                    .frame(maxWidth: .infinity, alignment: Alignment(horizontal: alignment, vertical: .center))
                    // Extend the decorative style through the bottom safe area;
                    // foreground controls remain inside the column's layout bounds.
                    .background(
                        showsBackground ? AnyShapeStyle(.bar) : AnyShapeStyle(Color.clear),
                        ignoresSafeAreaEdges: .bottom
                    )
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if #available(iOS 26.0, *), showsBackground {
            self.safeAreaBar(edge: .bottom, alignment: alignment, spacing: 0, content: content)
        } else {
            self.safeAreaInset(edge: .bottom, alignment: alignment, spacing: 0) {
                content()
                    .frame(maxWidth: .infinity, alignment: Alignment(horizontal: alignment, vertical: .center))
                    .background(showsBackground ? AnyShapeStyle(.bar) : AnyShapeStyle(Color.clear))
            }
        }
    }
}
