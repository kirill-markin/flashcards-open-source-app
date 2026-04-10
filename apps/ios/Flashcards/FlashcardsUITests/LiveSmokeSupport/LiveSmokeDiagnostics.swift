import Foundation
import XCTest

private let liveSmokePlaceholderScreenSummary: String = "screens=[-] nav=[-] alerts=[-] tabs=[-]"
private let liveSmokeAiDiagnosticIdentifiers: Set<String> = [
    LiveSmokeIdentifier.aiAssistantVisibleText,
    LiveSmokeIdentifier.aiAssistantErrorMessage,
    LiveSmokeIdentifier.aiToolCallSummary,
    LiveSmokeIdentifier.aiToolCallRequestText,
    LiveSmokeIdentifier.aiToolCallResponseText
]

struct LiveSmokeDiagnosticsSnapshot {
    let currentScreenSummary: String
    let launchEnvironmentSummary: String
    let rootScreenQuerySnapshot: String
    let activeAlertsSnapshot: String
    let visibleTextSnapshot: String
    let assistantTranscriptSnapshot: [String]
    let assistantErrorSnapshot: String?
    let toolCallSnapshot: [String]
    let breadcrumbs: String
    let appDebugHierarchy: String
}

extension LiveSmokeTestCase {
    @MainActor
    func makeDiagnosticsSnapshot() -> LiveSmokeDiagnosticsSnapshot {
        LiveSmokeDiagnosticsSnapshot(
            currentScreenSummary: self.currentScreenSummary(),
            launchEnvironmentSummary: self.launchEnvironmentSummary(),
            rootScreenQuerySnapshot: self.rootScreenQuerySnapshot(),
            activeAlertsSnapshot: self.activeAlertsSnapshot(),
            visibleTextSnapshot: self.visibleTextSnapshot(),
            assistantTranscriptSnapshot: self.visibleMeaningfulAssistantTextMessages(),
            assistantErrorSnapshot: self.latestVisibleAssistantErrorMessage(),
            toolCallSnapshot: self.visibleCompletedAiSqlToolCallSummaries(),
            breadcrumbs: self.recentBreadcrumbLines(),
            appDebugHierarchy: self.appDebugHierarchy()
        )
    }

    @MainActor
    func currentScreenSummary() -> String {
        guard self.app != nil else {
            return "appState=uninitialized screens=[-] tabs=[-]"
        }
        guard self.isApplicationRunning else {
            return "appState=\(self.appStateDescription()) screens=[-] tabs=[-]"
        }

        let visibleScreenTitles = LiveSmokeScreen.allCases
            .filter { screen in
                self.app.descendants(matching: .any).matching(identifier: screen.identifier).firstMatch.exists
            }
            .map(\.title)
            .joined(separator: ", ")
        let visibleTabBarItems = self.visibleTabBarItemSnapshot()

        return """
        appState=\(self.appStateDescription()) \
        screens=[\(visibleScreenTitles.isEmpty ? "-" : visibleScreenTitles)] \
        tabs=[\(visibleTabBarItems)]
        """
    }

    @MainActor
    func launchEnvironmentSummary() -> String {
        guard self.app != nil else {
            return "<app not initialized>"
        }

        let resetState = self.app.launchEnvironment[LiveSmokeConfiguration.resetStateEnvironmentKey] ?? "-"
        let selectedTab = self.app.launchEnvironment[LiveSmokeConfiguration.selectedTabEnvironmentKey] ?? "-"
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
            let staticTexts = self.elements(query: alert.staticTexts)
                .map(\.label)
                .filter { $0.isEmpty == false && $0 != alert.label }
                .joined(separator: " | ")
            let textSummary = staticTexts.isEmpty ? "-" : staticTexts
            return "\(alert.label) {\(textSummary)} [\(buttons.isEmpty ? "-" : buttons)]"
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
    func visibleTabBarItemSnapshot() -> String {
        guard self.app != nil else {
            return "-"
        }
        guard self.isApplicationRunning else {
            return "-"
        }

        let buttons = self.elements(query: self.app.tabBars.buttons)
        guard buttons.isEmpty == false else {
            return "-"
        }

        return buttons.enumerated().map { index, button in
            let label = button.label.isEmpty ? "<empty>" : button.label
            let identifier = button.identifier.isEmpty ? "-" : button.identifier
            return "\(label){index=\(index),id=\(identifier),hittable=\(button.isHittable)}"
        }.joined(separator: ", ")
    }

    @MainActor
    func attachFailureDiagnostics(
        stepTitle: String,
        error: Error,
        activity: XCTActivity,
        snapshot: LiveSmokeDiagnosticsSnapshot
    ) {
        if self.isApplicationRunning {
            let screenshotAttachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            screenshotAttachment.name = "Failure Screenshot - \(stepTitle)"
            screenshotAttachment.lifetime = .keepAlways
            activity.add(screenshotAttachment)
        }

        let hierarchyAttachment = XCTAttachment(string: snapshot.appDebugHierarchy)
        hierarchyAttachment.name = "UI Hierarchy - \(stepTitle)"
        hierarchyAttachment.lifetime = .keepAlways
        activity.add(hierarchyAttachment)

        let diagnosticsAttachment = self.makeTextAttachment(
            name: "Failure Diagnostics - \(stepTitle)",
            text: """
            Step: \(stepTitle)
            Error: \(error.localizedDescription)
            Current screen: \(snapshot.currentScreenSummary)
            Launch environment: \(snapshot.launchEnvironmentSummary)
            Root screen queries: \(snapshot.rootScreenQuerySnapshot)
            Active alerts: \(snapshot.activeAlertsSnapshot)
            Visible text snapshot: \(snapshot.visibleTextSnapshot)
            Assistant transcript snapshot: \(snapshot.assistantTranscriptSnapshot)
            Assistant error snapshot: \(snapshot.assistantErrorSnapshot ?? "<no assistant error>")
            Tool call snapshot: \(snapshot.toolCallSnapshot)
            Breadcrumbs:
            \(snapshot.breadcrumbs)
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
    func makeStepFailureSummaryAttachment(
        stepTitle: String,
        error: Error,
        durationSeconds: TimeInterval,
        snapshot: LiveSmokeDiagnosticsSnapshot
    ) -> XCTAttachment {
        self.makeTextAttachment(
            name: "Step Failure Summary - \(stepTitle)",
            text: """
            Result: failure
            Step: \(stepTitle)
            Duration: \(formatDuration(seconds: durationSeconds))
            Error: \(error.localizedDescription)
            Current screen: \(snapshot.currentScreenSummary)
            Visible text snapshot: \(snapshot.visibleTextSnapshot)
            Breadcrumbs:
            \(snapshot.breadcrumbs)
            """
        )
    }

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
    func emitInlineRawScreenStateIfNeeded(
        action: String,
        snapshot: LiveSmokeDiagnosticsSnapshot? = nil
    ) {
        if self.hasPrintedInlineRawScreenStateForCurrentFailure {
            return
        }

        self.hasPrintedInlineRawScreenStateForCurrentFailure = true
        let resolvedSnapshot = snapshot ?? self.makeDiagnosticsSnapshot()
        fputs(self.inlineRawScreenStateBlock(action: action, snapshot: resolvedSnapshot) + "\n", stderr)
    }

    @MainActor
    func inlineRawScreenStateBlock(
        action: String,
        snapshot: LiveSmokeDiagnosticsSnapshot
    ) -> String {
        [
            "===== BEGIN RAW SCREEN STATE =====",
            "platform: ios",
            "test: \(self.name)",
            "step: \(self.currentStepTitle)",
            "action: \(action)",
            "capturedAt: \(ISO8601DateFormatter().string(from: Date()))",
            "context: \(snapshot.currentScreenSummary)",
            "",
            "activeAlerts: \(snapshot.activeAlertsSnapshot)",
            "",
            snapshot.appDebugHierarchy,
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
            let snapshot = self.makeDiagnosticsSnapshot()
            self.emitInlineRawScreenStateIfNeeded(action: action, snapshot: snapshot)
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
        let screen = screenOverride ?? (shouldCaptureScreenSummary ? self.currentScreenSummary() : liveSmokePlaceholderScreenSummary)
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
        if self.recentBreadcrumbs.count > LiveSmokeConfiguration.maximumStoredBreadcrumbCount {
            self.recentBreadcrumbs.removeFirst(
                self.recentBreadcrumbs.count - LiveSmokeConfiguration.maximumStoredBreadcrumbCount
            )
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
}
