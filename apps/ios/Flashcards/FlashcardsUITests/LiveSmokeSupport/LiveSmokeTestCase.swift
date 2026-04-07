import Foundation
import XCTest

class LiveSmokeTestCase: XCTestCase {
    var app: XCUIApplication!
    var currentStepTitle: String = "test bootstrap"
    var hasPrintedInlineRawScreenStateForCurrentFailure: Bool = false
    var recentBreadcrumbs: [LiveSmokeBreadcrumb] = []

    override func setUpWithError() throws {
        try super.setUpWithError()
        continueAfterFailure = false
        addUIInterruptionMonitor(withDescription: "Live smoke known interruptions") { alert in
            MainActor.assumeIsolated {
                for label in LiveSmokeConfiguration.knownInterruptionButtonLabels {
                    let button = alert.buttons[label]
                    guard button.exists else {
                        continue
                    }

                    button.tap()
                    return true
                }

                return false
            }
        }
    }

    override func tearDownWithError() throws {
        if let app = self.app {
            MainActor.assumeIsolated {
                app.terminate()
            }
        }
        self.app = nil
        self.hasPrintedInlineRawScreenStateForCurrentFailure = false
        self.recentBreadcrumbs = []
        self.currentStepTitle = "test bootstrap"
        try super.tearDownWithError()
    }

    @MainActor
    func step(_ title: String, action: () throws -> Void) throws {
        let previousStepTitle = self.currentStepTitle
        self.currentStepTitle = title
        defer {
            self.currentStepTitle = previousStepTitle
        }

        try XCTContext.runActivity(named: title) { activity in
            let startedAt = Date()
            self.logSmokeBreadcrumb(
                event: "step_start",
                action: "step",
                identifier: "-",
                timeoutSeconds: "-",
                durationSeconds: "-",
                result: "start",
                note: title
            )

            do {
                try action()

                let durationSeconds = Date().timeIntervalSince(startedAt)
                self.logSmokeBreadcrumb(
                    event: "step_end",
                    action: "step",
                    identifier: "-",
                    timeoutSeconds: "-",
                    durationSeconds: formatDuration(seconds: durationSeconds),
                    result: "success",
                    note: title
                )
            } catch {
                let durationSeconds = Date().timeIntervalSince(startedAt)
                let snapshot = self.makeDiagnosticsSnapshot()
                self.emitInlineRawScreenStateIfNeeded(action: "step.\(title)", snapshot: snapshot)
                activity.add(
                    self.makeStepFailureSummaryAttachment(
                        stepTitle: title,
                        error: error,
                        durationSeconds: durationSeconds,
                        snapshot: snapshot
                    )
                )
                self.attachFailureDiagnostics(
                    stepTitle: title,
                    error: error,
                    activity: activity,
                    snapshot: snapshot
                )
                self.logSmokeBreadcrumb(
                    event: "step_end",
                    action: "step",
                    identifier: "-",
                    timeoutSeconds: "-",
                    durationSeconds: formatDuration(seconds: durationSeconds),
                    result: "failure",
                    note: error.localizedDescription
                )
                smokeLogger.error(
                    "event=step_failure step=\(title, privacy: .public) duration=\(formatDuration(seconds: durationSeconds), privacy: .public) currentScreen=\(snapshot.currentScreenSummary, privacy: .public) error=\(error.localizedDescription, privacy: .public)"
                )
                throw LiveSmokeFailure.stepFailed(
                    title: title,
                    durationSeconds: durationSeconds,
                    underlyingMessage: error.localizedDescription
                )
            }
        }
    }
}
