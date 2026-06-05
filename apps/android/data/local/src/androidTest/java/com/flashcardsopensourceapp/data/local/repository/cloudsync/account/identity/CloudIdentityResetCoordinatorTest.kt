package com.flashcardsopensourceapp.data.local.repository.cloudsync.account.identity

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.bootstrap.localWorkspaceName
import com.flashcardsopensourceapp.data.local.model.cloud.AccountDeletionState
import com.flashcardsopensourceapp.data.local.model.ai.AiChatPersistedState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCredentialRecoveryReason
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCredentialRecoveryState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfigurationMode
import com.flashcardsopensourceapp.data.local.model.ai.effectiveAiChatServerConfig
import com.flashcardsopensourceapp.data.local.model.cloud.makeOfficialCloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.CloudIdentityTestEnvironment
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.FakeCloudRemoteGateway
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.createStoredCloudCredentials
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.createStoredGuestAiSession
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class CloudIdentityResetCoordinatorTest {
    private lateinit var environment: CloudIdentityTestEnvironment

    @Before
    fun setUp() = runBlocking {
        environment = CloudIdentityTestEnvironment.create()
    }

    @After
    fun tearDown() {
        environment.close()
    }

    @Test
    fun resetLocalStateClearsIdentityAndRecreatesEmptyWorkspace() = runBlocking {
        val initialLocalWorkspaceId = environment.requireLocalWorkspaceId()
        val initialInstallationId = environment.cloudPreferencesStore.currentCloudSettings().installationId
        environment.cloudPreferencesStore.saveCredentials(
            credentials = createStoredCloudCredentials(idTokenExpiresAtMillis = 10_000L)
        )
        environment.cloudPreferencesStore.updateCloudSettings(
            cloudState = CloudAccountState.LINKED,
            linkedUserId = "user-1",
            linkedWorkspaceId = initialLocalWorkspaceId,
            linkedEmail = "user@example.com",
            activeWorkspaceId = initialLocalWorkspaceId
        )
        environment.aiChatPreferencesStore.updateConsent(hasConsent = true)
        environment.aiChatHistoryStore.saveState(
            workspaceId = initialLocalWorkspaceId,
            state = AiChatPersistedState(
                messages = emptyList(),
                chatSessionId = "session-1",
                lastKnownChatConfig = null,
                pendingToolRunPostSync = false,
                requiresRemoteSessionProvisioning = false
            )
        )
        environment.guestAiSessionStore.saveSession(
            localWorkspaceId = initialLocalWorkspaceId,
            session = createStoredGuestAiSession(
                workspaceId = "guest-workspace",
                configurationMode = CloudServiceConfigurationMode.OFFICIAL,
                apiBaseUrl = "https://api.flashcards-open-source-app.com/v1",
                guestToken = "guest-token",
                userId = "guest-user"
            )
        )
        environment.cloudPreferencesStore.saveCloudCredentialRecoveryState(
            recoveryState = CloudCredentialRecoveryState(
                reason = CloudCredentialRecoveryReason.LINKED_CREDENTIALS_MISSING,
                previousCloudState = CloudAccountState.LINKED,
                installationId = initialInstallationId,
                linkedUserId = "user-1",
                linkedWorkspaceId = initialLocalWorkspaceId,
                activeWorkspaceId = initialLocalWorkspaceId,
                linkedEmail = "user@example.com",
                configurationMode = CloudServiceConfigurationMode.OFFICIAL,
                apiBaseUrl = "https://api.flashcards-open-source-app.com/v1",
                detectedAtMillis = 500L
            )
        )
        environment.cloudPreferencesStore.markAccountDeletionInProgress()

        environment.resetCoordinator.resetLocalStateForCloudIdentityChange()

        val resetWorkspace = requireNotNull(environment.database.workspaceDao().loadAnyWorkspace()) {
            "Expected a local workspace after reset."
        }

        assertNull(environment.cloudPreferencesStore.loadCredentials())
        assertNull(environment.cloudPreferencesStore.loadCloudCredentialRecoveryState())
        assertEquals(CloudAccountState.DISCONNECTED, environment.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals(resetWorkspace.workspaceId, environment.cloudPreferencesStore.currentCloudSettings().activeWorkspaceId)
        assertNotEquals(initialLocalWorkspaceId, resetWorkspace.workspaceId)
        assertNotEquals(initialInstallationId, environment.cloudPreferencesStore.currentCloudSettings().installationId)
        assertEquals(AccountDeletionState.Hidden, environment.cloudPreferencesStore.currentAccountDeletionState())
        assertTrue(environment.aiChatPreferencesStore.hasConsent().not())
        assertEquals(localWorkspaceName, resetWorkspace.name)
        assertEquals(1, environment.database.workspaceDao().countWorkspaces())
        assertEquals(0, environment.database.outboxDao().countOutboxEntries())
        val resetChatConfig = effectiveAiChatServerConfig(
            environment.aiChatHistoryStore.loadState(workspaceId = resetWorkspace.workspaceId).lastKnownChatConfig
        )
        assertTrue(resetChatConfig.features.dictationEnabled)
        assertTrue(resetChatConfig.features.attachmentsEnabled)
        assertNull(
            environment.guestAiSessionStore.loadSession(
                localWorkspaceId = resetWorkspace.workspaceId,
                configuration = makeOfficialCloudServiceConfiguration()
            )
        )
    }

    @Test
    fun retryPendingAccountDeletionResetsLocalStateAfterDeleteFailure() = runBlocking {
        val initialLocalWorkspaceId = environment.requireLocalWorkspaceId()
        val initialInstallationId = environment.cloudPreferencesStore.currentCloudSettings().installationId
        val remoteGateway = FakeCloudRemoteGateway.forAccountDeletion(deleteFailuresRemaining = 1)
        val repository = environment.createCloudAccountRepository(remoteGateway = remoteGateway)

        environment.prepareLinkedCloudIdentity(localWorkspaceId = initialLocalWorkspaceId)

        repository.beginAccountDeletion()

        val failedState = environment.cloudPreferencesStore.currentAccountDeletionState()
        assertTrue(failedState is AccountDeletionState.Failed)
        assertEquals(1, remoteGateway.deleteAccountCalls)
        assertEquals(CloudAccountState.LINKED, environment.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals(initialLocalWorkspaceId, environment.database.workspaceDao().loadAnyWorkspace()?.workspaceId)

        repository.retryPendingAccountDeletion()

        val resetWorkspace = requireNotNull(environment.database.workspaceDao().loadAnyWorkspace()) {
            "Expected a local workspace after retry."
        }

        assertEquals(AccountDeletionState.Hidden, environment.cloudPreferencesStore.currentAccountDeletionState())
        assertEquals(2, remoteGateway.deleteAccountCalls)
        assertEquals(CloudAccountState.DISCONNECTED, environment.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertNull(environment.cloudPreferencesStore.loadCredentials())
        assertNotEquals(initialInstallationId, environment.cloudPreferencesStore.currentCloudSettings().installationId)
        assertEquals(1, environment.database.workspaceDao().countWorkspaces())
        assertEquals(localWorkspaceName, resetWorkspace.name)
        assertNotEquals(initialLocalWorkspaceId, resetWorkspace.workspaceId)
    }

    @Test
    fun resumePendingAccountDeletionResetsLocalStateOnLaunch() = runBlocking {
        val initialLocalWorkspaceId = environment.requireLocalWorkspaceId()
        val remoteGateway = FakeCloudRemoteGateway.forAccountDeletion(deleteFailuresRemaining = 0)
        val repository = environment.createCloudAccountRepository(remoteGateway = remoteGateway)

        environment.prepareLinkedCloudIdentity(localWorkspaceId = initialLocalWorkspaceId)
        environment.cloudPreferencesStore.markAccountDeletionInProgress()

        repository.resumePendingAccountDeletionIfNeeded()

        assertEquals(1, remoteGateway.deleteAccountCalls)
        assertEquals(AccountDeletionState.Hidden, environment.cloudPreferencesStore.currentAccountDeletionState())
        assertEquals(CloudAccountState.DISCONNECTED, environment.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals(localWorkspaceName, environment.database.workspaceDao().loadAnyWorkspace()?.name)
    }
}
