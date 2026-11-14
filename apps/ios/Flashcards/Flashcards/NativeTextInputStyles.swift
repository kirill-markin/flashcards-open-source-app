import SwiftUI

extension View {
    @ViewBuilder
    func nativeTextInputFocusTarget(isFocused: FocusState<Bool>.Binding) -> some View {
        #if targetEnvironment(macCatalyst)
        self
        #else
        self.background {
            Color.clear
                .contentShape(Rectangle())
                .onTapGesture { isFocused.wrappedValue = true }
                .accessibilityHidden(true)
        }
        #endif
    }

    func nativeTextInputBackground(cornerRadius: CGFloat, isInteractive: Bool = true) -> some View {
        self.modifier(NativeTextInputBackground(cornerRadius: cornerRadius, isInteractive: isInteractive))
    }
}

private struct NativeTextInputBackground: ViewModifier {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    let cornerRadius: CGFloat
    let isInteractive: Bool

    @ViewBuilder
    func body(content: Content) -> some View {
        #if targetEnvironment(macCatalyst)
        content
        #else
        let shape = RoundedRectangle(cornerRadius: self.cornerRadius, style: .continuous)
        if self.reduceTransparency {
            content
                .background(Color(uiColor: .tertiarySystemFill), in: shape)
                .background(Color(uiColor: .secondarySystemBackground), in: shape)
        } else if #available(iOS 26.0, *) {
            content.glassEffect(.regular.interactive(self.isInteractive), in: shape)
        } else {
            content.background(.thinMaterial, in: shape)
        }
        #endif
    }
}
