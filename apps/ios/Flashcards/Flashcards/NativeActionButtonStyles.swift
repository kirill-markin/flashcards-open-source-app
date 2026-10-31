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

// System toolbar controls own their metrics; retain only the existing iPad label target.
var nativeToolbarLabelMinimumDimension: CGFloat? {
    #if targetEnvironment(macCatalyst)
    nil
    #else
    UIDevice.current.userInterfaceIdiom == .pad ? 30 : nil
    #endif
}

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

    @ViewBuilder
    func nativeProminentActionButtonStyle() -> some View {
        if #available(iOS 26.0, *) {
            self.buttonStyle(.glassProminent)
        } else {
            self.buttonStyle(.borderedProminent)
        }
    }
}
