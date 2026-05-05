package com.flashcardsopensourceapp.app.marketing.screenshots

import android.app.LocaleConfig
import android.app.LocaleManager
import android.content.Context
import android.os.LocaleList
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import com.flashcardsopensourceapp.app.AppStateResetRule
import com.flashcardsopensourceapp.app.FlashcardsApplication
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout

private const val localeApplyTimeoutMillis: Long = 5_000L
private const val marketingScreenshotGuestCleanupTimeoutMillis: Long = 20_000L

class MarketingScreenshotAppStateResetRule : AppStateResetRule() {
    override fun before() {
        runRemoteCleanupThenReset(
            resetAction = {
                applyConfiguredMarketingScreenshotLocaleOverride()
                super.before()
            }
        )
    }

    override fun after() {
        runRemoteCleanupThenReset(
            resetAction = {
                super.after()
                clearConfiguredMarketingScreenshotLocaleOverride()
            }
        )
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

    private fun applyConfiguredMarketingScreenshotLocaleOverride() {
        val localeConfig = configuredMarketingScreenshotLocaleConfigOrNull() ?: return
        val context = ApplicationProvider.getApplicationContext<Context>()
        val localeManager = context.getSystemService(LocaleManager::class.java)
            ?: throw IllegalStateException("LocaleManager was unavailable while applying screenshot locale.")
        val localeList = LocaleList.forLanguageTags(localeConfig.appLocaleTag)

        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            localeManager.overrideLocaleConfig = LocaleConfig(localeList)
            localeManager.applicationLocales = localeList
        }
        waitForOverrideLocaleConfigState(
            localeManager = localeManager,
            expectedLanguageTags = localeConfig.appLocaleTag,
            phase = "applying marketing screenshot override locale config '${localeConfig.localePrefix}'"
        )
        waitForLocaleState(
            localeManager = localeManager,
            expectedLanguageTags = localeConfig.appLocaleTag,
            phase = "applying marketing screenshot locale '${localeConfig.localePrefix}'"
        )
    }

    private fun clearConfiguredMarketingScreenshotLocaleOverride() {
        val localeConfig = configuredMarketingScreenshotLocaleConfigOrNull() ?: return
        val context = ApplicationProvider.getApplicationContext<Context>()
        val localeManager = context.getSystemService(LocaleManager::class.java)
            ?: throw IllegalStateException("LocaleManager was unavailable while clearing screenshot locale.")

        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            localeManager.applicationLocales = LocaleList.getEmptyLocaleList()
            localeManager.overrideLocaleConfig = null
        }
        waitForLocaleState(
            localeManager = localeManager,
            expectedLanguageTags = "",
            phase = "clearing marketing screenshot locale '${localeConfig.localePrefix}'"
        )
        waitForOverrideLocaleConfigState(
            localeManager = localeManager,
            expectedLanguageTags = null,
            phase = "clearing marketing screenshot override locale config '${localeConfig.localePrefix}'"
        )
    }

    private fun waitForLocaleState(
        localeManager: LocaleManager,
        expectedLanguageTags: String,
        phase: String
    ) {
        val startTimeMillis = System.currentTimeMillis()
        do {
            InstrumentationRegistry.getInstrumentation().waitForIdleSync()
            if (localeManager.applicationLocales.toLanguageTags() == expectedLanguageTags) {
                return
            }
        } while (System.currentTimeMillis() - startTimeMillis < localeApplyTimeoutMillis)

        throw IllegalStateException(
            "Timed out after $localeApplyTimeoutMillis ms while $phase. " +
                "expectedLanguageTags='$expectedLanguageTags' actualLanguageTags='${localeManager.applicationLocales.toLanguageTags()}'."
        )
    }

    private fun waitForOverrideLocaleConfigState(
        localeManager: LocaleManager,
        expectedLanguageTags: String?,
        phase: String
    ) {
        val startTimeMillis = System.currentTimeMillis()
        do {
            InstrumentationRegistry.getInstrumentation().waitForIdleSync()
            val actualLanguageTags = localeManager.overrideLocaleConfig
                ?.supportedLocales
                ?.toLanguageTags()
            if (actualLanguageTags == expectedLanguageTags) {
                return
            }
        } while (System.currentTimeMillis() - startTimeMillis < localeApplyTimeoutMillis)

        val actualLanguageTags = localeManager.overrideLocaleConfig
            ?.supportedLocales
            ?.toLanguageTags()
        throw IllegalStateException(
            "Timed out after $localeApplyTimeoutMillis ms while $phase. " +
                "expectedLanguageTags='$expectedLanguageTags' actualLanguageTags='$actualLanguageTags'."
        )
    }
}
