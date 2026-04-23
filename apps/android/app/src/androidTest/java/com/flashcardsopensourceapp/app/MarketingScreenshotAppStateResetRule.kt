package com.flashcardsopensourceapp.app

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.rules.ExternalResource

private const val marketingScreenshotGuestCleanupTimeoutMillis: Long = 20_000L

class MarketingScreenshotAppStateResetRule : ExternalResource() {
    private val delegate = AppStateResetRule()

    override fun before() {
        runRemoteCleanupThenDelegate(delegateAction = delegate::before)
    }

    override fun after() {
        runRemoteCleanupThenDelegate(delegateAction = delegate::after)
    }

    private fun runRemoteCleanupThenDelegate(delegateAction: () -> Unit) {
        var primaryFailure: Throwable? = null

        try {
            deleteStoredGuestCloudSessionIfPresent()
        } catch (error: Throwable) {
            primaryFailure = error
        }

        try {
            delegateAction()
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
