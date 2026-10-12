import XCTest

extension LiveSmokeTestCase {
    @MainActor
    func visibleAssistantRowTexts(ignoredExactLabels: Set<String>) -> [String] {
        self.app.collectionViews[LiveSmokeIdentifier.aiScreen].firstMatch.cells
            .containing(.staticText, identifier: LiveSmokeIdentifier.aiAssistantVisibleText)
            .allElementsBoundByAccessibilityElement
        .filter { row in
            row.identifier != LiveSmokeIdentifier.aiAssistantErrorMessage
                && row.descendants(matching: .any)
                .matching(identifier: LiveSmokeIdentifier.aiAssistantErrorMessage).firstMatch.exists == false
        }
        .compactMap { row in
            row.staticTexts.matching(identifier: LiveSmokeIdentifier.aiAssistantVisibleText)
                .allElementsBoundByAccessibilityElement
                .lazy
            .compactMap { element in
                let value = self.elementValue(element: element).trimmingCharacters(in: .whitespacesAndNewlines)
                if value.isEmpty == false {
                    return value
                }

                let label = element.label.trimmingCharacters(in: .whitespacesAndNewlines)
                return label.isEmpty ? nil : label
            }
            .first { text in
                text.isEmpty == false && ignoredExactLabels.contains(text) == false
            }
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
            label.contains("SQL query:") || label.contains("SQL write:")
        }
        .reduce(into: [String]()) { partialResult, label in
            if partialResult.contains(label) == false {
                partialResult.append(label)
            }
        }
    }

    @MainActor
    func visibleMeaningfulAssistantTextMessages() -> [String] {
        self.visibleAssistantRowTexts(ignoredExactLabels: ["Assistant", "Assistant is typing"])
    }

    @MainActor
    func visibleAssistantErrorMessageCount() -> Int {
        self.visibleAssistantErrorElement().exists ? 1 : 0
    }

    @MainActor
    func latestVisibleAssistantErrorMessage() -> String? {
        let element = self.visibleAssistantErrorElement()
        guard element.exists else {
            let alert = self.app.alerts.firstMatch
            guard alert.exists else {
                return nil
            }
            let alertText = self.elements(query: alert.descendants(matching: .staticText))
                .map(\.label).joined(separator: " | ")
            return "AI request presented an alert: \(alertText)"
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
