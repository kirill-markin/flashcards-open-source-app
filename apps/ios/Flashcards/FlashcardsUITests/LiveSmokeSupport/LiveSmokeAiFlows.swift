import XCTest

private let aiSeededLongConversationOldestAssistantMessage: String = """
Smoke seeded oldest assistant message for AI scroll coverage.
This is the oldest seeded reply and should only appear after scrolling away from the bottom.
Keep this exact sentence stable so the XCUITest can detect it deterministically.
"""
private let aiSeededLongConversationLatestAssistantMessage: String = """
Smoke seeded latest assistant message near the composer.
This is the most recent seeded reply and should be visible near the bottom on launch.
The XCUITest uses it as the bottom anchor before opening the keyboard.
"""
private let aiSeededLongConversationScrollMaximumAttempts: Int = 12
private let aiSeededLongConversationScrollSettlingDelaySeconds: TimeInterval = 0.25

extension LiveSmokeTestCase {
    @MainActor
    func assertAiEntrySurfaceVisible() throws {
        let consentButton = self.app.buttons[LiveSmokeIdentifier.aiConsentAcceptButton]
        if self.waitForOptionalElement(
            consentButton,
            identifier: LiveSmokeIdentifier.aiConsentAcceptButton,
            timeout: LiveSmokeConfiguration.optionalProbeTimeoutSeconds
        ) {
            return
        }

        try self.assertElementExists(
            identifier: LiveSmokeIdentifier.aiComposerTextField,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )
    }

    @MainActor
    func createAiCardWithConfirmation() throws {
        try self.assertScreenVisible(screen: .ai, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)

        let aiConsentButton = self.app.buttons[LiveSmokeIdentifier.aiConsentAcceptButton]
        if self.waitForOptionalElement(
            aiConsentButton,
            identifier: LiveSmokeIdentifier.aiConsentAcceptButton,
            timeout: LiveSmokeConfiguration.optionalProbeTimeoutSeconds
        ) {
            try self.tapButton(
                identifier: LiveSmokeIdentifier.aiConsentAcceptButton,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
            try self.waitForAiComposerAfterConsent()
        }

        var latestCompletedSqlSummaries: [String] = []

        for attempt in 1...aiCreatePromptMaximumAttempts {
            try self.assertElementDisabled(
                identifier: LiveSmokeIdentifier.aiComposerSendButton,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
            try self.replaceAiComposerText(
                aiCreatePromptText,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
            try self.assertElementEnabled(
                identifier: LiveSmokeIdentifier.aiComposerSendButton,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
            self.logActionStart(action: "ai_send_\(attempt)", identifier: LiveSmokeIdentifier.aiComposerSendButton)
            try self.tapButton(
                identifier: LiveSmokeIdentifier.aiComposerSendButton,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
            self.logActionEnd(
                action: "ai_send_\(attempt)",
                identifier: LiveSmokeIdentifier.aiComposerSendButton,
                result: "success",
                note: "AI create request sent"
            )
            latestCompletedSqlSummaries = try self.waitForCompletedAiInsertToolCall(
                timeout: aiCreateRunCompletionTimeoutSeconds
            )
            try self.assertElementLabel(
                identifier: LiveSmokeIdentifier.aiComposerSendButton,
                expectedLabel: "Send message",
                timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
            )
            try self.assertElementDisabled(
                identifier: LiveSmokeIdentifier.aiComposerSendButton,
                timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
            )
            return
        }

        throw LiveSmokeFailure.unexpectedAiConversationState(
            message: "AI create flow did not produce a completed SQL INSERT INTO cards after \(aiCreatePromptMaximumAttempts) attempts. CompletedSqlToolCalls: \(latestCompletedSqlSummaries)",
            screen: self.currentScreenSummary(),
            step: self.currentStepTitle
        )
    }

    @MainActor
    func startNewAiChatAndAssertConversationReset() throws {
        let assistantErrorMessagesBeforeReset = self.visibleAssistantErrorMessageCount()

        try self.tapButton(
            identifier: LiveSmokeIdentifier.aiNewChatButton,
            timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
        )

        try self.assertElementExists(
            identifier: LiveSmokeIdentifier.aiComposerTextField,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )
        try self.assertElementExists(
            identifier: LiveSmokeIdentifier.aiEmptyState,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )

        let messageRows = self.app.descendants(matching: .any)
            .matching(identifier: LiveSmokeIdentifier.aiMessageRow)
            .count
        if messageRows != 0 {
            throw LiveSmokeFailure.unexpectedAiConversationState(
                message: "Expected zero AI chat message rows after starting a new chat, found \(messageRows).",
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }

        let assistantErrorMessages = self.visibleAssistantErrorMessageCount()
        if assistantErrorMessages > assistantErrorMessagesBeforeReset {
            throw LiveSmokeFailure.unexpectedAiConversationState(
                message: "Expected no new AI assistant error messages after starting a new chat, found \(assistantErrorMessages - assistantErrorMessagesBeforeReset).",
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }
    }

    @MainActor
    func waitForAiComposerAfterConsent() throws {
        let consentButton = self.app.buttons[LiveSmokeIdentifier.aiConsentAcceptButton]
        let composerTextField = self.app.descendants(matching: .any)
            .matching(identifier: LiveSmokeIdentifier.aiComposerTextField)
            .firstMatch
        let deadline = Date().addingTimeInterval(LiveSmokeConfiguration.longUiTimeoutSeconds)
        var nextConsentRetryTapAt = Date()

        while Date() < deadline {
            if consentButton.exists == false && composerTextField.exists {
                return
            }

            if consentButton.exists && consentButton.isHittable && Date() >= nextConsentRetryTapAt {
                consentButton.tap()
                nextConsentRetryTapAt = Date().addingTimeInterval(aiConsentRetryTapIntervalSeconds)
            }

            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.2))
        }

        if consentButton.exists {
            throw LiveSmokeFailure.unexpectedAiConversationState(
                message: "AI consent gate did not dismiss after accepting consent.",
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }

        throw LiveSmokeFailure.missingElement(
            identifier: LiveSmokeIdentifier.aiComposerTextField,
            timeoutSeconds: LiveSmokeConfiguration.longUiTimeoutSeconds,
            screen: self.currentScreenSummary(),
            step: self.currentStepTitle
        )
    }

    @MainActor
    func createGuestAiConversationForReset() throws {
        try self.assertScreenVisible(screen: .ai, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)

        let aiConsentButton = self.app.buttons[LiveSmokeIdentifier.aiConsentAcceptButton]
        if self.waitForOptionalElement(
            aiConsentButton,
            identifier: LiveSmokeIdentifier.aiConsentAcceptButton,
            timeout: LiveSmokeConfiguration.optionalProbeTimeoutSeconds
        ) {
            try self.tapButton(
                identifier: LiveSmokeIdentifier.aiConsentAcceptButton,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
            try self.waitForAiComposerAfterConsent()
        }

        try self.assertElementDisabled(
            identifier: LiveSmokeIdentifier.aiComposerSendButton,
            timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
        )
        let messageRowsBeforeSend = self.app.descendants(matching: .any)
            .matching(identifier: LiveSmokeIdentifier.aiMessageRow)
            .count
        try self.prepareAiComposerForResetConversation(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        let completedMarkerCountBeforeWait = self.app.descendants(matching: .any)
            .matching(identifier: LiveSmokeIdentifier.aiToolCallCompletedStatus)
            .count
        let errorMarkerCountBeforeWait = self.visibleAssistantErrorMessageCount()
        let assistantTextCountBeforeWait = self.visibleMeaningfulAssistantTextMessages().count
        try self.assertElementEnabled(
            identifier: LiveSmokeIdentifier.aiComposerSendButton,
            timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
        )
        try self.tapButton(
            identifier: LiveSmokeIdentifier.aiComposerSendButton,
            timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
        )
        try self.assertAiRunStartedOrFinished(
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds,
            completedMarkerCountBeforeWait: completedMarkerCountBeforeWait,
            errorMarkerCountBeforeWait: errorMarkerCountBeforeWait,
            assistantTextCountBeforeWait: assistantTextCountBeforeWait
        )
        try self.waitForUserAiMessageRowCountIncrease(
            previousCount: messageRowsBeforeSend,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )
        try self.assertElementLabel(
            identifier: LiveSmokeIdentifier.aiComposerSendButton,
            expectedLabel: "Send message",
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )
        try self.assertElementDisabled(
            identifier: LiveSmokeIdentifier.aiComposerSendButton,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )
        try self.assertElementEnabled(
            identifier: LiveSmokeIdentifier.aiNewChatButton,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )
    }

    @MainActor
    func assertSeededLongAiConversationStartsAtBottom() throws {
        try self.assertScreenVisible(screen: .ai, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertElementExists(
            identifier: LiveSmokeIdentifier.aiComposerTextField,
            timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
        )
        try self.assertElementExists(
            identifier: LiveSmokeIdentifier.aiConversationScrollSurface,
            timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
        )
        try self.assertAiConversationTextVisibleInScrollSurface(
            aiSeededLongConversationLatestAssistantMessage,
            timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
        )

        if self.aiConversationTextIsVisibleInScrollSurface(aiSeededLongConversationOldestAssistantMessage) {
            throw LiveSmokeFailure.unexpectedAiConversationState(
                message: "Expected the oldest seeded AI message to start off-screen near the top of the conversation.",
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }
    }

    @MainActor
    func revealOlderSeededAiMessagesWithKeyboardClosed() throws {
        try self.scrollAiConversationTowardOlderMessagesUntilTextVisible(
            aiSeededLongConversationOldestAssistantMessage
        )
    }

    @MainActor
    func revealOlderSeededAiMessagesWithKeyboardOpen() throws {
        try self.scrollAiConversationTowardLatestMessagesUntilTextVisible(
            aiSeededLongConversationLatestAssistantMessage
        )
        if self.aiConversationTextIsVisibleInScrollSurface(aiSeededLongConversationOldestAssistantMessage) {
            throw LiveSmokeFailure.unexpectedAiConversationState(
                message: "Expected the oldest seeded AI message to move out of view after returning to the latest message before opening the keyboard.",
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }

        try self.focusElementForTextInput(
            self.aiComposerTextFieldElement(),
            identifier: LiveSmokeIdentifier.aiComposerTextField,
            timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
        )
        try self.assertAiComposerKeyboardVisible(
            context: "after focusing the AI composer before the keyboard-open scroll assertion"
        )
        try self.scrollAiConversationTowardOlderMessagesUntilTextVisibleKeepingKeyboardOpen(
            aiSeededLongConversationOldestAssistantMessage
        )
    }

    @MainActor
    func replaceAiComposerText(_ text: String, timeout: TimeInterval) throws {
        let element = self.aiComposerTextFieldElement()
        try self.replaceTextSafely(
            text,
            inElement: element,
            identifier: LiveSmokeIdentifier.aiComposerTextField,
            placeholderValue: aiComposerPlaceholderText,
            timeout: timeout
        )
    }

    @MainActor
    func prepareAiComposerForResetConversation(timeout: TimeInterval) throws {
        let element = self.aiComposerTextFieldElement()

        for _ in 1...aiResetPromptMaximumAttempts {
            try self.clearAndTypeAiComposerTextWithoutExactValueAssertion(
                aiResetPromptText,
                element: element,
                timeout: timeout
            )

            if self.waitForAiComposerSendEnabled(timeout: timeout) {
                return
            }
        }

        throw LiveSmokeFailure.unexpectedAiConversationState(
            message: "AI composer did not become sendable for the reset conversation after \(aiResetPromptMaximumAttempts) attempts.",
            screen: self.currentScreenSummary(),
            step: self.currentStepTitle
        )
    }

    @MainActor
    func aiComposerTextFieldElement() -> XCUIElement {
        self.app.descendants(matching: .any)
            .matching(identifier: LiveSmokeIdentifier.aiComposerTextField)
            .firstMatch
    }

    @MainActor
    func clearAndTypeAiComposerTextWithoutExactValueAssertion(
        _ text: String,
        element: XCUIElement,
        timeout: TimeInterval
    ) throws {
        try self.runWithInlineRawScreenStateOnFailure(
            action: "replace_text_without_exact_match.\(LiveSmokeIdentifier.aiComposerTextField)"
        ) {
            try self.focusElementForTextInput(
                element,
                identifier: LiveSmokeIdentifier.aiComposerTextField,
                timeout: timeout
            )

            let existingValue = self.elementValue(element: element)
            if existingValue.isEmpty == false && existingValue != aiComposerPlaceholderText {
                let deleteSequence = String(repeating: XCUIKeyboardKey.delete.rawValue, count: existingValue.count)
                element.typeText(deleteSequence)
            }

            element.typeText(text)
        }
    }

    @MainActor
    func waitForAiComposerSendEnabled(timeout: TimeInterval) -> Bool {
        let sendButton = self.app.buttons[LiveSmokeIdentifier.aiComposerSendButton]
        let deadline = Date().addingTimeInterval(timeout)

        while Date() < deadline {
            if sendButton.exists && sendButton.isEnabled {
                return true
            }

            RunLoop.current.run(until: Date(timeIntervalSinceNow: liveSmokeFocusPollIntervalSeconds))
        }

        return false
    }

    @MainActor
    func scrollAiConversationTowardOlderMessagesUntilTextVisible(_ text: String) throws {
        try self.scrollAiConversationUntilTextVisible(
            text,
            startOffset: CGVector(dx: 0.5, dy: 0.28),
            endOffset: CGVector(dx: 0.5, dy: 0.82),
            directionDescription: "older messages"
        )
    }

    @MainActor
    func scrollAiConversationTowardLatestMessagesUntilTextVisible(_ text: String) throws {
        try self.scrollAiConversationUntilTextVisible(
            text,
            startOffset: CGVector(dx: 0.5, dy: 0.82),
            endOffset: CGVector(dx: 0.5, dy: 0.28),
            directionDescription: "latest messages"
        )
    }

    @MainActor
    func aiComposerSuggestionButton(index: Int) -> XCUIElement {
        self.app.descendants(matching: .any)
            .matching(identifier: "\(LiveSmokeIdentifier.aiComposerSuggestionPrefix)\(index)")
            .firstMatch
    }

    @MainActor
    private func assertAiConversationTextVisibleInScrollSurface(
        _ text: String,
        timeout: TimeInterval
    ) throws {
        let deadline = Date().addingTimeInterval(timeout)

        while Date() < deadline {
            if self.aiConversationTextIsVisibleInScrollSurface(text) {
                return
            }

            RunLoop.current.run(until: Date(timeIntervalSinceNow: liveSmokeFocusPollIntervalSeconds))
        }

        throw LiveSmokeFailure.unexpectedAiConversationState(
            message: "Expected AI conversation text '\(text)' to already be visible without scrolling.",
            screen: self.currentScreenSummary(),
            step: self.currentStepTitle
        )
    }

    @MainActor
    private func scrollAiConversationUntilTextVisible(
        _ text: String,
        startOffset: CGVector,
        endOffset: CGVector,
        directionDescription: String
    ) throws {
        let surface = self.aiConversationScrollSurfaceElement()
        for attempt in 1...aiSeededLongConversationScrollMaximumAttempts {
            if self.aiConversationTextIsVisibleInScrollSurface(text) {
                return
            }

            try self.dragAiConversationScrollSurface(
                surface: surface,
                from: startOffset,
                to: endOffset,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds,
                note: "attempt \(attempt) toward \(directionDescription)"
            )
            RunLoop.current.run(
                until: Date(timeIntervalSinceNow: aiSeededLongConversationScrollSettlingDelaySeconds)
            )
        }

        throw LiveSmokeFailure.unexpectedAiConversationState(
            message: "Expected AI conversation text '\(text)' to become visible after scrolling toward \(directionDescription).",
            screen: self.currentScreenSummary(),
            step: self.currentStepTitle
        )
    }

    @MainActor
    private func scrollAiConversationTowardOlderMessagesUntilTextVisibleKeepingKeyboardOpen(_ text: String) throws {
        let surface = self.aiConversationScrollSurfaceElement()
        let startOffset = CGVector(dx: 0.5, dy: 0.34)
        let endOffset = CGVector(dx: 0.5, dy: 0.60)

        for attempt in 1...aiSeededLongConversationScrollMaximumAttempts {
            if self.aiConversationTextIsVisibleInScrollSurface(text) {
                try self.assertAiComposerKeyboardVisible(
                    context: "after revealing older AI messages with the keyboard-open scroll assertion"
                )
                return
            }

            try self.assertAiComposerKeyboardVisible(
                context: "before keyboard-open AI conversation scroll attempt \(attempt)"
            )
            try self.dragAiConversationScrollSurface(
                surface: surface,
                from: startOffset,
                to: endOffset,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds,
                note: "attempt \(attempt) toward older messages while keeping the keyboard open"
            )
            RunLoop.current.run(
                until: Date(timeIntervalSinceNow: aiSeededLongConversationScrollSettlingDelaySeconds)
            )
            try self.assertAiComposerKeyboardVisible(
                context: "after keyboard-open AI conversation scroll attempt \(attempt)"
            )
        }

        throw LiveSmokeFailure.unexpectedAiConversationState(
            message: "Expected AI conversation text '\(text)' to become visible after scrolling toward older messages with the keyboard still open.",
            screen: self.currentScreenSummary(),
            step: self.currentStepTitle
        )
    }

    @MainActor
    private func aiConversationTextIsVisibleInScrollSurface(_ text: String) -> Bool {
        let surface = self.aiConversationScrollSurfaceElement()
        let element = self.aiConversationTextElement(text)

        guard surface.exists, element.exists else {
            return false
        }

        let surfaceFrame = surface.frame
        let elementFrame = element.frame
        guard surfaceFrame.isEmpty == false, elementFrame.isEmpty == false else {
            return false
        }

        return surfaceFrame.intersects(elementFrame)
    }

    @MainActor
    private func aiConversationScrollSurfaceElement() -> XCUIElement {
        self.app.scrollViews[LiveSmokeIdentifier.aiConversationScrollSurface].firstMatch
    }

    @MainActor
    private func dragAiConversationScrollSurface(
        surface: XCUIElement,
        from startOffset: CGVector,
        to endOffset: CGVector,
        timeout: TimeInterval,
        note: String
    ) throws {
        try self.runWithInlineRawScreenStateOnFailure(
            action: "drag_ai_conversation.\(LiveSmokeIdentifier.aiConversationScrollSurface)"
        ) {
            if self.waitForOptionalElement(
                surface,
                identifier: LiveSmokeIdentifier.aiConversationScrollSurface,
                timeout: timeout
            ) == false {
                throw LiveSmokeFailure.missingElement(
                    identifier: LiveSmokeIdentifier.aiConversationScrollSurface,
                    timeoutSeconds: timeout,
                    screen: self.currentScreenSummary(),
                    step: self.currentStepTitle
                )
            }

            self.logActionStart(
                action: "drag_ai_conversation",
                identifier: LiveSmokeIdentifier.aiConversationScrollSurface
            )
            let startCoordinate = surface.coordinate(withNormalizedOffset: startOffset)
            let endCoordinate = surface.coordinate(withNormalizedOffset: endOffset)
            startCoordinate.press(forDuration: 0.05, thenDragTo: endCoordinate)
            self.logActionEnd(
                action: "drag_ai_conversation",
                identifier: LiveSmokeIdentifier.aiConversationScrollSurface,
                result: "success",
                note: note
            )
        }
    }

    @MainActor
    private func assertAiComposerKeyboardVisible(context: String) throws {
        if self.softwareKeyboardIsVisible() {
            return
        }

        throw LiveSmokeFailure.unexpectedAiConversationState(
            message: "Expected the AI composer keyboard to remain visible \(context).",
            screen: self.currentScreenSummary(),
            step: self.currentStepTitle
        )
    }

    @MainActor
    private func aiConversationTextElement(_ text: String) -> XCUIElement {
        let predicate = NSPredicate(format: "label == %@ OR value == %@", text, text)
        return self.app.descendants(matching: .any).matching(predicate).firstMatch
    }

    @MainActor
    func tapAiComposerSuggestion(index: Int, timeout: TimeInterval) throws -> String {
        let button = self.aiComposerSuggestionButton(index: index)
        let identifier = "\(LiveSmokeIdentifier.aiComposerSuggestionPrefix)\(index)"
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

        let text = button.label.trimmingCharacters(in: .whitespacesAndNewlines)
        try self.tapButton(button: button, identifier: identifier, timeout: timeout)
        return text
    }

    @MainActor
    func waitForAiComposerSuggestionCount(expectedCount: Int, timeout: TimeInterval) throws {
        let predicate = NSPredicate(
            format: "identifier BEGINSWITH %@",
            LiveSmokeIdentifier.aiComposerSuggestionPrefix
        )
        let startedAt = Date()
        let deadline = startedAt.addingTimeInterval(timeout)

        while Date() < deadline {
            let currentCount = self.app.descendants(matching: .any)
                .matching(predicate)
                .count
            if currentCount == expectedCount {
                return
            }

            RunLoop.current.run(until: Date(timeIntervalSinceNow: liveSmokeFocusPollIntervalSeconds))
        }

        let currentCount = self.app.descendants(matching: .any)
            .matching(predicate)
            .count
        throw LiveSmokeFailure.unexpectedAiConversationState(
            message: "Expected \(expectedCount) AI composer suggestions, found \(currentCount).",
            screen: self.currentScreenSummary(),
            step: self.currentStepTitle
        )
    }

    @MainActor
    func waitForAiComposerValue(_ expectedValue: String, timeout: TimeInterval) throws {
        let element = self.aiComposerTextFieldElement()
        if try self.waitForElementValueContaining(
            element,
            identifier: LiveSmokeIdentifier.aiComposerTextField,
            expectedValue: expectedValue,
            timeout: timeout
        ) == false {
            throw LiveSmokeFailure.unexpectedElementValue(
                identifier: LiveSmokeIdentifier.aiComposerTextField,
                expectedValue: expectedValue,
                actualValue: self.elementValue(element: element),
                timeoutSeconds: timeout,
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }
    }

    @MainActor
    func clearAiComposerText(timeout: TimeInterval) throws {
        let element = self.aiComposerTextFieldElement()
        try self.clearAndTypeAiComposerTextWithoutExactValueAssertion(
            "",
            element: element,
            timeout: timeout
        )
    }

    @MainActor
    func waitForUserAiMessageRowCountIncrease(
        previousCount: Int,
        timeout: TimeInterval
    ) throws {
        let startedAt = Date()
        let deadline = startedAt.addingTimeInterval(timeout)

        self.logSmokeBreadcrumb(
            event: "wait_start",
            action: "wait_for_user_ai_message_row",
            identifier: LiveSmokeIdentifier.aiMessageRow,
            timeoutSeconds: formatDuration(seconds: timeout),
            durationSeconds: "-",
            result: "start",
            note: "waiting for a new user AI message row"
        )

        while Date() < deadline {
            let currentCount = self.app.descendants(matching: .any)
                .matching(identifier: LiveSmokeIdentifier.aiMessageRow)
                .count
            if currentCount > previousCount {
                let durationSeconds = Date().timeIntervalSince(startedAt)
                self.logSmokeBreadcrumb(
                    event: "wait_end",
                    action: "wait_for_user_ai_message_row",
                    identifier: LiveSmokeIdentifier.aiMessageRow,
                    timeoutSeconds: formatDuration(seconds: timeout),
                    durationSeconds: formatDuration(seconds: durationSeconds),
                    result: "success",
                    note: "user AI message row count increased"
                )
                return
            }

            RunLoop.current.run(until: Date(timeIntervalSinceNow: liveSmokeFocusPollIntervalSeconds))
        }

        let currentCount = self.app.descendants(matching: .any)
            .matching(identifier: LiveSmokeIdentifier.aiMessageRow)
            .count
        let durationSeconds = Date().timeIntervalSince(startedAt)
        self.logSmokeBreadcrumb(
            event: "wait_end",
            action: "wait_for_user_ai_message_row",
            identifier: LiveSmokeIdentifier.aiMessageRow,
            timeoutSeconds: formatDuration(seconds: timeout),
            durationSeconds: formatDuration(seconds: durationSeconds),
            result: "failure",
            note: "previous=\(previousCount) current=\(currentCount)"
        )
        throw LiveSmokeFailure.unexpectedAiConversationState(
            message: "Expected at least one new user AI message row before reset, but the count stayed at \(currentCount).",
            screen: self.currentScreenSummary(),
            step: self.currentStepTitle
        )
    }

    @MainActor
    func waitForCompletedAiInsertToolCall(
        timeout: TimeInterval
    ) throws -> [String] {
        let startedAt = Date()
        let deadline = startedAt.addingTimeInterval(timeout)
        self.logSmokeBreadcrumb(
            event: "wait_start",
            action: "wait_for_ai_insert_completion",
            identifier: LiveSmokeIdentifier.aiAssistantVisibleText,
            timeoutSeconds: formatDuration(seconds: timeout),
            durationSeconds: "-",
            result: "start",
            note: "waiting for completed INSERT INTO cards tool call"
        )

        while Date() < deadline {
            if let errorMessage = self.latestVisibleAssistantErrorMessage() {
                let durationSeconds = Date().timeIntervalSince(startedAt)
                self.logSmokeBreadcrumb(
                    event: "wait_end",
                    action: "wait_for_ai_insert_completion",
                    identifier: LiveSmokeIdentifier.aiAssistantErrorMessage,
                    timeoutSeconds: formatDuration(seconds: timeout),
                    durationSeconds: formatDuration(seconds: durationSeconds),
                    result: "failure",
                    note: errorMessage
                )
                throw LiveSmokeFailure.aiRunReportedError(
                    message: errorMessage.isEmpty ? "Assistant error message is empty." : errorMessage,
                    screen: self.currentScreenSummary(),
                    step: self.currentStepTitle
                )
            }

            let completedSqlSummaries = self.visibleCompletedAiSqlToolCallSummaries()
            if completedSqlSummaries.contains(where: { summary in
                summary.contains("INSERT INTO cards")
            }) {
                let durationSeconds = Date().timeIntervalSince(startedAt)
                self.logSmokeBreadcrumb(
                    event: "wait_end",
                    action: "wait_for_ai_insert_completion",
                    identifier: LiveSmokeIdentifier.aiAssistantVisibleText,
                    timeoutSeconds: formatDuration(seconds: timeout),
                    durationSeconds: formatDuration(seconds: durationSeconds),
                    result: "success",
                    note: "completed INSERT INTO cards became visible"
                )
                return completedSqlSummaries
            }

            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.2))
        }

        let toolCallCheck = try self.completedAiInsertToolCallCheck()
        let assistantMessages = self.visibleMeaningfulAssistantTextMessages()
        throw LiveSmokeFailure.unexpectedAiConversationState(
            message: "AI create flow did not surface a completed SQL INSERT INTO cards within \(formatDuration(seconds: timeout)). CompletedSqlToolCalls: \(toolCallCheck.completedSqlSummaries). AssistantMessages: \(assistantMessages)",
            screen: self.currentScreenSummary(),
            step: self.currentStepTitle
        )
    }

    @MainActor
    func assertAiRunStartedOrFinished(
        timeout: TimeInterval,
        completedMarkerCountBeforeWait: Int,
        errorMarkerCountBeforeWait: Int,
        assistantTextCountBeforeWait: Int
    ) throws {
        let sendButton = self.app.buttons[LiveSmokeIdentifier.aiComposerSendButton]
        let completedElements = self.app.descendants(matching: .any)
            .matching(identifier: LiveSmokeIdentifier.aiToolCallCompletedStatus)

        if self.waitForOptionalElement(
            sendButton,
            identifier: LiveSmokeIdentifier.aiComposerSendButton,
            timeout: timeout
        ) == false {
            throw LiveSmokeFailure.missingElement(
                identifier: LiveSmokeIdentifier.aiComposerSendButton,
                timeoutSeconds: timeout,
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }

        let startedAt = Date()
        let deadline = startedAt.addingTimeInterval(timeout)
        self.logSmokeBreadcrumb(
            event: "wait_start",
            action: "wait_for_ai_activity",
            identifier: LiveSmokeIdentifier.aiComposerSendButton,
            timeoutSeconds: formatDuration(seconds: timeout),
            durationSeconds: "-",
            result: "start",
            note: "waiting for AI run start or completion"
        )

        while Date() < deadline {
            if let errorMessage = self.latestVisibleAssistantErrorMessage() {
                let durationSeconds = Date().timeIntervalSince(startedAt)
                self.logSmokeBreadcrumb(
                    event: "wait_end",
                    action: "wait_for_ai_activity",
                    identifier: LiveSmokeIdentifier.aiAssistantErrorMessage,
                    timeoutSeconds: formatDuration(seconds: timeout),
                    durationSeconds: formatDuration(seconds: durationSeconds),
                    result: "failure",
                    note: errorMessage
                )
                throw LiveSmokeFailure.aiRunReportedError(
                    message: errorMessage.isEmpty ? "Assistant error message is empty." : errorMessage,
                    screen: self.currentScreenSummary(),
                    step: self.currentStepTitle
                )
            }

            if completedElements.count > completedMarkerCountBeforeWait {
                let durationSeconds = Date().timeIntervalSince(startedAt)
                self.logSmokeBreadcrumb(
                    event: "wait_end",
                    action: "wait_for_ai_activity",
                    identifier: LiveSmokeIdentifier.aiToolCallCompletedStatus,
                    timeoutSeconds: formatDuration(seconds: timeout),
                    durationSeconds: formatDuration(seconds: durationSeconds),
                    result: "success",
                    note: "AI run completed before stop state was observed"
                )
                return
            }

            if self.visibleMeaningfulAssistantTextMessages().count > assistantTextCountBeforeWait {
                let durationSeconds = Date().timeIntervalSince(startedAt)
                self.logSmokeBreadcrumb(
                    event: "wait_end",
                    action: "wait_for_ai_activity",
                    identifier: LiveSmokeIdentifier.aiAssistantVisibleText,
                    timeoutSeconds: formatDuration(seconds: timeout),
                    durationSeconds: formatDuration(seconds: durationSeconds),
                    result: "success",
                    note: "AI run completed with visible assistant text"
                )
                return
            }

            if sendButton.exists, sendButton.label == "Stop response" {
                if sendButton.isEnabled == false {
                    throw LiveSmokeFailure.disabledElement(
                        identifier: LiveSmokeIdentifier.aiComposerSendButton,
                        screen: self.currentScreenSummary(),
                        step: self.currentStepTitle
                    )
                }
                let durationSeconds = Date().timeIntervalSince(startedAt)
                self.logSmokeBreadcrumb(
                    event: "wait_end",
                    action: "wait_for_ai_activity",
                    identifier: LiveSmokeIdentifier.aiComposerSendButton,
                    timeoutSeconds: formatDuration(seconds: timeout),
                    durationSeconds: formatDuration(seconds: durationSeconds),
                    result: "success",
                    note: "AI run entered streaming state"
                )
                return
            }

            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.2))
        }

        let durationSeconds = Date().timeIntervalSince(startedAt)
        self.logSmokeBreadcrumb(
            event: "wait_end",
            action: "wait_for_ai_activity",
            identifier: LiveSmokeIdentifier.aiComposerSendButton,
            timeoutSeconds: formatDuration(seconds: timeout),
            durationSeconds: formatDuration(seconds: durationSeconds),
            result: "failure",
            note: "AI run did not start or complete"
        )
        throw LiveSmokeFailure.unexpectedAiConversationState(
            message: "AI run did not enter streaming or completion state within \(formatDuration(seconds: timeout)).",
            screen: self.currentScreenSummary(),
            step: self.currentStepTitle
        )
    }

    @MainActor
    func completedAiInsertToolCallCheck() throws -> LiveSmokeAIToolCallCheck {
        let summaryTexts = self.elements(
            query: self.app.descendants(matching: .any)
                .matching(identifier: LiveSmokeIdentifier.aiToolCallSummary)
        ).map(\.label).map { label in
            label.trimmingCharacters(in: .whitespacesAndNewlines)
        }.filter { label in
            label.isEmpty == false
        }
        let requestTexts = self.elements(
            query: self.app.descendants(matching: .any)
                .matching(identifier: LiveSmokeIdentifier.aiToolCallRequestText)
        ).map(\.label).map { label in
            label.trimmingCharacters(in: .whitespacesAndNewlines)
        }.filter { label in
            label.isEmpty == false
        }
        let responseTexts = self.elements(
            query: self.app.descendants(matching: .any)
                .matching(identifier: LiveSmokeIdentifier.aiToolCallResponseText)
        ).map(\.label).map { label in
            label.trimmingCharacters(in: .whitespacesAndNewlines)
        }.filter { label in
            label.isEmpty == false
        }
        let completedSqlSummaries = summaryTexts.filter { summaryText in
            summaryText.contains("SQL:")
        }
        let summaryMatch = completedSqlSummaries.contains { summaryText in
            summaryText.contains("INSERT INTO cards")
        }
        let requestMatch = requestTexts.isEmpty || requestTexts.contains { requestText in
            requestText.contains("INSERT INTO cards")
        }
        let responseMatch = responseTexts.isEmpty || responseTexts.contains { responseText in
            responseText.contains("\"ok\":true")
        }
        let matchingInsertFound = summaryMatch && requestMatch && responseMatch

        return LiveSmokeAIToolCallCheck(
            matchingInsertFound: matchingInsertFound,
            completedSqlSummaries: completedSqlSummaries
        )
    }
}
