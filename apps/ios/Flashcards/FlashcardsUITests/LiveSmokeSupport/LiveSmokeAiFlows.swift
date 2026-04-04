import XCTest

extension LiveSmokeTestCase {
    @MainActor
    func assertAiEntrySurfaceVisible() throws {
        let consentButton = self.app.buttons[LiveSmokeIdentifier.aiConsentAcceptButton]
        if self.waitForOptionalElement(
            consentButton,
            identifier: LiveSmokeIdentifier.aiConsentAcceptButton,
            timeout: self.optionalProbeTimeoutSeconds
        ) {
            return
        }

        try self.assertElementExists(
            identifier: LiveSmokeIdentifier.aiComposerTextField,
            timeout: self.longUiTimeoutSeconds
        )
    }

    @MainActor
    func createAiCardWithConfirmation() throws {
        try self.assertScreenVisible(screen: .ai, timeout: self.shortUiTimeoutSeconds)

        let aiConsentButton = self.app.buttons[LiveSmokeIdentifier.aiConsentAcceptButton]
        if self.waitForOptionalElement(
            aiConsentButton,
            identifier: LiveSmokeIdentifier.aiConsentAcceptButton,
            timeout: self.optionalProbeTimeoutSeconds
        ) {
            try self.tapElement(
                identifier: LiveSmokeIdentifier.aiConsentAcceptButton,
                timeout: self.shortUiTimeoutSeconds
            )
            try self.waitForAiComposerAfterConsent()
        }

        var latestCompletedSqlSummaries: [String] = []

        for attempt in 1...aiCreatePromptMaximumAttempts {
            try self.assertElementDisabled(
                identifier: LiveSmokeIdentifier.aiComposerSendButton,
                timeout: self.shortUiTimeoutSeconds
            )
            try self.replaceAiComposerText(
                aiCreatePromptText,
                timeout: self.shortUiTimeoutSeconds
            )
            try self.assertElementEnabled(
                identifier: LiveSmokeIdentifier.aiComposerSendButton,
                timeout: self.shortUiTimeoutSeconds
            )
            _ = self.dismissKnownBlockingAlertIfVisible()
            self.logActionStart(action: "ai_send_\(attempt)", identifier: LiveSmokeIdentifier.aiComposerSendButton)
            try self.tapElement(identifier: LiveSmokeIdentifier.aiComposerSendButton, timeout: self.shortUiTimeoutSeconds)
            _ = self.dismissKnownBlockingAlertIfVisible()
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
                timeout: self.longUiTimeoutSeconds
            )
            try self.assertElementDisabled(
                identifier: LiveSmokeIdentifier.aiComposerSendButton,
                timeout: self.longUiTimeoutSeconds
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

        try self.tapElement(
            identifier: LiveSmokeIdentifier.aiNewChatButton,
            timeout: self.shortUiTimeoutSeconds
        )

        try self.assertElementExists(
            identifier: LiveSmokeIdentifier.aiComposerTextField,
            timeout: self.longUiTimeoutSeconds
        )
        try self.assertElementExists(
            identifier: LiveSmokeIdentifier.aiEmptyState,
            timeout: self.longUiTimeoutSeconds
        )
        try self.assertElementDisabled(
            identifier: LiveSmokeIdentifier.aiComposerSendButton,
            timeout: self.longUiTimeoutSeconds
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
        let deadline = Date().addingTimeInterval(self.longUiTimeoutSeconds)
        var nextConsentRetryTapAt = Date()

        while Date() < deadline {
            _ = self.dismissKnownBlockingAlertIfVisible()

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
            timeoutSeconds: self.longUiTimeoutSeconds,
            screen: self.currentScreenSummary(),
            step: self.currentStepTitle
        )
    }

    @MainActor
    func createGuestAiConversationForReset() throws {
        try self.assertScreenVisible(screen: .ai, timeout: self.shortUiTimeoutSeconds)

        let aiConsentButton = self.app.buttons[LiveSmokeIdentifier.aiConsentAcceptButton]
        if self.waitForOptionalElement(
            aiConsentButton,
            identifier: LiveSmokeIdentifier.aiConsentAcceptButton,
            timeout: self.optionalProbeTimeoutSeconds
        ) {
            try self.tapElement(
                identifier: LiveSmokeIdentifier.aiConsentAcceptButton,
                timeout: self.shortUiTimeoutSeconds
            )
            try self.waitForAiComposerAfterConsent()
        }

        try self.assertElementDisabled(
            identifier: LiveSmokeIdentifier.aiComposerSendButton,
            timeout: self.shortUiTimeoutSeconds
        )
        let messageRowsBeforeSend = self.app.descendants(matching: .any)
            .matching(identifier: LiveSmokeIdentifier.aiMessageRow)
            .count
        try self.prepareAiComposerForResetConversation(timeout: self.shortUiTimeoutSeconds)
        let completedMarkerCountBeforeWait = self.app.descendants(matching: .any)
            .matching(identifier: LiveSmokeIdentifier.aiToolCallCompletedStatus)
            .count
        let errorMarkerCountBeforeWait = self.visibleAssistantErrorMessageCount()
        let assistantTextCountBeforeWait = self.visibleMeaningfulAssistantTextMessages().count
        try self.assertElementEnabled(
            identifier: LiveSmokeIdentifier.aiComposerSendButton,
            timeout: self.shortUiTimeoutSeconds
        )
        try self.tapElement(
            identifier: LiveSmokeIdentifier.aiComposerSendButton,
            timeout: self.shortUiTimeoutSeconds
        )
        try self.assertAiRunStartedOrFinished(
            timeout: self.longUiTimeoutSeconds,
            completedMarkerCountBeforeWait: completedMarkerCountBeforeWait,
            errorMarkerCountBeforeWait: errorMarkerCountBeforeWait,
            assistantTextCountBeforeWait: assistantTextCountBeforeWait
        )
        try self.waitForUserAiMessageRowCountIncrease(
            previousCount: messageRowsBeforeSend,
            timeout: self.longUiTimeoutSeconds
        )
        try self.assertElementEnabled(
            identifier: LiveSmokeIdentifier.aiNewChatButton,
            timeout: self.longUiTimeoutSeconds
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
        let predicate = NSPredicate(
            format: "identifier == %@ OR value == %@ OR label == %@",
            LiveSmokeIdentifier.aiComposerTextField,
            aiComposerPlaceholderText,
            aiComposerPlaceholderText
        )
        return self.app.descendants(matching: .any).matching(predicate).firstMatch
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
            _ = self.dismissKnownBlockingAlertIfVisible()
        }
    }

    @MainActor
    func waitForAiComposerSendEnabled(timeout: TimeInterval) -> Bool {
        let sendButton = self.app.descendants(matching: .any)
            .matching(identifier: LiveSmokeIdentifier.aiComposerSendButton)
            .firstMatch
        let deadline = Date().addingTimeInterval(timeout)

        while Date() < deadline {
            _ = self.dismissKnownBlockingAlertIfVisible()

            if sendButton.exists && sendButton.isEnabled {
                return true
            }

            RunLoop.current.run(until: Date(timeIntervalSinceNow: liveSmokeFocusPollIntervalSeconds))
        }

        return false
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
            _ = self.dismissKnownBlockingAlertIfVisible()

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
            _ = self.dismissKnownBlockingAlertIfVisible()

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
        let sendButtonQuery = self.app.descendants(matching: .any)
            .matching(identifier: LiveSmokeIdentifier.aiComposerSendButton)
        let sendButton = sendButtonQuery.firstMatch
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
            _ = self.dismissKnownBlockingAlertIfVisible()

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

            let currentSendButton = sendButtonQuery.firstMatch
            if currentSendButton.exists, currentSendButton.label == "Stop response" {
                if currentSendButton.isEnabled == false {
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
