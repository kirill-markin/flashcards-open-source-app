package com.flashcardsopensourceapp.data.local.cloud

import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.database.CardEntity
import com.flashcardsopensourceapp.data.local.database.DeckEntity
import com.flashcardsopensourceapp.data.local.database.ReviewLogEntity
import com.flashcardsopensourceapp.data.local.database.SyncStateEntity
import com.flashcardsopensourceapp.data.local.database.WorkspaceEntity
import com.flashcardsopensourceapp.data.local.database.WorkspaceSchedulerSettingsEntity
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.model.PersistedOutboxEntry
import com.flashcardsopensourceapp.data.local.model.ReviewEventSyncPayload
import com.flashcardsopensourceapp.data.local.model.SyncEntityType
import com.flashcardsopensourceapp.data.local.repository.LocalProgressCacheStore
import com.flashcardsopensourceapp.data.local.repository.TimeProvider
import com.flashcardsopensourceapp.data.local.review.ReviewPreferencesStore
import kotlinx.coroutines.flow.Flow
import org.json.JSONArray

/*
 Keep Android bootstrap and sync application aligned with:
 - apps/ios/Flashcards/Flashcards/CloudSync/CloudSyncRunner.swift
 - apps/ios/Flashcards/Flashcards/LocalDatabase+Sync.swift
 */

class SyncLocalStore(
    database: AppDatabase,
    preferencesStore: CloudPreferencesStore,
    reviewPreferencesStore: ReviewPreferencesStore,
    localProgressCacheStore: LocalProgressCacheStore,
    timeProvider: TimeProvider
) {
    private val reviewHistoryChangePublisher = ReviewHistoryChangePublisher()
    private val outboxLocalStore = SyncOutboxLocalStore(
        database = database,
        preferencesStore = preferencesStore,
        timeProvider = timeProvider
    )
    private val syncStateLocalStore = SyncStateLocalStore(database = database)
    private val hotStateLocalStore = SyncHotStateLocalStore(database = database)
    private val bootstrapLocalStore = SyncBootstrapLocalStore(
        database = database,
        outboxLocalStore = outboxLocalStore,
        hotStateLocalStore = hotStateLocalStore
    )
    private val reviewHistoryLocalStore = SyncReviewHistoryLocalStore(
        database = database,
        localProgressCacheStore = localProgressCacheStore,
        reviewHistoryChangePublisher = reviewHistoryChangePublisher
    )
    private val workspaceIdentityLocalStore = WorkspaceIdentityLocalStore(
        database = database,
        preferencesStore = preferencesStore,
        reviewPreferencesStore = reviewPreferencesStore,
        localProgressCacheStore = localProgressCacheStore,
        reviewHistoryChangePublisher = reviewHistoryChangePublisher
    )

    fun observeReviewHistoryChangedEvents(): Flow<ReviewHistoryChangedEvent> {
        return reviewHistoryChangePublisher.observeReviewHistoryChangedEvents()
    }

    fun beginReviewHistoryChangeBatch() {
        reviewHistoryChangePublisher.beginReviewHistoryChangeBatch()
    }

    fun flushReviewHistoryChangeBatch() {
        reviewHistoryChangePublisher.flushReviewHistoryChangeBatch()
    }

    fun discardReviewHistoryChangeBatch() {
        reviewHistoryChangePublisher.discardReviewHistoryChangeBatch()
    }

    suspend fun enqueueCardUpsert(card: CardEntity, tags: List<String>, affectsReviewSchedule: Boolean) {
        outboxLocalStore.enqueueCardUpsert(
            card = card,
            tags = tags,
            affectsReviewSchedule = affectsReviewSchedule
        )
    }

    suspend fun enqueueDeckUpsert(deck: DeckEntity) {
        outboxLocalStore.enqueueDeckUpsert(deck = deck)
    }

    suspend fun enqueueWorkspaceSchedulerSettingsUpsert(settings: WorkspaceSchedulerSettingsEntity) {
        outboxLocalStore.enqueueWorkspaceSchedulerSettingsUpsert(settings = settings)
    }

    suspend fun enqueueReviewEventAppend(reviewLog: ReviewLogEntity) {
        outboxLocalStore.enqueueReviewEventAppend(reviewLog = reviewLog)
    }

    suspend fun loadOutboxEntries(workspaceId: String): List<PersistedOutboxEntry> {
        return outboxLocalStore.loadOutboxEntries(workspaceId = workspaceId)
    }

    suspend fun loadPendingReviewEventPayloads(workspaceId: String): List<ReviewEventSyncPayload> {
        return outboxLocalStore.loadPendingReviewEventPayloads(workspaceId = workspaceId)
    }

    suspend fun deleteOutboxEntries(operationIds: List<String>) {
        outboxLocalStore.deleteOutboxEntries(operationIds = operationIds)
    }

    suspend fun markOutboxEntriesFailed(operationIds: List<String>, errorMessage: String) {
        outboxLocalStore.markOutboxEntriesFailed(operationIds = operationIds, errorMessage = errorMessage)
    }

    suspend fun countOutboxEntries(workspaceId: String): Int {
        return outboxLocalStore.countOutboxEntries(workspaceId = workspaceId)
    }

    suspend fun ensureSyncState(workspaceId: String): SyncStateEntity {
        return syncStateLocalStore.ensureSyncState(workspaceId = workspaceId)
    }

    suspend fun loadBlockedSyncMessage(workspaceId: String, installationId: String): String? {
        return syncStateLocalStore.loadBlockedSyncMessage(
            workspaceId = workspaceId,
            installationId = installationId
        )
    }

    suspend fun recordSyncAttempt(workspaceId: String) {
        syncStateLocalStore.recordSyncAttempt(workspaceId = workspaceId)
    }

    suspend fun markSyncFailure(workspaceId: String, errorMessage: String) {
        syncStateLocalStore.markSyncFailure(workspaceId = workspaceId, errorMessage = errorMessage)
    }

    suspend fun markSyncBlocked(
        workspaceId: String,
        installationId: String,
        errorMessage: String
    ) {
        syncStateLocalStore.markSyncBlocked(
            workspaceId = workspaceId,
            installationId = installationId,
            errorMessage = errorMessage
        )
    }

    suspend fun markReviewHistoryImportPending(workspaceId: String) {
        syncStateLocalStore.markReviewHistoryImportPending(workspaceId = workspaceId)
    }

    suspend fun markReviewHistoryImportComplete(workspaceId: String) {
        syncStateLocalStore.markReviewHistoryImportComplete(workspaceId = workspaceId)
    }

    suspend fun markSyncSuccess(
        workspaceId: String,
        lastSyncCursor: String,
        lastReviewSequenceId: Long,
        hasHydratedHotState: Boolean,
        hasHydratedReviewHistory: Boolean
    ) {
        syncStateLocalStore.markSyncSuccess(
            workspaceId = workspaceId,
            lastSyncCursor = lastSyncCursor,
            lastReviewSequenceId = lastReviewSequenceId,
            hasHydratedHotState = hasHydratedHotState,
            hasHydratedReviewHistory = hasHydratedReviewHistory
        )
    }

    suspend fun reidentifyWorkspaceForkConflictEntity(
        workspaceId: String,
        entityType: SyncEntityType,
        entityId: String
    ): String {
        return workspaceIdentityLocalStore.reidentifyWorkspaceForkConflictEntity(
            workspaceId = workspaceId,
            entityType = entityType,
            entityId = entityId
        )
    }

    suspend fun forkWorkspaceIdentity(
        currentLocalWorkspaceId: String,
        sourceWorkspaceId: String,
        destinationWorkspaceId: String
    ): WorkspaceEntity {
        return workspaceIdentityLocalStore.forkWorkspaceIdentity(
            currentLocalWorkspaceId = currentLocalWorkspaceId,
            sourceWorkspaceId = sourceWorkspaceId,
            destinationWorkspaceId = destinationWorkspaceId
        )
    }

    suspend fun forkWorkspaceIdentity(
        currentLocalWorkspaceId: String,
        sourceWorkspaceId: String,
        destinationWorkspace: CloudWorkspaceSummary
    ): WorkspaceEntity {
        return workspaceIdentityLocalStore.forkWorkspaceIdentity(
            currentLocalWorkspaceId = currentLocalWorkspaceId,
            sourceWorkspaceId = sourceWorkspaceId,
            destinationWorkspace = destinationWorkspace
        )
    }

    suspend fun migrateLocalShellToLinkedWorkspace(
        workspace: CloudWorkspaceSummary,
        remoteWorkspaceIsEmpty: Boolean
    ): WorkspaceEntity {
        return workspaceIdentityLocalStore.migrateLocalShellToLinkedWorkspace(
            workspace = workspace,
            remoteWorkspaceIsEmpty = remoteWorkspaceIsEmpty
        )
    }

    suspend fun bindGuestUpgradeToLinkedWorkspace(workspace: CloudWorkspaceSummary): WorkspaceEntity {
        return workspaceIdentityLocalStore.bindGuestUpgradeToLinkedWorkspace(workspace = workspace)
    }

    suspend fun buildBootstrapEntries(workspaceId: String): JSONArray {
        return bootstrapLocalStore.buildBootstrapEntries(workspaceId = workspaceId)
    }

    suspend fun buildReviewHistoryImportEvents(workspaceId: String): JSONArray {
        return bootstrapLocalStore.buildReviewHistoryImportEvents(workspaceId = workspaceId)
    }

    internal suspend fun applyBootstrapEntries(workspaceId: String, entries: List<RemoteBootstrapEntry>): BootstrapApplyResult {
        return bootstrapLocalStore.applyBootstrapEntries(workspaceId = workspaceId, entries = entries)
    }

    internal suspend fun hasPendingLocalHotRowsForAppliedBootstrapKeys(
        workspaceId: String,
        appliedHotEntityKeys: Set<PendingLocalHotEntityKey>
    ): Boolean {
        return bootstrapLocalStore.hasPendingLocalHotRowsForAppliedBootstrapKeys(
            workspaceId = workspaceId,
            appliedHotEntityKeys = appliedHotEntityKeys
        )
    }

    suspend fun applyPullChanges(workspaceId: String, changes: List<RemoteSyncChange>) {
        hotStateLocalStore.applyPullChanges(workspaceId = workspaceId, changes = changes)
    }

    suspend fun applyReviewHistory(events: List<RemoteReviewHistoryEvent>) {
        reviewHistoryLocalStore.applyReviewHistory(events = events)
    }
}
