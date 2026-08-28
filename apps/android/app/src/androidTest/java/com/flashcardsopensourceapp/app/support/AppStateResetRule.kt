package com.flashcardsopensourceapp.app.support

import android.content.Context
import androidx.core.app.NotificationManagerCompat
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import com.flashcardsopensourceapp.app.FlashcardsApplication
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.currentBlockingSystemDialogSummaryOrNull
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.dismissBlockingSystemDialogIfPresent
import com.flashcardsopensourceapp.app.prompts.guestreview.guestSignInAfterReviewPromptPreferencesName
import com.flashcardsopensourceapp.core.observability.analytics.analyticsIdentityPreferencesName
import com.flashcardsopensourceapp.core.observability.analytics.analyticsQueueDatabaseName
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.rules.ExternalResource

private val testOnlyPreferenceNames: List<String> = listOf(
    "flashcards-test-mode",
    "flashcards-review-preferences",
    "flashcards-store-review-request",
    guestSignInAfterReviewPromptPreferencesName,
    "flashcards-ai-chat-preferences",
    "flashcards-ai-chat-history",
    "flashcards-ai-chat-guest-session",
    analyticsIdentityPreferencesName
)

open class AppStateResetRule : ExternalResource() {
    override fun before() {
        resetAndroidTestAppState()
    }

    override fun after() {
        resetAndroidTestAppState()
    }
}

internal fun resetAndroidTestAppState() {
    waitForAndroidTestUiIdle(phase = "before resetting app state")

    val context = ApplicationProvider.getApplicationContext<Context>()
    val application = context as FlashcardsApplication

    runBlocking {
        withTimeout(appResetTimeoutMillis) {
            application.closeAppGraph()
            clearTestOnlySharedPreferences(context = context)
            clearAnalyticsQueueDatabase(context = context)
            application.recreateAppGraphAndAwaitStartup()
            application.appGraph.cloudAccountRepository.logout()
            application.closeAppGraph()
            application.recreateAppGraphAndAwaitStartup()
        }
    }
    NotificationManagerCompat.from(context).cancelAll()
    waitForAndroidTestUiIdle(phase = "after resetting app state")
}

private const val appResetTimeoutMillis: Long = 20_000L
private const val uiIdleTimeoutMillis: Long = 5_000L

private fun waitForAndroidTestUiIdle(phase: String) {
    val device: UiDevice = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
    device.dismissBlockingSystemDialogIfPresent()
    val latch = CountDownLatch(1)
    InstrumentationRegistry.getInstrumentation().waitForIdle {
        latch.countDown()
    }
    val didBecomeIdle = latch.await(uiIdleTimeoutMillis, TimeUnit.MILLISECONDS)
    device.dismissBlockingSystemDialogIfPresent()
    if (didBecomeIdle.not()) {
        val blockingSystemDialogSummary = device.currentBlockingSystemDialogSummaryOrNull() ?: "none"
        throw IllegalStateException(
            "Timed out after $uiIdleTimeoutMillis ms waiting for instrumentation to become idle $phase. " +
                "blockingSystemDialog=$blockingSystemDialogSummary"
        )
    }
}

/**
 * `FlashcardsAndroidTestRunner` disables product analytics for the whole instrumentation process,
 * so nothing should be queued here. This clears anything an earlier build of the app left on the
 * device, so a run can never inherit a queue or an analytics identity from outside the suite.
 */
private fun clearAnalyticsQueueDatabase(context: Context) {
    context.deleteDatabase(analyticsQueueDatabaseName)
}

private fun clearTestOnlySharedPreferences(context: Context) {
    testOnlyPreferenceNames.forEach { preferenceName ->
        val sharedPreferences = context.getSharedPreferences(preferenceName, Context.MODE_PRIVATE)
        val didCommitClear = sharedPreferences.edit().clear().commit()
        if (didCommitClear.not()) {
            throw IllegalStateException("Failed to clear shared preferences '$preferenceName'.")
        }
        val didDeletePreferences = context.deleteSharedPreferences(preferenceName)
        if (didDeletePreferences.not() && sharedPreferences.all.isNotEmpty()) {
            throw IllegalStateException("Failed to delete shared preferences '$preferenceName'.")
        }
    }
}
