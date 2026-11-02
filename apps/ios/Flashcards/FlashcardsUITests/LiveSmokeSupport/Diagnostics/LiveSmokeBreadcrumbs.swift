import Foundation

private let liveSmokePlaceholderScreenSummary: String = "screens=[-] nav=[-] alerts=[-] tabs=[-]"

struct LiveSmokeBreadcrumbFields: Decodable {
    let event: String
    let action: String
    let identifier: String
    let timeoutSeconds: String
    let result: String
    let note: String
}

extension LiveSmokeTestCase {
    /// What a failing step was waiting on: the latest non-step breadcrumb when it ended in failure,
    /// else the latest non-step start whose end was never logged.
    @MainActor
    func pendingSmokeBreadcrumb() throws -> LiveSmokeBreadcrumbFields? {
        let decoder = JSONDecoder()
        let breadcrumbs = try self.recentBreadcrumbs
            .map { breadcrumb in
                try decoder.decode(LiveSmokeBreadcrumbFields.self, from: Data(breadcrumb.line.utf8))
            }
            .filter { breadcrumb in
                breadcrumb.event.hasPrefix("step_") == false
            }

        if let last = breadcrumbs.last, last.event.hasSuffix("_end"), last.result == "failure" {
            return last
        }

        var openStarts: [LiveSmokeBreadcrumbFields] = []
        for breadcrumb in breadcrumbs {
            if breadcrumb.event.hasSuffix("_start") {
                openStarts.append(breadcrumb)
            } else if breadcrumb.event.hasSuffix("_end") {
                let kind = breadcrumb.event.dropLast("_end".count)
                if let index = openStarts.lastIndex(where: { start in
                    start.event.dropLast("_start".count) == kind && start.action == breadcrumb.action
                }) {
                    openStarts.remove(at: index)
                }
            }
        }
        return openStarts.last
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
}
