package com.flashcardsopensourceapp.data.local.cloudidentity

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.bootstrap.localWorkspaceName
import com.flashcardsopensourceapp.data.local.cloud.PendingGuestUpgradeState
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudCredentialRecoveryReason
import com.flashcardsopensourceapp.data.local.model.CloudCredentialRecoveryState
import com.flashcardsopensourceapp.data.local.model.CloudGuestUpgradeMode
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfigurationMode
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.model.makeOfficialCloudServiceConfiguration
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
class LocalCloudAccountRepositoryCredentialRecoveryEraseTest {
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
    fun eraseLocalDataForCredentialRecoveryClearsLocalStateWithoutBackendCalls() = runBlocking {
        val initialWorkspaceId = environment.requireLocalWorkspaceId()
        val initialInstallationId = environment.cloudPreferencesStore.currentCloudSettings().installationId
        val remoteGateway = FakeCloudRemoteGateway.standard()
        val repository = environment.createCloudAccountRepository(remoteGateway = remoteGateway)
        val guestSession = createStoredGuestAiSession(
            workspaceId = initialWorkspaceId,
            configurationMode = CloudServiceConfigurationMode.OFFICIAL,
            apiBaseUrl = "https://api.flashcards-open-source-app.com/v1",
            guestToken = "guest-token",
            userId = "guest-user"
        )
        val accountSnapshot = createCloudAccountSnapshot(
            userId = "user-1",
            email = "user@example.com",
            workspaces = listOf(
                createCloudWorkspaceSummary(
                    workspaceId = "workspace-linked",
                    name = "Linked Workspace",
                    createdAtMillis = 200L,
                    isSelected = true
                )
            )
        )

        environment.seedWorkspaceData(workspaceId = initialWorkspaceId)
        environment.cloudPreferencesStore.saveCredentials(
            credentials = createStoredCloudCredentials(idTokenExpiresAtMillis = Long.MAX_VALUE)
        )
        environment.cloudPreferencesStore.updateCloudSettings(
            cloudState = CloudAccountState.GUEST,
            linkedUserId = guestSession.userId,
            linkedWorkspaceId = initialWorkspaceId,
            linkedEmail = null,
            activeWorkspaceId = initialWorkspaceId
        )
        environment.guestAiSessionStore.saveSession(
            localWorkspaceId = initialWorkspaceId,
            session = guestSession
        )
        environment.cloudPreferencesStore.savePendingGuestUpgrade(
            pendingGuestUpgradeState = PendingGuestUpgradeState(
                configuration = makeOfficialCloudServiceConfiguration(),
                credentials = createStoredCloudCredentials(idTokenExpiresAtMillis = Long.MAX_VALUE),
                accountSnapshot = accountSnapshot,
                guestSession = guestSession,
                guestUpgradeMode = CloudGuestUpgradeMode.MERGE_REQUIRED,
                selection = CloudWorkspaceLinkSelection.CreateNew,
                completion = null
            )
        )
        environment.cloudPreferencesStore.saveCloudCredentialRecoveryState(
            recoveryState = CloudCredentialRecoveryState(
                reason = CloudCredentialRecoveryReason.GUEST_SESSION_MISSING,
                previousCloudState = CloudAccountState.GUEST,
                installationId = initialInstallationId,
                linkedUserId = guestSession.userId,
                linkedWorkspaceId = initialWorkspaceId,
                activeWorkspaceId = initialWorkspaceId,
                linkedEmail = null,
                configurationMode = CloudServiceConfigurationMode.OFFICIAL,
                apiBaseUrl = "https://api.flashcards-open-source-app.com/v1",
                detectedAtMillis = 500L
            )
        )
        environment.aiChatPreferencesStore.updateConsent(hasConsent = true)

        repository.eraseLocalDataForCredentialRecovery()

        val resetWorkspace = requireNotNull(environment.database.workspaceDao().loadAnyWorkspace()) {
            "Expected a fresh local workspace after recovery erase."
        }
        val resetCloudSettings = environment.cloudPreferencesStore.currentCloudSettings()

        assertNull(environment.cloudPreferencesStore.loadCredentials())
        assertNull(environment.cloudPreferencesStore.loadPendingGuestUpgrade())
        assertNull(environment.cloudPreferencesStore.loadCloudCredentialRecoveryState())
        assertEquals(CloudAccountState.DISCONNECTED, resetCloudSettings.cloudState)
        assertEquals(resetWorkspace.workspaceId, resetCloudSettings.activeWorkspaceId)
        assertNull(resetCloudSettings.linkedUserId)
        assertNull(resetCloudSettings.linkedWorkspaceId)
        assertNull(resetCloudSettings.linkedEmail)
        assertNotEquals(initialInstallationId, resetCloudSettings.installationId)
        assertNotEquals(initialWorkspaceId, resetWorkspace.workspaceId)
        assertEquals(localWorkspaceName, resetWorkspace.name)
        assertEquals(1, environment.database.workspaceDao().countWorkspaces())
        assertEquals(0, environment.database.cardDao().countActiveCards())
        assertEquals(0, environment.database.reviewLogDao().countReviewLogs())
        assertEquals(0, environment.database.outboxDao().countOutboxEntries())
        assertNull(environment.database.workspaceDao().loadWorkspaceById(workspaceId = initialWorkspaceId))
        assertNull(environment.database.syncStateDao().loadSyncState(workspaceId = initialWorkspaceId))
        assertNull(
            environment.guestAiSessionStore.loadAnySession(
                configuration = makeOfficialCloudServiceConfiguration()
            )
        )
        assertTrue(environment.aiChatPreferencesStore.hasConsent().not())
        assertEquals(0, remoteGateway.deleteAccountCalls)
        assertEquals(0, remoteGateway.fetchCloudAccountCalls)
        assertEquals(0, remoteGateway.verifyCodeCalls)
        assertEquals(0, remoteGateway.prepareGuestUpgradeCalls)
        assertEquals(0, remoteGateway.completeGuestUpgradeCalls)
        assertEquals(0, remoteGateway.createWorkspaceCalls)
        assertEquals(0, remoteGateway.selectWorkspaceCalls)
        assertEquals(emptyList<String>(), remoteGateway.syncRequestEvents)
    }
}
