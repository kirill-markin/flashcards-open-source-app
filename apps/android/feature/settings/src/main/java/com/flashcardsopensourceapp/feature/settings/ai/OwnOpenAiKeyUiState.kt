package com.flashcardsopensourceapp.feature.settings.ai

import com.flashcardsopensourceapp.data.local.model.ai.redactedOwnOpenAiKey

data class OwnOpenAiKeyUiState(
    val isEnabled: Boolean,
    val apiKey: String,
    /** False until the stored key has been read, so typing never races the read. */
    val isApiKeyFieldEnabled: Boolean,
    /** The stored key could not be read or saved, so it was removed. */
    val isStoredKeyUnreadable: Boolean,
    /** This month's messages answered on the person's own key, or null until they are loaded. */
    val ownKeyMessages: Int?,
    val usageErrorMessage: String
) {
    override fun toString(): String {
        return "OwnOpenAiKeyUiState(isEnabled=$isEnabled, apiKey=${redactedOwnOpenAiKey(apiKey = apiKey)}, " +
            "isApiKeyFieldEnabled=$isApiKeyFieldEnabled, isStoredKeyUnreadable=$isStoredKeyUnreadable, " +
            "ownKeyMessages=$ownKeyMessages, usageErrorMessage=$usageErrorMessage)"
    }
}
