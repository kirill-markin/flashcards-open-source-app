package com.flashcardsopensourceapp.data.local

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.ai.AiChatHistoryStore
import com.flashcardsopensourceapp.data.local.ai.AiChatPreferencesStore
import com.flashcardsopensourceapp.data.local.ai.GuestAiSessionStore
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
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceDeletePreview
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceDeleteResult
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.model.StoredCloudCredentials
import com.flashcardsopensourceapp.data.local.model.StoredGuestAiSession
import com.flashcardsopensourceapp.data.local.model.SyncStatus
import com.flashcardsopensourceapp.data.local.model.makeOfficialCloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.repository.CloudIdentityResetCoordinator
import com.flashcardsopensourceapp.data.local.repository.LocalCloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.LocalSyncRepository
import com.flashcardsopensourceapp.data.local.seed.DemoDataSeeder
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
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
    private lateinit var demoDataSeeder: DemoDataSeeder
    private lateinit var resetCoordinator: CloudIdentityResetCoordinator

    @Before
    fun setUp() {
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
        demoDataSeeder = DemoDataSeeder(database = database)
        resetCoordinator = CloudIdentityResetCoordinator(
            database = database,
            cloudPreferencesStore = cloudPreferencesStore,
            aiChatPreferencesStore = aiChatPreferencesStore,
            aiChatHistoryStore = aiChatHistoryStore,
            guestAiSessionStore = guestAiSessionStore,
            demoDataSeeder = demoDataSeeder
        )
    }

    @After
    fun tearDown() {
        database.close()
        clearTestPreferences()
    }

    @Test
    fun resetCoordinatorClearsIdentityAndReseedsFreshState() = runBlocking {
        demoDataSeeder.seedIfNeeded(currentTimeMillis = 100L)
        val initialDeviceId = cloudPreferencesStore.currentCloudSettings().deviceId
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
            linkedWorkspaceId = "workspace-demo",
            linkedEmail = "user@example.com",
            activeWorkspaceId = "workspace-demo"
        )
        aiChatPreferencesStore.updateConsent(hasConsent = true)
        aiChatHistoryStore.saveState(
            workspaceId = "workspace-demo",
            state = AiChatPersistedState(
                messages = emptyList(),
                selectedModelId = "gpt-5.2",
                chatSessionId = "session-1",
                codeInterpreterContainerId = "container-1"
            )
        )
        guestAiSessionStore.saveSession(
            localWorkspaceId = "workspace-demo",
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

        assertNull(cloudPreferencesStore.loadCredentials())
        assertEquals(CloudAccountState.DISCONNECTED, cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals("workspace-demo", cloudPreferencesStore.currentCloudSettings().activeWorkspaceId)
        assertNotEquals(initialDeviceId, cloudPreferencesStore.currentCloudSettings().deviceId)
        assertEquals(AccountDeletionState.Hidden, cloudPreferencesStore.currentAccountDeletionState())
        assertTrue(aiChatPreferencesStore.hasConsent().not())
        assertEquals("workspace-demo", database.workspaceDao().loadWorkspace()?.workspaceId)
        assertEquals(1, database.workspaceDao().countWorkspaces())
        assertEquals(1, database.outboxDao().countOutboxEntries())
        assertEquals(
            "gpt-5.4",
            aiChatHistoryStore.loadState(workspaceId = "workspace-demo").selectedModelId
        )
        assertNull(
            guestAiSessionStore.loadSession(
                localWorkspaceId = "workspace-demo",
                configuration = makeOfficialCloudServiceConfiguration()
            )
        )
    }

    @Test
    fun accountDeletionLifecyclePersistsFailureAndRetryCleansLocalState() = runBlocking {
        demoDataSeeder.seedIfNeeded(currentTimeMillis = 100L)
        val initialDeviceId = cloudPreferencesStore.currentCloudSettings().deviceId
        val remoteGateway = FakeCloudRemoteGateway(deleteFailuresRemaining = 1)
        val repository = createCloudAccountRepository(remoteGateway = remoteGateway)

        prepareLinkedCloudIdentity()

        repository.beginAccountDeletion()

        val failedState = cloudPreferencesStore.currentAccountDeletionState()
        assertTrue(failedState is AccountDeletionState.Failed)
        assertEquals(1, remoteGateway.deleteAccountCalls)
        assertEquals(CloudAccountState.LINKED, cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals("workspace-demo", database.workspaceDao().loadWorkspace()?.workspaceId)

        repository.retryPendingAccountDeletion()

        assertEquals(AccountDeletionState.Hidden, cloudPreferencesStore.currentAccountDeletionState())
        assertEquals(2, remoteGateway.deleteAccountCalls)
        assertEquals(CloudAccountState.DISCONNECTED, cloudPreferencesStore.currentCloudSettings().cloudState)
        assertNull(cloudPreferencesStore.loadCredentials())
        assertNotEquals(initialDeviceId, cloudPreferencesStore.currentCloudSettings().deviceId)
        assertEquals(1, database.workspaceDao().countWorkspaces())
        assertEquals("workspace-demo", database.workspaceDao().loadWorkspace()?.workspaceId)
    }

    @Test
    fun resumePendingAccountDeletionRepeatsDeleteOnNextLaunch() = runBlocking {
        demoDataSeeder.seedIfNeeded(currentTimeMillis = 100L)
        val remoteGateway = FakeCloudRemoteGateway(deleteFailuresRemaining = 0)
        val repository = createCloudAccountRepository(remoteGateway = remoteGateway)

        prepareLinkedCloudIdentity()
        cloudPreferencesStore.markAccountDeletionInProgress()

        repository.resumePendingAccountDeletionIfNeeded()

        assertEquals(1, remoteGateway.deleteAccountCalls)
        assertEquals(AccountDeletionState.Hidden, cloudPreferencesStore.currentAccountDeletionState())
        assertEquals(CloudAccountState.DISCONNECTED, cloudPreferencesStore.currentCloudSettings().cloudState)
    }

    @Test
    fun syncRepositoryResetsLocalStateOnRemoteAccountDeleted() = runBlocking {
        demoDataSeeder.seedIfNeeded(currentTimeMillis = 100L)
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
            resetCoordinator = resetCoordinator
        )

        prepareLinkedCloudIdentity()
        aiChatPreferencesStore.updateConsent(hasConsent = true)

        repository.syncNow()

        assertEquals(CloudAccountState.DISCONNECTED, cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals(AccountDeletionState.Hidden, cloudPreferencesStore.currentAccountDeletionState())
        assertNull(cloudPreferencesStore.loadCredentials())
        assertTrue(aiChatPreferencesStore.hasConsent().not())
        assertEquals(SyncStatus.Idle, repository.observeSyncStatus().first().status)
        assertEquals("workspace-demo", database.workspaceDao().loadWorkspace()?.workspaceId)
    }

    @Test
    fun verifyCodePreparesBoundGuestUpgradeWhenGuestSessionExists() = runBlocking {
        demoDataSeeder.seedIfNeeded(currentTimeMillis = 100L)
        val remoteGateway = FakeCloudRemoteGateway(guestUpgradeMode = CloudGuestUpgradeMode.BOUND)
        val repository = createCloudAccountRepository(remoteGateway = remoteGateway)
        guestAiSessionStore.saveSession(
            localWorkspaceId = "workspace-demo",
            session = StoredGuestAiSession(
                guestToken = "guest-token",
                userId = "guest-user",
                workspaceId = "guest-workspace",
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
        assertEquals(1, remoteGateway.prepareGuestUpgradeCalls)
    }

    @Test
    fun completeGuestUpgradeClearsGuestSessionAndLinksWorkspace() = runBlocking {
        demoDataSeeder.seedIfNeeded(currentTimeMillis = 100L)
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
            localWorkspaceId = "workspace-demo",
            session = StoredGuestAiSession(
                guestToken = "guest-token",
                userId = "guest-user",
                workspaceId = "guest-workspace",
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
        assertNull(
            guestAiSessionStore.loadAnySession(configuration = makeOfficialCloudServiceConfiguration())
        )
        assertEquals(1, remoteGateway.prepareGuestUpgradeCalls)
        assertEquals(1, remoteGateway.completeGuestUpgradeCalls)
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
            resetCoordinator = resetCoordinator,
            guestSessionStore = guestAiSessionStore
        )
    }

    private fun prepareLinkedCloudIdentity() {
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
            linkedWorkspaceId = "workspace-demo",
            linkedEmail = "user@example.com",
            activeWorkspaceId = "workspace-demo"
        )
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
    private val accountSnapshot: CloudAccountSnapshot = CloudAccountSnapshot(
        userId = "user-1",
        email = "user@example.com",
        workspaces = listOf(
            CloudWorkspaceSummary(
                workspaceId = "workspace-demo",
                name = "Personal Workspace",
                createdAtMillis = 100L,
                isSelected = true
            )
        )
    )
) : CloudRemoteGateway {
    var deleteAccountCalls: Int = 0
    var prepareGuestUpgradeCalls: Int = 0
    var completeGuestUpgradeCalls: Int = 0

    override fun validateConfiguration(configuration: CloudServiceConfiguration) {
    }

    override fun sendCode(email: String, authBaseUrl: String): CloudSendCodeResult {
        return CloudSendCodeResult.OtpRequired(
            challenge = CloudOtpChallenge(
                email = email,
                csrfToken = "csrf",
                otpSessionToken = "otp"
            )
        )
    }

    override fun verifyCode(challenge: CloudOtpChallenge, code: String, authBaseUrl: String): StoredCloudCredentials {
        return StoredCloudCredentials(
            refreshToken = "refresh-token",
            idToken = "id-token",
            idTokenExpiresAtMillis = Long.MAX_VALUE
        )
    }

    override fun refreshIdToken(refreshToken: String, authBaseUrl: String): StoredCloudCredentials {
        return StoredCloudCredentials(
            refreshToken = refreshToken,
            idToken = "id-token",
            idTokenExpiresAtMillis = Long.MAX_VALUE
        )
    }

    override fun fetchCloudAccount(apiBaseUrl: String, bearerToken: String): CloudAccountSnapshot {
        fetchAccountError?.let { error ->
            throw error
        }
        return accountSnapshot
    }

    override fun listLinkedWorkspaces(apiBaseUrl: String, bearerToken: String): List<CloudWorkspaceSummary> {
        return fetchCloudAccount(apiBaseUrl = apiBaseUrl, bearerToken = bearerToken).workspaces
    }

    override fun prepareGuestUpgrade(
        apiBaseUrl: String,
        bearerToken: String,
        guestToken: String
    ): CloudGuestUpgradeMode {
        prepareGuestUpgradeCalls += 1
        return requireNotNull(guestUpgradeMode) {
            "Guest upgrade mode is required for this test."
        }
    }

    override fun completeGuestUpgrade(
        apiBaseUrl: String,
        bearerToken: String,
        guestToken: String,
        selection: CloudGuestUpgradeSelection
    ): CloudWorkspaceSummary {
        completeGuestUpgradeCalls += 1
        return resolveWorkspaceSelection(selection = selection)
    }

    override fun createWorkspace(apiBaseUrl: String, bearerToken: String, name: String): CloudWorkspaceSummary {
        return CloudWorkspaceSummary(
            workspaceId = "workspace-new",
            name = name,
            createdAtMillis = 300L,
            isSelected = true
        )
    }

    override fun selectWorkspace(apiBaseUrl: String, bearerToken: String, workspaceId: String): CloudWorkspaceSummary {
        return accountSnapshot.workspaces.first { workspace ->
            workspace.workspaceId == workspaceId
        }
    }

    override fun renameWorkspace(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String,
        name: String
    ): CloudWorkspaceSummary {
        throw UnsupportedOperationException()
    }

    override fun loadWorkspaceDeletePreview(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String
    ): CloudWorkspaceDeletePreview {
        throw UnsupportedOperationException()
    }

    override fun deleteWorkspace(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String,
        confirmationText: String
    ): CloudWorkspaceDeleteResult {
        throw UnsupportedOperationException()
    }

    override fun deleteAccount(apiBaseUrl: String, bearerToken: String, confirmationText: String) {
        deleteAccountCalls += 1
        if (deleteFailuresRemaining > 0) {
            deleteFailuresRemaining -= 1
            throw IllegalStateException("Delete request did not finish.")
        }
    }

    override fun listAgentConnections(apiBaseUrl: String, bearerToken: String): AgentApiKeyConnectionsResult {
        throw UnsupportedOperationException()
    }

    override fun revokeAgentConnection(
        apiBaseUrl: String,
        bearerToken: String,
        connectionId: String
    ): AgentApiKeyConnectionsResult {
        throw UnsupportedOperationException()
    }

    override fun push(apiBaseUrl: String, bearerToken: String, workspaceId: String, body: JSONObject): RemotePushResponse {
        return RemotePushResponse(operations = emptyList())
    }

    override fun pull(apiBaseUrl: String, bearerToken: String, workspaceId: String, body: JSONObject): RemotePullResponse {
        return RemotePullResponse(changes = emptyList(), nextHotChangeId = 0L, hasMore = false)
    }

    override fun bootstrapPull(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String,
        body: JSONObject
    ): RemoteBootstrapPullResponse {
        return RemoteBootstrapPullResponse(
            entries = emptyList(),
            nextCursor = null,
            hasMore = false,
            bootstrapHotChangeId = 0L,
            remoteIsEmpty = true
        )
    }

    override fun bootstrapPush(
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

    override fun pullReviewHistory(
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

    override fun importReviewHistory(
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
                name = "Personal",
                createdAtMillis = 300L,
                isSelected = true
            )
        }
    }
}
