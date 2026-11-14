import SwiftUI

// Scaled-iPad Catalyst renders at 77%: 48 UIKit points give a 36.96-point Mac target.
// Native toolbar/menu controls keep their system sizing and input adaptation.
let appMinimumTouchTarget: CGFloat = {
    #if targetEnvironment(macCatalyst)
    48
    #else
    44
    #endif
}()

extension View {
    @ViewBuilder
    func nativeInlineActionButtonStyle() -> some View {
        #if targetEnvironment(macCatalyst)
        self.buttonStyle(.borderless)
        #else
        self.buttonStyle(.plain)
        #endif
    }

    @ViewBuilder
    func nativeActionButtonStyle() -> some View {
        if #available(iOS 26.0, *) {
            self.buttonStyle(.glass)
        } else {
            self.buttonStyle(.bordered)
        }
    }

    /// An active toolbar control shows its filled glyph in the accent color; an inactive one stays primary. Glass
    /// items in a navigation bar draw their label monochrome and ignore the tint, so the color is also set directly;
    /// the controls using this are never disabled, so no disabled dimming is lost.
    func nativeToolbarState(isActive: Bool) -> some View {
        self.tint(isActive ? Color.accentColor : Color.primary)
            .foregroundStyle(isActive ? Color.accentColor : Color.primary)
            .symbolVariant(isActive ? .fill : .none)
    }

    /// The glyph of an icon-only toolbar control in the regular toolbar layout.
    func nativeToolbarIconLabel() -> some View {
        self.font(.title3)
            .frame(minWidth: 30, minHeight: 30)
            .contentShape(Rectangle())
    }

    /// An icon-only toolbar control with its own glass in the regular toolbar layout. Its label uses
    /// `nativeToolbarIconLabel()`, so every such control is the same 44-point circle.
    func nativeToolbarIconButton() -> some View {
        self.labelStyle(.iconOnly)
            .nativeActionButtonStyle()
            .buttonBorderShape(.circle)
            .controlSize(.regular)
            .frame(minWidth: appMinimumTouchTarget, minHeight: appMinimumTouchTarget)
            .contentShape(Rectangle())
    }

    @ViewBuilder
    func nativeProminentActionButtonStyle() -> some View {
        if #available(iOS 26.0, *) {
            self.buttonStyle(.glassProminent)
        } else {
            self.buttonStyle(.borderedProminent)
        }
    }
}

extension EnvironmentValues {
    /// iPad and Duo's inner display, a phone window with regular width, share one toolbar layout: no top-level section
    /// titles, the AI companion's controls in the host bar, and equal icon controls. Mac has its own toolbar.
    @Entry var usesRegularToolbarLayout: Bool = false
}
