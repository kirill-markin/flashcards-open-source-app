package com.flashcardsopensourceapp.feature.ai

import com.flashcardsopensourceapp.feature.ai.strings.AiTextProvider

sealed interface AiEntryPrefill {
    data object CreateCard : AiEntryPrefill
    data class CatalogDeck(val topic: String) : AiEntryPrefill
}

fun aiEntryPrefillPrompt(
    prefill: AiEntryPrefill,
    textProvider: AiTextProvider
): String {
    return when (prefill) {
        AiEntryPrefill.CreateCard -> textProvider.entryPrefillCreateCard
        is AiEntryPrefill.CatalogDeck -> textProvider.entryPrefillCreateCatalogDeckFormat.format(prefill.topic)
    }
}
