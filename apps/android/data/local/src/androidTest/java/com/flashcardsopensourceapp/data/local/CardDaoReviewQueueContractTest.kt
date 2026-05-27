package com.flashcardsopensourceapp.data.local

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.database.CardTagEntity
import com.flashcardsopensourceapp.data.local.database.TagEntity
import com.flashcardsopensourceapp.data.local.database.loadTopActiveReviewCard
import com.flashcardsopensourceapp.data.local.model.EffortLevel
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
                    effortLevel = EffortLevel.FAST,
                    dueAtMillis = nowMillis - oneHourMillis,
                    createdAtMillis = 300L,
                    updatedAtMillis = 300L
                ).copy(fsrsLastReviewedAtMillis = nowMillis - oneHourMillis),
                makeDueReviewOrderingCardEntity(
                    cardId = "recent-cutoff-b",
                    workspaceId = workspaceId,
                    effortLevel = EffortLevel.FAST,
                    dueAtMillis = nowMillis - oneHourMillis,
                    createdAtMillis = 300L,
                    updatedAtMillis = 300L
                ).copy(fsrsLastReviewedAtMillis = nowMillis - oneHourMillis),
                makeDueReviewOrderingCardEntity(
                    cardId = "recent-cutoff-older-created",
                    workspaceId = workspaceId,
                    effortLevel = EffortLevel.FAST,
                    dueAtMillis = nowMillis - oneHourMillis,
                    createdAtMillis = 200L,
                    updatedAtMillis = 200L
                ).copy(fsrsLastReviewedAtMillis = nowMillis - oneHourMillis),
                makeDueReviewOrderingCardEntity(
                    cardId = "old-boundary-card",
                    workspaceId = workspaceId,
                    effortLevel = EffortLevel.LONG,
                    dueAtMillis = nowMillis - oneHourMillis - 1L,
                    createdAtMillis = 400L,
                    updatedAtMillis = 400L
                ),
                makeDueReviewOrderingCardEntity(
                    cardId = "due-now-card",
                    workspaceId = workspaceId,
                    effortLevel = EffortLevel.MEDIUM,
                    dueAtMillis = nowMillis,
                    createdAtMillis = 500L,
                    updatedAtMillis = 500L
                ),
                makeNewReviewOrderingCardEntity(
                    cardId = "new-medium-card",
                    workspaceId = workspaceId,
                    effortLevel = EffortLevel.MEDIUM,
                    createdAtMillis = 600L,
                    updatedAtMillis = 600L
                ),
                makeDueReviewOrderingCardEntity(
                    cardId = "future-card",
                    workspaceId = workspaceId,
                    effortLevel = EffortLevel.FAST,
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
            effortLevels = emptyList(),
            tagNames = emptyList()
        )
        val effortTop = loadTopActiveReviewCard(
            reviewCardSelectionDao = database.reviewCardSelectionDao(),
            workspaceId = workspaceId,
            nowMillis = nowMillis,
            effortLevels = listOf(EffortLevel.FAST),
            tagNames = emptyList()
        )
        val tagTop = loadTopActiveReviewCard(
            reviewCardSelectionDao = database.reviewCardSelectionDao(),
            workspaceId = workspaceId,
            nowMillis = nowMillis,
            effortLevels = emptyList(),
            tagNames = listOf("Priority")
        )
        val effortAndTagTop = loadTopActiveReviewCard(
            reviewCardSelectionDao = database.reviewCardSelectionDao(),
            workspaceId = workspaceId,
            nowMillis = nowMillis,
            effortLevels = listOf(EffortLevel.MEDIUM),
            tagNames = listOf("Priority")
        )
        val futureOnlyTagTop = loadTopActiveReviewCard(
            reviewCardSelectionDao = database.reviewCardSelectionDao(),
            workspaceId = workspaceId,
            nowMillis = nowMillis,
            effortLevels = emptyList(),
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
        val effortAndTagQueue = database.reviewQueueDao().observeBucketedActiveReviewQueueByEffortLevelsAndAnyTags(
            workspaceId = workspaceId,
            cutoffMillis = cutoffMillis,
            nowMillis = nowMillis,
            effortLevels = listOf(EffortLevel.MEDIUM),
            tagNames = listOf("Priority"),
            limit = 10
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
        assertEquals("recent-cutoff-a", effortTop?.cardId)
        assertEquals("recent-cutoff-a", tagTop?.cardId)
        assertEquals("due-now-card", effortAndTagTop?.cardId)
        assertNull(futureOnlyTagTop)
        assertEquals(
            listOf("recent-cutoff-a", "recent-cutoff-b", "recent-cutoff-older-created", "old-boundary-card"),
            boundedQueue
        )
        assertEquals(listOf("due-now-card", "new-medium-card"), effortAndTagQueue)
        assertEquals(6, priorityDueCount)
        assertEquals(6, priorityTotalCount)
        assertEquals(0, futureOnlyDueCount)
        assertEquals(1, futureOnlyTotalCount)
    }
}
