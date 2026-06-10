package com.flashcardsopensourceapp.feature.cards.editor

import com.flashcardsopensourceapp.data.local.model.cards.CardDraft
import com.flashcardsopensourceapp.data.local.model.cards.normalizeTags
import com.flashcardsopensourceapp.data.local.model.scheduling.EffortLevel

internal fun buildCardEditorDraft(
    frontText: String,
    backText: String,
    selectedTags: List<String>,
    effortLevel: EffortLevel,
    referenceTags: List<String>
): CardDraft {
    return CardDraft(
        frontText = frontText.trim(),
        backText = backText.trim(),
        tags = normalizeTags(
            values = selectedTags,
            referenceTags = referenceTags
        ),
        effortLevel = effortLevel
    )
}
