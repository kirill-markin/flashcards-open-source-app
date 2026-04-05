package com.flashcardsopensourceapp.app

import android.os.Bundle
import androidx.test.runner.AndroidJUnitRunner

private const val includeManualOnlyArgumentKey: String = "includeManualOnly"

class FlashcardsAndroidTestRunner : AndroidJUnitRunner() {
    override fun onCreate(arguments: Bundle) {
        val runnerArguments = Bundle(arguments)
        val includeManualOnly = runnerArguments
            .getString(includeManualOnlyArgumentKey)
            ?.toBooleanStrictOrNull()
            ?: false

        if (includeManualOnly.not()) {
            // Keep manual marketing screenshot entrypoints out of default instrumentation runs.
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
