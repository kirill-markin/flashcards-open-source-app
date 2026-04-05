import Foundation
import OSLog
import XCTest

let smokeLogger = Logger(
    subsystem: uiTestBundleIdentifier(),
    category: "ui-smoke"
)

class LiveSmokeTestCase: XCTestCase {
    let shortUiTimeoutSeconds: TimeInterval = 10
    let longUiTimeoutSeconds: TimeInterval = 30
    let optionalProbeTimeoutSeconds: TimeInterval = 3
    let reviewInitialProbeTimeoutSeconds: TimeInterval = 15
    let reviewInteractionTimeoutSeconds: TimeInterval = 10
    let reviewEmailEnvironmentKey: String = "FLASHCARDS_LIVE_REVIEW_EMAIL"
    let resetStateEnvironmentKey: String = "FLASHCARDS_UI_TEST_RESET_STATE"
    let selectedTabEnvironmentKey: String = "FLASHCARDS_UI_TEST_SELECTED_TAB"
    let appNotificationTapTypeEnvironmentKey: String = "FLASHCARDS_UI_TEST_APP_NOTIFICATION_TAP_TYPE"
    let maximumStoredBreadcrumbCount: Int = 30

    var app: XCUIApplication!
    var currentStepTitle: String = "test bootstrap"
    var hasPrintedInlineRawScreenStateForCurrentFailure: Bool = false
    var recentBreadcrumbs: [LiveSmokeBreadcrumb] = []

    override func setUpWithError() throws {
        try super.setUpWithError()
        continueAfterFailure = false
        addUIInterruptionMonitor(withDescription: "Live smoke known interruptions") { alert in
            MainActor.assumeIsolated {
                for label in ["Not now", "Not Now", "OK", "Close", "Dismiss", "Cancel", "Allow"] {
                    let button = alert.buttons[label]
                    guard button.exists else {
                        continue
                    }

                    button.tap()
                    return true
                }

                return false
            }
        }
    }

    override func tearDownWithError() throws {
        if let app = self.app {
            MainActor.assumeIsolated {
                app.terminate()
            }
        }
        self.app = nil
        self.hasPrintedInlineRawScreenStateForCurrentFailure = false
        self.recentBreadcrumbs = []
        self.currentStepTitle = "test bootstrap"
        try super.tearDownWithError()
    }

    @MainActor
    func step(_ title: String, action: () throws -> Void) throws {
        let previousStepTitle = self.currentStepTitle
        self.currentStepTitle = title
        defer {
            self.currentStepTitle = previousStepTitle
        }

        try XCTContext.runActivity(named: title) { activity in
            let startedAt = Date()
            self.logSmokeBreadcrumb(
                event: "step_start",
                action: "step",
                identifier: "-",
                timeoutSeconds: "-",
                durationSeconds: "-",
                result: "start",
                note: title
            )

            do {
                try action()

                let durationSeconds = Date().timeIntervalSince(startedAt)
                self.logSmokeBreadcrumb(
                    event: "step_end",
                    action: "step",
                    identifier: "-",
                    timeoutSeconds: "-",
                    durationSeconds: formatDuration(seconds: durationSeconds),
                    result: "success",
                    note: title
                )
            } catch {
                self.emitInlineRawScreenStateIfNeeded(action: "step.\(title)")
                let durationSeconds = Date().timeIntervalSince(startedAt)
                activity.add(
                    self.makeTextAttachment(
                        name: "Step Failure Summary - \(title)",
                        text: """
                        Result: failure
                        Step: \(title)
                        Duration: \(formatDuration(seconds: durationSeconds))
                        Error: \(error.localizedDescription)
                        Current screen: \(self.currentScreenSummary())
                        Visible text snapshot: \(self.visibleTextSnapshot())
                        Breadcrumbs:
                        \(self.recentBreadcrumbLines())
                        """
                    )
                )
                self.attachFailureDiagnostics(stepTitle: title, error: error, activity: activity)
                self.logSmokeBreadcrumb(
                    event: "step_end",
                    action: "step",
                    identifier: "-",
                    timeoutSeconds: "-",
                    durationSeconds: formatDuration(seconds: durationSeconds),
                    result: "failure",
                    note: error.localizedDescription
                )
                smokeLogger.error(
                    "event=step_failure step=\(title, privacy: .public) duration=\(formatDuration(seconds: durationSeconds), privacy: .public) currentScreen=\(self.currentScreenSummary(), privacy: .public) error=\(error.localizedDescription, privacy: .public)"
                )
                throw LiveSmokeFailure.stepFailed(
                    title: title,
                    durationSeconds: durationSeconds,
                    underlyingMessage: error.localizedDescription
                )
            }
        }
    }

    @MainActor
    func launchApplication(
        resetState: LiveSmokeLaunchResetState?,
        selectedTab: LiveSmokeSelectedTab
    ) throws {
        self.app = XCUIApplication()
        self.configureLaunchEnvironment(resetState: resetState, selectedTab: selectedTab)
        self.logActionStart(action: "launch_app", identifier: "application")
        self.app.launch()
        try self.waitForApplicationToReachForeground(timeout: self.shortUiTimeoutSeconds)
        _ = self.dismissKnownBlockingAlertIfVisible()
        try self.waitForSelectedTabScreen(selectedTab: selectedTab, timeout: self.shortUiTimeoutSeconds)
        self.logActionEnd(action: "launch_app", identifier: "application", result: "success", note: "application launched")
    }

    @MainActor
    func launchApplicationWithAppNotificationTap(
        resetState: LiveSmokeLaunchResetState?,
        selectedTab: LiveSmokeSelectedTab,
        appNotificationTapType: LiveSmokeAppNotificationTapType
    ) throws {
        self.app = XCUIApplication()
        self.configureLaunchEnvironmentWithAppNotificationTap(
            resetState: resetState,
            selectedTab: selectedTab,
            appNotificationTapType: appNotificationTapType
        )
        self.logActionStart(action: "launch_app_notification_tap", identifier: "application")
        self.app.launch()
        try self.waitForApplicationToReachForeground(timeout: self.shortUiTimeoutSeconds)
        _ = self.dismissKnownBlockingAlertIfVisible()
        self.logActionEnd(
            action: "launch_app_notification_tap",
            identifier: "application",
            result: "success",
            note: "application launched with app notification tap"
        )
    }

    @MainActor
    func tapTabBarItem(named name: String, timeout: TimeInterval) throws {
        try self.runWithInlineRawScreenStateOnFailure(action: "tap_tab.\(name)") {
            let tabBarButton = self.app.tabBars.buttons[name].firstMatch
            let fallbackButton = self.app.buttons[name].firstMatch
            let deadline = Date().addingTimeInterval(timeout)
            while Date() < deadline {
                if tabBarButton.exists && tabBarButton.isHittable {
                    self.logActionStart(action: "tap_tab", identifier: "tab.\(name)")
                    tabBarButton.tap()
                    _ = self.dismissKnownBlockingAlertIfVisible()
                    self.logActionEnd(action: "tap_tab", identifier: "tab.\(name)", result: "success", note: "tab bar button tapped")
                    return
                }
                if fallbackButton.exists && fallbackButton.isHittable {
                    self.logActionStart(action: "tap_tab", identifier: "tab.\(name)")
                    fallbackButton.tap()
                    _ = self.dismissKnownBlockingAlertIfVisible()
                    self.logActionEnd(action: "tap_tab", identifier: "tab.\(name)", result: "success", note: "fallback button tapped")
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
    func tapElement(identifier: String, timeout: TimeInterval) throws {
        try self.runWithInlineRawScreenStateOnFailure(action: "tap_element.\(identifier)") {
            let button = self.app.buttons[identifier].firstMatch
            if self.waitForOptionalElement(
                button,
                identifier: identifier,
                timeout: timeout
            ) {
                self.logActionStart(action: "tap_element", identifier: identifier)
                if button.isEnabled == false {
                    throw LiveSmokeFailure.disabledElement(
                        identifier: identifier,
                        screen: self.currentScreenSummary(),
                        step: self.currentStepTitle
                    )
                }
                button.tap()
                _ = self.dismissKnownBlockingAlertIfVisible()
                self.logActionEnd(action: "tap_element", identifier: identifier, result: "success", note: "button tapped")
                return
            }

            let cell = self.app.cells[identifier].firstMatch
            if self.waitForOptionalElement(
                cell,
                identifier: identifier,
                timeout: self.optionalProbeTimeoutSeconds
            ) {
                self.logActionStart(action: "tap_element", identifier: identifier)
                cell.tap()
                _ = self.dismissKnownBlockingAlertIfVisible()
                self.logActionEnd(action: "tap_element", identifier: identifier, result: "success", note: "cell tapped")
                return
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
    func assertElementExists(identifier: String, timeout: TimeInterval) throws {
        try self.runWithInlineRawScreenStateOnFailure(action: "assert_element_exists.\(identifier)") {
            let element = self.app.descendants(matching: .any).matching(identifier: identifier).firstMatch
            if self.waitForOptionalElement(
                element,
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
        }
    }

    @MainActor
    func assertTextExists(_ text: String, timeout: TimeInterval) throws {
        try self.runWithInlineRawScreenStateOnFailure(action: "assert_text_exists.\(text)") {
            let textElement = self.exactVisibleText(text).firstMatch
            if self.waitForOptionalElement(
                textElement,
                identifier: "text.\(text)",
                timeout: timeout
            ) == false {
                throw LiveSmokeFailure.missingText(
                    text: text,
                    timeoutSeconds: timeout,
                    screen: self.currentScreenSummary(),
                    step: self.currentStepTitle
                )
            }
        }
    }

    @MainActor
    func visibleStaticTextLabels(ignoredExactLabels: Set<String>) -> [String] {
        let staticTextLabels = self.elements(query: self.app.staticTexts)
            .map(\.label)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { label in
                label.isEmpty == false && ignoredExactLabels.contains(label) == false
            }
        let assistantTextLabels = self.visibleAssistantRowTexts(ignoredExactLabels: ignoredExactLabels)

        return staticTextLabels + assistantTextLabels
    }

    @MainActor
    func visibleAssistantRowTexts(ignoredExactLabels: Set<String>) -> [String] {
        self.elements(
            query: self.app.otherElements
                .matching(identifier: LiveSmokeIdentifier.aiAssistantVisibleText)
        )
        .compactMap { element in
            let value = self.elementValue(element: element).trimmingCharacters(in: .whitespacesAndNewlines)
            if value.isEmpty == false {
                return value
            }

            let label = element.label.trimmingCharacters(in: .whitespacesAndNewlines)
            return label.isEmpty ? nil : label
        }
        .filter { text in
            text.isEmpty == false && ignoredExactLabels.contains(text) == false
        }
    }

    @MainActor
    func visibleAssistantErrorElement() -> XCUIElement {
        self.app.otherElements[LiveSmokeIdentifier.aiAssistantErrorMessage].firstMatch
    }

    @MainActor
    func visibleCompletedAiSqlToolCallSummaries() -> [String] {
        self.elements(
            query: self.app.descendants(matching: .any)
                .matching(identifier: LiveSmokeIdentifier.aiToolCallSummary)
        )
        .map(\.label)
        .map { label in
            label.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        .filter { label in
            label.contains("SQL:")
        }
        .reduce(into: [String]()) { partialResult, label in
            if partialResult.contains(label) == false {
                partialResult.append(label)
            }
        }
    }

    @MainActor
    func visibleMeaningfulAssistantTextMessages() -> [String] {
        var seenMessages: Set<String> = []
        return self.visibleAssistantRowTexts(ignoredExactLabels: [])
            .filter { message in
                message.isEmpty == false
                    && message != "Assistant"
                    && message != "Looking through your cards..."
                    && message != "Assistant is typing"
            }
            .filter { message in
                seenMessages.insert(message).inserted
            }
    }

    @MainActor
    func visibleAssistantErrorMessageCount() -> Int {
        self.visibleAssistantErrorElement().exists ? 1 : 0
    }

    @MainActor
    func latestVisibleAssistantErrorMessage() -> String? {
        let element = self.visibleAssistantErrorElement()
        guard element.exists else {
            return nil
        }

        let nestedStaticTextLabels = self.elements(query: element.descendants(matching: .staticText))
            .map(\.label)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { label in
                label.isEmpty == false && label != "Assistant"
            }
        if let message = nestedStaticTextLabels.last {
            return message
        }

        let label = element.label.trimmingCharacters(in: .whitespacesAndNewlines)
        if label.isEmpty == false {
            return label
        }

        let value = self.elementValue(element: element)
        if value.isEmpty == false {
            return value
        }

        return "Assistant error is visible."
    }

    @MainActor
    func exactVisibleText(_ text: String) -> XCUIElementQuery {
        let predicate = NSPredicate(format: "label == %@ OR identifier == %@", text, text)
        return self.app.descendants(matching: .any).matching(predicate)
    }

    @MainActor
    func assertElementEnabled(identifier: String, timeout: TimeInterval) throws {
        try self.runWithInlineRawScreenStateOnFailure(action: "assert_element_enabled.\(identifier)") {
            let element = self.app.descendants(matching: .any).matching(identifier: identifier).firstMatch
            if self.waitForOptionalElement(
                element,
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

            let deadline = Date().addingTimeInterval(timeout)
            while Date() < deadline {
                if element.isEnabled {
                    return
                }

                _ = self.dismissKnownBlockingAlertIfVisible()
                RunLoop.current.run(until: Date(timeIntervalSinceNow: liveSmokeFocusPollIntervalSeconds))
            }

            throw LiveSmokeFailure.disabledElement(
                identifier: identifier,
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }
    }

    @MainActor
    func assertElementDisabled(identifier: String, timeout: TimeInterval) throws {
        try self.runWithInlineRawScreenStateOnFailure(action: "assert_element_disabled.\(identifier)") {
            let element = self.app.descendants(matching: .any).matching(identifier: identifier).firstMatch
            if self.waitForOptionalElement(
                element,
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

            let deadline = Date().addingTimeInterval(timeout)
            while Date() < deadline {
                if element.isEnabled == false {
                    return
                }

                _ = self.dismissKnownBlockingAlertIfVisible()
                RunLoop.current.run(until: Date(timeIntervalSinceNow: liveSmokeFocusPollIntervalSeconds))
            }

            throw LiveSmokeFailure.unexpectedAiConversationState(
                message: "Expected \(identifier) to be disabled.",
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }
    }

    @MainActor
    func assertElementLabel(
        identifier: String,
        expectedLabel: String,
        timeout: TimeInterval
    ) throws {
        try self.runWithInlineRawScreenStateOnFailure(action: "assert_element_label.\(identifier)") {
            let element = self.app.descendants(matching: .any).matching(identifier: identifier).firstMatch
            if self.waitForOptionalElement(
                element,
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

            let startedAt = Date()
            let deadline = startedAt.addingTimeInterval(timeout)
            var lastObservedLabel = element.label
            self.logSmokeBreadcrumb(
                event: "wait_start",
                action: "wait_for_element_label",
                identifier: identifier,
                timeoutSeconds: formatDuration(seconds: timeout),
                durationSeconds: "-",
                result: "start",
                note: expectedLabel
            )

            while Date() < deadline {
                _ = self.dismissKnownBlockingAlertIfVisible()
                lastObservedLabel = element.label
                if lastObservedLabel == expectedLabel {
                    let durationSeconds = Date().timeIntervalSince(startedAt)
                    self.logSmokeBreadcrumb(
                        event: "wait_end",
                        action: "wait_for_element_label",
                        identifier: identifier,
                        timeoutSeconds: formatDuration(seconds: timeout),
                        durationSeconds: formatDuration(seconds: durationSeconds),
                        result: "success",
                        note: expectedLabel
                    )
                    return
                }

                RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.2))
            }

            let durationSeconds = Date().timeIntervalSince(startedAt)
            self.logSmokeBreadcrumb(
                event: "wait_end",
                action: "wait_for_element_label",
                identifier: identifier,
                timeoutSeconds: formatDuration(seconds: timeout),
                durationSeconds: formatDuration(seconds: durationSeconds),
                result: "failure",
                note: "expected=\(expectedLabel) actual=\(lastObservedLabel)"
            )
            throw LiveSmokeFailure.unexpectedElementLabel(
                identifier: identifier,
                expectedLabel: expectedLabel,
                actualLabel: lastObservedLabel,
                timeoutSeconds: timeout,
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }
    }

    // Raw XCUIElement.typeText can hang until XCTest's global execution allowance
    // when Simulator or CI never grants keyboard focus. Always gate text entry on
    // explicit focus so text-input failures fail fast with local diagnostics.
    @MainActor
    func typeTextSafely(
        _ text: String,
        intoElement element: XCUIElement,
        identifier: String,
        timeout: TimeInterval
    ) throws {
        try self.runWithInlineRawScreenStateOnFailure(action: "type_text.\(identifier)") {
            try self.focusElementForTextInput(
                element,
                identifier: identifier,
                timeout: timeout
            )
            self.logActionStart(action: "type_text", identifier: identifier)
            element.typeText(text)
            _ = self.dismissKnownBlockingAlertIfVisible()
            if try self.waitForElementValueContaining(
                element,
                identifier: identifier,
                expectedValue: text,
                timeout: timeout
            ) == false {
                throw LiveSmokeFailure.unexpectedElementValue(
                    identifier: identifier,
                    expectedValue: text,
                    actualValue: self.elementValue(element: element),
                    timeoutSeconds: timeout,
                    screen: self.currentScreenSummary(),
                    step: self.currentStepTitle
                )
            }
            self.logActionEnd(action: "type_text", identifier: identifier, result: "success", note: "text typed")
        }
    }

    @MainActor
    func typeTextSafely(
        _ text: String,
        intoElementWithIdentifier identifier: String,
        timeout: TimeInterval
    ) throws {
        let element = self.app.descendants(matching: .any).matching(identifier: identifier).firstMatch
        try self.typeTextSafely(
            text,
            intoElement: element,
            identifier: identifier,
            timeout: timeout
        )
    }

    @MainActor
    func replaceTextSafely(
        _ text: String,
        inElement element: XCUIElement,
        identifier: String,
        placeholderValue: String,
        timeout: TimeInterval
    ) throws {
        try self.runWithInlineRawScreenStateOnFailure(action: "replace_text.\(identifier)") {
            try self.focusElementForTextInput(
                element,
                identifier: identifier,
                timeout: timeout
            )

            self.logActionStart(action: "replace_text", identifier: identifier)
            let existingValue = element.value as? String ?? ""
            if existingValue.isEmpty == false && existingValue != placeholderValue {
                let deleteSequence = String(repeating: XCUIKeyboardKey.delete.rawValue, count: existingValue.count)
                element.typeText(deleteSequence)
            }
            element.typeText(text)
            _ = self.dismissKnownBlockingAlertIfVisible()

            if try self.waitForElementValueContaining(
                element,
                identifier: identifier,
                expectedValue: text,
                timeout: timeout
            ) == false {
                throw LiveSmokeFailure.unexpectedElementValue(
                    identifier: identifier,
                    expectedValue: text,
                    actualValue: self.elementValue(element: element),
                    timeoutSeconds: timeout,
                    screen: self.currentScreenSummary(),
                    step: self.currentStepTitle
                )
            }

            self.logActionEnd(action: "replace_text", identifier: identifier, result: "success", note: "text replaced")
        }
    }

    @MainActor
    func replaceTextSafely(
        _ text: String,
        inElementWithIdentifier identifier: String,
        timeout: TimeInterval
    ) throws {
        let element = self.app.descendants(matching: .any).matching(identifier: identifier).firstMatch
        try self.replaceTextSafely(
            text,
            inElement: element,
            identifier: identifier,
            placeholderValue: element.placeholderValue ?? "",
            timeout: timeout
        )
    }

    @MainActor
    func focusElementForTextInput(
        _ element: XCUIElement,
        identifier: String,
        timeout: TimeInterval
    ) throws {
        if self.waitForOptionalElement(
            element,
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

        let startedAt = Date()
        let deadline = startedAt.addingTimeInterval(timeout)
        var didRetryActivation = false
        self.logSmokeBreadcrumb(
            event: "wait_start",
            action: "wait_for_text_input_focus",
            identifier: identifier,
            timeoutSeconds: formatDuration(seconds: timeout),
            durationSeconds: "-",
            result: "start",
            note: "waiting for keyboard focus"
        )

        while Date() < deadline {
            _ = self.dismissKnownBlockingAlertIfVisible()

            if element.exists && element.isHittable {
                element.tap()
                if self.elementHasKeyboardFocus(element: element) {
                    let durationSeconds = Date().timeIntervalSince(startedAt)
                    self.logSmokeBreadcrumb(
                        event: "wait_end",
                        action: "wait_for_text_input_focus",
                        identifier: identifier,
                        timeoutSeconds: formatDuration(seconds: timeout),
                        durationSeconds: formatDuration(seconds: durationSeconds),
                        result: "success",
                        note: "keyboard focus acquired"
                    )
                    return
                }

                if didRetryActivation == false {
                    self.app.activate()
                    didRetryActivation = true
                    RunLoop.current.run(until: Date(timeIntervalSinceNow: liveSmokeFocusPollIntervalSeconds))
                    continue
                }

                let durationSeconds = Date().timeIntervalSince(startedAt)
                self.logSmokeBreadcrumb(
                    event: "wait_end",
                    action: "wait_for_text_input_focus",
                    identifier: identifier,
                    timeoutSeconds: formatDuration(seconds: timeout),
                    durationSeconds: formatDuration(seconds: durationSeconds),
                    result: "success",
                    note: "keyboard focus not reported but element is hittable, proceeding"
                )
                return
            }

            if didRetryActivation == false {
                self.app.activate()
                didRetryActivation = true
            }

            RunLoop.current.run(until: Date(timeIntervalSinceNow: liveSmokeFocusPollIntervalSeconds))
        }

        let durationSeconds = Date().timeIntervalSince(startedAt)
        self.logSmokeBreadcrumb(
            event: "wait_end",
            action: "wait_for_text_input_focus",
            identifier: identifier,
            timeoutSeconds: formatDuration(seconds: timeout),
            durationSeconds: formatDuration(seconds: durationSeconds),
            result: "failure",
            note: self.textInputFailureNote(element: element)
        )
        throw LiveSmokeFailure.textInputNotReady(
            identifier: identifier,
            timeoutSeconds: timeout,
            screen: self.currentScreenSummary(),
            step: self.currentStepTitle,
            exists: element.exists,
            hittable: element.isHittable,
            hasKeyboardFocus: self.elementHasKeyboardFocus(element: element),
            softwareKeyboardVisible: self.softwareKeyboardIsVisible(),
            elementLabel: element.label,
            elementValue: self.elementValue(element: element)
        )
    }

    @MainActor
    func elementHasKeyboardFocus(element: XCUIElement) -> Bool {
        (element.value(forKey: "hasKeyboardFocus") as? Bool) == true
    }

    @MainActor
    func softwareKeyboardIsVisible() -> Bool {
        self.app.keyboards.firstMatch.exists
    }

    @MainActor
    func textInputFailureNote(element: XCUIElement) -> String {
        "exists=\(element.exists) hittable=\(element.isHittable) hasKeyboardFocus=\(self.elementHasKeyboardFocus(element: element)) softwareKeyboardVisible=\(self.softwareKeyboardIsVisible()) value=\(self.elementValue(element: element))"
    }

    @MainActor
    func tapFirstNavigationBackButton() throws {
        try self.runWithInlineRawScreenStateOnFailure(action: "tap_back_button.navigation.backButton") {
            let backButton = self.app.navigationBars.buttons.firstMatch
            if self.waitForOptionalElement(
                backButton,
                identifier: "navigation.backButton",
                timeout: self.shortUiTimeoutSeconds
            ) == false {
                throw LiveSmokeFailure.missingBackButton(
                    screen: self.currentScreenSummary(),
                    step: self.currentStepTitle
                )
            }
            if backButton.isEnabled == false {
                throw LiveSmokeFailure.disabledElement(
                    identifier: "navigation.backButton",
                    screen: self.currentScreenSummary(),
                    step: self.currentStepTitle
                )
            }
            self.logActionStart(action: "tap_back_button", identifier: "navigation.backButton")
            backButton.tap()
            _ = self.dismissKnownBlockingAlertIfVisible()
            self.logActionEnd(action: "tap_back_button", identifier: "navigation.backButton", result: "success", note: "back tapped")
        }
    }

    @MainActor
    func assertCurrentWorkspacePickerIsVisible() throws {
        let pickerScreen = self.app.descendants(matching: .any)
            .matching(identifier: LiveSmokeIdentifier.currentWorkspacePickerScreen)
            .firstMatch
        if self.waitForOptionalElement(
            pickerScreen,
            identifier: LiveSmokeIdentifier.currentWorkspacePickerScreen,
            timeout: self.shortUiTimeoutSeconds
        ) == false {
            throw LiveSmokeFailure.currentWorkspacePickerNotVisible(
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }
    }

    @MainActor
    func assertScreenVisible(screen: LiveSmokeScreen, timeout: TimeInterval) throws {
        try self.runWithInlineRawScreenStateOnFailure(action: "assert_screen.\(screen.identifier)") {
            let element = self.app.descendants(matching: .any).matching(identifier: screen.identifier).firstMatch
            if timeout >= self.longUiTimeoutSeconds {
                _ = self.dismissKnownBlockingAlertIfVisible()
            }
            self.logSmokeBreadcrumb(
                event: "screen_assert_start",
                action: "assert_screen",
                identifier: screen.identifier,
                timeoutSeconds: formatDuration(seconds: timeout),
                durationSeconds: "-",
                result: "start",
                note: screen.title
            )
            let startedAt = Date()
            let found = element.waitForExistence(timeout: timeout)
            let durationSeconds = Date().timeIntervalSince(startedAt)
            self.logSmokeBreadcrumb(
                event: "screen_assert_end",
                action: "assert_screen",
                identifier: screen.identifier,
                timeoutSeconds: formatDuration(seconds: timeout),
                durationSeconds: formatDuration(seconds: durationSeconds),
                result: found ? "success" : "failure",
                note: screen.title
            )

            if found == false {
                throw LiveSmokeFailure.missingScreen(
                    screen: screen.title,
                    identifier: screen.identifier,
                    timeoutSeconds: timeout,
                    currentScreen: self.currentScreenSummary(),
                    step: self.currentStepTitle
                )
            }
        }
    }

    @MainActor
    func waitForOptionalElement(
        _ element: XCUIElement,
        identifier: String,
        timeout: TimeInterval
    ) -> Bool {
        if timeout >= self.longUiTimeoutSeconds {
            _ = self.dismissKnownBlockingAlertIfVisible()
        }
        self.logSmokeBreadcrumb(
            event: "wait_start",
            action: "wait_for_element",
            identifier: identifier,
            timeoutSeconds: formatDuration(seconds: timeout),
            durationSeconds: "-",
            result: "start",
            note: "wait begins"
        )
        let startedAt = Date()
        let found = element.waitForExistence(timeout: timeout)
        let durationSeconds = Date().timeIntervalSince(startedAt)
        self.logSmokeBreadcrumb(
            event: "wait_end",
            action: "wait_for_element",
            identifier: identifier,
            timeoutSeconds: formatDuration(seconds: timeout),
            durationSeconds: formatDuration(seconds: durationSeconds),
            result: found ? "success" : "failure",
            note: "wait finished"
        )
        return found
    }

    @MainActor
    func dismissKnownBlockingAlertIfVisible() -> Bool {
        guard self.app != nil else {
            return false
        }
        guard self.isApplicationRunning else {
            return false
        }

        let alert = self.app.alerts.firstMatch
        guard alert.exists else {
            return false
        }

        for label in ["OK", "Close", "Dismiss", "Cancel", "Not now", "Not Now", "Allow"] {
            let button = alert.buttons[label]
            guard button.exists else {
                continue
            }

            button.tap()
            self.logSmokeBreadcrumb(
                event: "alert_dismissed",
                action: "dismiss_alert",
                identifier: label,
                timeoutSeconds: "-",
                durationSeconds: "-",
                result: "success",
                note: "known alert button tapped"
            )
            return true
        }

        return false
    }

    @MainActor
    func currentScreenSummary() -> String {
        guard self.app != nil else {
            return "appState=uninitialized screens=[-]"
        }
        guard self.isApplicationRunning else {
            return "appState=\(self.appStateDescription()) screens=[-]"
        }

        let visibleScreenTitles = LiveSmokeScreen.allCases
            .filter { screen in
                self.app.descendants(matching: .any).matching(identifier: screen.identifier).firstMatch.exists
            }
            .map(\.title)
            .joined(separator: ", ")

        return """
        appState=\(self.appStateDescription()) \
        screens=[\(visibleScreenTitles.isEmpty ? "-" : visibleScreenTitles)]
        """
    }

    @MainActor
    func launchEnvironmentSummary() -> String {
        guard self.app != nil else {
            return "<app not initialized>"
        }

        let resetState = self.app.launchEnvironment[self.resetStateEnvironmentKey] ?? "-"
        let selectedTab = self.app.launchEnvironment[self.selectedTabEnvironmentKey] ?? "-"
        return "resetState=\(resetState) selectedTab=\(selectedTab)"
    }

    @MainActor
    func activeAlertsSnapshot() -> String {
        guard self.app != nil else {
            return "<app not initialized>"
        }
        guard self.isApplicationRunning else {
            return "<app not running>"
        }

        let alerts = self.elements(query: self.app.alerts).map { alert in
            let buttons = self.elements(query: alert.buttons)
                .map(\.label)
                .joined(separator: ", ")
            return "\(alert.label) [\(buttons.isEmpty ? "-" : buttons)]"
        }

        if alerts.isEmpty {
            return "<no active alerts>"
        }

        return alerts.joined(separator: " | ")
    }

    @MainActor
    func rootScreenQuerySnapshot() -> String {
        guard self.app != nil else {
            return "<app not initialized>"
        }
        guard self.isApplicationRunning else {
            return "<app not running>"
        }

        let screens: [LiveSmokeScreen] = [.review, .cards, .ai, .settings]
        return screens.map { screen in
            let exists = self.app.descendants(matching: .any).matching(identifier: screen.identifier).firstMatch.exists
            return "\(screen.identifier)=\(exists)"
        }.joined(separator: " | ")
    }

    @MainActor
    func attachFailureDiagnostics(stepTitle: String, error: Error, activity: XCTActivity) {
        if self.isApplicationRunning {
            let screenshotAttachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            screenshotAttachment.name = "Failure Screenshot - \(stepTitle)"
            screenshotAttachment.lifetime = .keepAlways
            activity.add(screenshotAttachment)
        }

        let hierarchyAttachment = XCTAttachment(string: self.appDebugHierarchy())
        hierarchyAttachment.name = "UI Hierarchy - \(stepTitle)"
        hierarchyAttachment.lifetime = .keepAlways
        activity.add(hierarchyAttachment)

        let diagnosticsAttachment = self.makeTextAttachment(
            name: "Failure Diagnostics - \(stepTitle)",
            text: """
            Step: \(stepTitle)
            Error: \(error.localizedDescription)
            Current screen: \(self.currentScreenSummary())
            Launch environment: \(self.launchEnvironmentSummary())
            Root screen queries: \(self.rootScreenQuerySnapshot())
            Active alerts: \(self.activeAlertsSnapshot())
            Visible text snapshot: \(self.visibleTextSnapshot())
            Assistant transcript snapshot: \(self.visibleMeaningfulAssistantTextMessages())
            Tool call snapshot: \(self.visibleCompletedAiSqlToolCallSummaries())
            Breadcrumbs:
            \(self.recentBreadcrumbLines())
            """
        )
        activity.add(diagnosticsAttachment)
    }

    func makeTextAttachment(name: String, text: String) -> XCTAttachment {
        let attachment = XCTAttachment(string: text)
        attachment.name = name
        attachment.lifetime = .keepAlways
        return attachment
    }

    @MainActor
    func visibleTextSnapshot() -> String {
        guard self.app != nil else {
            return "<app not initialized>"
        }
        guard self.isApplicationRunning else {
            return "<app not running>"
        }

        let labels = self.visibleStaticTextLabels(ignoredExactLabels: [])

        if labels.isEmpty {
            return "<no visible static text>"
        }

        return labels.joined(separator: " | ")
    }

    @MainActor
    func appDebugHierarchy() -> String {
        guard self.app != nil else {
            return "<app not initialized>"
        }
        guard self.isApplicationRunning else {
            return "<app not running>"
        }

        return self.app.debugDescription
    }

    @MainActor
    func resetInlineRawScreenStateFailureGuard() {
        self.hasPrintedInlineRawScreenStateForCurrentFailure = false
    }

    @MainActor
    func emitInlineRawScreenStateIfNeeded(action: String) {
        if self.hasPrintedInlineRawScreenStateForCurrentFailure {
            return
        }

        self.hasPrintedInlineRawScreenStateForCurrentFailure = true
        fputs(self.inlineRawScreenStateBlock(action: action) + "\n", stderr)
    }

    @MainActor
    func inlineRawScreenStateBlock(action: String) -> String {
        return [
            "===== BEGIN RAW SCREEN STATE =====",
            "platform: ios",
            "test: \(self.name)",
            "step: \(self.currentStepTitle)",
            "action: \(action)",
            "capturedAt: \(ISO8601DateFormatter().string(from: Date()))",
            "context: \(self.currentScreenSummary())",
            "",
            "activeAlerts: \(self.activeAlertsSnapshot())",
            "",
            self.appDebugHierarchy(),
            "===== END RAW SCREEN STATE ====="
        ].joined(separator: "\n")
    }

    @MainActor
    func runWithInlineRawScreenStateOnFailure<T>(
        action: String,
        operation: () throws -> T
    ) throws -> T {
        do {
            return try operation()
        } catch {
            self.emitInlineRawScreenStateIfNeeded(action: action)
            throw error
        }
    }

    @MainActor
    func logSmokeBreadcrumb(
        event: String,
        action: String,
        identifier: String,
        timeoutSeconds: String,
        durationSeconds: String,
        result: String,
        note: String
    ) {
        self.logSmokeBreadcrumb(
            event: event,
            action: action,
            identifier: identifier,
            timeoutSeconds: timeoutSeconds,
            durationSeconds: durationSeconds,
            result: result,
            note: note,
            captureScreenSummary: false,
            screenOverride: nil
        )
    }

    @MainActor
    func logSmokeBreadcrumb(
        event: String,
        action: String,
        identifier: String,
        timeoutSeconds: String,
        durationSeconds: String,
        result: String,
        note: String,
        captureScreenSummary: Bool,
        screenOverride: String?
    ) {
        let shouldCaptureScreenSummary = captureScreenSummary || result == "failure"
        let screen = screenOverride ?? (shouldCaptureScreenSummary ? self.currentScreenSummary() : "screens=[-] nav=[-] alerts=[-] tabs=[-]")
        let line = makeLiveSmokeBreadcrumbLine(
            event: event,
            step: self.currentStepTitle,
            action: action,
            identifier: identifier,
            timeoutSeconds: timeoutSeconds,
            durationSeconds: durationSeconds,
            screen: screen,
            result: result,
            note: note
        )
        self.appendBreadcrumb(line: line)
    }

    @MainActor
    func appendBreadcrumb(line: String) {
        self.recentBreadcrumbs.append(LiveSmokeBreadcrumb(line: line))
        if self.recentBreadcrumbs.count > self.maximumStoredBreadcrumbCount {
            self.recentBreadcrumbs.removeFirst(self.recentBreadcrumbs.count - self.maximumStoredBreadcrumbCount)
        }
    }

    @MainActor
    func recentBreadcrumbLines() -> String {
        if self.recentBreadcrumbs.isEmpty {
            return "<no breadcrumbs>"
        }

        return self.recentBreadcrumbs.map(\.line).joined(separator: "\n")
    }

    @MainActor
    func logActionStart(action: String, identifier: String) {
        self.logSmokeBreadcrumb(
            event: "action_start",
            action: action,
            identifier: identifier,
            timeoutSeconds: "-",
            durationSeconds: "-",
            result: "start",
            note: "action started"
        )
    }

    @MainActor
    func logActionEnd(
        action: String,
        identifier: String,
        result: String,
        note: String
    ) {
        self.logActionEnd(
            action: action,
            identifier: identifier,
            result: result,
            note: note,
            captureScreenSummary: false,
            screenOverride: nil
        )
    }

    @MainActor
    func logActionEnd(
        action: String,
        identifier: String,
        result: String,
        note: String,
        captureScreenSummary: Bool,
        screenOverride: String?
    ) {
        self.logSmokeBreadcrumb(
            event: "action_end",
            action: action,
            identifier: identifier,
            timeoutSeconds: "-",
            durationSeconds: "-",
            result: result,
            note: note,
            captureScreenSummary: captureScreenSummary,
            screenOverride: screenOverride
        )
    }

    @MainActor
    func waitForApplicationToReachForeground(timeout: TimeInterval) throws {
        try self.runWithInlineRawScreenStateOnFailure(action: "wait_for_app_foreground") {
            self.logSmokeBreadcrumb(
                event: "wait_start",
                action: "wait_for_app_foreground",
                identifier: "application",
                timeoutSeconds: formatDuration(seconds: timeout),
                durationSeconds: "-",
                result: "start",
                note: "waiting for runningForeground",
                captureScreenSummary: false,
                screenOverride: "appState=\(self.appStateDescription()) screens=[-] nav=[-] alerts=[-] tabs=[-]"
            )
            let startedAt = Date()
            let reachedForeground = self.app.wait(for: .runningForeground, timeout: timeout)
            let durationSeconds = Date().timeIntervalSince(startedAt)
            self.logSmokeBreadcrumb(
                event: "wait_end",
                action: "wait_for_app_foreground",
                identifier: "application",
                timeoutSeconds: formatDuration(seconds: timeout),
                durationSeconds: formatDuration(seconds: durationSeconds),
                result: reachedForeground ? "success" : "failure",
                note: "foreground wait finished",
                captureScreenSummary: false,
                screenOverride: reachedForeground ? nil : "appState=\(self.appStateDescription()) screens=[-] nav=[-] alerts=[-] tabs=[-]"
            )

            if reachedForeground == false {
                throw LiveSmokeFailure.appDidNotReachForeground(
                    timeoutSeconds: timeout,
                    appState: self.appStateDescription(),
                    step: self.currentStepTitle
                )
            }
        }
    }

    @MainActor
    func configureLaunchEnvironment(
        resetState: LiveSmokeLaunchResetState?,
        selectedTab: LiveSmokeSelectedTab
    ) {
        self.app.launchEnvironment.removeValue(forKey: self.resetStateEnvironmentKey)
        self.app.launchEnvironment.removeValue(forKey: self.appNotificationTapTypeEnvironmentKey)
        self.app.launchEnvironment[self.selectedTabEnvironmentKey] = selectedTab.rawValue
        if let resetState {
            self.app.launchEnvironment[self.resetStateEnvironmentKey] = resetState.rawValue
        }
    }

    @MainActor
    func configureLaunchEnvironmentWithAppNotificationTap(
        resetState: LiveSmokeLaunchResetState?,
        selectedTab: LiveSmokeSelectedTab,
        appNotificationTapType: LiveSmokeAppNotificationTapType
    ) {
        self.configureLaunchEnvironment(resetState: resetState, selectedTab: selectedTab)
        self.app.launchEnvironment[self.appNotificationTapTypeEnvironmentKey] = appNotificationTapType.rawValue
    }

    @MainActor
    func elements(query: XCUIElementQuery) -> [XCUIElement] {
        let elements = query.allElementsBoundByIndex
        guard elements.isEmpty == false else {
            return []
        }

        return elements.filter(\.exists)
    }

    @MainActor
    func elementValue(element: XCUIElement) -> String {
        if let value = element.value as? String {
            return value.trimmingCharacters(in: .whitespacesAndNewlines)
        }

        if let value = element.value {
            return String(describing: value).trimmingCharacters(in: .whitespacesAndNewlines)
        }

        return element.label.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    @MainActor
    func waitForElementValueContaining(
        _ element: XCUIElement,
        identifier: String,
        expectedValue: String,
        timeout: TimeInterval
    ) throws -> Bool {
        self.logSmokeBreadcrumb(
            event: "wait_start",
            action: "wait_for_element_value",
            identifier: identifier,
            timeoutSeconds: formatDuration(seconds: timeout),
            durationSeconds: "-",
            result: "start",
            note: expectedValue
        )
        let startedAt = Date()
        let deadline = startedAt.addingTimeInterval(timeout)

        while Date() < deadline {
            _ = self.dismissKnownBlockingAlertIfVisible()
            let currentValue = self.elementValue(element: element)
            if currentValue == expectedValue || currentValue.contains(expectedValue) {
                let durationSeconds = Date().timeIntervalSince(startedAt)
                self.logSmokeBreadcrumb(
                    event: "wait_end",
                    action: "wait_for_element_value",
                    identifier: identifier,
                    timeoutSeconds: formatDuration(seconds: timeout),
                    durationSeconds: formatDuration(seconds: durationSeconds),
                    result: "success",
                    note: expectedValue
                )
                return true
            }

            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.2))
        }

        if let errorMessage = self.latestVisibleAssistantErrorMessage() {
            let durationSeconds = Date().timeIntervalSince(startedAt)
            self.logSmokeBreadcrumb(
                event: "wait_end",
                action: "wait_for_ai_completion",
                identifier: LiveSmokeIdentifier.aiAssistantErrorMessage,
                timeoutSeconds: formatDuration(seconds: timeout),
                durationSeconds: formatDuration(seconds: durationSeconds),
                result: "failure",
                note: errorMessage
            )
            throw LiveSmokeFailure.aiRunReportedError(
                message: errorMessage,
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }

        let durationSeconds = Date().timeIntervalSince(startedAt)
        self.logSmokeBreadcrumb(
            event: "wait_end",
            action: "wait_for_element_value",
            identifier: identifier,
            timeoutSeconds: formatDuration(seconds: timeout),
            durationSeconds: formatDuration(seconds: durationSeconds),
            result: "failure",
            note: self.elementValue(element: element)
        )
        return false
    }

    @MainActor
    func waitForSelectedTabScreen(selectedTab: LiveSmokeSelectedTab, timeout: TimeInterval) throws {
        try self.assertScreenVisible(screen: selectedTab.screen, timeout: timeout)
    }

    @MainActor
    var isApplicationRunning: Bool {
        guard self.app != nil else {
            return false
        }

        switch self.app.state {
        case .runningForeground:
            return true
        case .unknown, .notRunning, .runningBackground, .runningBackgroundSuspended:
            return false
        @unknown default:
            return false
        }
    }

    @MainActor
    func appStateDescription() -> String {
        guard self.app != nil else {
            return "uninitialized"
        }

        switch self.app.state {
        case .unknown:
            return "unknown"
        case .notRunning:
            return "notRunning"
        case .runningBackgroundSuspended:
            return "runningBackgroundSuspended"
        case .runningBackground:
            return "runningBackground"
        case .runningForeground:
            return "runningForeground"
        @unknown default:
            return "unknownFutureState"
        }
    }
}
