import XCTest

extension LiveSmokeTestCase {
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
            let existingValue = self.elementValue(element: element)
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

    // Raw XCUIElement.typeText can hang until XCTest's global execution allowance
    // when Simulator or CI never grants keyboard focus. Always gate text entry on
    // explicit focus so text-input failures fail fast with local diagnostics.
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
}
