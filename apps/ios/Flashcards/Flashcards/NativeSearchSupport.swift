import SwiftUI

@available(iOS 26.0, *)
private func preferredNativeSearchToolbarBehavior(horizontalSizeClass: UserInterfaceSizeClass?) -> SearchToolbarBehavior {
    if horizontalSizeClass == .compact {
        return .minimize
    }

    return .automatic
}

extension View {
    @ViewBuilder
    func nativeSearchToolbar(horizontalSizeClass: UserInterfaceSizeClass?) -> some View {
        if #available(iOS 26.0, *) {
            self.searchToolbarBehavior(preferredNativeSearchToolbarBehavior(horizontalSizeClass: horizontalSizeClass))
        } else {
            self
        }
    }
}
