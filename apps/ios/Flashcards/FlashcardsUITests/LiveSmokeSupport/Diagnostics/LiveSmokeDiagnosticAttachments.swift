import Foundation
import XCTest

extension LiveSmokeTestCase {
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
}
