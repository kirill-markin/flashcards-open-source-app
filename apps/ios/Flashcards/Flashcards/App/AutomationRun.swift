import Foundation
import OSLog

let flashcardsAutomationRunEnvironmentKey: String = "FLASHCARDS_AUTOMATION_RUN"

private let flashcardsAutomationRunAffirmativeValues: Set<String> = ["1", "true", "yes"]
private let flashcardsAutomationRunNegativeValues: Set<String> = ["0", "false", "no"]

private let automationRunLogger: Logger = Logger(
    subsystem: appBundleIdentifier(),
    category: "automation_run"
)

struct AutomationRunDecision: Equatable, Sendable {
    let isDebugBuild: Bool
    let isSimulator: Bool
    let isUITestLaunch: Bool
    let hasEnvironmentSignal: Bool
    let hasEnvironmentOverride: Bool
    let environmentSignal: String

    var isAutomation: Bool {
        // UI tests cannot opt into real analytics on the shared review account.
        if self.isUITestLaunch {
            return true
        }
        if self.hasEnvironmentOverride {
            return false
        }

        return self.isDebugBuild || self.isSimulator || self.hasEnvironmentSignal
    }
}

func makeAutomationRunDecision(
    processInfo: ProcessInfo,
    isDebugBuild: Bool,
    isSimulator: Bool
) -> AutomationRunDecision {
    let rawSignal = (processInfo.environment[flashcardsAutomationRunEnvironmentKey] ?? "")
        .trimmingCharacters(in: .whitespacesAndNewlines)
    let normalizedSignal = rawSignal.lowercased()

    return AutomationRunDecision(
        isDebugBuild: isDebugBuild,
        isSimulator: isSimulator,
        isUITestLaunch: isFlashcardsUITestLaunch(processInfo: processInfo),
        hasEnvironmentSignal: flashcardsAutomationRunAffirmativeValues.contains(normalizedSignal),
        hasEnvironmentOverride: flashcardsAutomationRunNegativeValues.contains(normalizedSignal),
        environmentSignal: rawSignal
    )
}

private func isDebugBuild() -> Bool {
#if DEBUG
    return true
#else
    return false
#endif
}

private func isSimulatorBuild() -> Bool {
#if targetEnvironment(simulator)
    return true
#else
    return false
#endif
}

enum AutomationRun {
    // Sync's installation marker is sticky, so every request in a process uses one decision.
    static let current: AutomationRunDecision = makeAutomationRunDecision(
        processInfo: ProcessInfo.processInfo,
        isDebugBuild: isDebugBuild(),
        isSimulator: isSimulatorBuild()
    )

    static func logDecision() {
        let decision = Self.current
        automationRunLogger.log(
            """
            event=automation_run_decided \
            isAutomation=\(String(decision.isAutomation), privacy: .public) \
            isDebugBuild=\(String(decision.isDebugBuild), privacy: .public) \
            isSimulator=\(String(decision.isSimulator), privacy: .public) \
            isUITestLaunch=\(String(decision.isUITestLaunch), privacy: .public) \
            hasEnvironmentSignal=\(String(decision.hasEnvironmentSignal), privacy: .public) \
            hasEnvironmentOverride=\(String(decision.hasEnvironmentOverride), privacy: .public) \
            environmentKey=\(flashcardsAutomationRunEnvironmentKey, privacy: .public) \
            environmentValue=\(decision.environmentSignal.isEmpty ? "-" : decision.environmentSignal, privacy: .public)
            """
        )
    }
}
