package com.flashcardsopensourceapp.feature.cards.editor

import com.flashcardsopensourceapp.data.local.model.cards.CardDraft
import org.junit.Assert.assertEquals
import org.junit.Test

class CardEditorDraftSnapshotTest {
    @Test
    fun buildCardEditorDraftTrimsAndNormalizesTags() {
        val result = buildCardEditorDraft(
            frontText = "  New front  ",
            backText = "  New back  ",
            selectedTags = listOf("  ai  ", "flashcards"),
            referenceTags = listOf("AI", "Flashcards")
        )

        assertEquals(
            CardDraft(
                frontText = "New front",
                backText = "New back",
                tags = listOf("AI", "Flashcards"),
            ),
            result
        )
    }
}
