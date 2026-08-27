package com.flashcardsopensourceapp.baselineprofile

import androidx.benchmark.macro.MacrobenchmarkScope
import androidx.benchmark.macro.junit4.BaselineProfileRule
import androidx.test.uiautomator.By
import androidx.test.uiautomator.BySelector
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import org.junit.Rule
import org.junit.Test

/**
 * Build tool, not test coverage.
 *
 * Regenerates the committed Baseline and Startup Profiles in
 * `apps/android/app/src/main/generated/baselineProfiles/`. See `apps/android/README.md`
 * for the exact command and the required emulator.
 *
 * The selectors below are the production Compose test tags, which reach UiAutomator because
 * `FlashcardsApp` enables `testTagsAsResourceId`.
 */
class BaselineProfileGenerator {
    @get:Rule
    val baselineProfileRule = BaselineProfileRule()

    /** Cold start up to the first usable Review frame. Feeds the startup profile. */
    @Test
    fun startup() = baselineProfileRule.collect(
        packageName = TARGET_PACKAGE_NAME,
        includeInStartupProfile = true
    ) {
        pressHome()
        startActivityAndWait()
        device.awaitObject(REVIEW_SCREEN_SETTLED)
        device.waitForIdle()
    }

    /** Primary review flow plus the other top-level tabs. Baseline profile only. */
    @Test
    fun reviewFlow() = baselineProfileRule.collect(
        packageName = TARGET_PACKAGE_NAME,
        includeInStartupProfile = false
    ) {
        pressHome()
        startActivityAndWait()
        device.awaitObject(REVIEW_SCREEN_SETTLED)

        reviewOneCardIfDue()

        TOP_LEVEL_ROUTES.forEach { route ->
            device.click(topLevelDestination(route))
        }
        device.awaitObject(REVIEW_SCREEN_SETTLED)
    }

    /**
     * A fresh install has exactly one due card, the seeded demo card, and rating it empties the
     * queue. Later collection iterations therefore land on the empty state instead. Both are
     * first-use paths worth having in the profile.
     */
    private fun MacrobenchmarkScope.reviewOneCardIfDue() {
        if (device.wait(Until.hasObject(REVIEW_SHOW_ANSWER_BUTTON), CARD_PROBE_TIMEOUT_MILLIS) != true) {
            device.awaitObject(REVIEW_EMPTY_STATE)
            return
        }

        device.clickAndWait(REVIEW_SHOW_ANSWER_BUTTON, REVIEW_RATE_GOOD_BUTTON)
        device.clickAndWait(REVIEW_RATE_GOOD_BUTTON, REVIEW_SCREEN_SETTLED)
    }

    private companion object {
        // `applicationId` of `:app`; the app declares no per-variant application id suffix.
        const val TARGET_PACKAGE_NAME = "com.flashcardsopensourceapp.app"
        const val UI_TIMEOUT_MILLIS = 30_000L
        const val CARD_PROBE_TIMEOUT_MILLIS = 5_000L

        val TOP_LEVEL_ROUTES = listOf("progress", "ai", "cards", "settings", "review")

        // Lives in the Review top bar, so it is present on every Review frame, card or empty state.
        val REVIEW_SCREEN_SETTLED: BySelector = By.res("review_filter_button")

        val REVIEW_SHOW_ANSWER_BUTTON: BySelector = By.res("review_show_answer_button")
        val REVIEW_RATE_GOOD_BUTTON: BySelector = By.res("review_rate_good_button")
        val REVIEW_EMPTY_STATE: BySelector = By.res("review_empty_state")

        fun topLevelDestination(route: String): BySelector = By.res("top_level_destination_$route")

        fun UiDevice.awaitObject(selector: BySelector) {
            if (!wait(Until.hasObject(selector), UI_TIMEOUT_MILLIS)) {
                error("Timed out waiting for $selector while generating the baseline profile.")
            }
        }

        fun UiDevice.click(selector: BySelector) {
            awaitObject(selector)
            findObject(selector).click()
            waitForIdle()
        }

        fun UiDevice.clickAndWait(selector: BySelector, next: BySelector) {
            click(selector)
            awaitObject(next)
            waitForIdle()
        }
    }
}
