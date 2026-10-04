package com.flashcardsopensourceapp.data.local.repository.cloudsync.guest

import com.flashcardsopensourceapp.data.local.database.core.AppDatabase
import com.flashcardsopensourceapp.data.local.database.entities.CardEntity
import com.flashcardsopensourceapp.data.local.database.entities.TagEntity
import com.flashcardsopensourceapp.data.local.model.cards.CardDraft
import com.flashcardsopensourceapp.data.local.repository.CardsRepository
import kotlinx.coroutines.flow.first

/**
 * Taken from the guest workspace before a merge guest upgrade discards it. Guest upgrade keeps
 * card ids, so a linked-workspace card whose id is not in [guestCardIds] belongs to the account.
 */
internal data class GuestUpgradeDemoCardCapture(
    val guestCardIds: Set<String>,
    val untouchedDemoCardIds: List<String>
)

/**
 * An untouched demo card is an active card whose text equals [demoCardDraft] and whose tags are
 * exactly its tags. Review history does not make a card touched.
 */
internal suspend fun captureGuestUpgradeDemoCards(
    database: AppDatabase,
    guestWorkspaceId: String,
    demoCardDraft: CardDraft
): GuestUpgradeDemoCardCapture {
    val guestCards: List<CardEntity> = database.cardDao().loadCards(workspaceId = guestWorkspaceId)
    val untouchedDemoCardIds: List<String> = guestCards.filter { card ->
        card.deletedAtMillis == null &&
            card.frontText == demoCardDraft.frontText &&
            card.backText == demoCardDraft.backText &&
            loadCardTagNames(database = database, cardId = card.cardId) == demoCardDraft.tags.toSet()
    }.map(CardEntity::cardId)
    return GuestUpgradeDemoCardCapture(
        guestCardIds = guestCards.map(CardEntity::cardId).toSet(),
        untouchedDemoCardIds = untouchedDemoCardIds
    )
}

/**
 * Deletes the captured demo cards only when the linked workspace holds a card, tombstones
 * included, that did not come from the guest, i.e. the account already had cards.
 */
internal suspend fun deleteGuestDemoCardsAfterMergeUpgrade(
    database: AppDatabase,
    cardsRepository: CardsRepository,
    linkedWorkspaceId: String,
    capture: GuestUpgradeDemoCardCapture
) {
    if (capture.untouchedDemoCardIds.isEmpty()) {
        return
    }
    val accountHadCards: Boolean = database.cardDao().loadCards(workspaceId = linkedWorkspaceId).any { card ->
        card.cardId !in capture.guestCardIds
    }
    if (accountHadCards.not()) {
        return
    }
    capture.untouchedDemoCardIds.forEach { cardId ->
        cardsRepository.deleteCard(cardId = cardId)
    }
}

private suspend fun loadCardTagNames(database: AppDatabase, cardId: String): Set<String> {
    return requireNotNull(database.cardDao().observeCardWithRelations(cardId = cardId).first()) {
        "Cannot load relations for guest card: $cardId"
    }.tags.map(TagEntity::name).toSet()
}
