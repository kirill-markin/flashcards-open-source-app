package com.flashcardsopensourceapp.core.ui

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

private const val testModePreferencesName: String = "flashcards-test-mode"
private const val testModeEnabledKey: String = "test-mode-enabled"

class TestModeStore(
    context: Context
) {
    private val preferences: SharedPreferences = context.getSharedPreferences(
        testModePreferencesName,
        Context.MODE_PRIVATE
    )
    private val isEnabledState = MutableStateFlow(loadIsEnabled())

    fun observeIsEnabled(): StateFlow<Boolean> {
        return isEnabledState.asStateFlow()
    }

    fun toggleIsEnabled(): Boolean {
        val nextValue: Boolean = isEnabledState.value.not()
        saveIsEnabled(isEnabled = nextValue)
        isEnabledState.value = nextValue
        return nextValue
    }

    private fun loadIsEnabled(): Boolean {
        return preferences.getBoolean(testModeEnabledKey, false)
    }

    private fun saveIsEnabled(isEnabled: Boolean) {
        val didCommit: Boolean = preferences.edit()
            .putBoolean(testModeEnabledKey, isEnabled)
            .commit()
        check(didCommit) {
            "Failed to persist Android test mode state. " +
                "preferencesName=$testModePreferencesName key=$testModeEnabledKey isEnabled=$isEnabled"
        }
    }
}
