import SwiftUI
import UIKit

/// Read inside each native Tab, where the actual tab-bar placement is available.
struct TabSidebarVisibilityReader: ViewModifier {
    @Environment(\.tabBarPlacement) private var placement
    @Environment(AppNavigationModel.self) private var navigation
    let tab: AppTab

    private func updatePlacement(_ placement: TabBarPlacement?) {
        // Leading-side docking is available only on iPad with native top navigation.
        self.navigation.isAICompanionLeadingAvailable = placement == .topBar
            && UIDevice.current.userInterfaceIdiom == .pad
    }

    func body(content: Content) -> some View {
        content
            .onChange(of: self.placement, initial: true) { _, placement in
                if self.navigation.selectedTab == self.tab {
                    self.updatePlacement(placement)
                }
            }
            .onChange(of: self.navigation.selectedTab) { _, selectedTab in
                if selectedTab == self.tab {
                    self.updatePlacement(self.placement)
                }
            }
    }
}
