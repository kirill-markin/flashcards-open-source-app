package com.flashcardsopensourceapp.data.local

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
import com.flashcardsopensourceapp.data.local.cloud.RemoteBootstrapPullResponse
import com.flashcardsopensourceapp.data.local.cloud.RemoteBootstrapPushResponse
import com.flashcardsopensourceapp.data.local.cloud.RemotePullResponse
import com.flashcardsopensourceapp.data.local.cloud.RemotePushResponse
import com.flashcardsopensourceapp.data.local.cloud.RemoteReviewHistoryImportResponse
import com.flashcardsopensourceapp.data.local.cloud.RemoteReviewHistoryPullResponse
import com.flashcardsopensourceapp.data.local.cloud.SyncLocalStore
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.database.CardEntity
import com.flashcardsopensourceapp.data.local.database.ReviewLogEntity
import com.flashcardsopensourceapp.data.local.database.SyncStateEntity
import com.flashcardsopensourceapp.data.local.database.WorkspaceEntity
import com.flashcardsopensourceapp.data.local.database.WorkspaceSchedulerSettingsEntity
import com.flashcardsopensourceapp.data.local.model.AgentApiKeyConnectionsResult
import com.flashcardsopensourceapp.data.local.model.CloudAccountSnapshot
import com.flashcardsopensourceapp.data.local.model.CloudGuestUpgradeMode
import com.flashcardsopensourceapp.data.local.model.CloudGuestUpgradeSelection
import com.flashcardsopensourceapp.data.local.model.CloudOtpChallenge
import com.flashcardsopensourceapp.data.local.model.CloudProgressSeries
import com.flashcardsopensourceapp.data.local.model.CloudProgressSummary
import com.flashcardsopensourceapp.data.local.model.CloudSendCodeResult
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfigurationMode
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceDeletePreview
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceDeleteResult
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceResetProgressPreview
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceResetProgressResult
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.FsrsCardState
import com.flashcardsopensourceapp.data.local.model.ReviewRating
import com.flashcardsopensourceapp.data.local.model.StoredCloudCredentials
import com.flashcardsopensourceapp.data.local.model.StoredGuestAiSession
import com.flashcardsopensourceapp.data.local.model.encodeSchedulerStepListJson
import com.flashcardsopensourceapp.data.local.model.makeDefaultWorkspaceSchedulerSettings
import com.flashcardsopensourceapp.data.local.repository.CloudGuestSessionCoordinator
import com.flashcardsopensourceapp.data.local.repository.CloudIdentityResetCoordinator
import com.flashcardsopensourceapp.data.local.repository.CloudOperationCoordinator
import com.flashcardsopensourceapp.data.local.repository.LocalCloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.LocalProgressCacheStore
import com.flashcardsopensourceapp.data.local.repository.LocalSyncRepository
import com.flashcardsopensourceapp.data.local.repository.SystemProgressTimeProvider
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import org.json.JSONObject

internal class CloudIdentityTestEnvironment private constructor(
    val context: Context,
    val database: AppDatabase,
    val cloudPreferencesStore: CloudPreferencesStore,
    val aiChatPreferencesStore: AiChatPreferencesStore,
    val aiChatHistoryStore: AiChatHistoryStore,
    val guestAiSessionStore: GuestAiSessionStore,
    val operationCoordinator: CloudOperationCoordinator,
    val resetCoordinator: CloudIdentityResetCoordinator,
    val aiChatRemoteService: AiChatRemoteService
) {
    private val appVersion: String = "1.2.1"

    companion object {
        suspend fun create(): CloudIdentityTestEnvironment {
            val context = ApplicationProvider.getApplicationContext<Context>()
            clearCloudAndAiPreferences(context = context)
            val database = Room.inMemoryDatabaseBuilder(
                context = context,
                klass = AppDatabase::class.java
            ).allowMainThreadQueries().build()
            val cloudPreferencesStore = CloudPreferencesStore(context = context, database = database)
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

    private fun createSyncLocalStore(): SyncLocalStore {
        return SyncLocalStore(
            database = database,
            preferencesStore = cloudPreferencesStore,
            localProgressCacheStore = LocalProgressCacheStore(
                database = database,
                timeProvider = SystemProgressTimeProvider
            )
        )
    }
}

internal fun clearCloudAndAiPreferences(context: Context) {
    context.deleteSharedPreferences("flashcards-cloud-metadata")
    context.deleteSharedPreferences("flashcards-cloud-secrets")
    context.deleteSharedPreferences("flashcards-ai-chat-preferences")
    context.deleteSharedPreferences("flashcards-ai-chat-history")
    context.deleteSharedPreferences("flashcards-ai-chat-guest-session")
}

internal fun createStoredCloudCredentials(idTokenExpiresAtMillis: Long): StoredCloudCredentials {
    return StoredCloudCredentials(
        refreshToken = "refresh-token",
        idToken = "id-token",
        idTokenExpiresAtMillis = idTokenExpiresAtMillis
    )
}

internal fun createOtpChallenge(email: String): CloudOtpChallenge {
    return CloudOtpChallenge(
        email = email,
        csrfToken = "csrf",
        otpSessionToken = "otp"
    )
}

internal fun createStoredGuestAiSession(
    workspaceId: String,
    configurationMode: CloudServiceConfigurationMode,
    apiBaseUrl: String,
    guestToken: String,
    userId: String
): StoredGuestAiSession {
    return StoredGuestAiSession(
        guestToken = guestToken,
        userId = userId,
        workspaceId = workspaceId,
        configurationMode = configurationMode,
        apiBaseUrl = apiBaseUrl
    )
}

internal fun createCloudWorkspaceSummary(
    workspaceId: String,
    name: String,
    createdAtMillis: Long,
    isSelected: Boolean
): CloudWorkspaceSummary {
    return CloudWorkspaceSummary(
        workspaceId = workspaceId,
        name = name,
        createdAtMillis = createdAtMillis,
        isSelected = isSelected
    )
}

internal fun createCloudAccountSnapshot(
    userId: String,
    email: String,
    workspaces: List<CloudWorkspaceSummary>
): CloudAccountSnapshot {
    return CloudAccountSnapshot(
        userId = userId,
        email = email,
        workspaces = workspaces
    )
}

internal fun syncStateEntityWithEmptyProgress(workspaceId: String): SyncStateEntity {
    return SyncStateEntity(
        workspaceId = workspaceId,
        lastSyncCursor = null,
        lastReviewSequenceId = 0L,
        hasHydratedHotState = false,
        hasHydratedReviewHistory = false,
        lastSyncAttemptAtMillis = null,
        lastSuccessfulSyncAtMillis = null,
        lastSyncError = null,
        blockedInstallationId = null
    )
}

private data class FakeCloudRemoteGatewayConfig(
    val deleteFailuresRemaining: Int,
    val fetchAccountError: Exception?,
    val guestUpgradeMode: CloudGuestUpgradeMode?,
    val bootstrapPullError: Exception?,
    val bootstrapRemoteIsEmptyResponses: List<Boolean>,
    val bootstrapPushErrors: List<Exception>,
    val importReviewHistoryErrors: List<Exception>,
    val createdWorkspace: CloudWorkspaceSummary,
    val onFetchCloudAccountEntered: CompletableDeferred<Unit>?,
    val blockFetchCloudAccount: CompletableDeferred<Unit>?,
    val accountSnapshot: CloudAccountSnapshot
)

internal class FakeCloudRemoteGateway private constructor(
    config: FakeCloudRemoteGatewayConfig
) : CloudRemoteGateway {
    private var deleteFailuresRemaining: Int = config.deleteFailuresRemaining
    private val fetchAccountError: Exception? = config.fetchAccountError
    private val guestUpgradeMode: CloudGuestUpgradeMode? = config.guestUpgradeMode
    private val bootstrapPullError: Exception? = config.bootstrapPullError
    private val bootstrapRemoteIsEmptyResponses: List<Boolean> = config.bootstrapRemoteIsEmptyResponses
    private val bootstrapPushErrors: List<Exception> = config.bootstrapPushErrors
    private val importReviewHistoryErrors: List<Exception> = config.importReviewHistoryErrors
    private val createdWorkspace: CloudWorkspaceSummary = config.createdWorkspace
    private val onFetchCloudAccountEntered: CompletableDeferred<Unit>? = config.onFetchCloudAccountEntered
    private val blockFetchCloudAccount: CompletableDeferred<Unit>? = config.blockFetchCloudAccount
    private val accountSnapshot: CloudAccountSnapshot = config.accountSnapshot
    private var bootstrapPullResponseIndex: Int = 0
    private var bootstrapPushErrorIndex: Int = 0
    private var importReviewHistoryErrorIndex: Int = 0

    companion object {
        fun standard(): FakeCloudRemoteGateway {
            return FakeCloudRemoteGateway(
                config = createConfig(
                    deleteFailuresRemaining = 0,
                    fetchAccountError = null,
                    guestUpgradeMode = null,
                    bootstrapPullError = null,
                    bootstrapRemoteIsEmptyResponses = listOf(true),
                    bootstrapPushErrors = emptyList(),
                    importReviewHistoryErrors = emptyList(),
                    createdWorkspace = createDefaultCreatedWorkspace(),
                    onFetchCloudAccountEntered = null,
                    blockFetchCloudAccount = null,
                    accountSnapshot = createDefaultAccountSnapshot()
                )
            )
        }

        fun forAccountDeletion(deleteFailuresRemaining: Int): FakeCloudRemoteGateway {
            return FakeCloudRemoteGateway(
                config = createConfig(
                    deleteFailuresRemaining = deleteFailuresRemaining,
                    fetchAccountError = null,
                    guestUpgradeMode = null,
                    bootstrapPullError = null,
                    bootstrapRemoteIsEmptyResponses = listOf(true),
                    bootstrapPushErrors = emptyList(),
                    importReviewHistoryErrors = emptyList(),
                    createdWorkspace = createDefaultCreatedWorkspace(),
                    onFetchCloudAccountEntered = null,
                    blockFetchCloudAccount = null,
                    accountSnapshot = createDefaultAccountSnapshot()
                )
            )
        }

        fun forFetchAccountError(fetchAccountError: Exception): FakeCloudRemoteGateway {
            return FakeCloudRemoteGateway(
                config = createConfig(
                    deleteFailuresRemaining = 0,
                    fetchAccountError = fetchAccountError,
                    guestUpgradeMode = null,
                    bootstrapPullError = null,
                    bootstrapRemoteIsEmptyResponses = listOf(true),
                    bootstrapPushErrors = emptyList(),
                    importReviewHistoryErrors = emptyList(),
                    createdWorkspace = createDefaultCreatedWorkspace(),
                    onFetchCloudAccountEntered = null,
                    blockFetchCloudAccount = null,
                    accountSnapshot = createDefaultAccountSnapshot()
                )
            )
        }

        fun forAccountSnapshot(accountSnapshot: CloudAccountSnapshot): FakeCloudRemoteGateway {
            return FakeCloudRemoteGateway(
                config = createConfig(
                    deleteFailuresRemaining = 0,
                    fetchAccountError = null,
                    guestUpgradeMode = null,
                    bootstrapPullError = null,
                    bootstrapRemoteIsEmptyResponses = listOf(true),
                    bootstrapPushErrors = emptyList(),
                    importReviewHistoryErrors = emptyList(),
                    createdWorkspace = createDefaultCreatedWorkspace(),
                    onFetchCloudAccountEntered = null,
                    blockFetchCloudAccount = null,
                    accountSnapshot = accountSnapshot
                )
            )
        }

        fun forBootstrapPullError(bootstrapPullError: Exception): FakeCloudRemoteGateway {
            return FakeCloudRemoteGateway(
                config = createConfig(
                    deleteFailuresRemaining = 0,
                    fetchAccountError = null,
                    guestUpgradeMode = null,
                    bootstrapPullError = bootstrapPullError,
                    bootstrapRemoteIsEmptyResponses = listOf(true),
                    bootstrapPushErrors = emptyList(),
                    importReviewHistoryErrors = emptyList(),
                    createdWorkspace = createDefaultCreatedWorkspace(),
                    onFetchCloudAccountEntered = null,
                    blockFetchCloudAccount = null,
                    accountSnapshot = createDefaultAccountSnapshot()
                )
            )
        }

        fun forGuestUpgrade(
            guestUpgradeMode: CloudGuestUpgradeMode,
            accountSnapshot: CloudAccountSnapshot,
            bootstrapRemoteIsEmpty: Boolean
        ): FakeCloudRemoteGateway {
            return FakeCloudRemoteGateway(
                config = createConfig(
                    deleteFailuresRemaining = 0,
                    fetchAccountError = null,
                    guestUpgradeMode = guestUpgradeMode,
                    bootstrapPullError = null,
                    bootstrapRemoteIsEmptyResponses = listOf(bootstrapRemoteIsEmpty),
                    bootstrapPushErrors = emptyList(),
                    importReviewHistoryErrors = emptyList(),
                    createdWorkspace = createDefaultCreatedWorkspace(),
                    onFetchCloudAccountEntered = null,
                    blockFetchCloudAccount = null,
                    accountSnapshot = accountSnapshot
                )
            )
        }

        fun forCreatedWorkspace(
            createdWorkspace: CloudWorkspaceSummary,
            bootstrapRemoteIsEmpty: Boolean
        ): FakeCloudRemoteGateway {
            return FakeCloudRemoteGateway(
                config = createConfig(
                    deleteFailuresRemaining = 0,
                    fetchAccountError = null,
                    guestUpgradeMode = null,
                    bootstrapPullError = null,
                    bootstrapRemoteIsEmptyResponses = listOf(bootstrapRemoteIsEmpty),
                    bootstrapPushErrors = emptyList(),
                    importReviewHistoryErrors = emptyList(),
                    createdWorkspace = createdWorkspace,
                    onFetchCloudAccountEntered = null,
                    blockFetchCloudAccount = null,
                    accountSnapshot = createDefaultAccountSnapshot()
                )
            )
        }

        fun forBootstrapPushScenario(
            bootstrapRemoteIsEmptyResponses: List<Boolean>,
            bootstrapPushErrors: List<Exception>
        ): FakeCloudRemoteGateway {
            return FakeCloudRemoteGateway(
                config = createConfig(
                    deleteFailuresRemaining = 0,
                    fetchAccountError = null,
                    guestUpgradeMode = null,
                    bootstrapPullError = null,
                    bootstrapRemoteIsEmptyResponses = bootstrapRemoteIsEmptyResponses,
                    bootstrapPushErrors = bootstrapPushErrors,
                    importReviewHistoryErrors = emptyList(),
                    createdWorkspace = createDefaultCreatedWorkspace(),
                    onFetchCloudAccountEntered = null,
                    blockFetchCloudAccount = null,
                    accountSnapshot = createDefaultAccountSnapshot()
                )
            )
        }

        fun forReviewHistoryImportScenario(
            bootstrapRemoteIsEmptyResponses: List<Boolean>,
            importReviewHistoryErrors: List<Exception>
        ): FakeCloudRemoteGateway {
            return FakeCloudRemoteGateway(
                config = createConfig(
                    deleteFailuresRemaining = 0,
                    fetchAccountError = null,
                    guestUpgradeMode = null,
                    bootstrapPullError = null,
                    bootstrapRemoteIsEmptyResponses = bootstrapRemoteIsEmptyResponses,
                    bootstrapPushErrors = emptyList(),
                    importReviewHistoryErrors = importReviewHistoryErrors,
                    createdWorkspace = createDefaultCreatedWorkspace(),
                    onFetchCloudAccountEntered = null,
                    blockFetchCloudAccount = null,
                    accountSnapshot = createDefaultAccountSnapshot()
                )
            )
        }

        fun forBlockingFetch(
            onFetchCloudAccountEntered: CompletableDeferred<Unit>,
            blockFetchCloudAccount: CompletableDeferred<Unit>
        ): FakeCloudRemoteGateway {
            return FakeCloudRemoteGateway(
                config = createConfig(
                    deleteFailuresRemaining = 0,
                    fetchAccountError = null,
                    guestUpgradeMode = null,
                    bootstrapPullError = null,
                    bootstrapRemoteIsEmptyResponses = listOf(true),
                    bootstrapPushErrors = emptyList(),
                    importReviewHistoryErrors = emptyList(),
                    createdWorkspace = createDefaultCreatedWorkspace(),
                    onFetchCloudAccountEntered = onFetchCloudAccountEntered,
                    blockFetchCloudAccount = blockFetchCloudAccount,
                    accountSnapshot = createDefaultAccountSnapshot()
                )
            )
        }

        private fun createConfig(
            deleteFailuresRemaining: Int,
            fetchAccountError: Exception?,
            guestUpgradeMode: CloudGuestUpgradeMode?,
            bootstrapPullError: Exception?,
            bootstrapRemoteIsEmptyResponses: List<Boolean>,
            bootstrapPushErrors: List<Exception>,
            importReviewHistoryErrors: List<Exception>,
            createdWorkspace: CloudWorkspaceSummary,
            onFetchCloudAccountEntered: CompletableDeferred<Unit>?,
            blockFetchCloudAccount: CompletableDeferred<Unit>?,
            accountSnapshot: CloudAccountSnapshot
        ): FakeCloudRemoteGatewayConfig {
            return FakeCloudRemoteGatewayConfig(
                deleteFailuresRemaining = deleteFailuresRemaining,
                fetchAccountError = fetchAccountError,
                guestUpgradeMode = guestUpgradeMode,
                bootstrapPullError = bootstrapPullError,
                bootstrapRemoteIsEmptyResponses = bootstrapRemoteIsEmptyResponses,
                bootstrapPushErrors = bootstrapPushErrors,
                importReviewHistoryErrors = importReviewHistoryErrors,
                createdWorkspace = createdWorkspace,
                onFetchCloudAccountEntered = onFetchCloudAccountEntered,
                blockFetchCloudAccount = blockFetchCloudAccount,
                accountSnapshot = accountSnapshot
            )
        }

        private fun createDefaultCreatedWorkspace(): CloudWorkspaceSummary {
            return createCloudWorkspaceSummary(
                workspaceId = "workspace-new",
                name = "Personal",
                createdAtMillis = 300L,
                isSelected = true
            )
        }

        private fun createDefaultAccountSnapshot(): CloudAccountSnapshot {
            return createCloudAccountSnapshot(
                userId = "user-1",
                email = "user@example.com",
                workspaces = listOf(
                    createCloudWorkspaceSummary(
                        workspaceId = "workspace-remote",
                        name = localWorkspaceName,
                        createdAtMillis = 100L,
                        isSelected = true
                    )
                )
            )
        }
    }

    var deleteAccountCalls: Int = 0
    var prepareGuestUpgradeCalls: Int = 0
    var completeGuestUpgradeCalls: Int = 0
    var createWorkspaceCalls: Int = 0
    var selectWorkspaceCalls: Int = 0
    val renameWorkspaceIds = mutableListOf<String>()
    val bootstrapPullWorkspaceIds = mutableListOf<String>()
    val bootstrapPushBodies = mutableListOf<JSONObject>()
    val importReviewHistoryBodies = mutableListOf<JSONObject>()
    val createdWorkspaceId: String = createdWorkspace.workspaceId

    override suspend fun validateConfiguration(configuration: CloudServiceConfiguration) {
    }

    override suspend fun sendCode(email: String, authBaseUrl: String): CloudSendCodeResult {
        return CloudSendCodeResult.OtpRequired(
            challenge = createOtpChallenge(email = email)
        )
    }

    override suspend fun verifyCode(
        challenge: CloudOtpChallenge,
        code: String,
        authBaseUrl: String
    ): StoredCloudCredentials {
        return createStoredCloudCredentials(idTokenExpiresAtMillis = Long.MAX_VALUE)
    }

    override suspend fun refreshIdToken(
        refreshToken: String,
        authBaseUrl: String
    ): StoredCloudCredentials {
        return StoredCloudCredentials(
            refreshToken = refreshToken,
            idToken = "id-token",
            idTokenExpiresAtMillis = Long.MAX_VALUE
        )
    }

    override suspend fun deleteGuestSession(apiBaseUrl: String, guestToken: String) {
    }

    override suspend fun fetchCloudAccount(
        apiBaseUrl: String,
        bearerToken: String
    ): CloudAccountSnapshot {
        onFetchCloudAccountEntered?.complete(Unit)
        blockFetchCloudAccount?.await()
        fetchAccountError?.let { error ->
            throw error
        }
        return accountSnapshot
    }

    override suspend fun listLinkedWorkspaces(
        apiBaseUrl: String,
        bearerToken: String
    ): List<CloudWorkspaceSummary> {
        return fetchCloudAccount(apiBaseUrl = apiBaseUrl, bearerToken = bearerToken).workspaces
    }

    override suspend fun prepareGuestUpgrade(
        apiBaseUrl: String,
        bearerToken: String,
        guestToken: String
    ): CloudGuestUpgradeMode {
        prepareGuestUpgradeCalls += 1
        return requireNotNull(guestUpgradeMode) {
            "Guest upgrade mode is required for this test."
        }
    }

    override suspend fun completeGuestUpgrade(
        apiBaseUrl: String,
        bearerToken: String,
        guestToken: String,
        selection: CloudGuestUpgradeSelection
    ): CloudWorkspaceSummary {
        completeGuestUpgradeCalls += 1
        return resolveWorkspaceSelection(selection = selection)
    }

    override suspend fun createWorkspace(
        apiBaseUrl: String,
        bearerToken: String,
        name: String
    ): CloudWorkspaceSummary {
        createWorkspaceCalls += 1
        return createdWorkspace.copy(name = name)
    }

    override suspend fun selectWorkspace(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String
    ): CloudWorkspaceSummary {
        selectWorkspaceCalls += 1
        return accountSnapshot.workspaces.first { workspace ->
            workspace.workspaceId == workspaceId
        }
    }

    override suspend fun renameWorkspace(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String,
        name: String
    ): CloudWorkspaceSummary {
        renameWorkspaceIds += workspaceId
        return CloudWorkspaceSummary(
            workspaceId = workspaceId,
            name = name,
            createdAtMillis = createdWorkspace.createdAtMillis,
            isSelected = true
        )
    }

    override suspend fun loadWorkspaceDeletePreview(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String
    ): CloudWorkspaceDeletePreview {
        throw UnsupportedOperationException()
    }

    override suspend fun deleteWorkspace(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String,
        confirmationText: String
    ): CloudWorkspaceDeleteResult {
        throw UnsupportedOperationException()
    }

    override suspend fun loadWorkspaceResetProgressPreview(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String
    ): CloudWorkspaceResetProgressPreview {
        throw UnsupportedOperationException()
    }

    override suspend fun resetWorkspaceProgress(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String,
        confirmationText: String
    ): CloudWorkspaceResetProgressResult {
        throw UnsupportedOperationException()
    }

    override suspend fun loadProgressSummary(
        apiBaseUrl: String,
        authorizationHeader: String,
        timeZone: String
    ): CloudProgressSummary {
        throw UnsupportedOperationException()
    }

    override suspend fun loadProgressSeries(
        apiBaseUrl: String,
        authorizationHeader: String,
        timeZone: String,
        from: String,
        to: String
    ): CloudProgressSeries {
        throw UnsupportedOperationException()
    }

    override suspend fun deleteAccount(
        apiBaseUrl: String,
        bearerToken: String,
        confirmationText: String
    ) {
        deleteAccountCalls += 1
        if (deleteFailuresRemaining > 0) {
            deleteFailuresRemaining -= 1
            throw IllegalStateException("Delete request did not finish.")
        }
    }

    override suspend fun listAgentConnections(
        apiBaseUrl: String,
        bearerToken: String
    ): AgentApiKeyConnectionsResult {
        throw UnsupportedOperationException()
    }

    override suspend fun revokeAgentConnection(
        apiBaseUrl: String,
        bearerToken: String,
        connectionId: String
    ): AgentApiKeyConnectionsResult {
        throw UnsupportedOperationException()
    }

    override suspend fun push(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        body: JSONObject
    ): RemotePushResponse {
        return RemotePushResponse(operations = emptyList())
    }

    override suspend fun pull(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        body: JSONObject
    ): RemotePullResponse {
        return RemotePullResponse(changes = emptyList(), nextHotChangeId = 0L, hasMore = false)
    }

    override suspend fun bootstrapPull(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        body: JSONObject
    ): RemoteBootstrapPullResponse {
        bootstrapPullError?.let { error ->
            throw error
        }
        bootstrapPullWorkspaceIds += workspaceId
        return RemoteBootstrapPullResponse(
            entries = emptyList(),
            nextCursor = null,
            hasMore = false,
            bootstrapHotChangeId = 0L,
            remoteIsEmpty = nextBootstrapRemoteIsEmpty()
        )
    }

    override suspend fun bootstrapPush(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        body: JSONObject
    ): RemoteBootstrapPushResponse {
        bootstrapPushBodies += JSONObject(body.toString())
        nextBootstrapPushErrorOrNull()?.let { error ->
            throw error
        }
        return RemoteBootstrapPushResponse(
            appliedEntriesCount = 0,
            bootstrapHotChangeId = 0L
        )
    }

    override suspend fun pullReviewHistory(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        body: JSONObject
    ): RemoteReviewHistoryPullResponse {
        return RemoteReviewHistoryPullResponse(
            reviewEvents = emptyList(),
            nextReviewSequenceId = 0L,
            hasMore = false
        )
    }

    override suspend fun importReviewHistory(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        body: JSONObject
    ): RemoteReviewHistoryImportResponse {
        importReviewHistoryBodies += JSONObject(body.toString())
        nextImportReviewHistoryErrorOrNull()?.let { error ->
            throw error
        }
        return RemoteReviewHistoryImportResponse(
            importedCount = 0,
            duplicateCount = 0,
            nextReviewSequenceId = 0L
        )
    }

    private fun resolveWorkspaceSelection(selection: CloudGuestUpgradeSelection): CloudWorkspaceSummary {
        return when (selection) {
            is CloudGuestUpgradeSelection.Existing -> accountSnapshot.workspaces.first { workspace ->
                workspace.workspaceId == selection.workspaceId
            }

            CloudGuestUpgradeSelection.CreateNew -> createCloudWorkspaceSummary(
                workspaceId = "workspace-new",
                name = localWorkspaceName,
                createdAtMillis = 300L,
                isSelected = true
            )
        }
    }

    private fun nextBootstrapRemoteIsEmpty(): Boolean {
        val response = bootstrapRemoteIsEmptyResponses.getOrElse(bootstrapPullResponseIndex) {
            bootstrapRemoteIsEmptyResponses.lastOrNull() ?: true
        }
        bootstrapPullResponseIndex += 1
        return response
    }

    private fun nextBootstrapPushErrorOrNull(): Exception? {
        if (bootstrapPushErrorIndex >= bootstrapPushErrors.size) {
            return null
        }
        val error = bootstrapPushErrors[bootstrapPushErrorIndex]
        bootstrapPushErrorIndex += 1
        return error
    }

    private fun nextImportReviewHistoryErrorOrNull(): Exception? {
        if (importReviewHistoryErrorIndex >= importReviewHistoryErrors.size) {
            return null
        }
        val error = importReviewHistoryErrors[importReviewHistoryErrorIndex]
        importReviewHistoryErrorIndex += 1
        return error
    }
}
