package com.flashcardsopensourceapp.app.observability

const val androidSentryEnvironmentOverrideArgumentKey: String = "flashcardsSentryEnvironmentOverride"

@Volatile
private var androidSentryEnvironmentOverrideValue: String? = null

fun setAndroidSentryEnvironmentOverride(environment: String?) {
    androidSentryEnvironmentOverrideValue = environment?.trim()?.takeIf(String::isNotEmpty)
}

fun setDefaultAndroidSentryEnvironmentOverride(environment: String) {
    if (androidSentryEnvironmentOverrideValue == null) {
        setAndroidSentryEnvironmentOverride(environment = environment)
    }
}

internal fun androidSentryEnvironmentOverride(): String? {
    return androidSentryEnvironmentOverrideValue
}
