package com.flashcardsopensourceapp.data.local.review

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.database.core.AppDatabase
import com.flashcardsopensourceapp.data.local.database.entities.CardTagEntity
import com.flashcardsopensourceapp.data.local.database.entities.TagEntity
import com.flashcardsopensourceapp.data.local.database.review.loadTopActiveReviewCard
import com.flashcardsopensourceapp.data.local.support.LocalDatabaseTestRuntime
import com.flashcardsopensourceapp.data.local.support.bootstrapTestWorkspace
import com.flashcardsopensourceapp.data.local.support.closeLocalDatabaseTestRuntime
import com.flashcardsopensourceapp.data.local.support.createLocalDatabaseTestRuntime
import com.flashcardsopensourceapp.data.local.support.makeDueReviewOrderingCardEntity
import com.flashcardsopensourceapp.data.local.support.makeNewReviewOrderingCardEntity
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class CardDaoReviewQueueContractTest {
    private lateinit var runtime: LocalDatabaseTestRuntime
    private val database: AppDatabase
        get() = runtime.database

    @Before
    fun setUp() = runBlocking {
        runtime = createLocalDatabaseTestRuntime()
    }

    @After
    fun tearDown() {
        if (::runtime.isInitialized) {
            closeLocalDatabaseTestRuntime(runtime = runtime)
        }
    }

    @Test
    fun topReviewCardQueriesUseRecentReviewBoundariesAndFilters(): Unit = runBlocking {
        val nowMillis = 12 * 60 * 60 * 1_000L
        val oneHourMillis = 60 * 60 * 1_000L
        val workspaceId = bootstrapTestWorkspace(runtime = runtime, currentTimeMillis = nowMillis)
        val priorityTag = TagEntity(
            tagId = "tag-priority",
            workspaceId = workspaceId,
            name = "Priority"
        )
        val futureTag = TagEntity(
            tagId = "tag-future-only",
            workspaceId = workspaceId,
            name = "Future Only"
        )

        database.cardDao().insertCards(
            listOf(
                makeDueReviewOrderingCardEntity(
                    cardId = "recent-cutoff-a",
                    workspaceId = workspaceId,
                    dueAtMillis = nowMillis - oneHourMillis,
                    createdAtMillis = 300L,
                    updatedAtMillis = 300L
                ).copy(fsrsLastReviewedAtMillis = nowMillis - oneHourMillis),
                makeDueReviewOrderingCardEntity(
                    cardId = "recent-cutoff-b",
                    workspaceId = workspaceId,
                    dueAtMillis = nowMillis - oneHourMillis,
                    createdAtMillis = 300L,
                    updatedAtMillis = 300L
                ).copy(fsrsLastReviewedAtMillis = nowMillis - oneHourMillis),
                makeDueReviewOrderingCardEntity(
                    cardId = "recent-cutoff-older-created",
                    workspaceId = workspaceId,
                    dueAtMillis = nowMillis - oneHourMillis,
                    createdAtMillis = 200L,
                    updatedAtMillis = 200L
                ).copy(fsrsLastReviewedAtMillis = nowMillis - oneHourMillis),
                makeDueReviewOrderingCardEntity(
                    cardId = "old-boundary-card",
                    workspaceId = workspaceId,
                    dueAtMillis = nowMillis - oneHourMillis - 1L,
                    createdAtMillis = 400L,
                    updatedAtMillis = 400L
                ),
                makeDueReviewOrderingCardEntity(
                    cardId = "due-now-card",
                    workspaceId = workspaceId,
                    dueAtMillis = nowMillis,
                    createdAtMillis = 500L,
                    updatedAtMillis = 500L
                ),
                makeNewReviewOrderingCardEntity(
                    cardId = "new-medium-card",
                    workspaceId = workspaceId,
                    createdAtMillis = 600L,
                    updatedAtMillis = 600L
                ),
                makeDueReviewOrderingCardEntity(
                    cardId = "future-card",
                    workspaceId = workspaceId,
                    dueAtMillis = nowMillis + 1L,
                    createdAtMillis = 700L,
                    updatedAtMillis = 700L
                ).copy(fsrsLastReviewedAtMillis = nowMillis)
            )
        )
        database.tagDao().insertTags(tags = listOf(priorityTag, futureTag))
        database.tagDao().insertCardTags(
            cardTags = listOf(
                CardTagEntity(cardId = "recent-cutoff-a", tagId = priorityTag.tagId),
                CardTagEntity(cardId = "recent-cutoff-b", tagId = priorityTag.tagId),
                CardTagEntity(cardId = "recent-cutoff-older-created", tagId = priorityTag.tagId),
                CardTagEntity(cardId = "old-boundary-card", tagId = priorityTag.tagId),
                CardTagEntity(cardId = "due-now-card", tagId = priorityTag.tagId),
                CardTagEntity(cardId = "new-medium-card", tagId = priorityTag.tagId),
                CardTagEntity(cardId = "future-card", tagId = futureTag.tagId)
            )
        )

        val allCardsTop = loadTopActiveReviewCard(
            reviewCardSelectionDao = database.reviewCardSelectionDao(),
            workspaceId = workspaceId,
            nowMillis = nowMillis,
            tagNames = emptyList()
        )
        val tagTop = loadTopActiveReviewCard(
            reviewCardSelectionDao = database.reviewCardSelectionDao(),
            workspaceId = workspaceId,
            nowMillis = nowMillis,
            tagNames = listOf("Priority")
        )
        val futureOnlyTagTop = loadTopActiveReviewCard(
            reviewCardSelectionDao = database.reviewCardSelectionDao(),
            workspaceId = workspaceId,
            nowMillis = nowMillis,
            tagNames = listOf("Future Only")
        )
        val cutoffMillis = nowMillis - oneHourMillis
        val boundedQueue = database.reviewQueueDao().observeBucketedActiveReviewQueue(
            workspaceId = workspaceId,
            cutoffMillis = cutoffMillis,
            nowMillis = nowMillis,
            limit = 4
        ).first().map { card ->
            card.card.cardId
        }
        val priorityQueue = database.reviewQueueDao().observeBucketedActiveReviewQueueByAnyTags(
            workspaceId = workspaceId,
            cutoffMillis = cutoffMillis,
            nowMillis = nowMillis,
            tagNames = listOf("Priority"),
            limit = 4
        ).first().map { card ->
            card.card.cardId
        }
        val priorityDueCount = database.reviewCountDao().observeReviewDueCountByAnyTags(
            workspaceId = workspaceId,
            nowMillis = nowMillis,
            tagNames = listOf("Priority")
        ).first()
        val priorityTotalCount = database.reviewCountDao().observeReviewTotalCountByAnyTags(
            workspaceId = workspaceId,
            tagNames = listOf("Priority")
        ).first()
        val futureOnlyDueCount = database.reviewCountDao().observeReviewDueCountByAnyTags(
            workspaceId = workspaceId,
            nowMillis = nowMillis,
            tagNames = listOf("Future Only")
        ).first()
        val futureOnlyTotalCount = database.reviewCountDao().observeReviewTotalCountByAnyTags(
            workspaceId = workspaceId,
            tagNames = listOf("Future Only")
        ).first()

        assertEquals("recent-cutoff-a", allCardsTop?.cardId)
        assertEquals("recent-cutoff-a", tagTop?.cardId)
        assertNull(futureOnlyTagTop)
        assertEquals(
            listOf("recent-cutoff-a", "recent-cutoff-b", "recent-cutoff-older-created", "old-boundary-card"),
            boundedQueue
        )
        assertEquals(boundedQueue, priorityQueue)
        assertEquals(6, priorityDueCount)
        assertEquals(6, priorityTotalCount)
        assertEquals(0, futureOnlyDueCount)
        assertEquals(1, futureOnlyTotalCount)
    }
}
