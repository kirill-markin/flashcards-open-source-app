import XCTest

extension LiveSmokeTestCase {
    #if targetEnvironment(macCatalyst)
    @MainActor
    func macSettingsContentViewport(_ settingsList: XCUIElement) throws -> CGRect {
        let windows = self.app.children(matching: .window)
            .containing(.any, identifier: LiveSmokeIdentifier.settingsScreen)
        guard windows.count == 1 else {
            throw LiveSmokeFailure.unexpectedAccountState(
                message: "Expected one native Settings window; found \(windows.count).",
                screen: self.currentScreenSummary(), step: self.currentStepTitle
            )
        }
        let window = windows.element.frame
        let frame = settingsList.frame.intersection(window)
        // UIKit also exposes a full-window Toolbar proxy; retain only titlebar chrome.
        let toolbars = self.app.toolbars.allElementsBoundByIndex.map(\.frame).filter {
            abs($0.minY - window.minY) <= 1 && abs($0.width - window.width) <= 1
                && $0.height > 0 && $0.height < window.height / 2
        }
        guard toolbars.count == 1, let toolbar = toolbars.first else {
            throw LiveSmokeFailure.unexpectedAccountState(
                message: "Expected one native Settings titlebar toolbar; found \(toolbars.count).",
                screen: self.currentScreenSummary(), step: self.currentStepTitle
            )
        }
        let top = max(frame.minY, toolbar.maxY)
        return CGRect(x: frame.minX, y: top, width: frame.width, height: max(0, frame.maxY - top))
    }
    #endif

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
        settingsList.swipeUp(velocity: .slow)
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
        settingsList.swipeDown(velocity: .slow)
        #endif
    }

    @MainActor
    func scrollBestEffort() {
        #if targetEnvironment(macCatalyst)
        // The adaptive tab sidebar is also a collection view. Scroll the largest
        // visible content surface rather than whichever collection appears first.
        let window = self.app.windows.firstMatch.frame
        let surfaces = self.elements(query: self.app.collectionViews)
            + self.elements(query: self.app.scrollViews)
            + self.elements(query: self.app.tables)
        let surface = surfaces.filter { $0.isHittable }.max { left, right in
            let a = left.frame.intersection(window)
            let b = right.frame.intersection(window)
            return a.width * a.height < b.width * b.height
        }
        (surface ?? self.app).scrollTowardLaterContent()
        #else
        let collectionView = self.app.collectionViews.firstMatch
        if collectionView.exists {
            collectionView.scrollTowardLaterContent()
            return
        }

        let scrollView = self.app.scrollViews.firstMatch
        if scrollView.exists {
            scrollView.scrollTowardLaterContent()
            return
        }

        let table = self.app.tables.firstMatch
        if table.exists {
            table.scrollTowardLaterContent()
            return
        }

        self.app.scrollTowardLaterContent()
        #endif
    }
}

extension XCUIElement {
    @MainActor
    func scrollTowardLaterContent() {
        #if targetEnvironment(macCatalyst)
        // Keep the pointer inside content when a Catalyst collection also spans the sidebar.
        self.coordinate(withNormalizedOffset: CGVector(dx: 0.75, dy: 0.5))
            .scroll(byDeltaX: 0, deltaY: -240)
        #else
        self.swipeUp()
        #endif
    }

    @MainActor
    func scrollTowardEarlierContent() {
        #if targetEnvironment(macCatalyst)
        self.coordinate(withNormalizedOffset: CGVector(dx: 0.75, dy: 0.5))
            .scroll(byDeltaX: 0, deltaY: 240)
        #else
        self.swipeDown()
        #endif
    }
}
