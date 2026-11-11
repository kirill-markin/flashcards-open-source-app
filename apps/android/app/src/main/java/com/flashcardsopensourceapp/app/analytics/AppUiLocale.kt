package com.flashcardsopensourceapp.app.analytics

import android.app.LocaleConfig
import android.content.Context
import android.content.res.Configuration
import android.content.res.Resources
import android.os.Build
import android.os.LocaleList
import android.util.TypedValue
import androidx.core.os.LocaleListCompat
import com.flashcardsopensourceapp.app.BuildConfig
import com.flashcardsopensourceapp.app.R
import com.flashcardsopensourceapp.core.ui.loadAppSupportedLocalesFromXml
import java.util.Locale

private val navigationStringIds: List<Int> = listOf(
    R.string.top_level_review,
    R.string.top_level_progress,
    R.string.top_level_library,
    R.string.top_level_settings
)

private data class ResourceStringIdentity(
    val assetCookie: Int,
    val stringPoolIndex: Int
)

fun currentAppUiLocaleTag(context: Context): String? {
    val resources: Resources = context.resources
    val configuration = Configuration(resources.configuration)
    val selectedStrings: List<ResourceStringIdentity> = navigationStringIdentities(resources)
    val baseLocale: Locale = Locale.forLanguageTag(BuildConfig.BASE_RESOURCE_LOCALE)
    // A generic English configuration can select regional resources such as en-CA.
    val baseResources: Resources = resourcesForLocale(context, configuration, Locale.ROOT)
    val usesBaseStrings = selectedStrings == navigationStringIdentities(baseResources)
    // The bundled English variants share base navigation and override this string.
    val regionalOverrideStringId: Int = R.string.premium_benefit_accent_color
    val selectedRegionalOverride: ResourceStringIdentity? = if (usesBaseStrings) {
        resourceStringIdentity(resources, regionalOverrideStringId).takeUnless { identity ->
            identity == resourceStringIdentity(baseResources, regionalOverrideStringId)
        } ?: return baseLocale.toLanguageTag()
    } else {
        null
    }
    val supportedLocales: LocaleList = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        LocaleConfig.fromContextIgnoringOverride(context).supportedLocales
            ?: return baseLocale.toLanguageTag().takeIf { usesBaseStrings }
    } else {
        loadAppSupportedLocalesFromXml(context = context)
    }
    val installedLocaleTags: Set<String> = resources.assets.locales
        .map { tag -> Locale.forLanguageTag(tag).toLanguageTag() }
        .toSet()
    val matchingLocales = (0 until supportedLocales.size())
        .mapNotNull { index -> supportedLocales[index] }
        .filter { locale ->
            when {
                locale == baseLocale -> usesBaseStrings
                locale.toLanguageTag() !in installedLocaleTags -> false
                // A library translation can advertise a locale whose app strings fall back to English.
                usesBaseStrings && !LocaleListCompat.matchesLanguageAndScript(baseLocale, locale) -> false
                else -> {
                    val localizedResources: Resources = resourcesForLocale(context, configuration, locale)
                    selectedStrings == navigationStringIdentities(localizedResources) &&
                        (selectedRegionalOverride == null ||
                            selectedRegionalOverride == resourceStringIdentity(localizedResources, regionalOverrideStringId))
                }
            }
        }
    return resolveMatchingAppUiLocale(
        preferredLocales = configuration.locales,
        matchingLocales = matchingLocales
    )?.toLanguageTag()
}

private fun resolveMatchingAppUiLocale(preferredLocales: LocaleList, matchingLocales: List<Locale>): Locale? {
    if (matchingLocales.size <= 1) {
        return matchingLocales.singleOrNull()
    }

    // Regional packs can inherit the same navigation strings as their parent.
    for (index in 0 until preferredLocales.size()) {
        val preferredLocale: Locale = preferredLocales[index]
        val languageMatches = matchingLocales.filter { locale ->
            LocaleListCompat.matchesLanguageAndScript(locale, preferredLocale)
        }
        val match = languageMatches.singleOrNull { it.country == preferredLocale.country }
            ?: languageMatches.singleOrNull { it.country.isEmpty() }
        if (match != null) {
            return match
        }
    }

    return matchingLocales.singleOrNull { locale ->
        locale.country.isEmpty() && matchingLocales.all { other ->
            LocaleListCompat.matchesLanguageAndScript(locale, other)
        }
    }
}

private fun resourcesForLocale(
    context: Context,
    configuration: Configuration,
    locale: Locale
): Resources {
    val localizedConfiguration = Configuration(configuration).apply {
        setLocales(LocaleList(locale))
    }
    return context.createConfigurationContext(localizedConfiguration).resources
}

private fun navigationStringIdentities(resources: Resources): List<ResourceStringIdentity> {
    return navigationStringIds.map { resourceId -> resourceStringIdentity(resources, resourceId) }
}

private fun resourceStringIdentity(resources: Resources, resourceId: Int): ResourceStringIdentity {
    val value = TypedValue()
    resources.getValue(resourceId, value, true)
    return ResourceStringIdentity(assetCookie = value.assetCookie, stringPoolIndex = value.data)
}
