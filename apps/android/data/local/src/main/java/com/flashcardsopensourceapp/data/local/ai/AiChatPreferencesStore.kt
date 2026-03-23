package com.flashcardsopensourceapp.data.local.ai

import android.content.Context
import androidx.core.content.edit
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

private const val aiChatPreferencesName: String = "flashcards-ai-chat-preferences"
private const val aiChatConsentKey: String = "external-provider-consent"

class AiChatPreferencesStore(
    context: Context
) {
    private val preferences =
        context.getSharedPreferences(aiChatPreferencesName, Context.MODE_PRIVATE)
    private val consentState = MutableStateFlow(loadConsent())

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

    private fun loadConsent(): Boolean {
        return preferences.getBoolean(aiChatConsentKey, false)
    }
}
