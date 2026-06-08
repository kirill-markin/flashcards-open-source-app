import Foundation

enum SettingsAttentionIssue: Hashable, Sendable {
    case accountNotLinked
}

enum SettingsAttentionTarget: Hashable, Sendable {
    case settingsTab
    case accountStatusRow
    case accountStatusPrimaryAction
}

struct SettingsAttentionSummary: Equatable, Sendable {
    let settingsTabCount: Int
    let accountStatusRowCount: Int
    let accountStatusPrimaryActionCount: Int
}

func makeSettingsAttentionIssues(cloudState: CloudAccountState?) -> [SettingsAttentionIssue] {
    switch cloudState {
    case .linked:
        return []
    case nil, .disconnected, .linkingReady, .guest:
        return [.accountNotLinked]
    }
}

func makeSettingsAttentionSummary(issues: [SettingsAttentionIssue]) -> SettingsAttentionSummary {
    SettingsAttentionSummary(
        settingsTabCount: makeSettingsAttentionTargetCount(
            issues: issues,
            target: .settingsTab
        ),
        accountStatusRowCount: makeSettingsAttentionTargetCount(
            issues: issues,
            target: .accountStatusRow
        ),
        accountStatusPrimaryActionCount: makeSettingsAttentionTargetCount(
            issues: issues,
            target: .accountStatusPrimaryAction
        )
    )
}

private func makeSettingsAttentionTargetCount(
    issues: [SettingsAttentionIssue],
    target: SettingsAttentionTarget
) -> Int {
    issues.reduce(0) { count, issue in
        count + (settingsAttentionTargets(issue: issue).contains(target) ? 1 : 0)
    }
}

private func settingsAttentionTargets(issue: SettingsAttentionIssue) -> [SettingsAttentionTarget] {
    switch issue {
    case .accountNotLinked:
        return [.settingsTab, .accountStatusRow, .accountStatusPrimaryAction]
    }
}
