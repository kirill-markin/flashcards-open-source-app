import Foundation
import XCTest

private let liveSmokeAiDiagnosticIdentifiers: Set<String> = [
    LiveSmokeIdentifier.aiAssistantVisibleText,
    LiveSmokeIdentifier.aiAssistantErrorMessage,
    LiveSmokeIdentifier.aiToolCallSummary,
    LiveSmokeIdentifier.aiToolCallRequestText,
    LiveSmokeIdentifier.aiToolCallResponseText
]

enum LiveSmokeCloudSignInPostSendState: Equatable {
    case linkedAccount
    case workspaceChooser
    case sendCodeInFlight
    case postAuthLoading
    case postAuthSync
    case authError(message: String)
    case postAuthFailure(message: String)
    case unknown

    var diagnosticLabel: String {
        switch self {
        case .linkedAccount:
            return "linkedAccount"
        case .workspaceChooser:
            return "workspaceChooser"
        case .sendCodeInFlight:
            return "sendCodeInFlight"
        case .postAuthLoading:
            return "postAuthLoading"
        case .postAuthSync:
            return "postAuthSync"
        case .authError(let message):
            return "authError(\(message))"
        case .postAuthFailure(let message):
            return "postAuthFailure(\(message))"
        case .unknown:
            return "unknown"
        }
    }
}

extension LiveSmokeTestCase {
    @MainActor
    func visibleTextSnapshot() -> String {
        guard self.app != nil else {
            return "<app not initialized>"
        }
        guard self.isApplicationRunning else {
            return "<app not running>"
        }

        let labels = self.visibleStaticTextLabels(
            ignoredExactLabels: [],
            ignoredIdentifiers: liveSmokeAiDiagnosticIdentifiers
        )

        if labels.isEmpty {
            return "<no visible static text>"
        }

        return labels.joined(separator: " | ")
    }

    @MainActor
    func resolvedCloudSignInPostSendState() -> LiveSmokeCloudSignInPostSendState {
        if self.isAccountStatusLinked() {
            return .linkedAccount
        }

        let chooserScreen = self.app.collectionViews[LiveSmokeIdentifier.cloudWorkspaceChooserScreen].firstMatch
        if chooserScreen.exists {
            return .workspaceChooser
        }

        if self.elementExists(identifier: LiveSmokeIdentifier.cloudSignInPostAuthFailureScreen) {
            return .postAuthFailure(
                message: self.visibleCloudPostAuthFailureMessage() ?? "messageUnavailable"
            )
        }

        if self.elementExists(identifier: LiveSmokeIdentifier.cloudSignInPostAuthLoadingScreen) {
            return .postAuthLoading
        }

        if self.elementExists(identifier: LiveSmokeIdentifier.cloudSignInPostAuthSyncScreen) {
            return .postAuthSync
        }

        if self.isCloudSignInSendCodeInFlightVisible() {
            return .sendCodeInFlight
        }

        if self.elementExists(identifier: LiveSmokeIdentifier.cloudSignInInlineAuthError) {
            return .authError(
                message: self.visibleCloudSignInInlineAuthErrorMessage() ?? "messageUnavailable"
            )
        }

        return .unknown
    }

    @MainActor
    func visibleCloudSignInOverlaySummaryItems() -> [String] {
        switch self.resolvedCloudSignInPostSendState() {
        case .workspaceChooser:
            return ["cloudSignIn.workspaceChooser"]
        case .sendCodeInFlight:
            return ["cloudSignIn.sendCodeInFlight"]
        case .postAuthLoading:
            return ["cloudSignIn.postAuthLoading"]
        case .postAuthSync:
            return ["cloudSignIn.postAuthSync"]
        case .authError(let message):
            return ["cloudSignIn.authError(\(message))"]
        case .postAuthFailure(let message):
            return ["cloudSignIn.postAuthFailure(\(message))"]
        case .linkedAccount, .unknown:
            return []
        }
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
    private func visibleStaticTextLabels(
        ignoredExactLabels: Set<String>,
        ignoredIdentifiers: Set<String>
    ) -> [String] {
        self.elements(query: self.app.staticTexts)
            .filter { element in
                ignoredIdentifiers.contains(element.identifier) == false
            }
            .map(\.label)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { label in
                label.isEmpty == false && ignoredExactLabels.contains(label) == false
            }
    }

    @MainActor
    private func visibleCloudSignInInlineAuthErrorMessage() -> String? {
        self.visibleElementText(identifier: LiveSmokeIdentifier.cloudSignInInlineAuthErrorMessage)
    }

    @MainActor
    private func visibleCloudPostAuthFailureMessage() -> String? {
        self.visibleElementText(identifier: LiveSmokeIdentifier.cloudSignInPostAuthFailureMessage)
    }

    @MainActor
    private func isCloudSignInSendCodeInFlightVisible() -> Bool {
        let cloudSignInScreen = self.app.descendants(matching: .any)
            .matching(identifier: LiveSmokeIdentifier.cloudSignInScreen)
            .firstMatch
        let sendCodeButton = self.app.buttons[LiveSmokeIdentifier.cloudSignInSendCodeButton].firstMatch

        return cloudSignInScreen.exists && sendCodeButton.exists && sendCodeButton.isEnabled == false
    }

    @MainActor
    private func elementExists(identifier: String) -> Bool {
        self.app.descendants(matching: .any).matching(identifier: identifier).firstMatch.exists
    }

    @MainActor
    private func visibleElementText(identifier: String) -> String? {
        let element = self.app.descendants(matching: .any).matching(identifier: identifier).firstMatch
        guard element.exists else {
            return nil
        }

        let text = self.elementValue(element: element)
        return text.isEmpty ? nil : text
    }
}
