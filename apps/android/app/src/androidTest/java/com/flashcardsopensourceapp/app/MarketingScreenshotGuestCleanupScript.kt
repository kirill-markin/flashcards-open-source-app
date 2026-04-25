package com.flashcardsopensourceapp.app

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Test
import org.junit.runner.RunWith

private const val marketingScreenshotGuestCleanupTimeoutMillis: Long = 20_000L

@ManualOnlyAndroidTest
@RunWith(AndroidJUnit4::class)
class MarketingScreenshotGuestCleanupScript {
    @Test
    fun deleteStoredGuestSessionThenResetLocalState() {
        deleteStoredMarketingScreenshotGuestCloudSessionIfPresent()
        resetAndroidTestAppState()
    }
}

private fun deleteStoredMarketingScreenshotGuestCloudSessionIfPresent() {
    val context: Context = ApplicationProvider.getApplicationContext<Context>()
    val application = context as FlashcardsApplication

    runBlocking {
        withTimeout(marketingScreenshotGuestCleanupTimeoutMillis) {
            val appGraph = requireNotNull(application.appGraphOrNull) {
                "App graph is unavailable for marketing screenshot guest cleanup."
            }
            appGraph.awaitStartup()
            appGraph.deleteStoredGuestCloudSessionIfPresent()
        }
    }
}
