import SwiftUI

func preferredNativeSearchToolbarBehavior(horizontalSizeClass: UserInterfaceSizeClass?) -> SearchToolbarBehavior {
    if horizontalSizeClass == .compact {
        return .minimize
    }

    return .automatic
}
