package com.flashcardsopensourceapp.app

import android.content.Context
import androidx.core.app.NotificationManagerCompat
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import com.flashcardsopensourceapp.app.livesmoke.currentBlockingSystemDialogSummaryOrNull
import com.flashcardsopensourceapp.app.livesmoke.dismissBlockingSystemDialogIfPresent
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.rules.ExternalResource

private val testOnlyPreferenceNames: List<String> = listOf(
    "flashcards-review-preferences",
    "flashcards-ai-chat-preferences",
    "flashcards-ai-chat-history",
    "flashcards-ai-chat-guest-session"
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
            application.recreateAppGraphAndAwaitStartup()
            application.appGraph.cloudAccountRepository.logout()
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
