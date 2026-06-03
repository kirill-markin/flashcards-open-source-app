package com.flashcardsopensourceapp.feature.cards

import com.flashcardsopensourceapp.data.local.model.cards.CardDraft
import com.flashcardsopensourceapp.data.local.model.scheduling.EffortLevel
import org.junit.Assert.assertEquals
import org.junit.Test

class CardEditorDraftSnapshotTest {
    @Test
    fun buildCardEditorDraftTrimsAndNormalizesTags() {
        val result = buildCardEditorDraft(
            frontText = "  New front  ",
            backText = "  New back  ",
            selectedTags = listOf("  ai  ", "flashcards"),
            effortLevel = EffortLevel.LONG,
            referenceTags = listOf("AI", "Flashcards")
        )

        assertEquals(
            CardDraft(
                frontText = "New front",
                backText = "New back",
                tags = listOf("AI", "Flashcards"),
                effortLevel = EffortLevel.LONG
            ),
            result
        )
    }
}
