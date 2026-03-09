import Foundation

struct SchedulerSettingsConfig: Equatable {
    let algorithm: String
    let desiredRetention: Double
    let learningStepsMinutes: [Int]
    let relearningStepsMinutes: [Int]
    let maximumIntervalDays: Int
    let enableFuzz: Bool

    var learningStepsMinutesJson: String {
        encodeSchedulerStepListJson(values: self.learningStepsMinutes)
    }

    var relearningStepsMinutesJson: String {
        encodeSchedulerStepListJson(values: self.relearningStepsMinutes)
    }
}

struct SchedulerSettingsDraft: Equatable {
    var desiredRetentionText: String
    var learningStepsText: String
    var relearningStepsText: String
    var maximumIntervalDaysText: String
    var enableFuzz: Bool
}

let defaultSchedulerSettingsConfig: SchedulerSettingsConfig = SchedulerSettingsConfig(
    algorithm: "fsrs-6",
    desiredRetention: 0.90,
    learningStepsMinutes: [1, 10],
    relearningStepsMinutes: [10],
    maximumIntervalDays: 36_500,
    enableFuzz: true
)

func makeSchedulerSettingsDraft(settings: WorkspaceSchedulerSettings) -> SchedulerSettingsDraft {
    makeSchedulerSettingsDraft(
        config: SchedulerSettingsConfig(
            algorithm: settings.algorithm,
            desiredRetention: settings.desiredRetention,
            learningStepsMinutes: settings.learningStepsMinutes,
            relearningStepsMinutes: settings.relearningStepsMinutes,
            maximumIntervalDays: settings.maximumIntervalDays,
            enableFuzz: settings.enableFuzz
        )
    )
}

func makeDefaultSchedulerSettingsDraft() -> SchedulerSettingsDraft {
    makeSchedulerSettingsDraft(config: defaultSchedulerSettingsConfig)
}

func formatSchedulerStepList(values: [Int]) -> String {
    values.map(String.init).joined(separator: ", ")
}

func formatSchedulerRetentionValue(value: Double) -> String {
    String(format: "%.2f", value)
}

func parseSchedulerDesiredRetention(text: String) throws -> Double {
    let normalizedText = text.trimmingCharacters(in: .whitespacesAndNewlines)
        .replacingOccurrences(of: ",", with: ".")

    guard let value = Double(normalizedText) else {
        throw LocalStoreError.validation("Desired retention must be a decimal number")
    }

    return value
}

func parseSchedulerPositiveInteger(text: String, fieldName: String) throws -> Int {
    let normalizedText = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let value = Int(normalizedText), value > 0 else {
        throw LocalStoreError.validation("\(fieldName) must be a positive integer")
    }

    return value
}

func parseSchedulerStepList(text: String, fieldName: String) throws -> [Int] {
    let parts = text
        .split(separator: ",")
        .map { value in
            value.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        .filter { value in
            value.isEmpty == false
        }

    if parts.isEmpty {
        throw LocalStoreError.validation("\(fieldName) must not be empty")
    }

    return try parts.map { value in
        guard let step = Int(value) else {
            throw LocalStoreError.validation("\(fieldName) must contain integers")
        }

        return step
    }
}

private func makeSchedulerSettingsDraft(config: SchedulerSettingsConfig) -> SchedulerSettingsDraft {
    SchedulerSettingsDraft(
        desiredRetentionText: formatSchedulerRetentionValue(value: config.desiredRetention),
        learningStepsText: formatSchedulerStepList(values: config.learningStepsMinutes),
        relearningStepsText: formatSchedulerStepList(values: config.relearningStepsMinutes),
        maximumIntervalDaysText: String(config.maximumIntervalDays),
        enableFuzz: config.enableFuzz
    )
}

private func encodeSchedulerStepListJson(values: [Int]) -> String {
    "[" + values.map(String.init).joined(separator: ",") + "]"
}
