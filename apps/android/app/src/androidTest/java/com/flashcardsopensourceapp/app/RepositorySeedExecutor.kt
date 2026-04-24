package com.flashcardsopensourceapp.app

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.data.local.database.CardWithRelations
import com.flashcardsopensourceapp.data.local.model.CardDraft
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.ReviewRating
import com.flashcardsopensourceapp.data.local.model.SyncStatus
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first

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

        seedScenario.cards.forEach { card ->
            val createdCard: RepositorySeededCard = createCard(
                appGraph = appGraph,
                workspaceId = workspaceId,
                seedCard = card
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
        seedCard: RepositorySeedCard
    ): RepositorySeededCard {
        val existingCardIds: Set<String> = appGraph.database.cardDao().observeCardsWithRelations().first().map { card ->
            card.card.cardId
        }.toSet()
        appGraph.cardsRepository.createCard(
            cardDraft = CardDraft(
                frontText = seedCard.frontText,
                backText = seedCard.backText,
                tags = seedCard.tags,
                effortLevel = seedCard.effortLevel
            )
        )
        val createdCard: CardWithRelations = resolveCreatedCard(
            appGraph = appGraph,
            existingCardIds = existingCardIds,
            expectedWorkspaceId = workspaceId
        )
        return RepositorySeededCard(
            cardId = createdCard.card.cardId,
            frontText = createdCard.card.frontText,
            backText = createdCard.card.backText,
            tags = createdCard.tags.map { tag -> tag.name }
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

    private suspend fun resolveCreatedCard(
        appGraph: AppGraph,
        existingCardIds: Set<String>,
        expectedWorkspaceId: String
    ): CardWithRelations {
        val newCards: List<CardWithRelations> = appGraph.database.cardDao().observeCardsWithRelations().first().filter { card ->
            existingCardIds.contains(card.card.cardId).not()
        }
        require(newCards.size == 1) {
            "Expected exactly one created card in workspace '$expectedWorkspaceId', but found ${newCards.size} new cards."
        }
        val createdCard: CardWithRelations = newCards.single()
        require(createdCard.card.workspaceId == expectedWorkspaceId) {
            "Expected seeded card workspace '$expectedWorkspaceId', but created '${createdCard.card.workspaceId}'."
        }
        return createdCard
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
