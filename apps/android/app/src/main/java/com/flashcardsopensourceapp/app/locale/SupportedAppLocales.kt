package com.flashcardsopensourceapp.app.locale

import android.app.LocaleConfig
import android.app.LocaleManager
import android.content.Context
import android.os.LocaleList

private const val supportedAppLanguageTags: String = "en,es"

internal fun configureSupportedAppLocales(context: Context) {
    val localeManager = context.getSystemService(LocaleManager::class.java)
    val supportedLocales = LocaleList.forLanguageTags(supportedAppLanguageTags)
    val currentSupportedLocales = localeManager.overrideLocaleConfig?.supportedLocales

    if (currentSupportedLocales?.toLanguageTags() == supportedLocales.toLanguageTags()) {
        return
    }

    localeManager.setOverrideLocaleConfig(LocaleConfig(supportedLocales))
}
