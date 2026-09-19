package com.flashcardsopensourceapp.app

import android.app.Application
import android.content.Context
import android.os.Bundle
import androidx.test.runner.AndroidJUnitRunner
import com.flashcardsopensourceapp.app.analytics.disableProductAnalyticsForProcess
import com.flashcardsopensourceapp.app.automation.automationDeclarationArgumentKey
import com.flashcardsopensourceapp.app.automation.markProcessAsAutomationEnvironment
import com.flashcardsopensourceapp.app.observability.androidSentryEnvironmentOverrideArgumentKey
import com.flashcardsopensourceapp.app.observability.setAndroidSentryEnvironmentOverride
import com.flashcardsopensourceapp.app.observability.setDefaultAndroidSentryEnvironmentOverride

private const val includeManualOnlyArgumentKey: String = "includeManualOnly"
private const val defaultInstrumentationSentryEnvironment: String = "ci-instrumentation"

class FlashcardsAndroidTestRunner : AndroidJUnitRunner() {
    override fun newApplication(
        cl: ClassLoader,
        className: String,
        context: Context
    ): Application {
        setDefaultAndroidSentryEnvironmentOverride(environment = defaultInstrumentationSentryEnvironment)
        // Before the application exists, so no graph in this process ever emits. The live-smoke
        // flow signs into a real account, and a synthetic `app_opened` or `screen_viewed` written
        // to production `product_events` is indistinguishable from a real person's row.
        disableProductAnalyticsForProcess()
        return super.newApplication(cl, className, context)
    }

    override fun onCreate(arguments: Bundle) {
        val runnerArguments = Bundle(arguments)
        if (runnerArguments.getString(automationDeclarationArgumentKey)?.toBooleanStrictOrNull() == true) {
            // Runs before `Application.onCreate`, so the first app graph of the process already
            // declares automation to the backend. Firebase Test Lab runs on real hardware and is
            // covered twice, by this argument and by the `firebase.test.lab` device setting the app
            // reads itself; this argument is the only signal for a connected run against a physical
            // device outside Test Lab.
            markProcessAsAutomationEnvironment()
        }
        val sentryEnvironmentOverride = sentryEnvironmentOverride(arguments = runnerArguments)
        setAndroidSentryEnvironmentOverride(environment = sentryEnvironmentOverride)
        runnerArguments.putString(androidSentryEnvironmentOverrideArgumentKey, sentryEnvironmentOverride)
        val includeManualOnly = runnerArguments
            .getString(includeManualOnlyArgumentKey)
            ?.toBooleanStrictOrNull()
            ?: false

        if (includeManualOnly.not()) {
            // Keep manual marketing screenshot entrypoints out of default instrumentation runs,
            // including package-level CI/CD runs such as Firebase Test Lab.
            val manualOnlyAnnotationName = ManualOnlyAndroidTest::class.java.name
            val existingNotAnnotation = runnerArguments.getString("notAnnotation").orEmpty()
            val updatedNotAnnotation = listOf(existingNotAnnotation, manualOnlyAnnotationName)
                .filter(String::isNotBlank)
                .joinToString(separator = ",")
            runnerArguments.putString("notAnnotation", updatedNotAnnotation)
        }

        super.onCreate(runnerArguments)
    }
}

private fun sentryEnvironmentOverride(arguments: Bundle): String {
    return arguments
        .getString(androidSentryEnvironmentOverrideArgumentKey)
        ?.trim()
        ?.takeIf(String::isNotEmpty)
        ?: defaultInstrumentationSentryEnvironment
}
