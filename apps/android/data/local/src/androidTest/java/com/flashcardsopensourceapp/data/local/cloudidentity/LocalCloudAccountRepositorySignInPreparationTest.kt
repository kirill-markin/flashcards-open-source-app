package com.flashcardsopensourceapp.data.local.cloudidentity

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudCredentialRecoveryReason
import com.flashcardsopensourceapp.data.local.model.CloudCredentialRecoveryRequiredException
import com.flashcardsopensourceapp.data.local.model.CloudCredentialRecoveryState
import com.flashcardsopensourceapp.data.local.model.CloudGuestUpgradeMode
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfigurationMode
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceLinkSelection
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

        assertEquals(localWorkspaceId, linkContext.preferredWorkspaceId)
        assertEquals(recoveryState, environment.cloudPreferencesStore.loadCloudCredentialRecoveryState())
        assertNull(environment.cloudPreferencesStore.loadCredentials())
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
    fun linkedCredentialRecoveryCanCreateNewWorkspaceWhenRecoveredWorkspaceIsUnavailable() = runBlocking {
        val localWorkspaceId = environment.requireLocalWorkspaceId()
        val installationId = environment.cloudPreferencesStore.currentCloudSettings().installationId
        environment.seedWorkspaceData(workspaceId = localWorkspaceId)
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
        val selectedWorkspace = repository.completeCloudLink(
            linkContext = linkContext,
            selection = CloudWorkspaceLinkSelection.CreateNew
        )

        assertEquals(localWorkspaceId, linkContext.preferredWorkspaceId)
        assertEquals("workspace-new", selectedWorkspace.workspaceId)
        assertEquals(0, remoteGateway.selectWorkspaceCalls)
        assertEquals(1, remoteGateway.createWorkspaceCalls)
        assertEquals(emptyList<String>(), remoteGateway.bootstrapPullWorkspaceIds)
        assertNotNull(environment.cloudPreferencesStore.loadCredentials())
        assertNull(environment.cloudPreferencesStore.loadCloudCredentialRecoveryState())
        assertEquals(CloudAccountState.LINKED, environment.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals("workspace-new", environment.cloudPreferencesStore.currentCloudSettings().activeWorkspaceId)
        assertEquals(1, environment.database.workspaceDao().countWorkspaces())
        assertEquals("workspace-new", environment.database.workspaceDao().loadAnyWorkspace()?.workspaceId)
        val migratedCards = environment.database.cardDao().loadCards(workspaceId = "workspace-new")
        assertEquals(1, migratedCards.count())
        assertEquals("Question", migratedCards.single().frontText)
        assertEquals(1, environment.database.reviewLogDao().countReviewLogs(workspaceId = "workspace-new"))
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
    fun completeCloudLinkPreservesGuestRecoveryDataWhenRemoteWorkspaceIsNotEmpty() = runBlocking {
        val localWorkspaceId = environment.requireLocalWorkspaceId()
        val installationId = environment.cloudPreferencesStore.currentCloudSettings().installationId
        environment.seedWorkspaceData(workspaceId = localWorkspaceId)
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
            bootstrapRemoteIsEmptyResponses = listOf(false),
            bootstrapPushErrors = emptyList()
        )
        val repository = environment.createCloudAccountRepository(remoteGateway = remoteGateway)
        environment.cloudPreferencesStore.saveCloudCredentialRecoveryState(recoveryState = recoveryState)
        val linkContext = repository.prepareVerifiedSignIn(
            credentials = createStoredCloudCredentials(idTokenExpiresAtMillis = Long.MAX_VALUE)
        )

        val selectedWorkspace = repository.completeCloudLink(
            linkContext = linkContext,
            selection = CloudWorkspaceLinkSelection.Existing(workspaceId = remoteWorkspaceId)
        )

        assertEquals(remoteWorkspaceId, selectedWorkspace.workspaceId)
        assertEquals(1, remoteGateway.selectWorkspaceCalls)
        assertEquals(0, remoteGateway.createWorkspaceCalls)
        assertEquals(emptyList<String>(), remoteGateway.bootstrapPullWorkspaceIds)
        assertNotNull(environment.cloudPreferencesStore.loadCredentials())
        assertNull(environment.cloudPreferencesStore.loadCloudCredentialRecoveryState())
        assertEquals(CloudAccountState.LINKED, environment.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals(remoteWorkspaceId, environment.cloudPreferencesStore.currentCloudSettings().linkedWorkspaceId)
        assertEquals(remoteWorkspaceId, environment.cloudPreferencesStore.currentCloudSettings().activeWorkspaceId)
        assertEquals(1, environment.database.workspaceDao().countWorkspaces())
        assertEquals(remoteWorkspaceId, environment.database.workspaceDao().loadAnyWorkspace()?.workspaceId)
        val migratedCards = environment.database.cardDao().loadCards(workspaceId = remoteWorkspaceId)
        assertEquals(1, migratedCards.count())
        assertEquals("Question", migratedCards.single().frontText)
        assertEquals(1, environment.database.reviewLogDao().countReviewLogs(workspaceId = remoteWorkspaceId))
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
}
