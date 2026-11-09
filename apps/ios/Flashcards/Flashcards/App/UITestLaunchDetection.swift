import Foundation

let flashcardsUITestLaunchScenarioEnvironmentKey: String = "FLASHCARDS_UI_TEST_LAUNCH_SCENARIO"
let flashcardsUITestSelectedTabEnvironmentKey: String = "FLASHCARDS_UI_TEST_SELECTED_TAB"

/**
 * True when the process was launched by the XCUITest harness — the grouped live smoke suite, which
 * signs into a real review account, or a marketing screenshot run. Both harnesses always set the
 * selected-tab key and set the scenario key for a prepared launch.
 *
 * Product analytics stays off for those launches: `product_events` is append-only, and synthetic app
 * opens, screen views and card-create intents written into it would corrupt the exact dataset the
 * analytics module exists to produce.
 */
func isFlashcardsUITestLaunch(processInfo: ProcessInfo) -> Bool {
    processInfo.environment[flashcardsUITestSelectedTabEnvironmentKey] != nil
        || processInfo.environment[flashcardsUITestLaunchScenarioEnvironmentKey] != nil
}
