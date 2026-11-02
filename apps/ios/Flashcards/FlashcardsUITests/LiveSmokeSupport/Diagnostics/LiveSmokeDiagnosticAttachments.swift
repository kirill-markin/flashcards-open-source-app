import Foundation
import XCTest

/// Breadcrumb and error labels that name no app accessibility identifier, so target geometry skips them.
private let liveSmokeSyntheticTargetLabels: Set<String> = ["-", "application", "navigation.backButton"]
/// Prefixes of labels the alert, tab bar, and text helpers fabricate; no app identifier starts with them.
private let liveSmokeSyntheticTargetPrefixes: [String] = ["alert.", "tab.", "text.", "workspaceWarning.alert."]

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

        let pendingAction = self.pendingActionDiagnostics(error: error)
        let diagnosticsAttachment = self.makeTextAttachment(
            name: "Failure Diagnostics - \(stepTitle)",
            text: """
            Step: \(stepTitle)
            Error: \(error.localizedDescription)
            Last logged action: \(pendingAction.lastLoggedAction)
            Target geometry: \(pendingAction.targetGeometry)
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

    /// The failure's own target wins: pointer and hittable polling helpers throw without logging a breadcrumb,
    /// so the breadcrumb is only context and the geometry fallback when the error names no element.
    @MainActor
    func pendingActionDiagnostics(error: Error) -> (lastLoggedAction: String, targetGeometry: String) {
        let breadcrumb: LiveSmokeBreadcrumbFields?
        let lastLoggedAction: String
        do {
            breadcrumb = try self.pendingSmokeBreadcrumb()
            lastLoggedAction = breadcrumb.map { breadcrumb in
                """
                event=\(breadcrumb.event) action=\(breadcrumb.action) identifier=\(breadcrumb.identifier) \
                timeout=\(breadcrumb.timeoutSeconds) result=\(breadcrumb.result) note=\(breadcrumb.note)
                """
            } ?? "<no unfinished or failed action breadcrumb; the failing helper may not log one>"
        } catch {
            breadcrumb = nil
            lastLoggedAction = "<unavailable: breadcrumbs not decodable: \(error)>"
        }

        let target: (identifier: String, source: String)
        if let identifier = (error as? LiveSmokeFailure)?.targetIdentifier {
            target = (identifier, "error")
        } else if let breadcrumb {
            target = (breadcrumb.identifier, "last logged action")
        } else {
            return (lastLoggedAction, "<unavailable: neither the error nor a breadcrumb names a target>")
        }

        let isAccessibilityIdentifier = liveSmokeSyntheticTargetLabels.contains(target.identifier) == false
            && liveSmokeSyntheticTargetPrefixes.allSatisfy { prefix in target.identifier.hasPrefix(prefix) == false }
            && ["==", "*", "["].allSatisfy { marker in target.identifier.contains(marker) == false }
        let geometry = isAccessibilityIdentifier
            ? self.targetGeometrySnapshot(identifier: target.identifier)
            : "<unavailable: not an accessibility identifier>"
        return (lastLoggedAction, "target=\(target.identifier) source=\(target.source) \(geometry)")
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
