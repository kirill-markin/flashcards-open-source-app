package com.flashcardsopensourceapp.app.livesmoke

import androidx.compose.ui.test.junit4.AndroidComposeTestRule
import androidx.test.ext.junit.rules.ActivityScenarioRule
import androidx.test.uiautomator.UiDevice
import com.flashcardsopensourceapp.app.MainActivity
import org.junit.rules.TestName

internal const val externalUiTimeoutMillis: Long = 30_000L
internal const val externalAiRunTimeoutMillis: Long = 60_000L
internal const val internalUiTimeoutMillis: Long = 10_000L
internal const val reviewEmailArgumentKey: String = "FLASHCARDS_LIVE_REVIEW_EMAIL"
internal const val cloudSyncChooserPrompt: String =
    "Choose a linked workspace to open on this Android device, or create a new one."
internal const val systemDialogWaitButtonText: String = "Wait"
internal const val systemDialogCloseAppButtonText: String = "Close app"
internal const val systemDialogAlertTitleResourceId: String = "android:id/alertTitle"
internal const val systemDialogWaitButtonResourceId: String = "android:id/aerr_wait"
internal const val systemDialogCloseAppButtonResourceId: String = "android:id/aerr_close"

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
