package com.flashcardsopensourceapp.feature.ai

enum class AiEntryPrefill {
    CREATE_CARD
}

fun aiEntryPrefillPrompt(prefill: AiEntryPrefill): String {
    return when (prefill) {
        AiEntryPrefill.CREATE_CARD -> "Help me create a card."
    }
}
