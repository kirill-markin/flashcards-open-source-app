package com.flashcardsopensourceapp.data.local.repository.cloudsync.account

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudCredentialRecoveryReason
import com.flashcardsopensourceapp.data.local.model.CloudCredentialRecoveryRequiredException
import com.flashcardsopensourceapp.data.local.model.CloudCredentialRecoveryState
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfigurationMode
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.model.CloudWorkspacePostAuthRoute
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.CloudIdentityTestEnvironment
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.FakeCloudRemoteGateway
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.createCloudAccountSnapshot
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.createCloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.createStoredCloudCredentials
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.createStoredGuestAiSession
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LocalCloudAccountRepositoryLinkedCredentialRecoveryTest {
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
    fun prepareVerifiedSignInPrefersRecoveredWorkspaceDuringLinkedCredentialRecovery() = runBlocking {
        val localWorkspaceId = environment.requireLocalWorkspaceId()
        val installationId = environment.cloudPreferencesStore.currentCloudSettings().installationId
        val remoteGateway = FakeCloudRemoteGateway.forAccountSnapshot(
            accountSnapshot = createCloudAccountSnapshot(
                userId = "user-1",
                email = "user@example.com",
                workspaces = listOf(
                    createCloudWorkspaceSummary(
                        workspaceId = localWorkspaceId,
                        name = "Recovered",
                        createdAtMillis = 100L,
                        isSelected = false
                    ),
                    createCloudWorkspaceSummary(
                        workspaceId = "workspace-selected",
                        name = "Selected",
                        createdAtMillis = 200L,
                        isSelected = true
                    )
                )
            )
        )
        val repository = environment.createCloudAccountRepository(remoteGateway = remoteGateway)
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
        environment.cloudPreferencesStore.saveCloudCredentialRecoveryState(recoveryState = recoveryState)

        val linkContext = repository.prepareVerifiedSignIn(
            credentials = createStoredCloudCredentials(idTokenExpiresAtMillis = Long.MAX_VALUE)
        )

        assertEquals(CloudWorkspacePostAuthRoute.LINKED_CREDENTIAL_RESTORE, linkContext.postAuthRoute)
        assertEquals(localWorkspaceId, linkContext.preferredWorkspaceId)
        assertEquals(recoveryState, environment.cloudPreferencesStore.loadCloudCredentialRecoveryState())
        assertNull(environment.cloudPreferencesStore.loadCredentials())
    }

    @Test
    fun linkedCredentialRecoveryRestoresCredentialsForSameAccountAndWorkspace() = runBlocking {
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
        val remoteGateway = FakeCloudRemoteGateway.forAccountSnapshot(
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
            )
        )
        val repository = environment.createCloudAccountRepository(remoteGateway = remoteGateway)
        environment.cloudPreferencesStore.saveCloudCredentialRecoveryState(recoveryState = recoveryState)
        val linkContext = repository.prepareVerifiedSignIn(
            credentials = createStoredCloudCredentials(idTokenExpiresAtMillis = Long.MAX_VALUE)
        )

        val selectedWorkspace = repository.completeCloudLink(
            linkContext = linkContext,
            selection = CloudWorkspaceLinkSelection.Existing(workspaceId = localWorkspaceId)
        )

        assertEquals(CloudWorkspacePostAuthRoute.LINKED_CREDENTIAL_RESTORE, linkContext.postAuthRoute)
        assertEquals(localWorkspaceId, linkContext.preferredWorkspaceId)
        assertEquals(localWorkspaceId, selectedWorkspace.workspaceId)
        assertEquals(1, remoteGateway.selectWorkspaceCalls)
        assertEquals(0, remoteGateway.createWorkspaceCalls)
        assertEquals(listOf(localWorkspaceId), remoteGateway.bootstrapPullWorkspaceIds)
        assertEquals(true, remoteGateway.bootstrapPushBodies.single().getJSONArray("entries").length() > 0)
        assertEquals(1, remoteGateway.importReviewHistoryBodies.single().getJSONArray("reviewEvents").length())
        assertNotNull(environment.cloudPreferencesStore.loadCredentials())
        assertNull(environment.cloudPreferencesStore.loadCloudCredentialRecoveryState())
        assertEquals(CloudAccountState.LINKED, environment.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals(localWorkspaceId, environment.cloudPreferencesStore.currentCloudSettings().linkedWorkspaceId)
        assertEquals(localWorkspaceId, environment.cloudPreferencesStore.currentCloudSettings().activeWorkspaceId)
        assertEquals(1, environment.database.workspaceDao().countWorkspaces())
        assertEquals(localWorkspaceId, environment.database.workspaceDao().loadAnyWorkspace()?.workspaceId)
        assertEquals(1, environment.database.cardDao().loadCards(workspaceId = localWorkspaceId).count())
        assertEquals(cardId, environment.database.cardDao().loadCards(workspaceId = localWorkspaceId).single().cardId)
    }

    @Test
    fun linkedCredentialRecoveryFailsClosedWhenExpectedIdentityIsMissing() = runBlocking {
        val localWorkspaceId = environment.requireLocalWorkspaceId()
        val installationId = environment.cloudPreferencesStore.currentCloudSettings().installationId
        val cardId = environment.seedWorkspaceData(workspaceId = localWorkspaceId)
        val recoveryState = CloudCredentialRecoveryState(
            reason = CloudCredentialRecoveryReason.LINKED_CREDENTIALS_MISSING,
            previousCloudState = CloudAccountState.LINKED,
            installationId = installationId,
            linkedUserId = null,
            linkedWorkspaceId = localWorkspaceId,
            activeWorkspaceId = localWorkspaceId,
            linkedEmail = null,
            configurationMode = CloudServiceConfigurationMode.OFFICIAL,
            apiBaseUrl = "https://api.flashcards-open-source-app.com/v1",
            detectedAtMillis = 500L
        )
        val remoteGateway = FakeCloudRemoteGateway.forAccountSnapshot(
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
            )
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
            throw AssertionError("Expected linked recovery to fail closed without stored identity.")
        } catch (error: CloudCredentialRecoveryRequiredException) {
            assertEquals(recoveryState, error.recoveryState)
        }

        assertEquals(CloudWorkspacePostAuthRoute.LINKED_CREDENTIAL_RESTORE, linkContext.postAuthRoute)
        assertNull(linkContext.preferredWorkspaceId)
        assertEquals(0, remoteGateway.selectWorkspaceCalls)
        assertEquals(0, remoteGateway.createWorkspaceCalls)
        assertNull(environment.cloudPreferencesStore.loadCredentials())
        assertEquals(recoveryState, environment.cloudPreferencesStore.loadCloudCredentialRecoveryState())
        assertEquals(localWorkspaceId, environment.cloudPreferencesStore.currentCloudSettings().activeWorkspaceId)
        assertEquals(1, environment.database.cardDao().loadCards(workspaceId = localWorkspaceId).count())
        assertEquals(cardId, environment.database.cardDao().loadCards(workspaceId = localWorkspaceId).single().cardId)
    }

    @Test
    fun linkedCredentialRecoveryFailsClosedWhenExpectedWorkspaceIsMissing() = runBlocking {
        val localWorkspaceId = environment.requireLocalWorkspaceId()
        val installationId = environment.cloudPreferencesStore.currentCloudSettings().installationId
        val cardId = environment.seedWorkspaceData(workspaceId = localWorkspaceId)
        val recoveryState = CloudCredentialRecoveryState(
            reason = CloudCredentialRecoveryReason.LINKED_CREDENTIALS_MISSING,
            previousCloudState = CloudAccountState.LINKED,
            installationId = installationId,
            linkedUserId = "user-1",
            linkedWorkspaceId = null,
            activeWorkspaceId = null,
            linkedEmail = "user@example.com",
            configurationMode = CloudServiceConfigurationMode.OFFICIAL,
            apiBaseUrl = "https://api.flashcards-open-source-app.com/v1",
            detectedAtMillis = 500L
        )
        val remoteGateway = FakeCloudRemoteGateway.forAccountSnapshot(
            accountSnapshot = createCloudAccountSnapshot(
                userId = "user-1",
                email = "user@example.com",
                workspaces = listOf(
                    createCloudWorkspaceSummary(
                        workspaceId = "workspace-remote",
                        name = "Remote",
                        createdAtMillis = 100L,
                        isSelected = true
                    )
                )
            )
        )
        val repository = environment.createCloudAccountRepository(remoteGateway = remoteGateway)
        environment.cloudPreferencesStore.saveCloudCredentialRecoveryState(recoveryState = recoveryState)
        val linkContext = repository.prepareVerifiedSignIn(
            credentials = createStoredCloudCredentials(idTokenExpiresAtMillis = Long.MAX_VALUE)
        )

        try {
            repository.completeCloudLink(
                linkContext = linkContext,
                selection = CloudWorkspaceLinkSelection.Existing(workspaceId = "workspace-remote")
            )
            throw AssertionError("Expected linked recovery to fail closed without a stored workspace.")
        } catch (error: CloudCredentialRecoveryRequiredException) {
            assertEquals(recoveryState, error.recoveryState)
        }

        assertEquals(CloudWorkspacePostAuthRoute.LINKED_CREDENTIAL_RESTORE, linkContext.postAuthRoute)
        assertNull(linkContext.preferredWorkspaceId)
        assertEquals(0, remoteGateway.selectWorkspaceCalls)
        assertEquals(0, remoteGateway.createWorkspaceCalls)
        assertNull(environment.cloudPreferencesStore.loadCredentials())
        assertEquals(recoveryState, environment.cloudPreferencesStore.loadCloudCredentialRecoveryState())
        assertEquals(localWorkspaceId, environment.cloudPreferencesStore.currentCloudSettings().activeWorkspaceId)
        assertEquals(1, environment.database.cardDao().loadCards(workspaceId = localWorkspaceId).count())
        assertEquals(cardId, environment.database.cardDao().loadCards(workspaceId = localWorkspaceId).single().cardId)
    }

    @Test
    fun linkedCredentialRecoveryRejectsFormerLinkedWorkspaceWhenActiveWorkspaceDiffers() = runBlocking {
        val localWorkspaceId = environment.requireLocalWorkspaceId()
        val installationId = environment.cloudPreferencesStore.currentCloudSettings().installationId
        val cardId = environment.seedWorkspaceData(workspaceId = localWorkspaceId)
        val linkedWorkspaceId = "workspace-linked"
        val recoveryState = CloudCredentialRecoveryState(
            reason = CloudCredentialRecoveryReason.LINKED_CREDENTIALS_MISSING,
            previousCloudState = CloudAccountState.LINKED,
            installationId = installationId,
            linkedUserId = "user-1",
            linkedWorkspaceId = linkedWorkspaceId,
            activeWorkspaceId = localWorkspaceId,
            linkedEmail = "user@example.com",
            configurationMode = CloudServiceConfigurationMode.OFFICIAL,
            apiBaseUrl = "https://api.flashcards-open-source-app.com/v1",
            detectedAtMillis = 500L
        )
        val remoteGateway = FakeCloudRemoteGateway.forAccountSnapshot(
            accountSnapshot = createCloudAccountSnapshot(
                userId = "user-1",
                email = "user@example.com",
                workspaces = listOf(
                    createCloudWorkspaceSummary(
                        workspaceId = linkedWorkspaceId,
                        name = "Former Linked",
                        createdAtMillis = 100L,
                        isSelected = true
                    ),
                    createCloudWorkspaceSummary(
                        workspaceId = localWorkspaceId,
                        name = "Recovered",
                        createdAtMillis = 200L,
                        isSelected = false
                    )
                )
            )
        )
        val repository = environment.createCloudAccountRepository(remoteGateway = remoteGateway)
        environment.cloudPreferencesStore.saveCloudCredentialRecoveryState(recoveryState = recoveryState)

        val linkContext = repository.prepareVerifiedSignIn(
            credentials = createStoredCloudCredentials(idTokenExpiresAtMillis = Long.MAX_VALUE)
        )

        assertEquals(localWorkspaceId, linkContext.preferredWorkspaceId)
        try {
            repository.completeCloudLink(
                linkContext = linkContext,
                selection = CloudWorkspaceLinkSelection.Existing(workspaceId = linkedWorkspaceId)
            )
            throw AssertionError("Expected completeCloudLink to reject the former linked workspace.")
        } catch (error: CloudCredentialRecoveryRequiredException) {
            assertEquals(recoveryState, error.recoveryState)
        }
        assertEquals(0, remoteGateway.selectWorkspaceCalls)
        assertEquals(0, remoteGateway.createWorkspaceCalls)
        assertNull(environment.cloudPreferencesStore.loadCredentials())
        assertEquals(recoveryState, environment.cloudPreferencesStore.loadCloudCredentialRecoveryState())
        assertEquals(localWorkspaceId, environment.cloudPreferencesStore.currentCloudSettings().activeWorkspaceId)
        assertEquals(1, environment.database.cardDao().loadCards(workspaceId = localWorkspaceId).count())
        assertEquals(cardId, environment.database.cardDao().loadCards(workspaceId = localWorkspaceId).single().cardId)
    }

    @Test
    fun linkedCredentialRecoveryRejectsCreateNewWhenRecoveredWorkspaceIsUnavailable() = runBlocking {
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
        val remoteGateway = FakeCloudRemoteGateway.forAccountSnapshot(
            accountSnapshot = createCloudAccountSnapshot(
                userId = "user-1",
                email = "user@example.com",
                workspaces = listOf(
                    createCloudWorkspaceSummary(
                        workspaceId = "workspace-other",
                        name = "Other",
                        createdAtMillis = 200L,
                        isSelected = true
                    )
                )
            )
        )
        val repository = environment.createCloudAccountRepository(remoteGateway = remoteGateway)
        environment.cloudPreferencesStore.saveCloudCredentialRecoveryState(recoveryState = recoveryState)

        val linkContext = repository.prepareVerifiedSignIn(
            credentials = createStoredCloudCredentials(idTokenExpiresAtMillis = Long.MAX_VALUE)
        )

        assertEquals(CloudWorkspacePostAuthRoute.LINKED_CREDENTIAL_RESTORE, linkContext.postAuthRoute)
        assertNull(linkContext.preferredWorkspaceId)
        try {
            repository.completeCloudLink(
                linkContext = linkContext,
                selection = CloudWorkspaceLinkSelection.CreateNew
            )
            throw AssertionError("Expected linked credential recovery to reject create-new.")
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

    @Test
    fun prepareVerifiedSignInIgnoresStoredGuestSessionDuringCredentialRecovery() = runBlocking {
        val localWorkspaceId = environment.requireLocalWorkspaceId()
        val installationId = environment.cloudPreferencesStore.currentCloudSettings().installationId
        val remoteGateway = FakeCloudRemoteGateway.standard()
        val repository = environment.createCloudAccountRepository(remoteGateway = remoteGateway)
        environment.guestAiSessionStore.saveSession(
            localWorkspaceId = "stale-guest-workspace",
            session = createStoredGuestAiSession(
                workspaceId = "stale-guest-workspace",
                configurationMode = CloudServiceConfigurationMode.OFFICIAL,
                apiBaseUrl = "https://api.flashcards-open-source-app.com/v1",
                guestToken = "stale-guest-token",
                userId = "stale-guest-user"
            )
        )
        environment.cloudPreferencesStore.saveCloudCredentialRecoveryState(
            recoveryState = CloudCredentialRecoveryState(
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
        )

        val linkContext = repository.prepareVerifiedSignIn(
            credentials = createStoredCloudCredentials(idTokenExpiresAtMillis = Long.MAX_VALUE)
        )

        assertEquals(CloudWorkspacePostAuthRoute.LINKED_CREDENTIAL_RESTORE, linkContext.postAuthRoute)
        assertNull(linkContext.guestUpgradeMode)
        assertEquals(0, remoteGateway.prepareGuestUpgradeCalls)
        assertEquals(
            CloudCredentialRecoveryReason.LINKED_CREDENTIALS_MISSING,
            environment.cloudPreferencesStore.loadCloudCredentialRecoveryState()?.reason
        )
    }

    @Test
    fun completeCloudLinkKeepsLinkedCredentialRecoveryWhenSignedInAccountDiffers() = runBlocking {
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
        val remoteGateway = FakeCloudRemoteGateway.forAccountSnapshot(
            accountSnapshot = createCloudAccountSnapshot(
                userId = "user-2",
                email = "other@example.com",
                workspaces = listOf(
                    createCloudWorkspaceSummary(
                        workspaceId = localWorkspaceId,
                        name = "Recovered",
                        createdAtMillis = 200L,
                        isSelected = true
                    )
                )
            )
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
            throw AssertionError("Expected completeCloudLink to preserve recovery for another account.")
        } catch (error: CloudCredentialRecoveryRequiredException) {
            assertEquals(recoveryState, error.recoveryState)
        }

        assertEquals(0, remoteGateway.selectWorkspaceCalls)
        assertEquals(0, remoteGateway.createWorkspaceCalls)
        assertNull(environment.cloudPreferencesStore.loadCredentials())
        assertEquals(recoveryState, environment.cloudPreferencesStore.loadCloudCredentialRecoveryState())
        assertEquals(CloudAccountState.DISCONNECTED, environment.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals(localWorkspaceId, environment.cloudPreferencesStore.currentCloudSettings().activeWorkspaceId)
        assertEquals(1, environment.database.workspaceDao().countWorkspaces())
        assertEquals(localWorkspaceId, environment.database.workspaceDao().loadAnyWorkspace()?.workspaceId)
        assertEquals(1, environment.database.cardDao().loadCards(workspaceId = localWorkspaceId).count())
        assertEquals(cardId, environment.database.cardDao().loadCards(workspaceId = localWorkspaceId).single().cardId)
    }

    @Test
    fun completeCloudLinkKeepsLinkedCredentialRecoveryWhenWorkspaceDiffers() = runBlocking {
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
        val remoteGateway = FakeCloudRemoteGateway.forAccountSnapshot(
            accountSnapshot = createCloudAccountSnapshot(
                userId = "user-1",
                email = "user@example.com",
                workspaces = listOf(
                    createCloudWorkspaceSummary(
                        workspaceId = localWorkspaceId,
                        name = "Recovered",
                        createdAtMillis = 100L,
                        isSelected = false
                    ),
                    createCloudWorkspaceSummary(
                        workspaceId = "workspace-other",
                        name = "Other",
                        createdAtMillis = 200L,
                        isSelected = true
                    )
                )
            )
        )
        val repository = environment.createCloudAccountRepository(remoteGateway = remoteGateway)
        environment.cloudPreferencesStore.saveCloudCredentialRecoveryState(recoveryState = recoveryState)
        val linkContext = repository.prepareVerifiedSignIn(
            credentials = createStoredCloudCredentials(idTokenExpiresAtMillis = Long.MAX_VALUE)
        )

        try {
            repository.completeCloudLink(
                linkContext = linkContext,
                selection = CloudWorkspaceLinkSelection.Existing(workspaceId = "workspace-other")
            )
            throw AssertionError("Expected completeCloudLink to preserve recovery for another workspace.")
        } catch (error: CloudCredentialRecoveryRequiredException) {
            assertEquals(recoveryState, error.recoveryState)
        }

        assertEquals(0, remoteGateway.selectWorkspaceCalls)
        assertEquals(0, remoteGateway.createWorkspaceCalls)
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
