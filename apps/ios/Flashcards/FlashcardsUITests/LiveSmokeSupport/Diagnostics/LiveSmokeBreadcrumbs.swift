import Foundation

private let liveSmokePlaceholderScreenSummary: String = "screens=[-] nav=[-] alerts=[-] tabs=[-]"

extension LiveSmokeTestCase {
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
}
