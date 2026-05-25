package com.flashcardsopensourceapp.data.local.repository.cloudsync.account

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudCredentialRecoveryReason
import com.flashcardsopensourceapp.data.local.model.CloudCredentialRecoveryState
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfigurationMode
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.CloudIdentityTestEnvironment
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.FakeCloudRemoteGateway
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.createCloudAccountSnapshot
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.createCloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.createStoredCloudCredentials
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LocalCloudAccountRepositoryRecoverySyncFailureTest {
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
    fun completeCloudLinkLinkedCredentialRecoveryKeepsRecoveryStateUntilInitialSyncSucceeds() = runBlocking {
        val localWorkspaceId = environment.requireLocalWorkspaceId()
        val installationId = environment.cloudPreferencesStore.currentCloudSettings().installationId
        val cardId = environment.seedWorkspaceData(workspaceId = localWorkspaceId)
        val recoveryState = CloudCredentialRecoveryState(
            reason = CloudCredentialRecoveryReason.LINKED_CREDENTIALS_MISSING,
            previousCloudState = CloudAccountState.LINKED,
            installationId = installationId,
            linkedUserId = "user-1",
            linkedWorkspaceId = localWorkspaceId,
            activeWorkspaceId = localWorkspaceId,
            linkedEmail = "user@example.com",
            configurationMode = CloudServiceConfigurationMode.OFFICIAL,
            apiBaseUrl = "https://api.flashcards-open-source-app.com/v1",
            detectedAtMillis = 500L
        )
        val remoteGateway = FakeCloudRemoteGateway.forBootstrapPushScenario(
            accountSnapshot = createCloudAccountSnapshot(
                userId = "user-1",
                email = "user@example.com",
                workspaces = listOf(
                    createCloudWorkspaceSummary(
                        workspaceId = localWorkspaceId,
                        name = "Recovered",
                        createdAtMillis = 100L,
                        isSelected = true
                    )
                )
            ),
            bootstrapRemoteIsEmptyResponses = listOf(true, true),
            bootstrapPushErrors = listOf(IllegalStateException("Forced bootstrap failure."))
        )
        val repository = environment.createCloudAccountRepository(remoteGateway = remoteGateway)
        environment.cloudPreferencesStore.saveCloudCredentialRecoveryState(recoveryState = recoveryState)
        val linkContext = repository.prepareVerifiedSignIn(
            credentials = createStoredCloudCredentials(idTokenExpiresAtMillis = Long.MAX_VALUE)
        )

        try {
            repository.completeCloudLink(
                linkContext = linkContext,
                selection = CloudWorkspaceLinkSelection.Existing(workspaceId = localWorkspaceId)
            )
            throw AssertionError("Expected linked recovery initial sync to fail.")
        } catch (error: IllegalStateException) {
            assertEquals(true, error.message?.contains("Forced bootstrap failure.") == true)
        }

        assertNotNull(environment.cloudPreferencesStore.loadCredentials())
        assertEquals(recoveryState, environment.cloudPreferencesStore.loadCloudCredentialRecoveryState())
        assertEquals(CloudAccountState.LINKED, environment.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals(localWorkspaceId, environment.cloudPreferencesStore.currentCloudSettings().linkedWorkspaceId)
        assertEquals(localWorkspaceId, environment.cloudPreferencesStore.currentCloudSettings().activeWorkspaceId)
        assertEquals(listOf(localWorkspaceId), remoteGateway.bootstrapPullWorkspaceIds)
        assertEquals(1, remoteGateway.bootstrapPushBodies.size)
        assertEquals(1, environment.database.cardDao().loadCards(workspaceId = localWorkspaceId).count())
        assertEquals(cardId, environment.database.cardDao().loadCards(workspaceId = localWorkspaceId).single().cardId)

        val recoveredWorkspace = repository.completeCloudLink(
            linkContext = linkContext,
            selection = CloudWorkspaceLinkSelection.Existing(workspaceId = localWorkspaceId)
        )

        assertEquals(localWorkspaceId, recoveredWorkspace.workspaceId)
        assertEquals(listOf(localWorkspaceId, localWorkspaceId), remoteGateway.bootstrapPullWorkspaceIds)
        assertEquals(2, remoteGateway.bootstrapPushBodies.size)
        assertEquals(1, remoteGateway.importReviewHistoryBodies.single().getJSONArray("reviewEvents").length())
        assertNull(environment.cloudPreferencesStore.loadCloudCredentialRecoveryState())
        assertEquals(CloudAccountState.LINKED, environment.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals(localWorkspaceId, environment.cloudPreferencesStore.currentCloudSettings().linkedWorkspaceId)
        assertEquals(localWorkspaceId, environment.cloudPreferencesStore.currentCloudSettings().activeWorkspaceId)
        assertEquals(1, environment.database.cardDao().loadCards(workspaceId = localWorkspaceId).count())
        assertEquals(cardId, environment.database.cardDao().loadCards(workspaceId = localWorkspaceId).single().cardId)
    }

    @Test
    fun completeCloudLinkGuestLocalRecoveryRetryUsesCreatedWorkspaceAfterInitialSyncFailure() = runBlocking {
        val localWorkspaceId = environment.requireLocalWorkspaceId()
        val installationId = environment.cloudPreferencesStore.currentCloudSettings().installationId
        val cardId = environment.seedWorkspaceData(workspaceId = localWorkspaceId)
        val syncLocalStore = environment.createSyncLocalStore()
        val localCard = requireNotNull(environment.database.cardDao().loadCard(cardId = cardId)) {
            "Seeded card is required for guest local recovery retry."
        }
        syncLocalStore.enqueueCardUpsert(
            card = localCard,
            tags = emptyList(),
            affectsReviewSchedule = true
        )
        val recoveryState = CloudCredentialRecoveryState(
            reason = CloudCredentialRecoveryReason.GUEST_SESSION_MISSING,
            previousCloudState = CloudAccountState.GUEST,
            installationId = installationId,
            linkedUserId = "guest-user",
            linkedWorkspaceId = localWorkspaceId,
            activeWorkspaceId = localWorkspaceId,
            linkedEmail = null,
            configurationMode = CloudServiceConfigurationMode.OFFICIAL,
            apiBaseUrl = "https://api.flashcards-open-source-app.com/v1",
            detectedAtMillis = 500L
        )
        val remoteGateway = FakeCloudRemoteGateway.forBootstrapPushScenario(
            bootstrapRemoteIsEmptyResponses = listOf(true, true),
            bootstrapPushErrors = listOf(IllegalStateException("Forced bootstrap failure"))
        )
        val repository = environment.createCloudAccountRepository(remoteGateway = remoteGateway)
        environment.cloudPreferencesStore.saveCloudCredentialRecoveryState(recoveryState = recoveryState)
        val linkContext = repository.prepareVerifiedSignIn(
            credentials = createStoredCloudCredentials(idTokenExpiresAtMillis = Long.MAX_VALUE)
        )

        try {
            repository.completeCloudLink(
                linkContext = linkContext,
                selection = CloudWorkspaceLinkSelection.CreateNew
            )
            throw AssertionError("Expected guest local recovery initial sync to fail.")
        } catch (error: IllegalStateException) {
            assertEquals(true, error.message?.contains("Forced bootstrap failure") == true)
        }

        val createdWorkspaceId = remoteGateway.createdWorkspaceId
        assertEquals(1, remoteGateway.createWorkspaceCalls)
        assertNotNull(environment.cloudPreferencesStore.loadCredentials())
        assertEquals(recoveryState, environment.cloudPreferencesStore.loadCloudCredentialRecoveryState())
        assertEquals(CloudAccountState.LINKED, environment.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals(createdWorkspaceId, environment.cloudPreferencesStore.currentCloudSettings().activeWorkspaceId)
        assertEquals(createdWorkspaceId, environment.cloudPreferencesStore.currentCloudSettings().linkedWorkspaceId)
        assertEquals(1, environment.database.cardDao().loadCards(workspaceId = createdWorkspaceId).count())
        assertEquals(1, environment.database.reviewLogDao().countReviewLogs(workspaceId = createdWorkspaceId))
        assertEquals(1, environment.database.outboxDao().countOutboxEntriesForWorkspace(workspaceId = createdWorkspaceId))

        val recoveredWorkspace = repository.completeCloudLink(
            linkContext = linkContext,
            selection = CloudWorkspaceLinkSelection.CreateNew
        )

        assertEquals(createdWorkspaceId, recoveredWorkspace.workspaceId)
        assertEquals(1, remoteGateway.createWorkspaceCalls)
        assertEquals(0, remoteGateway.selectWorkspaceCalls)
        assertEquals(0, remoteGateway.completeGuestUpgradeCalls)
        assertEquals(listOf(createdWorkspaceId, createdWorkspaceId), remoteGateway.bootstrapPullWorkspaceIds)
        assertEquals(2, remoteGateway.bootstrapPushBodies.size)
        assertEquals(1, remoteGateway.importReviewHistoryBodies.single().getJSONArray("reviewEvents").length())
        assertEquals(1, remoteGateway.pushBodies.single().getJSONArray("operations").length())
        assertNull(environment.cloudPreferencesStore.loadCloudCredentialRecoveryState())
        assertEquals(0, environment.database.outboxDao().countOutboxEntries())
    }
}
