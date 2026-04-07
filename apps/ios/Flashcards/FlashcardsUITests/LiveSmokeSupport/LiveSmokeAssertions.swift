import XCTest

extension LiveSmokeTestCase {
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

    @MainActor
    func assertCurrentWorkspacePickerIsVisible() throws {
        let pickerScreen = self.app.descendants(matching: .any)
            .matching(identifier: LiveSmokeIdentifier.currentWorkspacePickerScreen)
            .firstMatch
        if self.waitForOptionalElement(
            pickerScreen,
            identifier: LiveSmokeIdentifier.currentWorkspacePickerScreen,
            timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
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
            if timeout >= LiveSmokeConfiguration.longUiTimeoutSeconds {
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
        if timeout >= LiveSmokeConfiguration.longUiTimeoutSeconds {
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
    private func exactVisibleText(_ text: String) -> XCUIElementQuery {
        let predicate = NSPredicate(format: "label == %@ OR identifier == %@", text, text)
        return self.app.descendants(matching: .any).matching(predicate)
    }
}
