package com.flashcardsopensourceapp.data.local.repository.cloudsync.account

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCredentialRecoveryReason
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCredentialRecoveryRequiredException
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCredentialRecoveryState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfigurationMode
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspacePostAuthRoute
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.CloudIdentityTestEnvironment
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.FakeCloudRemoteGateway
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
class LocalCloudAccountRepositoryGuestLocalRecoveryTest {
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
    fun completeCloudLinkGuestLocalRecoveryCreatesWorkspaceAndUploadsLocalData() = runBlocking {
        val localWorkspaceId = environment.requireLocalWorkspaceId()
        val installationId = environment.cloudPreferencesStore.currentCloudSettings().installationId
        val cardId = environment.seedWorkspaceData(workspaceId = localWorkspaceId)
        val syncLocalStore = environment.createSyncLocalStore()
        val localCard = requireNotNull(environment.database.cardDao().loadCard(cardId = cardId)) {
            "Seeded card is required for guest local recovery."
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
            bootstrapRemoteIsEmptyResponses = listOf(true),
            bootstrapPushErrors = emptyList()
        )
        val repository = environment.createCloudAccountRepository(remoteGateway = remoteGateway)
        environment.cloudPreferencesStore.saveCloudCredentialRecoveryState(recoveryState = recoveryState)
        val linkContext = repository.prepareVerifiedSignIn(
            credentials = createStoredCloudCredentials(idTokenExpiresAtMillis = Long.MAX_VALUE)
        )

        assertEquals(CloudWorkspacePostAuthRoute.GUEST_LOCAL_RECOVERY, linkContext.postAuthRoute)
        assertEquals("user-1", linkContext.userId)
        assertNull(linkContext.guestUpgradeMode)
        assertEquals(0, remoteGateway.prepareGuestUpgradeCalls)
        val selectedWorkspace = repository.completeCloudLink(
            linkContext = linkContext,
            selection = CloudWorkspaceLinkSelection.CreateNew
        )

        val createdWorkspaceId = remoteGateway.createdWorkspaceId
        assertEquals(createdWorkspaceId, selectedWorkspace.workspaceId)
        assertEquals(0, remoteGateway.selectWorkspaceCalls)
        assertEquals(1, remoteGateway.createWorkspaceCalls)
        assertEquals(0, remoteGateway.completeGuestUpgradeCalls)
        assertEquals(listOf(createdWorkspaceId), remoteGateway.bootstrapPullWorkspaceIds)
        assertEquals(true, remoteGateway.bootstrapPushBodies.single().getJSONArray("entries").length() > 0)
        assertEquals(1, remoteGateway.importReviewHistoryBodies.single().getJSONArray("reviewEvents").length())
        assertEquals(1, remoteGateway.pushBodies.single().getJSONArray("operations").length())
        assertNotNull(environment.cloudPreferencesStore.loadCredentials())
        assertNull(environment.cloudPreferencesStore.loadCloudCredentialRecoveryState())
        assertEquals(CloudAccountState.LINKED, environment.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals(createdWorkspaceId, environment.cloudPreferencesStore.currentCloudSettings().activeWorkspaceId)
        assertEquals(createdWorkspaceId, environment.cloudPreferencesStore.currentCloudSettings().linkedWorkspaceId)
        assertEquals(1, environment.database.workspaceDao().countWorkspaces())
        assertEquals(createdWorkspaceId, environment.database.workspaceDao().loadAnyWorkspace()?.workspaceId)
        val recoveredCards = environment.database.cardDao().loadCards(workspaceId = createdWorkspaceId)
        assertEquals(1, recoveredCards.count())
        assertEquals("Question", recoveredCards.single().frontText)
        assertEquals("Answer", recoveredCards.single().backText)
        assertEquals(1, environment.database.reviewLogDao().countReviewLogs(workspaceId = createdWorkspaceId))
        assertEquals(0, environment.database.outboxDao().countOutboxEntries())
    }

    @Test
    fun completeCloudLinkRejectsExistingWorkspaceForGuestLocalRecoveryBeforeSideEffects() = runBlocking {
        val localWorkspaceId = environment.requireLocalWorkspaceId()
        val installationId = environment.cloudPreferencesStore.currentCloudSettings().installationId
        val cardId = environment.seedWorkspaceData(workspaceId = localWorkspaceId)
        val remoteWorkspaceId = "workspace-remote"
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
            bootstrapRemoteIsEmptyResponses = listOf(true),
            bootstrapPushErrors = emptyList()
        )
        val repository = environment.createCloudAccountRepository(remoteGateway = remoteGateway)
        environment.cloudPreferencesStore.saveCloudCredentialRecoveryState(recoveryState = recoveryState)
        val linkContext = repository.prepareVerifiedSignIn(
            credentials = createStoredCloudCredentials(idTokenExpiresAtMillis = Long.MAX_VALUE)
        )

        try {
            repository.completeCloudLink(
                linkContext = linkContext,
                selection = CloudWorkspaceLinkSelection.Existing(workspaceId = remoteWorkspaceId)
            )
            throw AssertionError("Expected guest local recovery to reject an existing workspace.")
        } catch (error: CloudCredentialRecoveryRequiredException) {
            assertEquals(recoveryState, error.recoveryState)
        }

        assertEquals(0, remoteGateway.selectWorkspaceCalls)
        assertEquals(0, remoteGateway.createWorkspaceCalls)
        assertEquals(emptyList<String>(), remoteGateway.bootstrapPullWorkspaceIds)
        assertNull(environment.cloudPreferencesStore.loadCredentials())
        assertEquals(recoveryState, environment.cloudPreferencesStore.loadCloudCredentialRecoveryState())
        assertEquals(CloudAccountState.DISCONNECTED, environment.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals(localWorkspaceId, environment.cloudPreferencesStore.currentCloudSettings().activeWorkspaceId)
        assertEquals(1, environment.database.workspaceDao().countWorkspaces())
        assertEquals(localWorkspaceId, environment.database.workspaceDao().loadAnyWorkspace()?.workspaceId)
        assertEquals(1, environment.database.cardDao().loadCards(workspaceId = localWorkspaceId).count())
        assertEquals(cardId, environment.database.cardDao().loadCards(workspaceId = localWorkspaceId).single().cardId)
    }
}
