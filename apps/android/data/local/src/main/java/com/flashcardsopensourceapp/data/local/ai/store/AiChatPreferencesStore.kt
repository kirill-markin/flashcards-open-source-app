package com.flashcardsopensourceapp.data.local.ai.store

import android.content.Context
import androidx.core.content.edit
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

private const val aiChatPreferencesName: String = "flashcards-ai-chat-preferences"
private const val aiChatConsentKey: String = "external-provider-consent"
private const val aiChatComposerSuggestionsEnabledKey: String = "composer-suggestions-enabled"

class AiChatPreferencesStore(
    context: Context
) {
    private val preferences =
        context.getSharedPreferences(aiChatPreferencesName, Context.MODE_PRIVATE)
    private val consentState = MutableStateFlow(loadConsent())
    private val composerSuggestionsEnabledState = MutableStateFlow(loadComposerSuggestionsEnabled())

    fun observeConsent(): StateFlow<Boolean> {
        return consentState.asStateFlow()
    }

    fun hasConsent(): Boolean {
        return consentState.value
    }

    fun updateConsent(hasConsent: Boolean) {
        preferences.edit(commit = true) {
            putBoolean(aiChatConsentKey, hasConsent)
        }
        consentState.value = hasConsent
    }

    fun clearConsent() {
        preferences.edit(commit = true) {
            remove(aiChatConsentKey)
        }
        consentState.value = false
    }

    fun observeComposerSuggestionsEnabled(): StateFlow<Boolean> {
        return composerSuggestionsEnabledState.asStateFlow()
    }

    fun areComposerSuggestionsEnabled(): Boolean {
        return composerSuggestionsEnabledState.value
    }

    fun updateComposerSuggestionsEnabled(isEnabled: Boolean) {
        preferences.edit(commit = true) {
            putBoolean(aiChatComposerSuggestionsEnabledKey, isEnabled)
        }
        composerSuggestionsEnabledState.value = isEnabled
    }

    private fun loadConsent(): Boolean {
        return preferences.getBoolean(aiChatConsentKey, false)
    }

    private fun loadComposerSuggestionsEnabled(): Boolean {
        return preferences.getBoolean(aiChatComposerSuggestionsEnabledKey, true)
    }
}
