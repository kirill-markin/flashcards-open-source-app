package com.flashcardsopensourceapp.data.local.repository.cloudsync.account

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudCredentialRecoveryReason
import com.flashcardsopensourceapp.data.local.model.CloudCredentialRecoveryRequiredException
import com.flashcardsopensourceapp.data.local.model.CloudCredentialRecoveryState
import com.flashcardsopensourceapp.data.local.model.CloudGuestUpgradeMode
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfigurationMode
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.model.CloudWorkspacePostAuthRoute
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.CloudIdentityTestEnvironment
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.FakeCloudRemoteGateway
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.createCloudAccountSnapshot
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.createCloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.createOtpChallenge
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.createStoredCloudCredentials
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.createStoredGuestAiSession
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LocalCloudAccountRepositorySignInPreparationTest {
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
    fun verifyCodePreparesBoundGuestUpgradeWhenMatchingGuestSessionExists() = runBlocking {
        val localWorkspaceId = environment.requireLocalWorkspaceId()
        val guestWorkspaceId = "guest-workspace"
        val remoteGateway = FakeCloudRemoteGateway.forGuestUpgrade(
            guestUpgradeMode = CloudGuestUpgradeMode.BOUND,
            accountSnapshot = createCloudAccountSnapshot(
                userId = "user-1",
                email = "user@example.com",
                workspaces = listOf(
                    createCloudWorkspaceSummary(
                        workspaceId = "workspace-remote",
                        name = "Personal",
                        createdAtMillis = 100L,
                        isSelected = true
                    )
                )
            ),
            bootstrapRemoteIsEmpty = true,
            guestUpgradeReconciliation = null
        )
        val repository = environment.createCloudAccountRepository(remoteGateway = remoteGateway)
        environment.cloudPreferencesStore.updateCloudSettings(
            cloudState = CloudAccountState.DISCONNECTED,
            linkedUserId = null,
            linkedWorkspaceId = null,
            linkedEmail = null,
            activeWorkspaceId = localWorkspaceId
        )
        environment.guestAiSessionStore.saveSession(
            localWorkspaceId = guestWorkspaceId,
            session = createStoredGuestAiSession(
                workspaceId = guestWorkspaceId,
                configurationMode = CloudServiceConfigurationMode.OFFICIAL,
                apiBaseUrl = "https://api.flashcards-open-source-app.com/v1",
                guestToken = "guest-token",
                userId = "guest-user"
            )
        )

        val linkContext = repository.verifyCode(
            challenge = createOtpChallenge(email = "user@example.com"),
            code = "123456"
        )

        assertEquals(CloudGuestUpgradeMode.BOUND, linkContext.guestUpgradeMode)
        assertEquals(CloudWorkspacePostAuthRoute.NONE, linkContext.postAuthRoute)
        assertEquals(CloudAccountState.GUEST, environment.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertNull(environment.cloudPreferencesStore.currentCloudSettings().linkedUserId)
        assertNull(environment.cloudPreferencesStore.currentCloudSettings().linkedWorkspaceId)
        assertEquals(localWorkspaceId, environment.cloudPreferencesStore.currentCloudSettings().activeWorkspaceId)
        assertNull(environment.cloudPreferencesStore.loadCredentials())
        assertEquals(1, remoteGateway.prepareGuestUpgradeCalls)
    }

    @Test
    fun prepareVerifiedSignInPrefersSelectedRemoteWorkspaceAndKeepsLocalActiveWorkspace() = runBlocking {
        val localWorkspaceId = environment.requireLocalWorkspaceId()
        val remoteGateway = FakeCloudRemoteGateway.forAccountSnapshot(
            accountSnapshot = createCloudAccountSnapshot(
                userId = "user-1",
                email = "google-review@example.com",
                workspaces = listOf(
                    createCloudWorkspaceSummary(
                        workspaceId = "workspace-1",
                        name = "Personal",
                        createdAtMillis = 100L,
                        isSelected = false
                    ),
                    createCloudWorkspaceSummary(
                        workspaceId = "workspace-2",
                        name = "Personal",
                        createdAtMillis = 200L,
                        isSelected = true
                    )
                )
            )
        )
        val repository = environment.createCloudAccountRepository(remoteGateway = remoteGateway)

        val linkContext = repository.prepareVerifiedSignIn(
            credentials = createStoredCloudCredentials(idTokenExpiresAtMillis = Long.MAX_VALUE)
        )

        assertEquals(CloudAccountState.DISCONNECTED, environment.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals(localWorkspaceId, environment.cloudPreferencesStore.currentCloudSettings().activeWorkspaceId)
        assertEquals(CloudWorkspacePostAuthRoute.NONE, linkContext.postAuthRoute)
        assertEquals("workspace-2", linkContext.preferredWorkspaceId)
        assertNull(environment.cloudPreferencesStore.loadCredentials())
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

    @Test
    fun completeCloudLinkRejectsWorkspaceOutsideCurrentLinkContext() = runBlocking {
        val remoteGateway = FakeCloudRemoteGateway.forAccountSnapshot(
            accountSnapshot = createCloudAccountSnapshot(
                userId = "user-1",
                email = "user@example.com",
                workspaces = listOf(
                    createCloudWorkspaceSummary(
                        workspaceId = "workspace-1",
                        name = "Personal",
                        createdAtMillis = 100L,
                        isSelected = true
                    )
                )
            )
        )
        val repository = environment.createCloudAccountRepository(remoteGateway = remoteGateway)
        val linkContext = repository.prepareVerifiedSignIn(
            credentials = createStoredCloudCredentials(idTokenExpiresAtMillis = Long.MAX_VALUE)
        )

        try {
            repository.completeCloudLink(
                linkContext = linkContext,
                selection = CloudWorkspaceLinkSelection.Existing(workspaceId = "workspace-stale")
            )
            throw AssertionError("Expected completeCloudLink to reject a stale workspace selection.")
        } catch (error: IllegalArgumentException) {
            assertEquals(
                "Selected workspace is unavailable for this sign-in attempt. Start sign-in again.",
                error.message
            )
        }

        assertEquals(0, remoteGateway.selectWorkspaceCalls)
        assertNull(environment.cloudPreferencesStore.loadCredentials())
        assertEquals(CloudAccountState.DISCONNECTED, environment.cloudPreferencesStore.currentCloudSettings().cloudState)
    }

    @Test
    fun verifyCodeSkipsGuestUpgradeWhenStoredSessionTargetsAnotherServerConfiguration() = runBlocking {
        val localWorkspaceId = environment.requireLocalWorkspaceId()
        val remoteGateway = FakeCloudRemoteGateway.forGuestUpgrade(
            guestUpgradeMode = CloudGuestUpgradeMode.BOUND,
            accountSnapshot = createCloudAccountSnapshot(
                userId = "user-1",
                email = "user@example.com",
                workspaces = listOf(
                    createCloudWorkspaceSummary(
                        workspaceId = "workspace-remote",
                        name = "Personal",
                        createdAtMillis = 100L,
                        isSelected = true
                    )
                )
            ),
            bootstrapRemoteIsEmpty = true,
            guestUpgradeReconciliation = null
        )
        val repository = environment.createCloudAccountRepository(remoteGateway = remoteGateway)
        environment.guestAiSessionStore.saveSession(
            localWorkspaceId = localWorkspaceId,
            session = createStoredGuestAiSession(
                workspaceId = "guest-workspace-stale",
                configurationMode = CloudServiceConfigurationMode.CUSTOM,
                apiBaseUrl = "https://api.stale.example.com/v1",
                guestToken = "guest-token-stale",
                userId = "guest-user-stale"
            )
        )

        val linkContext = repository.verifyCode(
            challenge = createOtpChallenge(email = "user@example.com"),
            code = "123456"
        )

        assertNull(linkContext.guestUpgradeMode)
        assertNull(
            environment.guestAiSessionStore.loadSession(
                localWorkspaceId = localWorkspaceId,
                configuration = com.flashcardsopensourceapp.data.local.model.makeOfficialCloudServiceConfiguration()
            )
        )
        assertEquals(0, remoteGateway.prepareGuestUpgradeCalls)
    }

    @Test
    fun invalidStoredRecoveryStateBlocksPostAuthWithoutIdentitySideEffects() = runBlocking {
        val metadataPreferences = environment.context.getSharedPreferences(
            "flashcards-cloud-metadata",
            Context.MODE_PRIVATE
        )
        metadataPreferences.edit()
            .putString("cloud-credential-recovery-state", "{")
            .commit()
        val remoteGateway = FakeCloudRemoteGateway.standard()
        val restartedRuntime = environment.createRestartedCloudAccountRuntime(remoteGateway = remoteGateway)

        val loadedRecoveryState = requireNotNull(restartedRuntime.cloudPreferencesStore.loadCloudCredentialRecoveryState())
        val observedRecoveryState = requireNotNull(
            restartedRuntime.cloudPreferencesStore.observeCloudCredentialRecoveryState().first()
        )
        val linkContext = restartedRuntime.repository.prepareVerifiedSignIn(
            credentials = createStoredCloudCredentials(idTokenExpiresAtMillis = Long.MAX_VALUE)
        )
        val otpLinkContext = restartedRuntime.repository.verifyCode(
            challenge = createOtpChallenge(email = "user@example.com"),
            code = "123456"
        )

        assertEquals(CloudCredentialRecoveryReason.INVALID_STORED_STATE, loadedRecoveryState.reason)
        assertEquals(CloudCredentialRecoveryReason.INVALID_STORED_STATE, observedRecoveryState.reason)
        assertEquals(CloudWorkspacePostAuthRoute.INVALID_STORED_STATE, linkContext.postAuthRoute)
        assertEquals(CloudWorkspacePostAuthRoute.INVALID_STORED_STATE, otpLinkContext.postAuthRoute)
        assertEquals(0, remoteGateway.fetchCloudAccountCalls)
        assertEquals(0, remoteGateway.verifyCodeCalls)
        try {
            restartedRuntime.repository.completeCloudLink(
                linkContext = linkContext,
                selection = CloudWorkspaceLinkSelection.CreateNew
            )
            throw AssertionError("Expected invalid stored recovery to block complete-link.")
        } catch (error: CloudCredentialRecoveryRequiredException) {
            assertEquals(CloudCredentialRecoveryReason.INVALID_STORED_STATE, error.recoveryState.reason)
        }

        assertEquals(0, remoteGateway.selectWorkspaceCalls)
        assertEquals(0, remoteGateway.createWorkspaceCalls)
        assertNull(restartedRuntime.cloudPreferencesStore.loadCredentials())
        assertEquals("{", metadataPreferences.getString("cloud-credential-recovery-state", null))
    }

    @Test
    fun resetInvalidStoredRecoveryStatePreservesLocalData() = runBlocking {
        val localWorkspaceId = environment.requireLocalWorkspaceId()
        val cardId = environment.seedWorkspaceData(workspaceId = localWorkspaceId)
        environment.cloudPreferencesStore.updateCloudSettings(
            cloudState = CloudAccountState.LINKED,
            linkedUserId = "user-linked",
            linkedWorkspaceId = localWorkspaceId,
            linkedEmail = "user@example.com",
            activeWorkspaceId = localWorkspaceId
        )
        environment.cloudPreferencesStore.saveCredentials(
            credentials = createStoredCloudCredentials(idTokenExpiresAtMillis = Long.MAX_VALUE)
        )
        val metadataPreferences = environment.context.getSharedPreferences(
            "flashcards-cloud-metadata",
            Context.MODE_PRIVATE
        )
        metadataPreferences.edit()
            .putString("cloud-credential-recovery-state", "{")
            .commit()
        val restartedRuntime = environment.createRestartedCloudAccountRuntime(
            remoteGateway = FakeCloudRemoteGateway.standard()
        )

        assertEquals(
            CloudCredentialRecoveryReason.INVALID_STORED_STATE,
            restartedRuntime.cloudPreferencesStore.loadCloudCredentialRecoveryState()?.reason
        )

        restartedRuntime.repository.resetInvalidCloudCredentialRecoveryState()

        val cloudSettings = restartedRuntime.cloudPreferencesStore.currentCloudSettings()
        assertNull(restartedRuntime.cloudPreferencesStore.loadCloudCredentialRecoveryState())
        assertNull(metadataPreferences.getString("cloud-credential-recovery-state", null))
        assertEquals(CloudAccountState.DISCONNECTED, cloudSettings.cloudState)
        assertNull(cloudSettings.linkedUserId)
        assertNull(cloudSettings.linkedWorkspaceId)
        assertNull(cloudSettings.linkedEmail)
        assertEquals(localWorkspaceId, cloudSettings.activeWorkspaceId)
        assertNull(restartedRuntime.cloudPreferencesStore.loadCredentials())
        assertEquals(1, environment.database.workspaceDao().countWorkspaces())
        assertEquals(localWorkspaceId, environment.database.workspaceDao().loadAnyWorkspace()?.workspaceId)
        assertEquals(1, environment.database.cardDao().loadCards(workspaceId = localWorkspaceId).count())
        assertEquals(cardId, environment.database.cardDao().loadCards(workspaceId = localWorkspaceId).single().cardId)
    }
}
