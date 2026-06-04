import Foundation
import XCTest

private struct LiveSmokeTabBarItemCandidate {
    let element: XCUIElement
    let identifier: String
    let note: String
}

extension LiveSmokeTestCase {
    @MainActor
    func tapTabBarItem(selectedTab: LiveSmokeSelectedTab, timeout: TimeInterval) throws {
        try self.runWithInlineRawScreenStateOnFailure(action: "tap_tab.\(selectedTab.rawValue)") {
            let tabBarItemLookup = selectedTab.tabBarItemLookup(localization: self.currentLaunchLocalization)
            let tabBarItemCandidates = self.tabBarItemCandidates(lookup: tabBarItemLookup)
            let deadline = Date().addingTimeInterval(timeout)

            while Date() < deadline {
                for candidate in tabBarItemCandidates {
                    if candidate.element.exists && candidate.element.isHittable {
                        try self.tapExistingElement(
                            candidate.element,
                            identifier: candidate.identifier,
                            action: "tap_tab",
                            note: candidate.note
                        )
                        return
                    }
                }

                RunLoop.current.run(until: Date(timeIntervalSinceNow: liveSmokeFocusPollIntervalSeconds))
            }

            throw LiveSmokeFailure.missingElement(
                identifier: self.tabBarLookupDescription(selectedTab: selectedTab, lookup: tabBarItemLookup),
                timeoutSeconds: timeout,
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }
    }

    @MainActor
    func tapTabBarItem(identifier: String, timeout: TimeInterval) throws {
        try self.runWithInlineRawScreenStateOnFailure(action: "tap_tab.\(identifier)") {
            let tabBarItem = self.app.tabBars.descendants(matching: .any).matching(identifier: identifier).firstMatch
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
    private func tabBarItemCandidates(lookup: LiveSmokeTabBarItemLookup) -> [LiveSmokeTabBarItemCandidate] {
        return [
            LiveSmokeTabBarItemCandidate(
                element: self.app.tabBars.buttons.matching(identifier: lookup.identifier).firstMatch,
                identifier: lookup.identifier,
                note: "tab bar button tapped via accessibility identifier"
            ),
            LiveSmokeTabBarItemCandidate(
                element: self.app.tabBars.buttons[lookup.localizedTitle].firstMatch,
                identifier: "tab.\(lookup.localizedTitle)",
                note: "tab bar button tapped via localized label fallback"
            ),
            LiveSmokeTabBarItemCandidate(
                element: self.app.tabBars.buttons.element(boundBy: lookup.stableIndex),
                identifier: "tab.index.\(lookup.stableIndex)",
                note: "tab bar button tapped via stable index fallback"
            )
        ]
    }

    @MainActor
    private func tabBarLookupDescription(
        selectedTab: LiveSmokeSelectedTab,
        lookup: LiveSmokeTabBarItemLookup
    ) -> String {
        let visibleTabButtons = self.visibleTabBarButtonSummary()
        return "tab.\(selectedTab.rawValue) tried identifier='\(lookup.identifier)' label='\(lookup.localizedTitle)' index=\(lookup.stableIndex) visibleButtons=[\(visibleTabButtons)]"
    }

    @MainActor
    private func visibleTabBarButtonSummary() -> String {
        let visibleButtons = self.elements(query: self.app.tabBars.buttons).enumerated().map { index, button in
            let label = button.label.trimmingCharacters(in: .whitespacesAndNewlines)
            let identifier = button.identifier.trimmingCharacters(in: .whitespacesAndNewlines)
            let resolvedLabel = label.isEmpty ? "-" : label
            let resolvedIdentifier = identifier.isEmpty ? "-" : identifier
            return "\(resolvedLabel){index=\(index),id=\(resolvedIdentifier)}"
        }

        if visibleButtons.isEmpty {
            return "<none>"
        }

        return visibleButtons.joined(separator: ", ")
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
        element.tap()
        self.logActionEnd(action: action, identifier: identifier, result: "success", note: note)
    }
}
