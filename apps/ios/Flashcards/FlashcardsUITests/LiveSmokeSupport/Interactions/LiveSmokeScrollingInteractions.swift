import XCTest

extension LiveSmokeTestCase {
    @MainActor
    func scrollSettingsRootContent(timeout: TimeInterval) throws {
        let settingsList = self.app.collectionViews[LiveSmokeIdentifier.settingsScreen].firstMatch
        guard settingsList.exists else {
            throw LiveSmokeFailure.missingElement(
                identifier: LiveSmokeIdentifier.settingsScreen,
                timeoutSeconds: timeout,
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }

        #if targetEnvironment(macCatalyst)
        // The Settings collection also spans the sidebar; aim inside its right content area.
        settingsList.coordinate(withNormalizedOffset: CGVector(dx: 0.75, dy: 0.5))
            .scroll(byDeltaX: 0, deltaY: -120)
        #else
        let frame = settingsList.frame.intersection(self.app.frame)
        let navigationBar = self.app.navigationBars.firstMatch
        let tabBar = self.app.tabBars.firstMatch
        let top = max(frame.minY, navigationBar.exists ? navigationBar.frame.maxY : frame.minY)
        let bottom = tabBar.exists && tabBar.frame.minY > top ? min(frame.maxY, tabBar.frame.minY) : frame.maxY
        guard bottom > top else {
            throw LiveSmokeFailure.unexpectedAccountState(
                message: "Settings has no visible content viewport.",
                screen: self.currentScreenSummary(), step: self.currentStepTitle
            )
        }
        let origin = self.app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
        let start = origin.withOffset(CGVector(dx: frame.midX - self.app.frame.minX, dy: top + (bottom - top) * 0.75 - self.app.frame.minY))
        let end = origin.withOffset(CGVector(dx: frame.midX - self.app.frame.minX, dy: top + (bottom - top) * 0.25 - self.app.frame.minY))
        start.press(forDuration: 0, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.2)
        #endif
    }

    @MainActor
    func scrollSettingsRootContentTowardEarlierRows(timeout: TimeInterval) throws {
        let settingsList = self.app.collectionViews[LiveSmokeIdentifier.settingsScreen].firstMatch
        guard settingsList.exists else {
            throw LiveSmokeFailure.missingElement(
                identifier: LiveSmokeIdentifier.settingsScreen,
                timeoutSeconds: timeout,
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }

        #if targetEnvironment(macCatalyst)
        settingsList.coordinate(withNormalizedOffset: CGVector(dx: 0.75, dy: 0.5))
            .scroll(byDeltaX: 0, deltaY: 120)
        #else
        let frame = settingsList.frame.intersection(self.app.frame)
        let navigationBar = self.app.navigationBars.firstMatch
        let tabBar = self.app.tabBars.firstMatch
        let top = max(frame.minY, navigationBar.exists ? navigationBar.frame.maxY : frame.minY)
        let bottom = tabBar.exists && tabBar.frame.minY > top ? min(frame.maxY, tabBar.frame.minY) : frame.maxY
        guard bottom > top else {
            throw LiveSmokeFailure.unexpectedAccountState(
                message: "Settings has no visible content viewport.",
                screen: self.currentScreenSummary(), step: self.currentStepTitle
            )
        }
        let origin = self.app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
        let start = origin.withOffset(CGVector(dx: frame.midX - self.app.frame.minX, dy: top + (bottom - top) * 0.25 - self.app.frame.minY))
        let end = origin.withOffset(CGVector(dx: frame.midX - self.app.frame.minX, dy: top + (bottom - top) * 0.75 - self.app.frame.minY))
        start.press(forDuration: 0, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.2)
        #endif
    }

    @MainActor
    func scrollBestEffort() {
        let collectionView = self.app.collectionViews.firstMatch
        if collectionView.exists {
            collectionView.swipeUp()
            return
        }

        let scrollView = self.app.scrollViews.firstMatch
        if scrollView.exists {
            scrollView.swipeUp()
            return
        }

        let table = self.app.tables.firstMatch
        if table.exists {
            table.swipeUp()
            return
        }

        self.app.swipeUp()
    }
}
