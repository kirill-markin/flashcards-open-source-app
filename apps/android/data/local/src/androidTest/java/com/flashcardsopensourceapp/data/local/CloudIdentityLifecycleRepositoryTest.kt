package com.flashcardsopensourceapp.data.local

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.ai.AiChatHistoryStore
import com.flashcardsopensourceapp.data.local.ai.AiChatPreferencesStore
import com.flashcardsopensourceapp.data.local.ai.AiChatRemoteService
import com.flashcardsopensourceapp.data.local.ai.GuestAiSessionStore
import com.flashcardsopensourceapp.data.local.bootstrap.ensureLocalWorkspaceShell
import com.flashcardsopensourceapp.data.local.bootstrap.localWorkspaceName
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.CloudRemoteException
import com.flashcardsopensourceapp.data.local.cloud.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.cloud.RemoteBootstrapPullResponse
import com.flashcardsopensourceapp.data.local.cloud.RemoteBootstrapPushResponse
import com.flashcardsopensourceapp.data.local.cloud.RemotePullResponse
import com.flashcardsopensourceapp.data.local.cloud.RemotePushResponse
import com.flashcardsopensourceapp.data.local.cloud.RemoteReviewHistoryImportResponse
import com.flashcardsopensourceapp.data.local.cloud.RemoteReviewHistoryPullResponse
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.model.AccountDeletionState
import com.flashcardsopensourceapp.data.local.model.AgentApiKeyConnectionsResult
import com.flashcardsopensourceapp.data.local.model.AiChatPersistedState
import com.flashcardsopensourceapp.data.local.model.CloudAccountSnapshot
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudGuestUpgradeMode
import com.flashcardsopensourceapp.data.local.model.CloudGuestUpgradeSelection
import com.flashcardsopensourceapp.data.local.model.CloudOtpChallenge
import com.flashcardsopensourceapp.data.local.model.CloudSendCodeResult
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfigurationMode
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceDeletePreview
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceDeleteResult
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.model.StoredCloudCredentials
import com.flashcardsopensourceapp.data.local.model.StoredGuestAiSession
import com.flashcardsopensourceapp.data.local.model.SyncStatus
import com.flashcardsopensourceapp.data.local.model.effectiveAiChatServerConfig
import com.flashcardsopensourceapp.data.local.model.makeOfficialCloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.repository.CloudIdentityResetCoordinator
import com.flashcardsopensourceapp.data.local.repository.CloudGuestSessionCoordinator
import com.flashcardsopensourceapp.data.local.repository.CloudOperationCoordinator
import com.flashcardsopensourceapp.data.local.repository.LocalCloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.LocalSyncRepository
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class CloudIdentityLifecycleRepositoryTest {
    private lateinit var context: Context
    private lateinit var database: AppDatabase
    private lateinit var cloudPreferencesStore: CloudPreferencesStore
    private lateinit var aiChatPreferencesStore: AiChatPreferencesStore
    private lateinit var aiChatHistoryStore: AiChatHistoryStore
    private lateinit var guestAiSessionStore: GuestAiSessionStore
    private lateinit var operationCoordinator: CloudOperationCoordinator
    private lateinit var resetCoordinator: CloudIdentityResetCoordinator
    private lateinit var aiChatRemoteService: AiChatRemoteService

    @Before
    fun setUp() = runBlocking {
        context = ApplicationProvider.getApplicationContext()
        clearTestPreferences()
        database = Room.inMemoryDatabaseBuilder(
            context = context,
            klass = AppDatabase::class.java
        ).allowMainThreadQueries().build()
        cloudPreferencesStore = CloudPreferencesStore(context = context)
        aiChatPreferencesStore = AiChatPreferencesStore(context = context)
        aiChatHistoryStore = AiChatHistoryStore(context = context)
        guestAiSessionStore = GuestAiSessionStore(context = context)
        operationCoordinator = CloudOperationCoordinator()
        aiChatRemoteService = AiChatRemoteService()
        ensureLocalWorkspaceShell(
            database = database,
            currentTimeMillis = 100L
        )
        resetCoordinator = CloudIdentityResetCoordinator(
            database = database,
            cloudPreferencesStore = cloudPreferencesStore,
            aiChatPreferencesStore = aiChatPreferencesStore,
            aiChatHistoryStore = aiChatHistoryStore,
            guestAiSessionStore = guestAiSessionStore
        )
    }

    @After
    fun tearDown() {
        database.close()
        clearTestPreferences()
    }

    @Test
    fun resetCoordinatorClearsIdentityAndRecreatesEmptyState() = runBlocking {
        val initialLocalWorkspaceId = requireLocalWorkspaceId()
        val initialInstallationId = cloudPreferencesStore.currentCloudSettings().installationId
        cloudPreferencesStore.saveCredentials(
            credentials = StoredCloudCredentials(
                refreshToken = "refresh-token",
                idToken = "id-token",
                idTokenExpiresAtMillis = 10_000L
            )
        )
        cloudPreferencesStore.updateCloudSettings(
            cloudState = CloudAccountState.LINKED,
            linkedUserId = "user-1",
            linkedWorkspaceId = initialLocalWorkspaceId,
            linkedEmail = "user@example.com",
            activeWorkspaceId = initialLocalWorkspaceId
        )
        aiChatPreferencesStore.updateConsent(hasConsent = true)
        aiChatHistoryStore.saveState(
            workspaceId = initialLocalWorkspaceId,
            state = AiChatPersistedState(
                messages = emptyList(),
                chatSessionId = "session-1",
                lastKnownChatConfig = null
            )
        )
        guestAiSessionStore.saveSession(
            localWorkspaceId = initialLocalWorkspaceId,
            session = StoredGuestAiSession(
                guestToken = "guest-token",
                userId = "guest-user",
                workspaceId = "guest-workspace",
                configurationMode = CloudServiceConfigurationMode.OFFICIAL,
                apiBaseUrl = "https://api.flashcards-open-source-app.com/v1"
            )
        )
        cloudPreferencesStore.markAccountDeletionInProgress()

        resetCoordinator.resetLocalStateForCloudIdentityChange()

        val resetWorkspace = requireNotNull(database.workspaceDao().loadAnyWorkspace()) {
            "Expected a local workspace after reset."
        }

        assertNull(cloudPreferencesStore.loadCredentials())
        assertEquals(CloudAccountState.DISCONNECTED, cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals(resetWorkspace.workspaceId, cloudPreferencesStore.currentCloudSettings().activeWorkspaceId)
        assertNotEquals(initialLocalWorkspaceId, resetWorkspace.workspaceId)
        assertNotEquals(initialInstallationId, cloudPreferencesStore.currentCloudSettings().installationId)
        assertEquals(AccountDeletionState.Hidden, cloudPreferencesStore.currentAccountDeletionState())
        assertTrue(aiChatPreferencesStore.hasConsent().not())
        assertEquals(localWorkspaceName, resetWorkspace.name)
        assertEquals(1, database.workspaceDao().countWorkspaces())
        assertEquals(0, database.outboxDao().countOutboxEntries())
        assertEquals(
            "gpt-5.4",
            effectiveAiChatServerConfig(
                aiChatHistoryStore.loadState(workspaceId = resetWorkspace.workspaceId).lastKnownChatConfig
            ).model.id
        )
        assertNull(
            guestAiSessionStore.loadSession(
                localWorkspaceId = resetWorkspace.workspaceId,
                configuration = makeOfficialCloudServiceConfiguration()
            )
        )
    }

    @Test
    fun accountDeletionLifecyclePersistsFailureAndRetryCleansLocalState() = runBlocking {
        val initialLocalWorkspaceId = requireLocalWorkspaceId()
        val initialInstallationId = cloudPreferencesStore.currentCloudSettings().installationId
        val remoteGateway = FakeCloudRemoteGateway(deleteFailuresRemaining = 1)
        val repository = createCloudAccountRepository(remoteGateway = remoteGateway)

        prepareLinkedCloudIdentity(localWorkspaceId = initialLocalWorkspaceId)

        repository.beginAccountDeletion()

        val failedState = cloudPreferencesStore.currentAccountDeletionState()
        assertTrue(failedState is AccountDeletionState.Failed)
        assertEquals(1, remoteGateway.deleteAccountCalls)
        assertEquals(CloudAccountState.LINKED, cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals(initialLocalWorkspaceId, database.workspaceDao().loadAnyWorkspace()?.workspaceId)

        repository.retryPendingAccountDeletion()

        val resetWorkspace = requireNotNull(database.workspaceDao().loadAnyWorkspace()) {
            "Expected a local workspace after retry."
        }

        assertEquals(AccountDeletionState.Hidden, cloudPreferencesStore.currentAccountDeletionState())
        assertEquals(2, remoteGateway.deleteAccountCalls)
        assertEquals(CloudAccountState.DISCONNECTED, cloudPreferencesStore.currentCloudSettings().cloudState)
        assertNull(cloudPreferencesStore.loadCredentials())
        assertNotEquals(initialInstallationId, cloudPreferencesStore.currentCloudSettings().installationId)
        assertEquals(1, database.workspaceDao().countWorkspaces())
        assertEquals(localWorkspaceName, resetWorkspace.name)
        assertNotEquals(initialLocalWorkspaceId, resetWorkspace.workspaceId)
    }

    @Test
    fun resumePendingAccountDeletionRepeatsDeleteOnNextLaunch() = runBlocking {
        val initialLocalWorkspaceId = requireLocalWorkspaceId()
        val remoteGateway = FakeCloudRemoteGateway(deleteFailuresRemaining = 0)
        val repository = createCloudAccountRepository(remoteGateway = remoteGateway)

        prepareLinkedCloudIdentity(localWorkspaceId = initialLocalWorkspaceId)
        cloudPreferencesStore.markAccountDeletionInProgress()

        repository.resumePendingAccountDeletionIfNeeded()

        assertEquals(1, remoteGateway.deleteAccountCalls)
        assertEquals(AccountDeletionState.Hidden, cloudPreferencesStore.currentAccountDeletionState())
        assertEquals(CloudAccountState.DISCONNECTED, cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals(localWorkspaceName, database.workspaceDao().loadAnyWorkspace()?.name)
    }

    @Test
    fun syncRepositoryResetsLocalStateOnRemoteAccountDeleted() = runBlocking {
        val initialLocalWorkspaceId = requireLocalWorkspaceId()
        val remoteGateway = FakeCloudRemoteGateway(
            fetchAccountError = CloudRemoteException(
                message = "Cloud request failed with status 410 for /me",
                statusCode = 410,
                responseBody = JSONObject()
                    .put("code", "ACCOUNT_DELETED")
                    .put("requestId", "request-1")
                    .toString(),
                errorCode = "ACCOUNT_DELETED",
                requestId = "request-1"
            )
        )
        val repository = LocalSyncRepository(
            database = database,
            preferencesStore = cloudPreferencesStore,
            remoteService = remoteGateway,
            syncLocalStore = com.flashcardsopensourceapp.data.local.cloud.SyncLocalStore(
                database = database,
                preferencesStore = cloudPreferencesStore
            ),
            operationCoordinator = operationCoordinator,
            resetCoordinator = resetCoordinator,
            guestSessionStore = guestAiSessionStore,
            cloudGuestSessionCoordinator = createCloudGuestSessionCoordinator(remoteGateway = remoteGateway)
        )

        prepareLinkedCloudIdentity(localWorkspaceId = initialLocalWorkspaceId)
        aiChatPreferencesStore.updateConsent(hasConsent = true)

        repository.syncNow()

        val resetWorkspace = requireNotNull(database.workspaceDao().loadAnyWorkspace()) {
            "Expected a local workspace after remote deletion."
        }

        assertEquals(CloudAccountState.DISCONNECTED, cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals(AccountDeletionState.Hidden, cloudPreferencesStore.currentAccountDeletionState())
        assertNull(cloudPreferencesStore.loadCredentials())
        assertTrue(aiChatPreferencesStore.hasConsent().not())
        assertEquals(SyncStatus.Idle, repository.observeSyncStatus().first().status)
        assertEquals(localWorkspaceName, resetWorkspace.name)
        assertNotEquals(initialLocalWorkspaceId, resetWorkspace.workspaceId)
    }

    @Test
    fun verifyCodePreparesBoundGuestUpgradeWhenGuestSessionExists() = runBlocking {
        val localWorkspaceId = requireLocalWorkspaceId()
        val guestWorkspaceId = "guest-workspace"
        val remoteGateway = FakeCloudRemoteGateway(guestUpgradeMode = CloudGuestUpgradeMode.BOUND)
        val repository = createCloudAccountRepository(remoteGateway = remoteGateway)
        cloudPreferencesStore.updateCloudSettings(
            cloudState = CloudAccountState.DISCONNECTED,
            linkedUserId = null,
            linkedWorkspaceId = null,
            linkedEmail = null,
            activeWorkspaceId = localWorkspaceId
        )
        guestAiSessionStore.saveSession(
            localWorkspaceId = guestWorkspaceId,
            session = StoredGuestAiSession(
                guestToken = "guest-token",
                userId = "guest-user",
                workspaceId = guestWorkspaceId,
                configurationMode = CloudServiceConfigurationMode.OFFICIAL,
                apiBaseUrl = "https://api.flashcards-open-source-app.com/v1"
            )
        )

        val linkContext = repository.verifyCode(
            challenge = CloudOtpChallenge(
                email = "user@example.com",
                csrfToken = "csrf",
                otpSessionToken = "otp"
            ),
            code = "123456"
        )

        assertEquals(CloudGuestUpgradeMode.BOUND, linkContext.guestUpgradeMode)
        assertEquals(CloudAccountState.LINKING_READY, cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals("user-1", cloudPreferencesStore.currentCloudSettings().linkedUserId)
        assertNull(cloudPreferencesStore.currentCloudSettings().linkedWorkspaceId)
        assertEquals(localWorkspaceId, cloudPreferencesStore.currentCloudSettings().activeWorkspaceId)
        assertEquals(1, remoteGateway.prepareGuestUpgradeCalls)
    }

    @Test
    fun syncRepositoryRestoresStoredGuestSessionBeforeSyncWhenCloudStateIsDisconnected() = runBlocking {
        val localWorkspaceId = requireLocalWorkspaceId()
        val guestWorkspaceId = "guest-workspace"
        val remoteGateway = FakeCloudRemoteGateway()
        val syncRepository = LocalSyncRepository(
            database = database,
            preferencesStore = cloudPreferencesStore,
            remoteService = remoteGateway,
            syncLocalStore = com.flashcardsopensourceapp.data.local.cloud.SyncLocalStore(
                database = database,
                preferencesStore = cloudPreferencesStore
            ),
            operationCoordinator = operationCoordinator,
            resetCoordinator = resetCoordinator,
            guestSessionStore = guestAiSessionStore,
            cloudGuestSessionCoordinator = createCloudGuestSessionCoordinator(remoteGateway = remoteGateway)
        )
        cloudPreferencesStore.updateCloudSettings(
            cloudState = CloudAccountState.DISCONNECTED,
            linkedUserId = null,
            linkedWorkspaceId = null,
            linkedEmail = null,
            activeWorkspaceId = localWorkspaceId
        )
        guestAiSessionStore.saveSession(
            localWorkspaceId = guestWorkspaceId,
            session = StoredGuestAiSession(
                guestToken = "guest-token",
                userId = "guest-user",
                workspaceId = guestWorkspaceId,
                configurationMode = CloudServiceConfigurationMode.OFFICIAL,
                apiBaseUrl = "https://api.flashcards-open-source-app.com/v1"
            )
        )

        syncRepository.syncNow()

        val cloudSettings = cloudPreferencesStore.currentCloudSettings()
        assertEquals(CloudAccountState.GUEST, cloudSettings.cloudState)
        assertEquals(guestWorkspaceId, cloudSettings.activeWorkspaceId)
        assertEquals(guestWorkspaceId, database.workspaceDao().loadAnyWorkspace()?.workspaceId)
        assertEquals(listOf(guestWorkspaceId), remoteGateway.bootstrapPullWorkspaceIds)
    }

    @Test
    fun syncRepositoryResetsInvalidGuestStateWhenStoredGuestSessionIsMissing() = runBlocking {
        val localWorkspaceId = requireLocalWorkspaceId()
        val initialInstallationId = cloudPreferencesStore.currentCloudSettings().installationId
        val remoteGateway = FakeCloudRemoteGateway()
        val syncRepository = LocalSyncRepository(
            database = database,
            preferencesStore = cloudPreferencesStore,
            remoteService = remoteGateway,
            syncLocalStore = com.flashcardsopensourceapp.data.local.cloud.SyncLocalStore(
                database = database,
                preferencesStore = cloudPreferencesStore
            ),
            operationCoordinator = operationCoordinator,
            resetCoordinator = resetCoordinator,
            guestSessionStore = guestAiSessionStore,
            cloudGuestSessionCoordinator = createCloudGuestSessionCoordinator(remoteGateway = remoteGateway)
        )
        cloudPreferencesStore.updateCloudSettings(
            cloudState = CloudAccountState.GUEST,
            linkedUserId = "guest-user",
            linkedWorkspaceId = localWorkspaceId,
            linkedEmail = null,
            activeWorkspaceId = localWorkspaceId
        )

        try {
            syncRepository.syncNow()
        } catch (_: IllegalStateException) {
        }

        val resetWorkspace = requireNotNull(database.workspaceDao().loadAnyWorkspace()) {
            "Expected a local workspace after guest reset."
        }
        assertEquals(CloudAccountState.DISCONNECTED, cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals(resetWorkspace.workspaceId, cloudPreferencesStore.currentCloudSettings().activeWorkspaceId)
        assertNotEquals(initialInstallationId, cloudPreferencesStore.currentCloudSettings().installationId)
    }

    @Test
    fun syncRepositoryResetsStaleActiveWorkspaceIdBeforeSync() = runBlocking {
        val remoteGateway = FakeCloudRemoteGateway()
        val syncRepository = LocalSyncRepository(
            database = database,
            preferencesStore = cloudPreferencesStore,
            remoteService = remoteGateway,
            syncLocalStore = com.flashcardsopensourceapp.data.local.cloud.SyncLocalStore(
                database = database,
                preferencesStore = cloudPreferencesStore
            ),
            operationCoordinator = operationCoordinator,
            resetCoordinator = resetCoordinator,
            guestSessionStore = guestAiSessionStore,
            cloudGuestSessionCoordinator = createCloudGuestSessionCoordinator(remoteGateway = remoteGateway)
        )
        cloudPreferencesStore.updateCloudSettings(
            cloudState = CloudAccountState.DISCONNECTED,
            linkedUserId = null,
            linkedWorkspaceId = null,
            linkedEmail = null,
            activeWorkspaceId = "stale-workspace-id"
        )

        try {
            syncRepository.syncNow()
        } catch (_: IllegalStateException) {
        }

        val cloudSettings = cloudPreferencesStore.currentCloudSettings()
        val resetWorkspace = requireNotNull(database.workspaceDao().loadAnyWorkspace()) {
            "Expected a local workspace after stale active workspace reset."
        }
        assertEquals(CloudAccountState.DISCONNECTED, cloudSettings.cloudState)
        assertEquals(resetWorkspace.workspaceId, cloudSettings.activeWorkspaceId)
    }

    @Test
    fun syncRepositoryBlocksInstallationPlatformMismatchWithoutResettingLocalIdentity() = runBlocking {
        val initialLocalWorkspaceId = requireLocalWorkspaceId()
        val initialInstallationId = cloudPreferencesStore.currentCloudSettings().installationId
        val remoteGateway = FakeCloudRemoteGateway(
            bootstrapPullError = CloudRemoteException(
                message = "Cloud request failed with status 409 for /sync/bootstrap-pull",
                statusCode = 409,
                responseBody = JSONObject()
                    .put("code", "SYNC_INSTALLATION_PLATFORM_MISMATCH")
                    .put("requestId", "request-platform-mismatch")
                    .toString(),
                errorCode = "SYNC_INSTALLATION_PLATFORM_MISMATCH",
                requestId = "request-platform-mismatch"
            )
        )
        val syncRepository = LocalSyncRepository(
            database = database,
            preferencesStore = cloudPreferencesStore,
            remoteService = remoteGateway,
            syncLocalStore = com.flashcardsopensourceapp.data.local.cloud.SyncLocalStore(
                database = database,
                preferencesStore = cloudPreferencesStore
            ),
            operationCoordinator = operationCoordinator,
            resetCoordinator = resetCoordinator,
            guestSessionStore = guestAiSessionStore,
            cloudGuestSessionCoordinator = createCloudGuestSessionCoordinator(remoteGateway = remoteGateway)
        )

        prepareLinkedCloudIdentity(localWorkspaceId = initialLocalWorkspaceId)

        try {
            syncRepository.syncNow()
        } catch (_: CloudRemoteException) {
        }

        val cloudSettings = cloudPreferencesStore.currentCloudSettings()
        val syncStatus = syncRepository.observeSyncStatus().first().status
        assertEquals(CloudAccountState.LINKED, cloudSettings.cloudState)
        assertEquals(initialInstallationId, cloudSettings.installationId)
        assertEquals(initialLocalWorkspaceId, cloudSettings.activeWorkspaceId)
        assertEquals(initialLocalWorkspaceId, database.workspaceDao().loadAnyWorkspace()?.workspaceId)
        assertNotNull(cloudPreferencesStore.loadCredentials())
        assertTrue(syncStatus is SyncStatus.Blocked)
        assertEquals(
            "Cloud request failed with status 409 for /sync/bootstrap-pull",
            (syncStatus as SyncStatus.Blocked).message
        )
    }

    @Test
    fun syncRepositoryBlocksReplicaConflictWithoutResettingLocalIdentity() = runBlocking {
        val initialLocalWorkspaceId = requireLocalWorkspaceId()
        val initialInstallationId = cloudPreferencesStore.currentCloudSettings().installationId
        val remoteGateway = FakeCloudRemoteGateway(
            bootstrapPullError = CloudRemoteException(
                message = "Cloud request failed with status 409 for /sync/bootstrap-pull",
                statusCode = 409,
                responseBody = JSONObject()
                    .put("code", "SYNC_REPLICA_CONFLICT")
                    .put("requestId", "request-replica-conflict")
                    .toString(),
                errorCode = "SYNC_REPLICA_CONFLICT",
                requestId = "request-replica-conflict"
            )
        )
        val syncRepository = LocalSyncRepository(
            database = database,
            preferencesStore = cloudPreferencesStore,
            remoteService = remoteGateway,
            syncLocalStore = com.flashcardsopensourceapp.data.local.cloud.SyncLocalStore(
                database = database,
                preferencesStore = cloudPreferencesStore
            ),
            operationCoordinator = operationCoordinator,
            resetCoordinator = resetCoordinator,
            guestSessionStore = guestAiSessionStore,
            cloudGuestSessionCoordinator = createCloudGuestSessionCoordinator(remoteGateway = remoteGateway)
        )

        prepareLinkedCloudIdentity(localWorkspaceId = initialLocalWorkspaceId)

        try {
            syncRepository.syncNow()
        } catch (_: CloudRemoteException) {
        }

        val cloudSettings = cloudPreferencesStore.currentCloudSettings()
        val syncStatus = syncRepository.observeSyncStatus().first().status
        assertEquals(CloudAccountState.LINKED, cloudSettings.cloudState)
        assertEquals(initialInstallationId, cloudSettings.installationId)
        assertEquals(initialLocalWorkspaceId, cloudSettings.activeWorkspaceId)
        assertEquals(initialLocalWorkspaceId, database.workspaceDao().loadAnyWorkspace()?.workspaceId)
        assertNotNull(cloudPreferencesStore.loadCredentials())
        assertTrue(syncStatus is SyncStatus.Blocked)
        assertEquals(
            "Cloud request failed with status 409 for /sync/bootstrap-pull",
            (syncStatus as SyncStatus.Blocked).message
        )
    }

    @Test
    fun prepareVerifiedSignInUsesRemotePreferredWorkspaceAndPreservesLocalActiveWorkspaceId() = runBlocking {
        val localWorkspaceId = requireLocalWorkspaceId()
        val remoteGateway = FakeCloudRemoteGateway(
            accountSnapshot = CloudAccountSnapshot(
                userId = "user-1",
                email = "google-review@example.com",
                workspaces = listOf(
                    CloudWorkspaceSummary(
                        workspaceId = "workspace-1",
                        name = "Personal",
                        createdAtMillis = 100L,
                        isSelected = false
                    ),
                    CloudWorkspaceSummary(
                        workspaceId = "workspace-2",
                        name = "Personal",
                        createdAtMillis = 200L,
                        isSelected = true
                    )
                )
            )
        )
        val repository = createCloudAccountRepository(remoteGateway = remoteGateway)

        val linkContext = repository.prepareVerifiedSignIn(
            credentials = StoredCloudCredentials(
                refreshToken = "refresh-token",
                idToken = "id-token",
                idTokenExpiresAtMillis = Long.MAX_VALUE
            )
        )

        assertEquals(CloudAccountState.LINKING_READY, cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals(localWorkspaceId, cloudPreferencesStore.currentCloudSettings().activeWorkspaceId)
        assertEquals("workspace-2", linkContext.preferredWorkspaceId)
    }

    @Test
    fun verifyCodeSkipsGuestUpgradeWhenStoredGuestSessionBelongsToAnotherServerConfiguration() = runBlocking {
        val localWorkspaceId = requireLocalWorkspaceId()
        val remoteGateway = FakeCloudRemoteGateway(guestUpgradeMode = CloudGuestUpgradeMode.BOUND)
        val repository = createCloudAccountRepository(remoteGateway = remoteGateway)
        guestAiSessionStore.saveSession(
            localWorkspaceId = localWorkspaceId,
            session = StoredGuestAiSession(
                guestToken = "guest-token-stale",
                userId = "guest-user-stale",
                workspaceId = "guest-workspace-stale",
                configurationMode = CloudServiceConfigurationMode.CUSTOM,
                apiBaseUrl = "https://api.stale.example.com/v1"
            )
        )

        val linkContext = repository.verifyCode(
            challenge = CloudOtpChallenge(
                email = "user@example.com",
                csrfToken = "csrf",
                otpSessionToken = "otp"
            ),
            code = "123456"
        )

        assertNull(linkContext.guestUpgradeMode)
        assertNull(
            guestAiSessionStore.loadSession(
                localWorkspaceId = localWorkspaceId,
                configuration = makeOfficialCloudServiceConfiguration()
            )
        )
        assertEquals(0, remoteGateway.prepareGuestUpgradeCalls)
    }

    @Test
    fun guestSessionStoreClearsWorkspaceScopedSessionWhenStoredWorkspaceIdDoesNotMatchKey() {
        guestAiSessionStore.saveSession(
            localWorkspaceId = "local-workspace",
            session = StoredGuestAiSession(
                guestToken = "guest-token",
                userId = "guest-user",
                workspaceId = "remote-workspace",
                configurationMode = CloudServiceConfigurationMode.OFFICIAL,
                apiBaseUrl = "https://api.flashcards-open-source-app.com/v1"
            )
        )

        assertNull(
            guestAiSessionStore.loadSession(
                localWorkspaceId = "local-workspace",
                configuration = makeOfficialCloudServiceConfiguration()
            )
        )
        assertNull(
            guestAiSessionStore.loadAnySession(
                configuration = makeOfficialCloudServiceConfiguration()
            )
        )
    }

    @Test
    fun guestSessionStoreRebindsGuestSessionToTheRemoteWorkspaceKeyOnly() {
        val session = StoredGuestAiSession(
            guestToken = "guest-token",
            userId = "guest-user",
            workspaceId = "remote-workspace",
            configurationMode = CloudServiceConfigurationMode.OFFICIAL,
            apiBaseUrl = "https://api.flashcards-open-source-app.com/v1"
        )
        guestAiSessionStore.saveSession(
            localWorkspaceId = "local-workspace",
            session = session
        )

        guestAiSessionStore.saveSession(
            localWorkspaceId = session.workspaceId,
            session = session
        )

        assertNull(
            guestAiSessionStore.loadSession(
                localWorkspaceId = "local-workspace",
                configuration = makeOfficialCloudServiceConfiguration()
            )
        )
        assertEquals(
            session.workspaceId,
            guestAiSessionStore.loadSession(
                localWorkspaceId = session.workspaceId,
                configuration = makeOfficialCloudServiceConfiguration()
            )?.workspaceId
        )
    }

    @Test
    fun completeGuestUpgradeClearsGuestSessionAndLinksWorkspace() = runBlocking {
        val localWorkspaceId = requireLocalWorkspaceId()
        val guestWorkspaceId = "guest-workspace"
        val selectedWorkspace = CloudWorkspaceSummary(
            workspaceId = "workspace-linked",
            name = "Linked Workspace",
            createdAtMillis = 200L,
            isSelected = true
        )
        val remoteGateway = FakeCloudRemoteGateway(
            guestUpgradeMode = CloudGuestUpgradeMode.MERGE_REQUIRED,
            accountSnapshot = CloudAccountSnapshot(
                userId = "user-1",
                email = "user@example.com",
                workspaces = listOf(selectedWorkspace)
            )
        )
        val repository = createCloudAccountRepository(remoteGateway = remoteGateway)
        guestAiSessionStore.saveSession(
            localWorkspaceId = guestWorkspaceId,
            session = StoredGuestAiSession(
                guestToken = "guest-token",
                userId = "guest-user",
                workspaceId = guestWorkspaceId,
                configurationMode = CloudServiceConfigurationMode.OFFICIAL,
                apiBaseUrl = "https://api.flashcards-open-source-app.com/v1"
            )
        )
        repository.verifyCode(
            challenge = CloudOtpChallenge(
                email = "user@example.com",
                csrfToken = "csrf",
                otpSessionToken = "otp"
            ),
            code = "123456"
        )

        val linkedWorkspace = repository.completeGuestUpgrade(
            selection = CloudWorkspaceLinkSelection.Existing(workspaceId = selectedWorkspace.workspaceId)
        )

        assertEquals(selectedWorkspace.workspaceId, linkedWorkspace.workspaceId)
        assertEquals(CloudAccountState.LINKED, cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals(selectedWorkspace.workspaceId, cloudPreferencesStore.currentCloudSettings().linkedWorkspaceId)
        assertEquals("user@example.com", cloudPreferencesStore.currentCloudSettings().linkedEmail)
        assertEquals(selectedWorkspace.workspaceId, database.workspaceDao().loadAnyWorkspace()?.workspaceId)
        assertNull(
            guestAiSessionStore.loadAnySession(configuration = makeOfficialCloudServiceConfiguration())
        )
        assertEquals(1, remoteGateway.prepareGuestUpgradeCalls)
        assertEquals(1, remoteGateway.completeGuestUpgradeCalls)
    }

    @Test
    fun switchLinkedWorkspaceCreateNewReplacesCurrentLocalWorkspaceWhenRemoteWorkspaceIsEmpty() = runBlocking {
        val initialLocalWorkspaceId = requireLocalWorkspaceId()
        val createdWorkspace = CloudWorkspaceSummary(
            workspaceId = "workspace-new",
            name = "Personal",
            createdAtMillis = 300L,
            isSelected = true
        )
        val remoteGateway = FakeCloudRemoteGateway(
            bootstrapRemoteIsEmpty = true,
            createdWorkspace = createdWorkspace
        )
        val repository = createCloudAccountRepository(remoteGateway = remoteGateway)

        prepareLinkedCloudIdentity(localWorkspaceId = initialLocalWorkspaceId)

        val linkedWorkspace = repository.completeLinkedWorkspaceTransition(CloudWorkspaceLinkSelection.CreateNew)

        assertEquals(createdWorkspace.workspaceId, linkedWorkspace.workspaceId)
        assertEquals(createdWorkspace.workspaceId, cloudPreferencesStore.currentCloudSettings().activeWorkspaceId)
        assertEquals(createdWorkspace.workspaceId, cloudPreferencesStore.currentCloudSettings().linkedWorkspaceId)
        assertEquals(createdWorkspace.workspaceId, database.workspaceDao().loadAnyWorkspace()?.workspaceId)
    }

    @Test
    fun renameCurrentWorkspaceTargetsTheCreatedLinkedWorkspaceAfterCreateNewSwitch() = runBlocking {
        val initialLocalWorkspaceId = requireLocalWorkspaceId()
        val createdWorkspace = CloudWorkspaceSummary(
            workspaceId = "workspace-new",
            name = "Personal",
            createdAtMillis = 300L,
            isSelected = true
        )
        val remoteGateway = FakeCloudRemoteGateway(
            bootstrapRemoteIsEmpty = true,
            createdWorkspace = createdWorkspace
        )
        val repository = createCloudAccountRepository(remoteGateway = remoteGateway)

        prepareLinkedCloudIdentity(localWorkspaceId = initialLocalWorkspaceId)
        repository.completeLinkedWorkspaceTransition(CloudWorkspaceLinkSelection.CreateNew)

        val renamedWorkspace = repository.renameCurrentWorkspace(name = "Renamed Workspace")

        assertEquals(createdWorkspace.workspaceId, remoteGateway.renameWorkspaceIds.single())
        assertEquals("Renamed Workspace", renamedWorkspace.name)
        assertEquals("Renamed Workspace", database.workspaceDao().loadAnyWorkspace()?.name)
    }

    @Test
    fun completeCloudLinkExistingWorkspaceReplacesTheLocalShellAndKeepsRenameTargetAligned() = runBlocking {
        val linkedWorkspace = CloudWorkspaceSummary(
            workspaceId = "workspace-linked",
            name = "Linked Workspace",
            createdAtMillis = 200L,
            isSelected = true
        )
        val remoteGateway = FakeCloudRemoteGateway(
            bootstrapRemoteIsEmpty = true,
            accountSnapshot = CloudAccountSnapshot(
                userId = "user-1",
                email = "user@example.com",
                workspaces = listOf(linkedWorkspace)
            )
        )
        val repository = createCloudAccountRepository(remoteGateway = remoteGateway)

        repository.verifyCode(
            challenge = CloudOtpChallenge(
                email = "user@example.com",
                csrfToken = "csrf",
                otpSessionToken = "otp"
            ),
            code = "123456"
        )
        repository.completeCloudLink(
            selection = CloudWorkspaceLinkSelection.Existing(workspaceId = linkedWorkspace.workspaceId)
        )

        val renamedWorkspace = repository.renameCurrentWorkspace(name = "Renamed Linked Workspace")

        assertEquals(linkedWorkspace.workspaceId, cloudPreferencesStore.currentCloudSettings().activeWorkspaceId)
        assertEquals(linkedWorkspace.workspaceId, cloudPreferencesStore.currentCloudSettings().linkedWorkspaceId)
        assertEquals(linkedWorkspace.workspaceId, database.workspaceDao().loadAnyWorkspace()?.workspaceId)
        assertEquals(linkedWorkspace.workspaceId, remoteGateway.renameWorkspaceIds.single())
        assertEquals("Renamed Linked Workspace", renamedWorkspace.name)
    }

    @Test
    fun switchLinkedWorkspaceWaitsForForegroundSyncToFinish() = runBlocking {
        val initialLocalWorkspaceId = requireLocalWorkspaceId()
        val fetchEntered = CompletableDeferred<Unit>()
        val releaseFetch = CompletableDeferred<Unit>()
        val remoteGateway = FakeCloudRemoteGateway(
            onFetchCloudAccountEntered = fetchEntered,
            blockFetchCloudAccount = releaseFetch
        )
        val cloudRepository = createCloudAccountRepository(remoteGateway = remoteGateway)
        val syncRepository = LocalSyncRepository(
            database = database,
            preferencesStore = cloudPreferencesStore,
            remoteService = remoteGateway,
            syncLocalStore = com.flashcardsopensourceapp.data.local.cloud.SyncLocalStore(
                database = database,
                preferencesStore = cloudPreferencesStore
            ),
            operationCoordinator = operationCoordinator,
            resetCoordinator = resetCoordinator,
            guestSessionStore = guestAiSessionStore,
            cloudGuestSessionCoordinator = createCloudGuestSessionCoordinator(remoteGateway = remoteGateway)
        )

        prepareLinkedCloudIdentity(localWorkspaceId = initialLocalWorkspaceId)

        val syncJob = launch {
            syncRepository.syncNow()
        }
        fetchEntered.await()

        val switchJob = launch {
            cloudRepository.switchLinkedWorkspace(CloudWorkspaceLinkSelection.CreateNew)
        }

        assertEquals(0, remoteGateway.createWorkspaceCalls)

        releaseFetch.complete(Unit)
        switchJob.join()
        syncJob.join()

        assertEquals(1, remoteGateway.createWorkspaceCalls)
        assertEquals(
            remoteGateway.createdWorkspaceId,
            cloudPreferencesStore.currentCloudSettings().activeWorkspaceId
        )
    }

    @Test
    fun syncRepositoryReadsLinkedWorkspaceAfterAcquiringSharedCoordinatorLock() = runBlocking {
        val initialLocalWorkspaceId = requireLocalWorkspaceId()
        val lockAcquired = CompletableDeferred<Unit>()
        val releaseLock = CompletableDeferred<Unit>()
        val remoteGateway = FakeCloudRemoteGateway()
        val syncRepository = LocalSyncRepository(
            database = database,
            preferencesStore = cloudPreferencesStore,
            remoteService = remoteGateway,
            syncLocalStore = com.flashcardsopensourceapp.data.local.cloud.SyncLocalStore(
                database = database,
                preferencesStore = cloudPreferencesStore
            ),
            operationCoordinator = operationCoordinator,
            resetCoordinator = resetCoordinator,
            guestSessionStore = guestAiSessionStore,
            cloudGuestSessionCoordinator = createCloudGuestSessionCoordinator(remoteGateway = remoteGateway)
        )

        prepareLinkedCloudIdentity(localWorkspaceId = initialLocalWorkspaceId)
        val lockJob = launch {
            operationCoordinator.runExclusive {
                lockAcquired.complete(Unit)
                releaseLock.await()
            }
        }
        lockAcquired.await()
        cloudPreferencesStore.updateCloudSettings(
            cloudState = CloudAccountState.LINKED,
            linkedUserId = "user-1",
            linkedWorkspaceId = "workspace-after-lock",
            linkedEmail = "user@example.com",
            activeWorkspaceId = "workspace-after-lock"
        )

        val syncJob = launch {
            syncRepository.syncNow()
        }

        assertTrue(remoteGateway.bootstrapPullWorkspaceIds.isEmpty())

        releaseLock.complete(Unit)
        syncJob.join()
        lockJob.join()

        assertEquals(listOf("workspace-after-lock"), remoteGateway.bootstrapPullWorkspaceIds)
    }

    private fun createCloudAccountRepository(remoteGateway: CloudRemoteGateway): LocalCloudAccountRepository {
        return LocalCloudAccountRepository(
            database = database,
            preferencesStore = cloudPreferencesStore,
            remoteService = remoteGateway,
            syncLocalStore = com.flashcardsopensourceapp.data.local.cloud.SyncLocalStore(
                database = database,
                preferencesStore = cloudPreferencesStore
            ),
            operationCoordinator = operationCoordinator,
            resetCoordinator = resetCoordinator,
            guestSessionStore = guestAiSessionStore
        )
    }

    private fun createCloudGuestSessionCoordinator(
        remoteGateway: CloudRemoteGateway
    ): CloudGuestSessionCoordinator {
        return CloudGuestSessionCoordinator(
            database = database,
            preferencesStore = cloudPreferencesStore,
            remoteService = remoteGateway,
            syncLocalStore = com.flashcardsopensourceapp.data.local.cloud.SyncLocalStore(
                database = database,
                preferencesStore = cloudPreferencesStore
            ),
            operationCoordinator = operationCoordinator,
            resetCoordinator = resetCoordinator,
            guestSessionStore = guestAiSessionStore,
            aiChatRemoteService = aiChatRemoteService
        )
    }

    private fun prepareLinkedCloudIdentity(localWorkspaceId: String) {
        cloudPreferencesStore.saveCredentials(
            credentials = StoredCloudCredentials(
                refreshToken = "refresh-token",
                idToken = "id-token",
                idTokenExpiresAtMillis = Long.MAX_VALUE
            )
        )
        cloudPreferencesStore.updateCloudSettings(
            cloudState = CloudAccountState.LINKED,
            linkedUserId = "user-1",
            linkedWorkspaceId = localWorkspaceId,
            linkedEmail = "user@example.com",
            activeWorkspaceId = localWorkspaceId
        )
    }

    private suspend fun requireLocalWorkspaceId(): String {
        return requireNotNull(database.workspaceDao().loadAnyWorkspace()?.workspaceId) {
            "Expected a local workspace."
        }
    }

    private fun clearTestPreferences() {
        context.deleteSharedPreferences("flashcards-cloud-metadata")
        context.deleteSharedPreferences("flashcards-cloud-secrets")
        context.deleteSharedPreferences("flashcards-ai-chat-preferences")
        context.deleteSharedPreferences("flashcards-ai-chat-history")
        context.deleteSharedPreferences("flashcards-ai-chat-guest-session")
    }
}

private class FakeCloudRemoteGateway(
    private var deleteFailuresRemaining: Int = 0,
    private val fetchAccountError: CloudRemoteException? = null,
    private val guestUpgradeMode: CloudGuestUpgradeMode? = null,
    private val bootstrapPullError: CloudRemoteException? = null,
    private val bootstrapRemoteIsEmpty: Boolean = true,
    private val createdWorkspace: CloudWorkspaceSummary = CloudWorkspaceSummary(
        workspaceId = "workspace-new",
        name = "Personal",
        createdAtMillis = 300L,
        isSelected = true
    ),
    private val onFetchCloudAccountEntered: CompletableDeferred<Unit>? = null,
    private val blockFetchCloudAccount: CompletableDeferred<Unit>? = null,
    private val accountSnapshot: CloudAccountSnapshot = CloudAccountSnapshot(
        userId = "user-1",
        email = "user@example.com",
        workspaces = listOf(
            CloudWorkspaceSummary(
                workspaceId = "workspace-remote",
                name = localWorkspaceName,
                createdAtMillis = 100L,
                isSelected = true
            )
        )
    )
) : CloudRemoteGateway {
    var deleteAccountCalls: Int = 0
    var prepareGuestUpgradeCalls: Int = 0
    var completeGuestUpgradeCalls: Int = 0
    var createWorkspaceCalls: Int = 0
    val renameWorkspaceIds = mutableListOf<String>()
    val bootstrapPullWorkspaceIds = mutableListOf<String>()
    val createdWorkspaceId: String = createdWorkspace.workspaceId

    override suspend fun validateConfiguration(configuration: CloudServiceConfiguration) {
    }

    override suspend fun sendCode(email: String, authBaseUrl: String): CloudSendCodeResult {
        return CloudSendCodeResult.OtpRequired(
            challenge = CloudOtpChallenge(
                email = email,
                csrfToken = "csrf",
                otpSessionToken = "otp"
            )
        )
    }

    override suspend fun verifyCode(challenge: CloudOtpChallenge, code: String, authBaseUrl: String): StoredCloudCredentials {
        return StoredCloudCredentials(
            refreshToken = "refresh-token",
            idToken = "id-token",
            idTokenExpiresAtMillis = Long.MAX_VALUE
        )
    }

    override suspend fun refreshIdToken(refreshToken: String, authBaseUrl: String): StoredCloudCredentials {
        return StoredCloudCredentials(
            refreshToken = refreshToken,
            idToken = "id-token",
            idTokenExpiresAtMillis = Long.MAX_VALUE
        )
    }

    override suspend fun fetchCloudAccount(apiBaseUrl: String, bearerToken: String): CloudAccountSnapshot {
        onFetchCloudAccountEntered?.complete(Unit)
        blockFetchCloudAccount?.await()
        fetchAccountError?.let { error ->
            throw error
        }
        return accountSnapshot
    }

    override suspend fun listLinkedWorkspaces(apiBaseUrl: String, bearerToken: String): List<CloudWorkspaceSummary> {
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

    override suspend fun createWorkspace(apiBaseUrl: String, bearerToken: String, name: String): CloudWorkspaceSummary {
        createWorkspaceCalls += 1
        return createdWorkspace.copy(name = name)
    }

    override suspend fun selectWorkspace(apiBaseUrl: String, bearerToken: String, workspaceId: String): CloudWorkspaceSummary {
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

    override suspend fun deleteAccount(apiBaseUrl: String, bearerToken: String, confirmationText: String) {
        deleteAccountCalls += 1
        if (deleteFailuresRemaining > 0) {
            deleteFailuresRemaining -= 1
            throw IllegalStateException("Delete request did not finish.")
        }
    }

    override suspend fun listAgentConnections(apiBaseUrl: String, bearerToken: String): AgentApiKeyConnectionsResult {
        throw UnsupportedOperationException()
    }

    override suspend fun revokeAgentConnection(
        apiBaseUrl: String,
        bearerToken: String,
        connectionId: String
    ): AgentApiKeyConnectionsResult {
        throw UnsupportedOperationException()
    }

    override suspend fun push(apiBaseUrl: String, bearerToken: String, workspaceId: String, body: JSONObject): RemotePushResponse {
        return RemotePushResponse(operations = emptyList())
    }

    override suspend fun pull(apiBaseUrl: String, bearerToken: String, workspaceId: String, body: JSONObject): RemotePullResponse {
        return RemotePullResponse(changes = emptyList(), nextHotChangeId = 0L, hasMore = false)
    }

    override suspend fun bootstrapPull(
        apiBaseUrl: String,
        bearerToken: String,
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
            remoteIsEmpty = bootstrapRemoteIsEmpty
        )
    }

    override suspend fun bootstrapPush(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String,
        body: JSONObject
    ): RemoteBootstrapPushResponse {
        return RemoteBootstrapPushResponse(
            appliedEntriesCount = 0,
            bootstrapHotChangeId = 0L
        )
    }

    override suspend fun pullReviewHistory(
        apiBaseUrl: String,
        bearerToken: String,
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
        bearerToken: String,
        workspaceId: String,
        body: JSONObject
    ): RemoteReviewHistoryImportResponse {
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

            CloudGuestUpgradeSelection.CreateNew -> CloudWorkspaceSummary(
                workspaceId = "workspace-new",
                name = localWorkspaceName,
                createdAtMillis = 300L,
                isSelected = true
            )
        }
    }
}
