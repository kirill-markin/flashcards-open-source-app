package com.flashcardsopensourceapp.app

import android.content.Context
import androidx.room.withTransaction
import androidx.test.core.app.ApplicationProvider
import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.data.local.database.CardEntity
import com.flashcardsopensourceapp.data.local.database.CardTagEntity
import com.flashcardsopensourceapp.data.local.database.CardWithRelations
import com.flashcardsopensourceapp.data.local.database.TagEntity
import com.flashcardsopensourceapp.data.local.model.CardDraft
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.FsrsCardState
import com.flashcardsopensourceapp.data.local.model.ReviewRating
import com.flashcardsopensourceapp.data.local.model.SyncStatus
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import java.util.UUID
import com.flashcardsopensourceapp.data.local.model.normalizeTags

internal data class RepositorySeedReview(
    val rating: ReviewRating,
    val reviewedAtMillis: Long
)

internal data class RepositorySeedCard(
    val frontText: String,
    val backText: String,
    val tags: List<String>,
    val effortLevel: EffortLevel,
    val reviews: List<RepositorySeedReview>
)

internal data class RepositorySeedScenario(
    val cards: List<RepositorySeedCard>
)

internal data class RepositorySeededCard(
    val cardId: String,
    val frontText: String,
    val backText: String,
    val tags: List<String>
)

internal data class RepositorySeedResult(
    val workspaceId: String,
    val cards: List<RepositorySeededCard>,
    val reviewCount: Int
)

internal class RepositorySeedExecutor(
    private val application: FlashcardsApplication
) {
    suspend fun seedCardsAndReviewsInCurrentWorkspace(
        seedScenario: RepositorySeedScenario
    ): RepositorySeedResult {
        val appGraph: AppGraph = application.appGraph
        appGraph.awaitStartup()
        appGraph.ensureLocalWorkspaceShell(currentTimeMillis = System.currentTimeMillis())
        val workspaceId: String = requireCurrentWorkspaceId(appGraph = appGraph)
        return seedCardsAndReviews(
            appGraph = appGraph,
            workspaceId = workspaceId,
            seedScenario = seedScenario
        )
    }

    suspend fun seedCardsAndReviewsInGuestCloudWorkspace(
        seedScenario: RepositorySeedScenario
    ): RepositorySeedResult {
        val appGraph: AppGraph = application.appGraph
        appGraph.awaitStartup()
        appGraph.ensureLocalWorkspaceShell(currentTimeMillis = System.currentTimeMillis())
        val localWorkspaceId: String = requireCurrentWorkspaceId(appGraph = appGraph)
        val guestSession = appGraph.ensureGuestCloudSession(workspaceId = localWorkspaceId)
        val seedResult: RepositorySeedResult = seedCardsAndReviews(
            appGraph = appGraph,
            workspaceId = guestSession.workspaceId,
            seedScenario = seedScenario
        )
        appGraph.syncRepository.syncNow()
        verifyGuestCloudReadiness(
            appGraph = appGraph,
            expectedWorkspaceId = guestSession.workspaceId
        )
        return seedResult
    }

    private suspend fun seedCardsAndReviews(
        appGraph: AppGraph,
        workspaceId: String,
        seedScenario: RepositorySeedScenario
    ): RepositorySeedResult {
        val seededCards: MutableList<RepositorySeededCard> = mutableListOf()
        var reviewCount: Int = 0
        val seedBaseTimestampMillis: Long = resolveSeedBaseTimestampMillis(
            appGraph = appGraph,
            workspaceId = workspaceId
        )

        seedScenario.cards.forEachIndexed { index, card ->
            val createdCard: RepositorySeededCard = createCard(
                appGraph = appGraph,
                workspaceId = workspaceId,
                seedCard = card,
                createdAtMillis = seedBaseTimestampMillis + index.toLong()
            )
            seededCards += createdCard
            card.reviews.sortedBy(RepositorySeedReview::reviewedAtMillis).forEach { review ->
                appGraph.reviewRepository.recordReview(
                    cardId = createdCard.cardId,
                    rating = review.rating,
                    reviewedAtMillis = review.reviewedAtMillis
                )
                reviewCount += 1
            }
            if (card.reviews.isNotEmpty()) {
                stabilizeReviewedCardSnapshotForSync(
                    appGraph = appGraph,
                    seededCard = createdCard,
                    seedCard = card
                )
            }
        }

        return RepositorySeedResult(
            workspaceId = workspaceId,
            cards = seededCards.toList(),
            reviewCount = reviewCount
        )
    }

    private suspend fun createCard(
        appGraph: AppGraph,
        workspaceId: String,
        seedCard: RepositorySeedCard,
        createdAtMillis: Long
    ): RepositorySeededCard {
        val cardId: String = UUID.randomUUID().toString()
        val card = CardEntity(
            cardId = cardId,
            workspaceId = workspaceId,
            frontText = seedCard.frontText,
            backText = seedCard.backText,
            effortLevel = seedCard.effortLevel,
            dueAtMillis = null,
            createdAtMillis = createdAtMillis,
            updatedAtMillis = createdAtMillis,
            reps = 0,
            lapses = 0,
            fsrsCardState = FsrsCardState.NEW,
            fsrsStepIndex = null,
            fsrsStability = null,
            fsrsDifficulty = null,
            fsrsLastReviewedAtMillis = null,
            fsrsScheduledDays = null,
            deletedAtMillis = null
        )
        val normalizedTags: List<String> = appGraph.database.withTransaction {
            appGraph.database.cardDao().insertCard(card = card)
            val resolvedTags: List<String> = replaceCardTagsForSeed(
                appGraph = appGraph,
                workspaceId = workspaceId,
                cardId = cardId,
                tags = seedCard.tags
            )
            appGraph.syncLocalStore.enqueueCardUpsert(card = card, tags = resolvedTags)
            resolvedTags
        }
        return RepositorySeededCard(
            cardId = cardId,
            frontText = seedCard.frontText,
            backText = seedCard.backText,
            tags = normalizedTags
        )
    }

    private suspend fun stabilizeReviewedCardSnapshotForSync(
        appGraph: AppGraph,
        seededCard: RepositorySeededCard,
        seedCard: RepositorySeedCard
    ) {
        delay(timeMillis = 5L)
        appGraph.cardsRepository.updateCard(
            cardId = seededCard.cardId,
            cardDraft = CardDraft(
                frontText = seedCard.frontText,
                backText = seedCard.backText,
                tags = seedCard.tags,
                effortLevel = seedCard.effortLevel
            )
        )
    }

    private suspend fun resolveSeedBaseTimestampMillis(
        appGraph: AppGraph,
        workspaceId: String
    ): Long {
        val existingCards: List<CardWithRelations> = appGraph.database.cardDao().observeCardsWithRelations().first().filter { card ->
            card.card.workspaceId == workspaceId
        }
        val latestExistingTimestampMillis: Long? = existingCards.maxOfOrNull { card ->
            maxOf(card.card.createdAtMillis, card.card.updatedAtMillis)
        }
        return maxOf(
            System.currentTimeMillis(),
            (latestExistingTimestampMillis ?: Long.MIN_VALUE) + 1L
        )
    }

    private suspend fun replaceCardTagsForSeed(
        appGraph: AppGraph,
        workspaceId: String,
        cardId: String,
        tags: List<String>
    ): List<String> {
        val workspaceTags: List<TagEntity> = appGraph.database.tagDao().loadTagsForWorkspace(workspaceId = workspaceId)
        val normalizedTags: List<String> = normalizeTags(
            values = tags,
            referenceTags = workspaceTags.map { tag -> tag.name }
        )
        appGraph.database.tagDao().deleteCardTags(cardId = cardId)

        if (normalizedTags.isEmpty()) {
            appGraph.database.tagDao().deleteUnusedTags(workspaceId = workspaceId)
            return normalizedTags
        }

        val existingTags: List<TagEntity> = appGraph.database.tagDao().loadTagsByNames(
            workspaceId = workspaceId,
            names = normalizedTags
        )
        val missingTags: List<TagEntity> = normalizedTags.filter { normalizedTag ->
            existingTags.none { existingTag ->
                existingTag.name == normalizedTag
            }
        }.map { normalizedTag ->
            TagEntity(
                tagId = UUID.randomUUID().toString(),
                workspaceId = workspaceId,
                name = normalizedTag
            )
        }
        if (missingTags.isNotEmpty()) {
            appGraph.database.tagDao().insertTags(tags = missingTags)
        }

        val resolvedTags: List<TagEntity> = appGraph.database.tagDao().loadTagsByNames(
            workspaceId = workspaceId,
            names = normalizedTags
        )
        appGraph.database.tagDao().insertCardTags(
            cardTags = normalizedTags.map { normalizedTag ->
                val tag: TagEntity = requireNotNull(
                    resolvedTags.firstOrNull { resolvedTag -> resolvedTag.name == normalizedTag }
                ) {
                    "Expected resolved tag '$normalizedTag' while seeding repository card '$cardId' in workspace '$workspaceId'."
                }
                CardTagEntity(
                    cardId = cardId,
                    tagId = tag.tagId
                )
            }
        )
        appGraph.database.tagDao().deleteUnusedTags(workspaceId = workspaceId)
        return normalizedTags
    }

    private suspend fun verifyGuestCloudReadiness(
        appGraph: AppGraph,
        expectedWorkspaceId: String
    ) {
        val cloudSettings = appGraph.cloudAccountRepository.observeCloudSettings().first()
        require(cloudSettings.cloudState == CloudAccountState.GUEST) {
            "Expected guest cloud state after repository seeding, but was '${cloudSettings.cloudState}'."
        }
        require(cloudSettings.activeWorkspaceId == expectedWorkspaceId) {
            "Expected active guest workspace '$expectedWorkspaceId', but was '${cloudSettings.activeWorkspaceId}'."
        }
        require(cloudSettings.linkedWorkspaceId == expectedWorkspaceId) {
            "Expected linked guest workspace '$expectedWorkspaceId', but was '${cloudSettings.linkedWorkspaceId}'."
        }

        val currentWorkspaceId: String = requireCurrentWorkspaceId(appGraph = appGraph)
        require(currentWorkspaceId == expectedWorkspaceId) {
            "Expected current workspace '$expectedWorkspaceId', but found '$currentWorkspaceId'."
        }

        val outboxEntriesCount: Int = appGraph.database.outboxDao().countOutboxEntries()
        require(outboxEntriesCount == 0) {
            "Expected an empty outbox after repository seeding sync, but found $outboxEntriesCount pending entries."
        }

        val syncStatus = appGraph.syncRepository.observeSyncStatus().first()
        require(syncStatus.status == SyncStatus.Idle) {
            "Expected sync to be idle after repository seeding, but was '${syncStatus.status}'."
        }
        require(syncStatus.lastErrorMessage.isEmpty()) {
            "Expected no sync error after repository seeding, but was '${syncStatus.lastErrorMessage}'."
        }

        val syncState = requireNotNull(
            appGraph.database.syncStateDao().loadSyncState(workspaceId = expectedWorkspaceId)
        ) {
            "Expected sync state for seeded guest workspace '$expectedWorkspaceId'."
        }
        require(syncState.lastSuccessfulSyncAtMillis != null) {
            "Expected a successful sync timestamp for seeded guest workspace '$expectedWorkspaceId'."
        }
        require(syncState.lastSyncError == null) {
            "Expected no sync-state error for seeded guest workspace '$expectedWorkspaceId', but was '${syncState.lastSyncError}'."
        }
    }

    private suspend fun requireCurrentWorkspaceId(
        appGraph: AppGraph
    ): String {
        return requireNotNull(appGraph.database.workspaceDao().loadAnyWorkspace()?.workspaceId) {
            "Expected a current workspace before repository seeding."
        }
    }
}

internal fun createRepositorySeedExecutor(): RepositorySeedExecutor {
    val context: Context = ApplicationProvider.getApplicationContext<Context>()
    val application = context as FlashcardsApplication
    return RepositorySeedExecutor(application = application)
}
