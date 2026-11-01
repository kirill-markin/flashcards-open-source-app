import Foundation
import XCTest

extension LiveSmokeTestCase {
    @MainActor
    func tapTabBarItem(selectedTab: LiveSmokeSelectedTab, timeout: TimeInterval) throws {
        try self.tapTabBarItem(identifier: selectedTab.itemIdentifier, timeout: timeout)
    }

    @MainActor
    func tapTabBarItem(identifier: String, timeout: TimeInterval) throws {
        try self.runWithInlineRawScreenStateOnFailure(action: "tap_tab.\(identifier)") {
            let tabBarItem = self.app.descendants(matching: .any).matching(identifier: identifier).firstMatch
            let deadline = Date().addingTimeInterval(timeout)

            while Date() < deadline {
                if tabBarItem.exists && tabBarItem.isHittable {
                    try self.tapExistingElement(
                        tabBarItem,
                        identifier: identifier,
                        action: "tap_tab",
                        note: "tab bar item tapped"
                    )
                    return
                }

                RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.2))
            }

            throw LiveSmokeFailure.missingElement(
                identifier: identifier,
                timeoutSeconds: timeout,
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }
    }

    @MainActor
    func tapTabBarItem(named name: String, timeout: TimeInterval) throws {
        try self.runWithInlineRawScreenStateOnFailure(action: "tap_tab.\(name)") {
            let tabBarButton = self.app.tabBars.buttons[name].firstMatch
            let deadline = Date().addingTimeInterval(timeout)

            while Date() < deadline {
                if tabBarButton.exists && tabBarButton.isHittable {
                    try self.tapExistingButton(
                        tabBarButton,
                        identifier: "tab.\(name)",
                        action: "tap_tab",
                        note: "tab bar button tapped"
                    )
                    return
                }

                RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.2))
            }

            throw LiveSmokeFailure.missingElement(
                identifier: "tab.\(name)",
                timeoutSeconds: timeout,
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }
    }

    @MainActor
    private func tapExistingElement(
        _ element: XCUIElement,
        identifier: String,
        action: String,
        note: String
    ) throws {
        if element.elementType == .button {
            try self.tapExistingButton(
                element,
                identifier: identifier,
                action: action,
                note: note
            )
            return
        }

        self.logActionStart(action: action, identifier: identifier)
        element.clickOrTap()
        self.logActionEnd(action: action, identifier: identifier, result: "success", note: note)
    }
}
