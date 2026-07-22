package com.flashcardsopensourceapp.feature.ai

import android.app.LocaleConfig
import android.content.Context
import android.os.LocaleList
import java.util.Locale

internal fun currentAiUiLocaleTag(context: Context): String {
    val localeConfig: LocaleConfig = LocaleConfig(context)
    check(localeConfig.status == LocaleConfig.STATUS_SUCCESS) {
        "Android LocaleConfig must load successfully for AI UI locale resolution, " +
            "but returned status ${localeConfig.status}."
    }
    val supportedLocales: LocaleList = checkNotNull(localeConfig.supportedLocales) {
        "Android LocaleConfig returned no supported locales for AI UI locale resolution."
    }
    return resolveAiUiLocaleTag(
        preferredLocales = context.resources.configuration.locales,
        supportedLocales = supportedLocales,
        baseLocale = Locale.ENGLISH
    )
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
            if (LocaleList.matchesLanguageAndScript(supportedLocale, preferredLocale)) {
                return supportedLocale.toLanguageTag()
            }
        }
    }

    return baseLocale.toLanguageTag()
}
