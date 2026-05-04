package com.flashcardsopensourceapp.data.local.cloudidentity

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.flashcardsopensourceapp.data.local.ai.AiChatHistoryStore
import com.flashcardsopensourceapp.data.local.ai.AiChatLiveRemoteService
import com.flashcardsopensourceapp.data.local.ai.AiChatPreferencesStore
import com.flashcardsopensourceapp.data.local.ai.AiChatRemoteService
import com.flashcardsopensourceapp.data.local.ai.AiCoroutineDispatchers
import com.flashcardsopensourceapp.data.local.ai.GuestAiSessionStore
import com.flashcardsopensourceapp.data.local.bootstrap.ensureLocalWorkspaceShell
import com.flashcardsopensourceapp.data.local.bootstrap.localWorkspaceName
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.cloud.SyncLocalStore
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.database.CardEntity
import com.flashcardsopensourceapp.data.local.database.ReviewLogEntity
import com.flashcardsopensourceapp.data.local.database.WorkspaceEntity
import com.flashcardsopensourceapp.data.local.database.WorkspaceSchedulerSettingsEntity
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.FsrsCardState
import com.flashcardsopensourceapp.data.local.model.ReviewRating
import com.flashcardsopensourceapp.data.local.model.encodeSchedulerStepListJson
import com.flashcardsopensourceapp.data.local.model.makeDefaultWorkspaceSchedulerSettings
import com.flashcardsopensourceapp.data.local.repository.CloudGuestSessionCoordinator
import com.flashcardsopensourceapp.data.local.repository.CloudIdentityResetCoordinator
import com.flashcardsopensourceapp.data.local.repository.CloudOperationCoordinator
import com.flashcardsopensourceapp.data.local.repository.LocalCloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.LocalProgressCacheStore
import com.flashcardsopensourceapp.data.local.repository.LocalSyncRepository
import com.flashcardsopensourceapp.data.local.repository.SystemTimeProvider
import com.flashcardsopensourceapp.data.local.review.ReviewPreferencesStore
import com.flashcardsopensourceapp.data.local.review.SharedPreferencesReviewPreferencesStore
import kotlinx.coroutines.Dispatchers

internal class CloudIdentityTestEnvironment private constructor(
    val context: Context,
    val database: AppDatabase,
    val cloudPreferencesStore: CloudPreferencesStore,
    val reviewPreferencesStore: ReviewPreferencesStore,
    val aiChatPreferencesStore: AiChatPreferencesStore,
    val aiChatHistoryStore: AiChatHistoryStore,
    val guestAiSessionStore: GuestAiSessionStore,
    val operationCoordinator: CloudOperationCoordinator,
    val resetCoordinator: CloudIdentityResetCoordinator,
    val aiChatRemoteService: AiChatRemoteService
) {
    private val appVersion: String = "1.2.2"

    companion object {
        suspend fun create(): CloudIdentityTestEnvironment {
            val context = ApplicationProvider.getApplicationContext<Context>()
            clearCloudAndAiPreferences(context = context)
            val database = Room.inMemoryDatabaseBuilder(
                context = context,
                klass = AppDatabase::class.java
            ).allowMainThreadQueries().build()
            val cloudPreferencesStore = CloudPreferencesStore(context = context, database = database)
            val reviewPreferencesStore = SharedPreferencesReviewPreferencesStore(context = context)
            val aiChatPreferencesStore = AiChatPreferencesStore(context = context)
            val aiChatHistoryStore = AiChatHistoryStore(context = context)
            val guestAiSessionStore = GuestAiSessionStore(context = context)
            val operationCoordinator = CloudOperationCoordinator()
            val dispatchers = AiCoroutineDispatchers(io = Dispatchers.IO)
            val aiChatRemoteService = AiChatRemoteService(
                dispatchers = dispatchers,
                liveRemoteService = AiChatLiveRemoteService(dispatchers = dispatchers)
            )
            ensureLocalWorkspaceShell(
                database = database,
                currentTimeMillis = 100L
            )
            cloudPreferencesStore.hydrateCloudSettingsFromDatabase()
            val resetCoordinator = CloudIdentityResetCoordinator(
                database = database,
                cloudPreferencesStore = cloudPreferencesStore,
                aiChatPreferencesStore = aiChatPreferencesStore,
                aiChatHistoryStore = aiChatHistoryStore,
                guestAiSessionStore = guestAiSessionStore
            )
            return CloudIdentityTestEnvironment(
                context = context,
                database = database,
                cloudPreferencesStore = cloudPreferencesStore,
                reviewPreferencesStore = reviewPreferencesStore,
                aiChatPreferencesStore = aiChatPreferencesStore,
                aiChatHistoryStore = aiChatHistoryStore,
                guestAiSessionStore = guestAiSessionStore,
                operationCoordinator = operationCoordinator,
                resetCoordinator = resetCoordinator,
                aiChatRemoteService = aiChatRemoteService
            )
        }
    }

    fun close() {
        database.close()
        clearCloudAndAiPreferences(context = context)
    }

    fun createCloudAccountRepository(remoteGateway: CloudRemoteGateway): LocalCloudAccountRepository {
        return LocalCloudAccountRepository(
            database = database,
            preferencesStore = cloudPreferencesStore,
            remoteService = remoteGateway,
            syncLocalStore = createSyncLocalStore(),
            operationCoordinator = operationCoordinator,
            resetCoordinator = resetCoordinator,
            guestSessionStore = guestAiSessionStore,
            appVersion = appVersion
        )
    }

    suspend fun createRestartedCloudAccountRuntime(
        remoteGateway: CloudRemoteGateway
    ): RestartedCloudAccountRuntime {
        val restartedCloudPreferencesStore = CloudPreferencesStore(context = context, database = database)
        restartedCloudPreferencesStore.hydrateCloudSettingsFromDatabase()
        val restartedAiChatPreferencesStore = AiChatPreferencesStore(context = context)
        val restartedAiChatHistoryStore = AiChatHistoryStore(context = context)
        val restartedGuestAiSessionStore = GuestAiSessionStore(context = context)
        val restartedOperationCoordinator = CloudOperationCoordinator()
        val restartedResetCoordinator = CloudIdentityResetCoordinator(
            database = database,
            cloudPreferencesStore = restartedCloudPreferencesStore,
            aiChatPreferencesStore = restartedAiChatPreferencesStore,
            aiChatHistoryStore = restartedAiChatHistoryStore,
            guestAiSessionStore = restartedGuestAiSessionStore
        )
        val restartedSyncLocalStore = SyncLocalStore(
            database = database,
            preferencesStore = restartedCloudPreferencesStore,
            reviewPreferencesStore = reviewPreferencesStore,
            localProgressCacheStore = LocalProgressCacheStore(
                database = database,
                timeProvider = SystemTimeProvider
            ),
            timeProvider = SystemTimeProvider
        )
        val repository = LocalCloudAccountRepository(
            database = database,
            preferencesStore = restartedCloudPreferencesStore,
            remoteService = remoteGateway,
            syncLocalStore = restartedSyncLocalStore,
            operationCoordinator = restartedOperationCoordinator,
            resetCoordinator = restartedResetCoordinator,
            guestSessionStore = restartedGuestAiSessionStore,
            appVersion = appVersion
        )
        return RestartedCloudAccountRuntime(
            repository = repository,
            cloudPreferencesStore = restartedCloudPreferencesStore,
            guestAiSessionStore = restartedGuestAiSessionStore,
            syncLocalStore = restartedSyncLocalStore
        )
    }

    suspend fun createRestartedCloudGuestSessionRuntime(
        remoteGateway: CloudRemoteGateway
    ): RestartedCloudGuestSessionRuntime {
        val restartedCloudPreferencesStore = CloudPreferencesStore(context = context, database = database)
        restartedCloudPreferencesStore.hydrateCloudSettingsFromDatabase()
        val restartedAiChatPreferencesStore = AiChatPreferencesStore(context = context)
        val restartedAiChatHistoryStore = AiChatHistoryStore(context = context)
        val restartedGuestAiSessionStore = GuestAiSessionStore(context = context)
        val restartedOperationCoordinator = CloudOperationCoordinator()
        val restartedResetCoordinator = CloudIdentityResetCoordinator(
            database = database,
            cloudPreferencesStore = restartedCloudPreferencesStore,
            aiChatPreferencesStore = restartedAiChatPreferencesStore,
            aiChatHistoryStore = restartedAiChatHistoryStore,
            guestAiSessionStore = restartedGuestAiSessionStore
        )
        val restartedSyncLocalStore = SyncLocalStore(
            database = database,
            preferencesStore = restartedCloudPreferencesStore,
            reviewPreferencesStore = reviewPreferencesStore,
            localProgressCacheStore = LocalProgressCacheStore(
                database = database,
                timeProvider = SystemTimeProvider
            ),
            timeProvider = SystemTimeProvider
        )
        val coordinator = CloudGuestSessionCoordinator(
            database = database,
            preferencesStore = restartedCloudPreferencesStore,
            remoteService = remoteGateway,
            syncLocalStore = restartedSyncLocalStore,
            operationCoordinator = restartedOperationCoordinator,
            resetCoordinator = restartedResetCoordinator,
            guestSessionStore = restartedGuestAiSessionStore,
            aiChatRemoteService = aiChatRemoteService,
            appVersion = appVersion
        )
        return RestartedCloudGuestSessionRuntime(
            cloudPreferencesStore = restartedCloudPreferencesStore,
            guestAiSessionStore = restartedGuestAiSessionStore,
            cloudGuestSessionCoordinator = coordinator
        )
    }

    fun createSyncRepository(remoteGateway: CloudRemoteGateway): LocalSyncRepository {
        return LocalSyncRepository(
            database = database,
            preferencesStore = cloudPreferencesStore,
            remoteService = remoteGateway,
            syncLocalStore = createSyncLocalStore(),
            operationCoordinator = operationCoordinator,
            resetCoordinator = resetCoordinator,
            guestSessionStore = guestAiSessionStore,
            cloudGuestSessionCoordinator = createCloudGuestSessionCoordinator(remoteGateway = remoteGateway),
            appVersion = appVersion
        )
    }

    fun createCloudGuestSessionCoordinator(remoteGateway: CloudRemoteGateway): CloudGuestSessionCoordinator {
        return CloudGuestSessionCoordinator(
            database = database,
            preferencesStore = cloudPreferencesStore,
            remoteService = remoteGateway,
            syncLocalStore = createSyncLocalStore(),
            operationCoordinator = operationCoordinator,
            resetCoordinator = resetCoordinator,
            guestSessionStore = guestAiSessionStore,
            aiChatRemoteService = aiChatRemoteService,
            appVersion = appVersion
        )
    }

    suspend fun prepareLinkedCloudIdentity(localWorkspaceId: String) {
        cloudPreferencesStore.saveCredentials(
            credentials = createStoredCloudCredentials(idTokenExpiresAtMillis = Long.MAX_VALUE)
        )
        cloudPreferencesStore.updateCloudSettings(
            cloudState = com.flashcardsopensourceapp.data.local.model.CloudAccountState.LINKED,
            linkedUserId = "user-1",
            linkedWorkspaceId = localWorkspaceId,
            linkedEmail = "user@example.com",
            activeWorkspaceId = localWorkspaceId
        )
    }

    suspend fun requireLocalWorkspaceId(): String {
        return requireNotNull(database.workspaceDao().loadAnyWorkspace()?.workspaceId) {
            "Expected a local workspace."
        }
    }

    suspend fun createWorkspaceShell(
        workspaceId: String,
        createdAtMillis: Long
    ) {
        database.workspaceDao().insertWorkspace(
            WorkspaceEntity(
                workspaceId = workspaceId,
                name = localWorkspaceName,
                createdAtMillis = createdAtMillis
            )
        )
        val schedulerSettings = makeDefaultWorkspaceSchedulerSettings(
            workspaceId = workspaceId,
            updatedAtMillis = createdAtMillis
        )
        database.workspaceSchedulerSettingsDao().insertWorkspaceSchedulerSettings(
            WorkspaceSchedulerSettingsEntity(
                workspaceId = schedulerSettings.workspaceId,
                algorithm = schedulerSettings.algorithm,
                desiredRetention = schedulerSettings.desiredRetention,
                learningStepsMinutesJson = encodeSchedulerStepListJson(schedulerSettings.learningStepsMinutes),
                relearningStepsMinutesJson = encodeSchedulerStepListJson(schedulerSettings.relearningStepsMinutes),
                maximumIntervalDays = schedulerSettings.maximumIntervalDays,
                enableFuzz = schedulerSettings.enableFuzz,
                updatedAtMillis = schedulerSettings.updatedAtMillis
            )
        )
        database.syncStateDao().insertSyncState(
            syncStateEntityWithEmptyProgress(workspaceId = workspaceId)
        )
    }

    suspend fun seedWorkspaceData(workspaceId: String): String {
        val cardId = "card-$workspaceId"
        database.cardDao().insertCard(
            CardEntity(
                cardId = cardId,
                workspaceId = workspaceId,
                frontText = "Question",
                backText = "Answer",
                effortLevel = EffortLevel.MEDIUM,
                dueAtMillis = null,
                createdAtMillis = 100L,
                updatedAtMillis = 100L,
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
        )
        database.reviewLogDao().insertReviewLog(
            ReviewLogEntity(
                reviewLogId = "review-$workspaceId",
                workspaceId = workspaceId,
                cardId = cardId,
                replicaId = "replica-$workspaceId",
                clientEventId = "event-$workspaceId",
                rating = ReviewRating.GOOD,
                reviewedAtMillis = 200L,
                reviewedAtServerIso = "2026-04-02T15:50:57.000Z"
            )
        )
        return cardId
    }

    fun createSyncLocalStore(): SyncLocalStore {
        return SyncLocalStore(
            database = database,
            preferencesStore = cloudPreferencesStore,
            reviewPreferencesStore = reviewPreferencesStore,
            localProgressCacheStore = LocalProgressCacheStore(
                database = database,
                timeProvider = SystemTimeProvider
            ),
            timeProvider = SystemTimeProvider
        )
    }
}

internal data class RestartedCloudAccountRuntime(
    val repository: LocalCloudAccountRepository,
    val cloudPreferencesStore: CloudPreferencesStore,
    val guestAiSessionStore: GuestAiSessionStore,
    val syncLocalStore: SyncLocalStore
)

internal data class RestartedCloudGuestSessionRuntime(
    val cloudPreferencesStore: CloudPreferencesStore,
    val guestAiSessionStore: GuestAiSessionStore,
    val cloudGuestSessionCoordinator: CloudGuestSessionCoordinator
)
