package com.flashcardsopensourceapp.data.local.repository

import com.flashcardsopensourceapp.data.local.model.AppMetadataSummary
import com.flashcardsopensourceapp.data.local.model.CardDraft
import com.flashcardsopensourceapp.data.local.model.CardSummary
import com.flashcardsopensourceapp.data.local.model.DeckSummary
import com.flashcardsopensourceapp.data.local.model.ReviewCard
import com.flashcardsopensourceapp.data.local.model.ReviewRating
import com.flashcardsopensourceapp.data.local.model.WorkspaceSummary
import kotlinx.coroutines.flow.Flow

interface CardsRepository {
    fun observeCards(): Flow<List<CardSummary>>
    fun observeCard(cardId: String): Flow<CardSummary?>
    suspend fun createCard(cardDraft: CardDraft)
    suspend fun updateCard(cardId: String, cardDraft: CardDraft)
    suspend fun deleteCard(cardId: String)
}

interface DecksRepository {
    fun observeDecks(): Flow<List<DeckSummary>>
}

interface WorkspaceRepository {
    fun observeWorkspace(): Flow<WorkspaceSummary?>
    fun observeAppMetadata(): Flow<AppMetadataSummary>
}

interface ReviewRepository {
    fun observeReviewCards(): Flow<List<ReviewCard>>
    suspend fun recordReview(cardId: String, rating: ReviewRating, reviewedAtMillis: Long)
}

interface SyncRepository {
    suspend fun scheduleDraftSync()
}
