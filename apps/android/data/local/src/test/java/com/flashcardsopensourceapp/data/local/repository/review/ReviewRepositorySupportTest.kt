package com.flashcardsopensourceapp.data.local.repository.review

import com.flashcardsopensourceapp.data.local.database.review.ReviewTagCardRow
import com.flashcardsopensourceapp.data.local.model.review.ReviewTagFilterOption
import org.junit.Assert.assertEquals
import org.junit.Test

class ReviewRepositorySupportTest {
    @Test
    fun tagFilterOptionsAggregateDistinctCardsAcrossEquivalentStoredNames() {
        val decomposedTag = "E\u0301clair"
        val rows = listOf(
            ReviewTagCardRow(tag = "éCLAIR", cardId = "shared-card"),
            ReviewTagCardRow(tag = "Éclair", cardId = "shared-card"),
            ReviewTagCardRow(tag = decomposedTag, cardId = "shared-card"),
            ReviewTagCardRow(tag = "éCLAIR", cardId = "second-card"),
            ReviewTagCardRow(tag = decomposedTag, cardId = "third-card")
        )

        assertEquals(
            listOf(
                ReviewTagFilterOption(tag = decomposedTag, totalCount = 3),
                ReviewTagFilterOption(tag = "Future", totalCount = 0)
            ),
            buildReviewTagFilterOptionsFromRows(
                rows = rows,
                storedTagNames = listOf("éCLAIR", "Future", "Éclair", decomposedTag)
            )
        )
    }
}
