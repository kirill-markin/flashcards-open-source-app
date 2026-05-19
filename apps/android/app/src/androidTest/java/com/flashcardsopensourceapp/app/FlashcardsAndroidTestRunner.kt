package com.flashcardsopensourceapp.app

import android.app.Application
import android.content.Context
import android.os.Bundle
import androidx.test.runner.AndroidJUnitRunner
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
        return super.newApplication(cl, className, context)
    }

    override fun onCreate(arguments: Bundle) {
        val runnerArguments = Bundle(arguments)
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
