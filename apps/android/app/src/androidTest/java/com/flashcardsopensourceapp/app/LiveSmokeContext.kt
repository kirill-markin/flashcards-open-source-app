package com.flashcardsopensourceapp.app

import androidx.compose.ui.test.junit4.AndroidComposeTestRule
import androidx.test.ext.junit.rules.ActivityScenarioRule
import androidx.test.uiautomator.UiDevice
import org.junit.rules.TestName

internal const val externalUiTimeoutMillis: Long = 30_000L
internal const val internalUiTimeoutMillis: Long = 10_000L
internal const val reviewEmailArgumentKey: String = "FLASHCARDS_LIVE_REVIEW_EMAIL"
internal const val cloudSyncChooserPrompt: String =
    "Choose a linked workspace to open on this Android device, or create a new one."
internal const val systemDialogWaitButtonText: String = "Wait"
internal const val systemDialogCloseAppButtonText: String = "Close app"
internal val blockingSystemDialogTitles: List<String> = listOf(
    "System UI",
    "Digital Wellbeing"
)

internal class LiveSmokeContext(
    val composeRule: AndroidComposeTestRule<ActivityScenarioRule<MainActivity>, MainActivity>,
    val device: UiDevice,
    val testNameRule: TestName,
    var currentStepLabel: String,
    var hasPrintedInlineRawScreenStateForCurrentFailure: Boolean
)

/**
 * Keep each smoke test independently attributable and short enough for device-farm runs.
 */
internal fun LiveSmokeContext.step(label: String, action: () -> Unit) {
    val previousStepLabel: String = currentStepLabel
    currentStepLabel = label
    try {
        action()
    } catch (error: Throwable) {
        emitInlineRawScreenStateIfNeeded(action = "step.$label")
        throw AssertionError("Android live smoke step failed: $label", error)
    } finally {
        currentStepLabel = previousStepLabel
    }
}
