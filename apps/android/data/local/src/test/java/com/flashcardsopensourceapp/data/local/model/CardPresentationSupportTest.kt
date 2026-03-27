package com.flashcardsopensourceapp.data.local.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

class CardPresentationSupportTest {
    @Test
    fun formatCardEffortLabelReturnsTitleCaseValue() {
        assertEquals("Fast", formatCardEffortLabel(effortLevel = EffortLevel.FAST))
    }

    @Test
    fun formatCardTagsLabelReturnsNoTagsWhenEmpty() {
        assertEquals("No tags", formatCardTagsLabel(tags = emptyList()))
    }

    @Test
    fun formatCardTagsLabelJoinsTagsWithCommaSeparator() {
        assertEquals("android, mobile", formatCardTagsLabel(tags = listOf("android", "mobile")))
    }

    @Test
    fun formatCardDueLabelReturnsNewForMissingDueDate() {
        assertEquals("new", formatCardDueLabel(dueAtMillis = null))
    }

    @Test
    fun formatCardDueLabelFormatsExistingDueDate() {
        val previousLocale = Locale.getDefault()
        Locale.setDefault(Locale.US)

        try {
            assertTrue(formatCardDueLabel(dueAtMillis = 1_700_000_000_000L).isNotBlank())
        } finally {
            Locale.setDefault(previousLocale)
        }
    }
}
