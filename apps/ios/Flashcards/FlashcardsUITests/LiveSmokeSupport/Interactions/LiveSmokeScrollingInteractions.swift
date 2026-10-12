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
        settingsList.swipeUp()
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
        settingsList.swipeDown()
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
