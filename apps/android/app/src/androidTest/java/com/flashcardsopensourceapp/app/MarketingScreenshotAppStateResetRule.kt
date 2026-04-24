package com.flashcardsopensourceapp.app

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout

private const val marketingScreenshotGuestCleanupTimeoutMillis: Long = 20_000L

class MarketingScreenshotAppStateResetRule : AppStateResetRule() {
    override fun before() {
        runRemoteCleanupThenReset(resetAction = { super.before() })
    }

    override fun after() {
        runRemoteCleanupThenReset(resetAction = { super.after() })
    }

    private fun runRemoteCleanupThenReset(resetAction: () -> Unit) {
        var primaryFailure: Throwable? = null

        try {
            deleteStoredGuestCloudSessionIfPresent()
        } catch (error: Throwable) {
            primaryFailure = error
        }

        try {
            resetAction()
        } catch (error: Throwable) {
            if (primaryFailure != null) {
                primaryFailure.addSuppressed(error)
            } else {
                primaryFailure = error
            }
        }

        if (primaryFailure != null) {
            throw primaryFailure
        }
    }

    private fun deleteStoredGuestCloudSessionIfPresent() {
        val context: Context = ApplicationProvider.getApplicationContext<Context>()
        val application = context as FlashcardsApplication

        runBlocking {
            withTimeout(marketingScreenshotGuestCleanupTimeoutMillis) {
                // Marketing screenshot seeding creates a real guest cloud workspace,
                // so the remote session must be deleted before the local reset
                // drops the only stored guest token.
                val appGraph = requireNotNull(application.appGraphOrNull) {
                    "App graph is unavailable for marketing screenshot guest cleanup."
                }
                appGraph.deleteStoredGuestCloudSessionIfPresent()
            }
        }
    }
}
