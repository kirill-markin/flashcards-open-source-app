import Foundation
import OSLog

/**
 * Environment variable through which an automation harness declares its own run.
 *
 * XCUITest delivers it with `XCUIApplication.launchEnvironment`, which reaches the app process on a
 * real device too. That is the only path that works in a cloud device farm, where the app runs on
 * physical hardware and the simulator check below sees nothing.
 */
let flashcardsAutomationRunEnvironmentKey: String = "FLASHCARDS_AUTOMATION_RUN"

private let flashcardsAutomationRunAffirmativeValues: Set<String> = ["1", "true", "yes"]

/**
 * Explicit refusal, parsed exactly like the affirmative set above.
 *
 * It is the only way to run a simulator build as a real installation, because the simulator input
 * cannot be turned off and the backend marker is sticky: without this, an installation created from
 * a simulator could never exercise the real install or ingest path, once or ever.
 */
private let flashcardsAutomationRunNegativeValues: Set<String> = ["0", "false", "no"]

private let automationRunLogger: Logger = Logger(
    subsystem: appBundleIdentifier(),
    category: "automation_run"
)

/// The three detection inputs and the answer they produce, kept apart so a wrong answer names its
/// cause: an overridden run must stay distinguishable from a run whose harness set nothing at all.
struct AutomationRunDecision: Equatable, Sendable {
    let isSimulator: Bool
    let hasEnvironmentSignal: Bool
    /// An explicit negative environment value, which overrides both inputs above.
    let hasEnvironmentOverride: Bool
    /// The raw environment value, so a harness that set an unrecognized non-empty one is visible in
    /// the log. A value that trims to nothing is logged like an unset variable.
    let environmentSignal: String

    /// Neither positive input covers the other: the simulator check catches local and simulator-based
    /// CI runs nobody configured, the environment signal catches real hardware in a device farm. The
    /// override beats both, so a developer can still drive the real install path from a simulator.
    var isAutomation: Bool {
        if self.hasEnvironmentOverride {
            return false
        }

        return self.isSimulator || self.hasEnvironmentSignal
    }
}

func makeAutomationRunDecision(processInfo: ProcessInfo, isSimulator: Bool) -> AutomationRunDecision {
    let rawSignal = (processInfo.environment[flashcardsAutomationRunEnvironmentKey] ?? "")
        .trimmingCharacters(in: .whitespacesAndNewlines)
    let normalizedSignal = rawSignal.lowercased()

    return AutomationRunDecision(
        isSimulator: isSimulator,
        hasEnvironmentSignal: flashcardsAutomationRunAffirmativeValues.contains(normalizedSignal),
        hasEnvironmentOverride: flashcardsAutomationRunNegativeValues.contains(normalizedSignal),
        environmentSignal: rawSignal
    )
}

private func isSimulatorBuild() -> Bool {
#if targetEnvironment(simulator)
    return true
#else
    return false
#endif
}

enum AutomationRun {
    /// Resolved once, on the first read at app start. All three inputs are fixed for the life of the
    /// process, and every sync payload of one run must declare the same answer: the backend marker is
    /// sticky, so a run that declares automation on one request and stays silent on the next is still
    /// automation, while the reverse never becomes a person again.
    static let current: AutomationRunDecision = makeAutomationRunDecision(
        processInfo: ProcessInfo.processInfo,
        isSimulator: isSimulatorBuild()
    )

    /// Called at app start, both to force the decision before the first sync request and because the
    /// log line is what makes a run that should have been marked and was not diagnosable here rather
    /// than by reading backend data days later.
    static func logDecision() {
        let decision = Self.current
        automationRunLogger.log(
            """
            event=automation_run_decided \
            isAutomation=\(String(decision.isAutomation), privacy: .public) \
            isSimulator=\(String(decision.isSimulator), privacy: .public) \
            hasEnvironmentSignal=\(String(decision.hasEnvironmentSignal), privacy: .public) \
            hasEnvironmentOverride=\(String(decision.hasEnvironmentOverride), privacy: .public) \
            environmentKey=\(flashcardsAutomationRunEnvironmentKey, privacy: .public) \
            environmentValue=\(decision.environmentSignal.isEmpty ? "-" : decision.environmentSignal, privacy: .public)
            """
        )
    }
}
