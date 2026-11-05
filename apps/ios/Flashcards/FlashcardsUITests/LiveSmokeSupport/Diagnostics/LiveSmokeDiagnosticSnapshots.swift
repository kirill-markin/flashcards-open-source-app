import Foundation
import XCTest

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
            return "appState=uninitialized screens=[-] overlays=[-] tabs=[-]"
        }
        guard self.isApplicationRunning else {
            return "appState=\(self.appStateDescription()) screens=[-] overlays=[-] tabs=[-]"
        }

        let visibleScreenTitles = LiveSmokeScreen.allCases
            .filter { screen in
                self.app.descendants(matching: .any).matching(identifier: screen.identifier).firstMatch.exists
            }
            .map(\.title)
            .joined(separator: ", ")
        let visibleOverlayTitles = self.visibleCloudSignInOverlaySummaryItems().joined(separator: ", ")
        let visibleTabBarItems = self.visibleTabBarItemSnapshot()

        return """
        appState=\(self.appStateDescription()) \
        screens=[\(visibleScreenTitles.isEmpty ? "-" : visibleScreenTitles)] \
        overlays=[\(visibleOverlayTitles.isEmpty ? "-" : visibleOverlayTitles)] \
        tabs=[\(visibleTabBarItems)]
        """
    }

    @MainActor
    func launchEnvironmentSummary() -> String {
        guard self.app != nil else {
            return "<app not initialized>"
        }

        let launchScenario = self.app.launchEnvironment[LiveSmokeConfiguration.launchScenarioEnvironmentKey] ?? "-"
        let selectedTab = self.app.launchEnvironment[LiveSmokeConfiguration.selectedTabEnvironmentKey] ?? "-"
        return "launchScenario=\(launchScenario) selectedTab=\(selectedTab)"
    }

    @MainActor
    func activeAlertsSnapshot() -> String {
        guard self.app != nil else {
            return "<app not initialized>"
        }
        guard self.isApplicationRunning else {
            return "<app not running>"
        }

        let alerts = self.elements(query: self.nativeAlerts).map { alert in
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

        let screens: [LiveSmokeScreen] = [.review, .ai, .progress, .library, .cards, .settings]
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

    /// Frames come from `snapshot()`, which throws when the element is gone, because reading `frame` on a
    /// vanished element records its own XCTest failure and could abort before the original one is reported.
    /// `isHittable` still re-resolves the live element, so a fresh `exists` check guards it; only the
    /// tiny window between those two reads remains.
    @MainActor
    func targetGeometrySnapshot(identifier: String) -> String {
        guard self.app != nil else {
            return "<unavailable: app not initialized>"
        }
        guard self.isApplicationRunning else {
            return "<unavailable: app not running>"
        }

        let window = self.snapshotFrame(of: self.app.windows.firstMatch)
        let sheet = self.snapshotFrame(of: self.app.sheets.containing(.any, identifier: identifier).firstMatch)
        let containers = "window=\(window.summary) sheet=\(sheet.summary)"

        let element = self.app.descendants(matching: .any).matching(identifier: identifier).firstMatch
        let target = self.snapshotFrame(of: element)
        guard let frame = target.frame else {
            return "element=\(target.summary) \(containers)"
        }

        let insideWindow = window.frame.map { "\($0.contains(frame))" } ?? "-"
        let insideSheet = sheet.frame.map { "\($0.contains(frame))" } ?? "-"
        let hittable = element.exists ? "\(element.isHittable)" : "<unavailable: element vanished after snapshot>"
        return """
        exists=true hittable=\(hittable) frame=\(frame) \(containers) \
        insideWindow=\(insideWindow) insideSheet=\(insideSheet)
        """
    }

    @MainActor
    private func snapshotFrame(of element: XCUIElement) -> (frame: CGRect?, summary: String) {
        do {
            let frame = try element.snapshot().frame
            return (frame, "\(frame)")
        } catch {
            return (nil, "<unavailable: \(error.localizedDescription)>")
        }
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
}
