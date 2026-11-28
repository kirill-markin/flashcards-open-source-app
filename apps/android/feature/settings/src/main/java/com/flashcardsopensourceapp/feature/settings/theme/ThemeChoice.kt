package com.flashcardsopensourceapp.feature.settings.theme

import com.flashcardsopensourceapp.data.local.model.sync.AccountPreferences
import com.flashcardsopensourceapp.data.local.model.sync.AccountTheme

/** A Theme screen option: [SYSTEM] is `followSystemAppearance`, the others are the stored `theme`. */
enum class ThemeChoice(val tagValue: String) {
    DARK("dark"),
    LIGHT("light"),
    SYSTEM("system")
}

fun savedThemeChoice(preferences: AccountPreferences): ThemeChoice {
    if (preferences.followSystemAppearance) {
        return ThemeChoice.SYSTEM
    }
    return when (preferences.theme) {
        AccountTheme.DARK -> ThemeChoice.DARK
        AccountTheme.LIGHT -> ThemeChoice.LIGHT
    }
}
