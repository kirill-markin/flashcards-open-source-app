import XCTest

extension LiveSmokeTestCase {
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
    private func visibleAssistantErrorElement() -> XCUIElement {
        self.app.otherElements[LiveSmokeIdentifier.aiAssistantErrorMessage].firstMatch
    }
}
