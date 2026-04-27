package com.flashcardsopensourceapp.data.local.cloud

import android.util.Log
import androidx.room.withTransaction
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.database.CardEntity
import com.flashcardsopensourceapp.data.local.database.CardTagEntity
import com.flashcardsopensourceapp.data.local.database.DeckEntity
import com.flashcardsopensourceapp.data.local.database.OutboxEntryEntity
import com.flashcardsopensourceapp.data.local.database.ReviewLogEntity
import com.flashcardsopensourceapp.data.local.database.TagEntity
import com.flashcardsopensourceapp.data.local.database.WorkspaceEntity
import com.flashcardsopensourceapp.data.local.database.WorkspaceSchedulerSettingsEntity
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.model.SyncEntityType
import com.flashcardsopensourceapp.data.local.model.encodeSchedulerStepListJson
import com.flashcardsopensourceapp.data.local.model.makeDefaultWorkspaceSchedulerSettings
import com.flashcardsopensourceapp.data.local.repository.LocalProgressCacheStore
import com.flashcardsopensourceapp.data.local.repository.loadCurrentWorkspaceOrNull
import com.flashcardsopensourceapp.data.local.review.ReviewPreferencesStore
import java.util.UUID

private const val cloudMigrationLogTag: String = "FlashcardsCloudMigration"

private data class WorkspaceForkSnapshot(
    val cards: List<CardEntity>,
    val decks: List<DeckEntity>,
    val tags: List<TagEntity>,
    val cardTags: List<CardTagEntity>,
    val reviewLogs: List<ReviewLogEntity>,
    val outboxEntries: List<OutboxEntryEntity>,
    val schedulerSettings: WorkspaceSchedulerSettingsEntity?
)

internal class WorkspaceIdentityLocalStore(
    private val database: AppDatabase,
    private val preferencesStore: CloudPreferencesStore,
    private val reviewPreferencesStore: ReviewPreferencesStore,
    private val localProgressCacheStore: LocalProgressCacheStore,
    private val reviewHistoryChangePublisher: ReviewHistoryChangePublisher
) {
    suspend fun reidentifyWorkspaceForkConflictEntity(
        workspaceId: String,
        entityType: SyncEntityType,
        entityId: String
    ): String {
        return database.withTransaction {
            when (entityType) {
                SyncEntityType.CARD -> reidentifyCardWorkspaceForkConflictInTransaction(
                    workspaceId = workspaceId,
                    cardId = entityId
                )

                SyncEntityType.DECK -> reidentifyDeckWorkspaceForkConflictInTransaction(
                    workspaceId = workspaceId,
                    deckId = entityId
                )

                SyncEntityType.REVIEW_EVENT -> reidentifyReviewEventWorkspaceForkConflictInTransaction(
                    workspaceId = workspaceId,
                    reviewEventId = entityId
                )

                SyncEntityType.WORKSPACE_SCHEDULER_SETTINGS -> throw IllegalArgumentException(
                    "Cannot recover workspace fork conflict for unsupported entity type " +
                        "'${entityType.toRemoteValue()}' in workspace '$workspaceId'."
                )
            }
        }
    }

    suspend fun forkWorkspaceIdentity(
        currentLocalWorkspaceId: String,
        sourceWorkspaceId: String,
        destinationWorkspaceId: String
    ): WorkspaceEntity {
        val destinationWorkspace = requireNotNull(
            database.workspaceDao().loadWorkspaceById(workspaceId = destinationWorkspaceId)
        ) {
            "Cannot fork workspace identity because local workspace '$destinationWorkspaceId' does not exist."
        }
        return forkWorkspaceIdentity(
            currentLocalWorkspaceId = currentLocalWorkspaceId,
            sourceWorkspaceId = sourceWorkspaceId,
            destinationWorkspace = CloudWorkspaceSummary(
                workspaceId = destinationWorkspace.workspaceId,
                name = destinationWorkspace.name,
                createdAtMillis = destinationWorkspace.createdAtMillis,
                isSelected = true
            )
        )
    }

    suspend fun forkWorkspaceIdentity(
        currentLocalWorkspaceId: String,
        sourceWorkspaceId: String,
        destinationWorkspace: CloudWorkspaceSummary
    ): WorkspaceEntity {
        database.withTransaction {
            forkWorkspaceIdentityInTransaction(
                currentLocalWorkspaceId = currentLocalWorkspaceId,
                sourceWorkspaceId = sourceWorkspaceId,
                destinationWorkspace = destinationWorkspace
            )
        }
        return requireNotNull(
            database.workspaceDao().loadWorkspaceById(workspaceId = destinationWorkspace.workspaceId)
        ) {
            "Workspace identity fork did not leave local workspace '${destinationWorkspace.workspaceId}'."
        }
    }

    /**
     * Linked-workspace switching must not publish a new active workspace id
     * until Android has verified that the local shell really points at that
     * workspace. This method is the single local migration entrypoint and
     * returns the actual resulting local workspace row after the migration.
     */
    suspend fun migrateLocalShellToLinkedWorkspace(
        workspace: CloudWorkspaceSummary,
        remoteWorkspaceIsEmpty: Boolean
    ): WorkspaceEntity {
        val currentWorkspaceId = currentWorkspaceIdOrNull()
        val reusesCurrentWorkspace = currentWorkspaceId == workspace.workspaceId
        val didDeleteReviewHistory = reusesCurrentWorkspace.not() &&
            remoteWorkspaceIsEmpty.not() &&
            database.reviewLogDao().countReviewLogs() > 0
        val migrationKind = if (reusesCurrentWorkspace) {
            "reuse_local_shell"
        } else if (remoteWorkspaceIsEmpty) {
            "fork_local_data"
        } else {
            "replace_local_shell"
        }
        logLinkedWorkspaceMigration(
            outcome = "start",
            fromWorkspaceId = currentWorkspaceId,
            toWorkspaceId = workspace.workspaceId,
            remoteWorkspaceIsEmpty = remoteWorkspaceIsEmpty,
            migrationKind = migrationKind
        )
        database.withTransaction {
            if (reusesCurrentWorkspace) {
                refreshCurrentWorkspaceShellInTransaction(workspace = workspace)
            } else if (remoteWorkspaceIsEmpty) {
                val sourceWorkspaceId = requireNotNull(currentWorkspaceId) {
                    "Workspace is required before linking to cloud."
                }
                forkWorkspaceIdentityInTransaction(
                    currentLocalWorkspaceId = sourceWorkspaceId,
                    sourceWorkspaceId = sourceWorkspaceId,
                    destinationWorkspace = workspace
                )
            } else {
                replaceLocalShellForNonEmptyRemoteWorkspaceInTransaction(workspace = workspace)
            }
        }
        if (didDeleteReviewHistory && currentWorkspaceId != null) {
            reviewHistoryChangePublisher.publishReviewHistoryChangedEvent(
                ReviewHistoryChangedEvent(
                    workspaceIds = setOf(currentWorkspaceId),
                    latestReviewedAtMillis = null
                )
            )
        }

        val localWorkspaces = database.workspaceDao().loadWorkspaces()
        check(localWorkspaces.size == 1) {
            "Linked workspace migration must leave exactly one local workspace. " +
                "Local workspaces=${localWorkspaces.map(WorkspaceEntity::workspaceId)}"
        }
        val resultingWorkspace = requireNotNull(
            database.workspaceDao().loadWorkspaceById(workspaceId = workspace.workspaceId)
        ) {
            "Linked workspace migration did not create the expected local workspace '${workspace.workspaceId}'."
        }
        logLinkedWorkspaceMigration(
            outcome = "success",
            fromWorkspaceId = currentWorkspaceId,
            toWorkspaceId = workspace.workspaceId,
            remoteWorkspaceIsEmpty = remoteWorkspaceIsEmpty,
            migrationKind = migrationKind
        )
        return resultingWorkspace
    }

    /**
     * Bound guest upgrade must reuse the existing local guest workspace as-is.
     * Refresh the workspace shell metadata, but do not rewrite identity or
     * clear any sync progress or blocked state.
     */
    suspend fun bindGuestUpgradeToLinkedWorkspace(workspace: CloudWorkspaceSummary): WorkspaceEntity {
        val currentWorkspaceId = requireNotNull(currentWorkspaceIdOrNull()) {
            "Bound guest upgrade requires a current local workspace."
        }
        check(currentWorkspaceId == workspace.workspaceId) {
            "Bound guest upgrade must preserve the existing workspace identity. " +
                "Current='$currentWorkspaceId' Remote='${workspace.workspaceId}'."
        }
        database.withTransaction {
            refreshCurrentWorkspaceShellInTransaction(workspace = workspace)
        }

        val localWorkspaces = database.workspaceDao().loadWorkspaces()
        check(localWorkspaces.size == 1) {
            "Bound guest upgrade must leave exactly one local workspace. " +
                "Local workspaces=${localWorkspaces.map(WorkspaceEntity::workspaceId)}"
        }
        return requireNotNull(
            database.workspaceDao().loadWorkspaceById(workspaceId = workspace.workspaceId)
        ) {
            "Bound guest upgrade did not keep the expected local workspace '${workspace.workspaceId}'."
        }
    }

    private suspend fun currentWorkspaceIdOrNull(): String? {
        return loadCurrentWorkspaceOrNull(
            database = database,
            preferencesStore = preferencesStore
        )?.workspaceId
    }

    private suspend fun replaceLocalShellForNonEmptyRemoteWorkspaceInTransaction(workspace: CloudWorkspaceSummary) {
        val currentLocalWorkspaceId = database.workspaceDao().loadAnyWorkspace()?.workspaceId
        if (currentLocalWorkspaceId != null) {
            database.outboxDao().deleteOutboxEntriesForWorkspace(workspaceId = currentLocalWorkspaceId)
        }
        database.reviewLogDao().deleteAllReviewLogs()
        localProgressCacheStore.clearAllInTransaction()
        database.tagDao().deleteAllCardTags()
        database.cardDao().deleteAllCards()
        database.deckDao().deleteAllDecks()
        database.tagDao().deleteAllTags()
        database.syncStateDao().deleteAllSyncState()
        database.workspaceDao().deleteAllWorkspaces()

        database.workspaceDao().insertWorkspace(
            workspace = WorkspaceEntity(
                workspaceId = workspace.workspaceId,
                name = workspace.name,
                createdAtMillis = workspace.createdAtMillis
            )
        )
        val defaultSettings = makeDefaultWorkspaceSchedulerSettings(
            workspaceId = workspace.workspaceId,
            updatedAtMillis = workspace.createdAtMillis
        )
        database.workspaceSchedulerSettingsDao().insertWorkspaceSchedulerSettings(
            settings = WorkspaceSchedulerSettingsEntity(
                workspaceId = defaultSettings.workspaceId,
                algorithm = defaultSettings.algorithm,
                desiredRetention = defaultSettings.desiredRetention,
                learningStepsMinutesJson = encodeSchedulerStepListJson(defaultSettings.learningStepsMinutes),
                relearningStepsMinutesJson = encodeSchedulerStepListJson(defaultSettings.relearningStepsMinutes),
                maximumIntervalDays = defaultSettings.maximumIntervalDays,
                enableFuzz = defaultSettings.enableFuzz,
                updatedAtMillis = defaultSettings.updatedAtMillis
            )
        )
        database.syncStateDao().insertSyncState(
            syncState = emptySyncStateEntity(workspaceId = workspace.workspaceId)
        )
    }

    private suspend fun refreshCurrentWorkspaceShellInTransaction(workspace: CloudWorkspaceSummary) {
        val currentWorkspace = requireNotNull(database.workspaceDao().loadWorkspaceById(workspaceId = workspace.workspaceId)) {
            "Workspace '${workspace.workspaceId}' is missing locally."
        }
        database.workspaceDao().updateWorkspace(
            workspace = currentWorkspace.copy(
                name = workspace.name,
                createdAtMillis = workspace.createdAtMillis
            )
        )
    }

    private suspend fun forkWorkspaceIdentityInTransaction(
        currentLocalWorkspaceId: String,
        sourceWorkspaceId: String,
        destinationWorkspace: CloudWorkspaceSummary
    ) {
        val currentLocalWorkspace = requireNotNull(
            database.workspaceDao().loadWorkspaceById(workspaceId = currentLocalWorkspaceId)
        ) {
            "Cannot fork workspace identity because current local workspace '$currentLocalWorkspaceId' does not exist."
        }
        val snapshot = loadWorkspaceForkSnapshot(workspaceId = currentLocalWorkspaceId)
        val forkMappings = buildWorkspaceForkIdMappings(
            sourceWorkspaceId = sourceWorkspaceId,
            destinationWorkspaceId = destinationWorkspace.workspaceId,
            cards = snapshot.cards,
            decks = snapshot.decks,
            reviewLogs = snapshot.reviewLogs
        )
        val destinationMatchesCurrentWorkspace = currentLocalWorkspaceId == destinationWorkspace.workspaceId

        if (destinationMatchesCurrentWorkspace) {
            database.workspaceDao().updateWorkspace(
                workspace = currentLocalWorkspace.copy(
                    name = destinationWorkspace.name,
                    createdAtMillis = destinationWorkspace.createdAtMillis
                )
            )
        } else {
            database.syncStateDao().deleteSyncState(workspaceId = destinationWorkspace.workspaceId)
            database.workspaceDao().loadWorkspaceById(workspaceId = destinationWorkspace.workspaceId)?.let {
                database.workspaceDao().deleteWorkspace(workspaceId = destinationWorkspace.workspaceId)
            }
            database.workspaceDao().insertWorkspace(
                workspace = WorkspaceEntity(
                    workspaceId = destinationWorkspace.workspaceId,
                    name = destinationWorkspace.name,
                    createdAtMillis = destinationWorkspace.createdAtMillis
                )
            )
            snapshot.schedulerSettings?.let {
                database.workspaceSchedulerSettingsDao().reassignWorkspace(
                    oldWorkspaceId = currentLocalWorkspaceId,
                    newWorkspaceId = destinationWorkspace.workspaceId
                )
            }
            if (snapshot.tags.isNotEmpty()) {
                database.tagDao().reassignWorkspace(
                    oldWorkspaceId = currentLocalWorkspaceId,
                    newWorkspaceId = destinationWorkspace.workspaceId
                )
            }
            localProgressCacheStore.reassignWorkspaceInTransaction(
                oldWorkspaceId = currentLocalWorkspaceId,
                newWorkspaceId = destinationWorkspace.workspaceId
            )
        }

        if (snapshot.cards.isNotEmpty()) {
            val cardsToInsert = snapshot.cards.mapNotNull { card ->
                val rewrittenCardId = forkMappings.cardIdsBySourceId.requireMappedId(
                    entityType = "card",
                    sourceId = card.cardId
                )
                if (destinationMatchesCurrentWorkspace && rewrittenCardId == card.cardId) {
                    return@mapNotNull null
                }
                card.copy(
                    cardId = rewrittenCardId,
                    workspaceId = destinationWorkspace.workspaceId
                )
            }
            if (cardsToInsert.isNotEmpty()) {
                database.cardDao().insertCards(cards = cardsToInsert)
            }
        }
        if (snapshot.decks.isNotEmpty()) {
            val decksToInsert = snapshot.decks.mapNotNull { deck ->
                val rewrittenDeckId = forkMappings.deckIdsBySourceId.requireMappedId(
                    entityType = "deck",
                    sourceId = deck.deckId
                )
                if (destinationMatchesCurrentWorkspace && rewrittenDeckId == deck.deckId) {
                    return@mapNotNull null
                }
                deck.copy(
                    deckId = rewrittenDeckId,
                    workspaceId = destinationWorkspace.workspaceId
                )
            }
            if (decksToInsert.isNotEmpty()) {
                database.deckDao().insertDecks(decks = decksToInsert)
            }
        }
        if (snapshot.cardTags.isNotEmpty()) {
            val cardTagsToInsert = snapshot.cardTags.mapNotNull { cardTag ->
                val rewrittenCardId = forkMappings.cardIdsBySourceId.requireMappedId(
                    entityType = "card",
                    sourceId = cardTag.cardId
                )
                if (destinationMatchesCurrentWorkspace && rewrittenCardId == cardTag.cardId) {
                    return@mapNotNull null
                }
                CardTagEntity(cardId = rewrittenCardId, tagId = cardTag.tagId)
            }
            if (cardTagsToInsert.isNotEmpty()) {
                database.tagDao().insertCardTags(cardTags = cardTagsToInsert)
            }
        }
        if (snapshot.reviewLogs.isNotEmpty()) {
            val reviewLogsToInsert = snapshot.reviewLogs.mapNotNull { reviewLog ->
                val rewrittenReviewEventId = forkMappings.reviewEventIdsBySourceId.requireMappedId(
                    entityType = "review_event",
                    sourceId = reviewLog.reviewLogId
                )
                if (destinationMatchesCurrentWorkspace && rewrittenReviewEventId == reviewLog.reviewLogId) {
                    return@mapNotNull null
                }
                reviewLog.copy(
                    reviewLogId = rewrittenReviewEventId,
                    workspaceId = destinationWorkspace.workspaceId,
                    cardId = forkMappings.cardIdsBySourceId.requireMappedId(
                        entityType = "card",
                        sourceId = reviewLog.cardId
                    )
                )
            }
            if (reviewLogsToInsert.isNotEmpty()) {
                database.reviewLogDao().insertReviewLogs(reviewLogs = reviewLogsToInsert)
            }
        }
        if (snapshot.outboxEntries.isNotEmpty()) {
            val outboxEntriesToInsert = snapshot.outboxEntries.mapNotNull { entry ->
                val rewrittenEntry = rewriteOutboxEntryForFork(
                    entry = entry,
                    destinationWorkspaceId = destinationWorkspace.workspaceId,
                    forkMappings = forkMappings
                )
                if (
                    destinationMatchesCurrentWorkspace &&
                    rewrittenEntry.workspaceId == entry.workspaceId &&
                    rewrittenEntry.entityId == entry.entityId &&
                    rewrittenEntry.payloadJson == entry.payloadJson
                ) {
                    return@mapNotNull null
                }
                rewrittenEntry
            }
            if (outboxEntriesToInsert.isNotEmpty()) {
                database.outboxDao().insertOutboxEntries(entries = outboxEntriesToInsert)
            }
        }

        if (destinationMatchesCurrentWorkspace) {
            val didRewriteLocalEntityIds: Boolean = hasWorkspaceForkEntityIdRewrites(
                snapshot = snapshot,
                forkMappings = forkMappings
            )
            snapshot.decks
                .filter { deck ->
                    forkMappings.deckIdsBySourceId.requireMappedId(
                        entityType = "deck",
                        sourceId = deck.deckId
                    ) != deck.deckId
                }
                .forEach { deck -> database.deckDao().deleteDeck(deckId = deck.deckId) }
            snapshot.cards
                .filter { card ->
                    forkMappings.cardIdsBySourceId.requireMappedId(
                        entityType = "card",
                        sourceId = card.cardId
                    ) != card.cardId
                }
                .forEach { card -> database.cardDao().deleteCard(cardId = card.cardId) }
            if (didRewriteLocalEntityIds) {
                resetVolatileWorkspaceSelectionsAfterLocalEntityReId(workspaceId = destinationWorkspace.workspaceId)
            }
        } else {
            database.workspaceDao().deleteWorkspace(workspaceId = currentLocalWorkspaceId)
            database.syncStateDao().deleteSyncState(workspaceId = currentLocalWorkspaceId)
        }

        replaceSyncStateWithEmptyProgress(workspaceId = destinationWorkspace.workspaceId)
    }

    private suspend fun loadWorkspaceForkSnapshot(workspaceId: String): WorkspaceForkSnapshot {
        val cards = database.cardDao().loadCards(workspaceId = workspaceId)
        return WorkspaceForkSnapshot(
            cards = cards,
            decks = database.deckDao().loadDecks(workspaceId = workspaceId),
            tags = database.tagDao().loadTags(workspaceId = workspaceId),
            cardTags = database.tagDao().loadCardTags(workspaceId = workspaceId),
            reviewLogs = database.reviewLogDao().loadReviewLogs(workspaceId = workspaceId),
            outboxEntries = database.outboxDao().loadAllOutboxEntries(workspaceId = workspaceId),
            schedulerSettings = database.workspaceSchedulerSettingsDao()
                .loadWorkspaceSchedulerSettings(workspaceId = workspaceId)
        )
    }

    private suspend fun reidentifyCardWorkspaceForkConflictInTransaction(
        workspaceId: String,
        cardId: String
    ): String {
        val card = requireNotNull(database.cardDao().loadCard(cardId = cardId)) {
            "Cannot recover workspace fork conflict for card '$cardId' in workspace '$workspaceId' " +
                "because the local card does not exist."
        }
        require(card.workspaceId == workspaceId) {
            "Cannot recover workspace fork conflict for card '$cardId' in workspace '$workspaceId' " +
                "because the local card belongs to workspace '${card.workspaceId}'."
        }

        val newCardId = generateFreshCardIdInTransaction()
        database.cardDao().insertCard(card = card.copy(cardId = newCardId))
        database.tagDao().reassignCardTagsToCard(oldCardId = cardId, newCardId = newCardId)
        database.reviewLogDao().reassignReviewLogsToCard(
            workspaceId = workspaceId,
            oldCardId = cardId,
            newCardId = newCardId
        )
        rewriteOutboxEntriesForWorkspaceForkEntityReId(
            workspaceId = workspaceId,
            entityType = SyncEntityType.CARD,
            oldEntityId = cardId,
            newEntityId = newCardId
        )
        database.cardDao().deleteCard(cardId = cardId)
        resetVolatileWorkspaceSelectionsAfterLocalEntityReId(workspaceId = workspaceId)
        return newCardId
    }

    private suspend fun reidentifyDeckWorkspaceForkConflictInTransaction(
        workspaceId: String,
        deckId: String
    ): String {
        val deck = requireNotNull(database.deckDao().loadDeck(deckId = deckId)) {
            "Cannot recover workspace fork conflict for deck '$deckId' in workspace '$workspaceId' " +
                "because the local deck does not exist."
        }
        require(deck.workspaceId == workspaceId) {
            "Cannot recover workspace fork conflict for deck '$deckId' in workspace '$workspaceId' " +
                "because the local deck belongs to workspace '${deck.workspaceId}'."
        }

        val newDeckId = generateFreshDeckIdInTransaction()
        database.deckDao().insertDeck(deck = deck.copy(deckId = newDeckId))
        rewriteOutboxEntriesForWorkspaceForkEntityReId(
            workspaceId = workspaceId,
            entityType = SyncEntityType.DECK,
            oldEntityId = deckId,
            newEntityId = newDeckId
        )
        database.deckDao().deleteDeck(deckId = deckId)
        resetVolatileWorkspaceSelectionsAfterLocalEntityReId(workspaceId = workspaceId)
        return newDeckId
    }

    private suspend fun reidentifyReviewEventWorkspaceForkConflictInTransaction(
        workspaceId: String,
        reviewEventId: String
    ): String {
        val reviewLog = requireNotNull(database.reviewLogDao().loadReviewLog(reviewLogId = reviewEventId)) {
            "Cannot recover workspace fork conflict for review_event '$reviewEventId' in workspace '$workspaceId' " +
                "because the local review log does not exist."
        }
        require(reviewLog.workspaceId == workspaceId) {
            "Cannot recover workspace fork conflict for review_event '$reviewEventId' in workspace '$workspaceId' " +
                "because the local review log belongs to workspace '${reviewLog.workspaceId}'."
        }

        val newReviewEventId = generateFreshReviewEventIdInTransaction()
        database.reviewLogDao().insertReviewLogs(
            reviewLogs = listOf(reviewLog.copy(reviewLogId = newReviewEventId))
        )
        rewriteOutboxEntriesForWorkspaceForkEntityReId(
            workspaceId = workspaceId,
            entityType = SyncEntityType.REVIEW_EVENT,
            oldEntityId = reviewEventId,
            newEntityId = newReviewEventId
        )
        database.reviewLogDao().deleteReviewLogs(reviewLogIds = listOf(reviewEventId))
        resetVolatileWorkspaceSelectionsAfterLocalEntityReId(workspaceId = workspaceId)
        return newReviewEventId
    }

    private suspend fun rewriteOutboxEntriesForWorkspaceForkEntityReId(
        workspaceId: String,
        entityType: SyncEntityType,
        oldEntityId: String,
        newEntityId: String
    ) {
        val rewrittenEntries = database.outboxDao()
            .loadAllOutboxEntries(workspaceId = workspaceId)
            .mapNotNull { entry ->
                val rewrittenEntry = rewriteOutboxEntryForWorkspaceForkEntityReId(
                    entry = entry,
                    entityType = entityType,
                    oldEntityId = oldEntityId,
                    newEntityId = newEntityId
                )
                if (rewrittenEntry == entry) {
                    null
                } else {
                    rewrittenEntry
                }
            }
        if (rewrittenEntries.isNotEmpty()) {
            database.outboxDao().insertOutboxEntries(entries = rewrittenEntries)
        }
    }

    private suspend fun generateFreshCardIdInTransaction(): String {
        repeat(10) {
            val candidate = UUID.randomUUID().toString()
            if (database.cardDao().loadCard(cardId = candidate) == null) {
                return candidate
            }
        }
        throw IllegalStateException("Unable to generate a fresh local card id after 10 attempts.")
    }

    private suspend fun generateFreshDeckIdInTransaction(): String {
        repeat(10) {
            val candidate = UUID.randomUUID().toString()
            if (database.deckDao().loadDeck(deckId = candidate) == null) {
                return candidate
            }
        }
        throw IllegalStateException("Unable to generate a fresh local deck id after 10 attempts.")
    }

    private suspend fun generateFreshReviewEventIdInTransaction(): String {
        repeat(10) {
            val candidate = UUID.randomUUID().toString()
            if (database.reviewLogDao().loadReviewLog(reviewLogId = candidate) == null) {
                return candidate
            }
        }
        throw IllegalStateException("Unable to generate a fresh local review_event id after 10 attempts.")
    }

    private suspend fun replaceSyncStateWithEmptyProgress(workspaceId: String) {
        database.syncStateDao().insertSyncState(
            syncState = emptySyncStateEntity(workspaceId = workspaceId)
        )
    }

    /**
     * Local re-id recovery is rare; reset volatile persisted selections instead
     * of preserving state that may still point at old entity ids.
     */
    private fun resetVolatileWorkspaceSelectionsAfterLocalEntityReId(workspaceId: String) {
        reviewPreferencesStore.clearSelectedReviewFilter(workspaceId = workspaceId)
    }
}

private fun hasWorkspaceForkEntityIdRewrites(
    snapshot: WorkspaceForkSnapshot,
    forkMappings: WorkspaceForkIdMappings
): Boolean {
    return snapshot.cards.any { card ->
        forkMappings.cardIdsBySourceId.requireMappedId(
            entityType = "card",
            sourceId = card.cardId
        ) != card.cardId
    } || snapshot.decks.any { deck ->
        forkMappings.deckIdsBySourceId.requireMappedId(
            entityType = "deck",
            sourceId = deck.deckId
        ) != deck.deckId
    } || snapshot.reviewLogs.any { reviewLog ->
        forkMappings.reviewEventIdsBySourceId.requireMappedId(
            entityType = "review_event",
            sourceId = reviewLog.reviewLogId
        ) != reviewLog.reviewLogId
    }
}

private fun logLinkedWorkspaceMigration(
    outcome: String,
    fromWorkspaceId: String?,
    toWorkspaceId: String,
    remoteWorkspaceIsEmpty: Boolean,
    migrationKind: String
) {
    Log.i(
        cloudMigrationLogTag,
        "outcome=$outcome fromWorkspaceId=${fromWorkspaceId ?: "-"} " +
            "toWorkspaceId=$toWorkspaceId remoteWorkspaceIsEmpty=$remoteWorkspaceIsEmpty " +
            "migrationKind=$migrationKind"
    )
}
