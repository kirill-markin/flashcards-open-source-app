package com.flashcardsopensourceapp.data.local.appicon

import android.content.Context
import androidx.core.content.edit
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

const val appIconPreferencesName: String = "flashcards-app-icon-preferences"
private const val appIconKey: String = "app-icon"

enum class AppIcon(val storageValue: String) {
    DEFAULT(storageValue = "default"),
    LIGHT(storageValue = "light")
}

/** The icon the launcher shows: the stored choice while style is customizable, otherwise Default. */
fun effectiveAppIcon(storedAppIcon: AppIcon, canCustomizeStyle: Boolean): AppIcon {
    return if (canCustomizeStyle) {
        storedAppIcon
    } else {
        AppIcon.DEFAULT
    }
}

/** The per-device App icon choice, kept independently of entitlement. */
class AppIconPreferencesStore(
    context: Context
) {
    private val preferences =
        context.getSharedPreferences(appIconPreferencesName, Context.MODE_PRIVATE)
    private val appIconState = MutableStateFlow(loadAppIcon())

    fun observeAppIcon(): StateFlow<AppIcon> {
        return appIconState.asStateFlow()
    }

    fun updateAppIcon(appIcon: AppIcon) {
        preferences.edit(commit = true) {
            putString(appIconKey, appIcon.storageValue)
        }
        appIconState.value = appIcon
    }

    private fun loadAppIcon(): AppIcon {
        val storedValue: String = preferences.getString(appIconKey, null) ?: return AppIcon.DEFAULT
        return AppIcon.entries.firstOrNull { appIcon -> appIcon.storageValue == storedValue }
            ?: throw IllegalStateException(
                "Stored app icon '$storedValue' in '$appIconPreferencesName' is not one of " +
                    AppIcon.entries.joinToString(separator = ", ") { appIcon -> appIcon.storageValue } + "."
            )
    }
}
