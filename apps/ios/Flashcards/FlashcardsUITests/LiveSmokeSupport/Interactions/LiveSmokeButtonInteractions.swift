import Foundation
import XCTest

extension LiveSmokeTestCase {
    #if targetEnvironment(macCatalyst)
    @MainActor
    func macReviewStatusButtons(timeout: TimeInterval) throws -> (leaderboard: XCUIElement, streak: XCUIElement) {
        // NSToolbarItemGroup's momentary factory exposes numeric Button labels,
        // empty system-owned identifiers, and action descriptions only as AX Help.
        // Identify its native container, then retain the factory's action order.
        let deadline = Date().addingTimeInterval(timeout)
        var matches: [(window: XCUIElement, toolbar: XCUIElement, group: XCUIElement)] = []
        repeat {
            matches = self.app.windows.allElementsBoundByIndex.flatMap { window in
                window.children(matching: .toolbar).allElementsBoundByIndex.flatMap { toolbar in
                    toolbar.children(matching: .any).allElementsBoundByIndex.compactMap { group -> (window: XCUIElement, toolbar: XCUIElement, group: XCUIElement)? in
                        // XCUI retains the factory's inner segmented group;
                        // CUA's AX summary flattens that otherwise empty level.
                        guard group.elementType == .group, group.identifier.isEmpty,
                              group.descendants(matching: .button).count == 2,
                              group.children(matching: .group).count == 1,
                              group.children(matching: .group).firstMatch.children(matching: .button).count == 2 else { return nil }
                        return (window: window, toolbar: toolbar, group: group)
                    }
                }
            }
            if matches.count == 1 { break }
            RunLoop.current.run(until: Date(timeIntervalSinceNow: liveSmokeFocusPollIntervalSeconds))
        } while Date() < deadline

        let match = try XCTUnwrap(matches.count == 1 ? matches.first : nil,
            "Expected one anonymous two-Button factory group directly in the main window's native toolbar; found \(matches.count).")
        let buttons = match.group.descendants(matching: .button).allElementsBoundByIndex
        let pair = try XCTUnwrap(buttons.count == 2 ? (leaderboard: buttons[0], streak: buttons[1]) : nil,
            "Expected the native factory's two ordered Button children to remain present.")
        for button in buttons {
            XCTAssertEqual(button.elementType, .button)
            XCTAssertTrue(button.identifier.isEmpty, "Factory child identifiers belong to the system.")
            XCTAssertTrue(button.isEnabled && button.isHittable, "Native Review status buttons must accept independent clicks.")
            XCTAssertFalse(button.frame.isEmpty)
            XCTAssertTrue(match.group.frame.contains(button.frame))
            XCTAssertTrue(match.toolbar.frame.contains(button.frame))
            XCTAssertTrue(match.window.frame.contains(button.frame))
        }
        XCTAssertEqual(buttons[0].frame.midY, buttons[1].frame.midY, accuracy: 1)
        let frames = buttons.map(\.frame).sorted { $0.minX < $1.minX }
        XCTAssertLessThanOrEqual(frames[0].maxX, frames[1].minX + 0.5,
            "Native status buttons must have distinct, nonoverlapping hit regions.")
        return pair
    }

    /// macOS 26 XCUITest drops the accessibility identifiers of native toolbar items
    /// but keeps their labels, so Mac tests find exactly these items by English label.
    private func macToolbarItemLabel(identifier: String) -> NSPredicate? {
        switch identifier {
        // The Review filter's label is its applied filter; these are the ones the tests apply.
        case LiveSmokeIdentifier.reviewFilterMenu:
            return NSPredicate(format: "label IN %@", ["All cards", "smoke-guest-ai-review"])
        case "mac.sidebar.toggle": return NSPredicate(format: "label == %@", "Sidebar")
        case "mac.navigation.back": return NSPredicate(format: "label == %@", "Back")
        case LiveSmokeIdentifier.aiCompanionToggle:
            return NSPredicate(format: "label == %@ OR label == %@", "Show AI alongside", "Close AI pane")
        case LiveSmokeIdentifier.aiHistoryButton: return NSPredicate(format: "label == %@", "History")
        case LiveSmokeIdentifier.aiNewChatButton: return NSPredicate(format: "label == %@", "New")
        case "cards.filterButton": return NSPredicate(format: "label BEGINSWITH %@", "Filter cards")
        case LiveSmokeIdentifier.cardsAddButton: return NSPredicate(format: "label == %@", "Add card")
        default: return nil
        }
    }

    /// The native AI toggle conveys whether the companion is open only through its label.
    @MainActor
    func macAiCompanionIsOpen(toggle: XCUIElement) -> Bool {
        toggle.label == "Close AI pane"
    }
    #endif

    /// Every button a test addresses by `identifier`.
    @MainActor
    func buttons(identifier: String) -> XCUIElementQuery {
        #if targetEnvironment(macCatalyst)
        if let label = self.macToolbarItemLabel(identifier: identifier) {
            return self.app.toolbars.buttons.matching(label)
        }
        #endif
        return self.app.buttons.matching(identifier: identifier)
    }

    /// The element of any type a test addresses by `identifier`.
    @MainActor
    func element(identifier: String) -> XCUIElement {
        #if targetEnvironment(macCatalyst)
        if let label = self.macToolbarItemLabel(identifier: identifier) {
            return self.app.toolbars.buttons.matching(label).firstMatch
        }
        #endif
        return self.app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }

    @MainActor
    func tapButton(identifier: String, timeout: TimeInterval) throws {
        let button = self.buttons(identifier: identifier).firstMatch
        try self.tapButton(button: button, identifier: identifier, timeout: timeout)
    }

    @MainActor
    func tapButtonPreservingAlerts(identifier: String, timeout: TimeInterval) throws {
        let button = self.app.buttons[identifier].firstMatch
        try self.runWithInlineRawScreenStateOnFailure(action: "tap_button_preserving_alerts.\(identifier)") {
            if self.waitForOptionalElement(
                button,
                identifier: identifier,
                timeout: timeout
            ) == false {
                throw LiveSmokeFailure.missingElement(
                    identifier: identifier,
                    timeoutSeconds: timeout,
                    screen: self.currentScreenSummary(),
                    step: self.currentStepTitle
                )
            }

            if button.isEnabled == false {
                throw LiveSmokeFailure.disabledElement(
                    identifier: identifier,
                    screen: self.currentScreenSummary(),
                    step: self.currentStepTitle
                )
            }

            self.logActionStart(action: "tap_button_preserving_alerts", identifier: identifier)
            button.clickOrTap()
            self.logActionEnd(
                action: "tap_button_preserving_alerts",
                identifier: identifier,
                result: "success",
                note: "button tapped without alert dismissal"
            )
        }
    }

    @MainActor
    func tapButtonScrollingIntoView(identifier: String, timeout: TimeInterval) throws {
        let button = self.app.buttons[identifier].firstMatch
        try self.runWithInlineRawScreenStateOnFailure(action: "tap_button_scrolling_into_view.\(identifier)") {
            let deadline = Date().addingTimeInterval(timeout)

            while Date() < deadline {
                if button.exists && button.isHittable {
                    try self.tapExistingButton(
                        button,
                        identifier: identifier,
                        action: "tap_button_scrolling_into_view",
                        note: "button tapped after scrolling into view"
                    )
                    return
                }

                self.scrollBestEffort()
                RunLoop.current.run(until: Date(timeIntervalSinceNow: liveSmokeFocusPollIntervalSeconds))
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
    func tapSettingsButtonScrollingIntoView(identifier: String, timeout: TimeInterval) throws {
        let button = self.app.buttons[identifier].firstMatch
        let settingsList = self.app.collectionViews[LiveSmokeIdentifier.settingsScreen].firstMatch
        try self.runWithInlineRawScreenStateOnFailure(action: "tap_button_scrolling_into_view.\(identifier)") {
            let deadline = Date().addingTimeInterval(timeout)

            guard settingsList.exists else {
                throw LiveSmokeFailure.missingElement(
                    identifier: LiveSmokeIdentifier.settingsScreen,
                    timeoutSeconds: timeout,
                    screen: self.currentScreenSummary(),
                    step: self.currentStepTitle
                )
            }

            while Date() < deadline {
                #if targetEnvironment(macCatalyst)
                let viewport = try self.macSettingsContentViewport(settingsList)
                let isInsideVisibleContent = button.exists && button.frame.isEmpty == false
                    && viewport.contains(button.frame)
                #else
                let navigationBar = self.app.navigationBars.firstMatch
                let viewportTop = max(settingsList.frame.minY, navigationBar.exists ? navigationBar.frame.maxY : settingsList.frame.minY)
                let isInsideVisibleContent = true
                #endif
                if button.exists && button.isHittable && isInsideVisibleContent {
                    try self.tapExistingButton(
                        button,
                        identifier: identifier,
                        action: "tap_button_scrolling_into_view",
                        note: "button tapped after scrolling into view"
                    )
                    return
                }

                #if targetEnvironment(macCatalyst)
                let viewportTop = viewport.minY
                #endif
                if button.exists && button.frame.isEmpty == false && button.frame.minY < viewportTop {
                    try self.scrollSettingsRootContentTowardEarlierRows(timeout: timeout)
                } else {
                    try self.scrollSettingsRootContent(timeout: timeout)
                }
                RunLoop.current.run(until: Date(timeIntervalSinceNow: liveSmokeFocusPollIntervalSeconds))
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
    func tapButtonScrollingIntoViewPreservingAlerts(identifier: String, timeout: TimeInterval) throws {
        let button = self.app.buttons[identifier].firstMatch
        try self.runWithInlineRawScreenStateOnFailure(action: "tap_button_scrolling_into_view_preserving_alerts.\(identifier)") {
            let deadline = Date().addingTimeInterval(timeout)

            while Date() < deadline {
                if button.exists && button.isHittable {
                    try self.tapExistingButtonPreservingAlerts(
                        button,
                        identifier: identifier,
                        action: "tap_button_scrolling_into_view_preserving_alerts",
                        note: "button tapped after scrolling into view without alert dismissal"
                    )
                    return
                }

                self.scrollBestEffort()
                RunLoop.current.run(until: Date(timeIntervalSinceNow: liveSmokeFocusPollIntervalSeconds))
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
    func tapFirstNavigationBackButton() throws {
        var navigationBarButton = self.app.navigationBars.buttons["BackButton"].firstMatch
        let toolbarBackButton = self.app.toolbars.buttons["BackButton"].firstMatch
        #if targetEnvironment(macCatalyst)
        let compactToolbarBackButton = self.buttons(identifier: "mac.navigation.back").firstMatch
        #endif
        try self.runWithInlineRawScreenStateOnFailure(action: "tap_back_button.navigation.backButton") {
            #if !targetEnvironment(macCatalyst)
            if #unavailable(iOS 26.0), let source = try self.iOS18SettingsBackSource() {
                try self.tapBackToSettingsRoot(from: source)
                return
            }
            if #unavailable(iOS 26.0), let historyBackButton = try self.iOS18AIHistoryBackButton() {
                navigationBarButton = historyBackButton
            }
            if #unavailable(iOS 26.0), let editorBackButton = try self.iOS18CardEditorBackButton() {
                navigationBarButton = editorBackButton
            }
            #endif
            let timeout = LiveSmokeConfiguration.shortUiTimeoutSeconds
            self.logSmokeBreadcrumb(
                event: "wait_start",
                action: "wait_for_element",
                identifier: "navigation.backButton",
                timeoutSeconds: formatDuration(seconds: timeout),
                durationSeconds: "-",
                result: "start",
                note: "wait begins"
            )
            let startedAt = Date()
            let deadline = startedAt.addingTimeInterval(timeout)
            var backButton: XCUIElement?
            while Date() < deadline {
                if navigationBarButton.exists && navigationBarButton.isEnabled && navigationBarButton.isHittable {
                    backButton = navigationBarButton
                    break
                }
                if toolbarBackButton.exists && toolbarBackButton.isEnabled && toolbarBackButton.isHittable {
                    backButton = toolbarBackButton
                    break
                }
                #if targetEnvironment(macCatalyst)
                if compactToolbarBackButton.exists && compactToolbarBackButton.isEnabled && compactToolbarBackButton.isHittable {
                    backButton = compactToolbarBackButton
                    break
                }
                #else
                if #unavailable(iOS 26.0),
                   !navigationBarButton.exists,
                   !toolbarBackButton.exists,
                   let libraryTransferBackButton = self.iOS18LibraryTransferBackButton(),
                   libraryTransferBackButton.isEnabled && libraryTransferBackButton.isHittable {
                    backButton = libraryTransferBackButton
                    break
                }
                #endif
                RunLoop.current.run(until: Date(timeIntervalSinceNow: liveSmokeFocusPollIntervalSeconds))
            }
            self.logSmokeBreadcrumb(
                event: "wait_end",
                action: "wait_for_element",
                identifier: "navigation.backButton",
                timeoutSeconds: formatDuration(seconds: timeout),
                durationSeconds: formatDuration(seconds: Date().timeIntervalSince(startedAt)),
                result: backButton == nil ? "failure" : "success",
                note: "wait finished"
            )

            guard let backButton else {
                throw LiveSmokeFailure.missingBackButton(
                    screen: self.currentScreenSummary(),
                    step: self.currentStepTitle
                )
            }

            try self.tapExistingButton(
                backButton,
                identifier: "navigation.backButton",
                action: "tap_back_button",
                note: "back tapped"
            )
        }
    }

    #if !targetEnvironment(macCatalyst)
    @MainActor
    private func iOS18LibraryTransferBackButton() -> XCUIElement? {
        guard self.currentLaunchLocalization == .english else {
            return nil
        }

        let libraryTitle = LiveSmokeSelectedTab.library.localizedTitle(localization: self.currentLaunchLocalization)
        let parentTitlesByVisibleIdentifier = [
            (LiveSmokeIdentifier.workspaceImportChooseFileButton, "Import"),
            (LiveSmokeIdentifier.workspaceImportChooseAnkiFilesButton, "Import"),
            (LiveSmokeIdentifier.workspaceSpreadsheetImportSource, "Import"),
            (LiveSmokeIdentifier.libraryNibomoImportRow, libraryTitle),
            (LiveSmokeIdentifier.workspacePackageExportPreviewButton, "Export"),
            (LiveSmokeIdentifier.libraryNibomoExportRow, libraryTitle)
        ]
        let visibleParentTitles = parentTitlesByVisibleIdentifier.compactMap { identifier, title in
            let element = self.element(identifier: identifier)
            return element.exists && element.isHittable ? title : nil
        }
        guard visibleParentTitles.count == 1,
              let parentTitle = visibleParentTitles.first,
              self.app.alerts.count == 0,
              self.app.sheets.count == 0 else {
            return nil
        }

        let navigationBars = self.elements(query: self.app.navigationBars).filter(\.isHittable)
        guard navigationBars.count == 1 else {
            return nil
        }

        // iOS 18 exposes native Back by its parent title without the BackButton identifier.
        let buttons = navigationBars[0].buttons.matching(NSPredicate(format: "label == %@", parentTitle))
        return buttons.count == 1 ? buttons.firstMatch : nil
    }

    @MainActor
    private func iOS18CardEditorBackButton() throws -> XCUIElement? {
        let editorIdentifiers = [LiveSmokeIdentifier.cardEditorFrontTextEditor, LiveSmokeIdentifier.cardEditorBackTextEditor]
        let editors = editorIdentifiers.map { self.app.textViews[$0].firstMatch }
            .filter { $0.exists && $0.isHittable }
        guard editors.isEmpty == false else {
            return nil
        }

        let navigationBars = self.elements(query: self.app.navigationBars).filter(\.isHittable)
        guard self.currentLaunchLocalization == .english,
              editors.count == 1,
              self.app.alerts.count == 0,
              navigationBars.count == 1 else {
            throw LiveSmokeFailure.unexpectedAccountState(
                message: "Native iOS 18 card editor back lookup requires an English launch, one active text editor, one navigation bar, and no alert.",
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }

        let expectedTitle = editors[0].identifier == LiveSmokeIdentifier.cardEditorFrontTextEditor ? "Front" : "Back"
        let navigationBar = navigationBars[0]
        let buttons = navigationBar.buttons.matching(NSPredicate(format: "label IN %@", ["New card", "Edit card"]))
        guard navigationBar.identifier == expectedTitle, buttons.count == 1 else {
            throw LiveSmokeFailure.unexpectedAccountState(
                message: "Expected the \(expectedTitle) navigation bar with one native card editor back button; found \(navigationBar.identifier) and \(buttons.count) matching buttons.",
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }
        return buttons.firstMatch
    }

    @MainActor
    private func iOS18AIHistoryBackButton() throws -> XCUIElement? {
        let reader = self.app.collectionViews[LiveSmokeIdentifier.aiHistoryReader].firstMatch
        let historyList = self.app.collectionViews[LiveSmokeIdentifier.aiHistoryList].firstMatch
        let isReaderVisible = reader.exists && reader.isHittable
        let isListVisible = historyList.exists && historyList.isHittable
        guard isReaderVisible || isListVisible else {
            return nil
        }

        let navigationBars = self.elements(query: self.app.navigationBars).filter(\.isHittable)
        guard self.currentLaunchLocalization == .english,
              isReaderVisible != isListVisible,
              self.app.alerts.count == 0,
              self.app.sheets.count == 0,
              navigationBars.count == 1 else {
            throw LiveSmokeFailure.unexpectedAiConversationState(
                message: "Native iOS 18 AI history back lookup requires an English launch, one active history screen, one navigation bar, and no sheet or alert.",
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }

        let navigationBar = navigationBars[0]
        guard isReaderVisible || navigationBar.identifier == "Chat history" else {
            throw LiveSmokeFailure.unexpectedAiConversationState(
                message: "Expected Chat history navigation bar before returning to AI; found \(navigationBar.identifier).",
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }

        // iOS 18 exposes native Back by its parent title without the BackButton identifier.
        let parentTitle = isReaderVisible ? "Chat history" : LiveSmokeSelectedTab.ai.localizedTitle(localization: self.currentLaunchLocalization)
        let buttons = navigationBar.buttons.matching(NSPredicate(format: "label == %@", parentTitle))
        guard buttons.count <= 1 else {
            throw LiveSmokeFailure.unexpectedAiConversationState(
                message: "Expected one native AI history back button labeled \(parentTitle); found \(buttons.count).",
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }
        return buttons.firstMatch
    }

    @MainActor
    private func iOS18SettingsBackSource() throws -> XCUIElement? {
        let sourceIdentifiers: [String] = [
            LiveSmokeIdentifier.accountStatusScreen,
            LiveSmokeIdentifier.currentWorkspaceScreen,
            LiveSmokeIdentifier.reviewAnimationsSettingsScreen,
            LiveSmokeIdentifier.aiChatSuggestionsSettingsScreen,
            LiveSmokeIdentifier.notificationsSettingsScreen,
            LiveSmokeIdentifier.leaderboardParticipationSettingsScreen,
            LiveSmokeIdentifier.languageSettingsScreen,
            LiveSmokeIdentifier.accessSettingsScreen,
            LiveSmokeIdentifier.schedulerSettingsScreen,
            LiveSmokeIdentifier.serverSettingsScreen,
            LiveSmokeIdentifier.thisDeviceSettingsScreen,
            LiveSmokeIdentifier.resetStudyProgressScreen,
            LiveSmokeIdentifier.deleteCurrentWorkspaceScreen,
            LiveSmokeIdentifier.dangerZoneScreen
        ]
        let sources = sourceIdentifiers.map { identifier in
            self.app.descendants(matching: .any).matching(identifier: identifier).firstMatch
        }.filter(\.exists)
        guard sources.count <= 1 else {
            throw LiveSmokeFailure.unexpectedAccountState(
                message: "Expected one active Settings detail before native back tap; found \(sources.map(\.identifier)).",
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }
        guard let source = sources.first else {
            return nil
        }

        let timeout = LiveSmokeConfiguration.shortUiTimeoutSeconds
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if source.exists && source.isHittable {
                return source
            }
            RunLoop.current.run(until: Date(timeIntervalSinceNow: liveSmokeFocusPollIntervalSeconds))
        }

        throw LiveSmokeFailure.unexpectedAccountState(
            message: "Recognized Settings detail \(source.identifier) did not become hittable within \(timeout)s before native back tap.",
            screen: self.currentScreenSummary(),
            step: self.currentStepTitle
        )
    }

    @MainActor
    private func tapBackToSettingsRoot(from source: XCUIElement) throws {
        let settingsRoot = self.app.collectionViews[LiveSmokeIdentifier.settingsScreen].firstMatch
        let navigationBars = self.elements(query: self.app.navigationBars).filter(\.isHittable)
        guard settingsRoot.exists == false,
              self.app.alerts.count == 0,
              self.app.sheets.count == 0,
              navigationBars.count == 1,
              source.frame.isEmpty == false else {
            throw LiveSmokeFailure.unexpectedAccountState(
                message: "Native Settings back tap requires an active detail, one navigation bar, and no sheet or alert. Source: \(source.identifier).",
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }

        let sourceIdentifier = source.identifier
        let buttons = navigationBars[0].buttons
        guard buttons.count == 1 else {
            throw LiveSmokeFailure.unexpectedAccountState(
                message: "Native Settings back tap requires exactly one navigation button; found \(buttons.count). Source: \(sourceIdentifier).",
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }
        let backButton = buttons.element(boundBy: 0)
        let timeout = LiveSmokeConfiguration.shortUiTimeoutSeconds
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline && (backButton.exists == false || backButton.isEnabled == false || backButton.isHittable == false) {
            RunLoop.current.run(until: Date(timeIntervalSinceNow: liveSmokeFocusPollIntervalSeconds))
        }
        guard buttons.count == 1, backButton.exists, backButton.isEnabled, backButton.isHittable else {
            throw LiveSmokeFailure.unexpectedAccountState(
                message: "Expected exactly one enabled, hittable native Settings back button within \(timeout)s; found \(buttons.count) buttons. Source: \(sourceIdentifier).",
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }
        self.logActionStart(action: "tap_back", identifier: sourceIdentifier)
        backButton.clickOrTap()
        try self.assertElementDoesNotExist(identifier: sourceIdentifier, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertScreenVisible(screen: .settings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        self.logActionEnd(action: "tap_back", identifier: sourceIdentifier, result: "success", note: "native back button reached Settings")
    }
    #endif

    @MainActor
    func tapButton(
        button: XCUIElement,
        identifier: String,
        timeout: TimeInterval
    ) throws {
        try self.runWithInlineRawScreenStateOnFailure(action: "tap_button.\(identifier)") {
            if self.waitForOptionalElement(
                button,
                identifier: identifier,
                timeout: timeout
            ) == false {
                throw LiveSmokeFailure.missingElement(
                    identifier: identifier,
                    timeoutSeconds: timeout,
                    screen: self.currentScreenSummary(),
                    step: self.currentStepTitle
                )
            }

            try self.tapExistingButton(
                button,
                identifier: identifier,
                action: "tap_button",
                note: "button tapped"
            )
        }
    }

    @MainActor
    func tapExistingButton(
        _ button: XCUIElement,
        identifier: String,
        action: String,
        note: String
    ) throws {
        if button.isEnabled == false {
            throw LiveSmokeFailure.disabledElement(
                identifier: identifier,
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }

        self.logActionStart(action: action, identifier: identifier)
        button.clickOrTap()
        self.logActionEnd(action: action, identifier: identifier, result: "success", note: note)
    }

    @MainActor
    func tapExistingButtonPreservingAlerts(
        _ button: XCUIElement,
        identifier: String,
        action: String,
        note: String
    ) throws {
        if button.isEnabled == false {
            throw LiveSmokeFailure.disabledElement(
                identifier: identifier,
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }

        self.logActionStart(action: action, identifier: identifier)
        button.clickOrTap()
        self.logActionEnd(action: action, identifier: identifier, result: "success", note: note)
    }
}

// Catalyst acceptance exercises the Mac pointer path; physical direct touch is a separate check.
extension XCUIElement {
    @MainActor
    func clickOrTap() {
        #if targetEnvironment(macCatalyst)
        self.click()
        #else
        self.tap()
        #endif
    }
}
