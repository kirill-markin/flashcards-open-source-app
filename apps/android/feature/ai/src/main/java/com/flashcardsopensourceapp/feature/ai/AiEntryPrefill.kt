package com.flashcardsopensourceapp.feature.ai

import com.flashcardsopensourceapp.feature.ai.strings.AiTextProvider

enum class AiEntryPrefill {
    CREATE_CARD
}

fun aiEntryPrefillPrompt(
    prefill: AiEntryPrefill,
    textProvider: AiTextProvider
): String {
    return when (prefill) {
        AiEntryPrefill.CREATE_CARD -> textProvider.entryPrefillCreateCard
    }
}
