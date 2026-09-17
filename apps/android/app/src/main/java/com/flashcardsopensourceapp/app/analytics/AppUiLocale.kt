package com.flashcardsopensourceapp.app.analytics

import android.app.LocaleConfig
import android.content.Context
import android.content.res.Configuration
import android.content.res.Resources
import android.os.LocaleList
import android.util.TypedValue
import com.flashcardsopensourceapp.app.BuildConfig
import com.flashcardsopensourceapp.app.R
import java.util.Locale

private val navigationStringIds: List<Int> = listOf(
    R.string.top_level_review,
    R.string.top_level_progress,
    R.string.top_level_cards,
    R.string.top_level_settings
)

private data class ResourceStringIdentity(
    val assetCookie: Int,
    val stringPoolIndex: Int
)

fun currentAppUiLocaleTag(context: Context): String? {
    val configuration = Configuration(context.resources.configuration)
    val selectedStrings: List<ResourceStringIdentity> = navigationStringIdentities(context.resources)
    val baseLocale: Locale = Locale.forLanguageTag(BuildConfig.BASE_RESOURCE_LOCALE)
    // Compare resource identities, not translated text. The base tag comes from resources.properties;
    // matching these selected navigation resources is evidence of the displayed base language.
    if (selectedStrings == navigationStringIdentitiesForLocale(context, configuration, baseLocale)) {
        return baseLocale.toLanguageTag()
    }
    val supportedLocales: LocaleList = LocaleConfig.fromContextIgnoringOverride(context).supportedLocales
        ?: return null
    val installedLocaleTags: Set<String> = context.resources.assets.locales
        .map { tag -> Locale.forLanguageTag(tag).toLanguageTag() }
        .toSet()
    // Asset locales also include framework/library translations; only the app's advertised
    // candidates with matching app resource identities can establish its displayed language.
    return (0 until supportedLocales.size())
        .mapNotNull { index -> supportedLocales[index] }
        .filter { locale -> locale.toLanguageTag() in installedLocaleTags }
        .filter { locale ->
            selectedStrings == navigationStringIdentitiesForLocale(context, configuration, locale)
        }
        .singleOrNull()
        ?.toLanguageTag()
}

private fun navigationStringIdentitiesForLocale(
    context: Context,
    configuration: Configuration,
    locale: Locale
): List<ResourceStringIdentity> {
    val localizedConfiguration = Configuration(configuration).apply {
        setLocales(LocaleList(locale))
    }
    return navigationStringIdentities(context.createConfigurationContext(localizedConfiguration).resources)
}

private fun navigationStringIdentities(resources: Resources): List<ResourceStringIdentity> {
    return navigationStringIds.map { resourceId ->
        val value = TypedValue()
        resources.getValue(resourceId, value, true)
        ResourceStringIdentity(assetCookie = value.assetCookie, stringPoolIndex = value.data)
    }
}
