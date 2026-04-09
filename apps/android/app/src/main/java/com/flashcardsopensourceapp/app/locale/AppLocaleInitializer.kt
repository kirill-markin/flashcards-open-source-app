package com.flashcardsopensourceapp.app.locale

import android.app.LocaleManager
import android.content.Context
import android.os.LocaleList

private const val appLocalePreferencesName: String = "app_locale_preferences"
private const val appLocaleInitializedKey: String = "app_locale_initialized"
private const val englishLanguageTag: String = "en"
private const val spanishLanguageTag: String = "es"

internal class AppLocaleInitializer(
    private val context: Context
) {
    fun initializeIfNeeded() {
        val localeManager = context.getSystemService(LocaleManager::class.java)
        val preferences = context.getSharedPreferences(
            appLocalePreferencesName,
            Context.MODE_PRIVATE
        )

        if (preferences.getBoolean(appLocaleInitializedKey, false)) {
            return
        }

        if (localeManager.applicationLocales.isEmpty.not()) {
            markInitialized(preferences = preferences)
            return
        }

        val initialLanguageTag = resolveInitialLanguageTag(
            systemLocales = localeManager.systemLocales
        )
        markInitialized(preferences = preferences)
        localeManager.applicationLocales = LocaleList.forLanguageTags(initialLanguageTag)
    }
}

private fun resolveInitialLanguageTag(systemLocales: LocaleList): String {
    val matchingLocale = systemLocales.getFirstMatch(
        arrayOf(
            englishLanguageTag,
            spanishLanguageTag
        )
    )

    return when (matchingLocale?.language) {
        spanishLanguageTag -> spanishLanguageTag
        englishLanguageTag -> englishLanguageTag
        else -> englishLanguageTag
    }
}

private fun markInitialized(preferences: android.content.SharedPreferences) {
    val isStored = preferences.edit()
        .putBoolean(appLocaleInitializedKey, true)
        .commit()

    if (isStored.not()) {
        throw IllegalStateException(
            "Failed to persist initial app language state in '$appLocalePreferencesName'."
        )
    }
}
