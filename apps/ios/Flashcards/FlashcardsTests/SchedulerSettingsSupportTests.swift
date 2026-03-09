import XCTest
@testable import Flashcards

final class SchedulerSettingsSupportTests: XCTestCase {
    func testDefaultSchedulerSettingsConfigMatchesDocumentedValues() {
        XCTAssertEqual(defaultSchedulerSettingsConfig.algorithm, "fsrs-6")
        XCTAssertEqual(defaultSchedulerSettingsConfig.desiredRetention, 0.9, accuracy: 0.00000001)
        XCTAssertEqual(defaultSchedulerSettingsConfig.learningStepsMinutes, [1, 10])
        XCTAssertEqual(defaultSchedulerSettingsConfig.relearningStepsMinutes, [10])
        XCTAssertEqual(defaultSchedulerSettingsConfig.maximumIntervalDays, 36_500)
        XCTAssertTrue(defaultSchedulerSettingsConfig.enableFuzz)
        XCTAssertEqual(defaultSchedulerSettingsConfig.learningStepsMinutesJson, "[1,10]")
        XCTAssertEqual(defaultSchedulerSettingsConfig.relearningStepsMinutesJson, "[10]")
    }

    func testDefaultSchedulerSettingsDraftFormatsResetValuesForEditing() {
        XCTAssertEqual(
            makeDefaultSchedulerSettingsDraft(),
            SchedulerSettingsDraft(
                desiredRetentionText: "0.90",
                learningStepsText: "1, 10",
                relearningStepsText: "10",
                maximumIntervalDaysText: "36500",
                enableFuzz: true
            )
        )
    }
}
