package com.flashcardsopensourceapp.feature.ai

import android.app.LocaleConfig
import android.content.Context
import android.os.Build
import android.os.LocaleList
import androidx.core.os.LocaleListCompat
import com.flashcardsopensourceapp.core.ui.loadAppSupportedLocalesFromXml
import java.util.Locale

internal fun currentAiUiLocaleTag(context: Context): String {
    val supportedLocales: LocaleList = loadAiUiSupportedLocales(context = context)
    return resolveAiUiLocaleTag(
        preferredLocales = context.resources.configuration.locales,
        supportedLocales = supportedLocales,
        baseLocale = Locale.ENGLISH
    )
}

private fun loadAiUiSupportedLocales(context: Context): LocaleList {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
        return loadAppSupportedLocalesFromXml(context = context)
    }

    val localeConfig: LocaleConfig = LocaleConfig(context)
    check(localeConfig.status == LocaleConfig.STATUS_SUCCESS) {
        "Android LocaleConfig must load successfully for AI UI locale resolution, " +
            "but returned status ${localeConfig.status}."
    }
    return checkNotNull(localeConfig.supportedLocales) {
        "Android LocaleConfig returned no supported locales for AI UI locale resolution."
    }
}

internal fun resolveAiUiLocaleTag(
    preferredLocales: LocaleList,
    supportedLocales: LocaleList,
    baseLocale: Locale
): String {
    check(supportedLocales.isEmpty.not()) {
        "Android LocaleConfig must declare at least one supported locale for AI UI locale resolution."
    }
    check(supportedLocales.indexOf(baseLocale) >= 0) {
        "Android LocaleConfig must declare the base AI UI locale '${baseLocale.toLanguageTag()}'. " +
            "Supported locales: ${supportedLocales.toLanguageTags()}."
    }

    for (preferredIndex: Int in 0 until preferredLocales.size()) {
        val preferredLocale: Locale = preferredLocales[preferredIndex]
        val exactSupportedIndex: Int = supportedLocales.indexOf(preferredLocale)
        if (exactSupportedIndex >= 0) {
            return supportedLocales[exactSupportedIndex].toLanguageTag()
        }

        for (supportedIndex: Int in 0 until supportedLocales.size()) {
            val supportedLocale: Locale = supportedLocales[supportedIndex]
            if (LocaleListCompat.matchesLanguageAndScript(supportedLocale, preferredLocale)) {
                return supportedLocale.toLanguageTag()
            }
        }
    }

    return baseLocale.toLanguageTag()
}
