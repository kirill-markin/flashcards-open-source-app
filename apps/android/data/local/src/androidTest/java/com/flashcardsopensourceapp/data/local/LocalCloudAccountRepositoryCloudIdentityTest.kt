package com.flashcardsopensourceapp.data.local

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudGuestUpgradeMode
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfigurationMode
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceLinkSelection
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LocalCloudAccountRepositoryCloudIdentityTest {
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
            bootstrapRemoteIsEmpty = true
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
            bootstrapRemoteIsEmpty = true
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
    fun completeGuestUpgradeClearsGuestSessionAndLinksSelectedWorkspace() = runBlocking {
        val guestWorkspaceId = "guest-workspace"
        val selectedWorkspace = createCloudWorkspaceSummary(
            workspaceId = "workspace-linked",
            name = "Linked Workspace",
            createdAtMillis = 200L,
            isSelected = true
        )
        val remoteGateway = FakeCloudRemoteGateway.forGuestUpgrade(
            guestUpgradeMode = CloudGuestUpgradeMode.MERGE_REQUIRED,
            accountSnapshot = createCloudAccountSnapshot(
                userId = "user-1",
                email = "user@example.com",
                workspaces = listOf(selectedWorkspace)
            ),
            bootstrapRemoteIsEmpty = true
        )
        val repository = environment.createCloudAccountRepository(remoteGateway = remoteGateway)
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

        val linkedWorkspace = repository.completeGuestUpgrade(
            linkContext = linkContext,
            selection = CloudWorkspaceLinkSelection.Existing(workspaceId = selectedWorkspace.workspaceId)
        )

        assertEquals(selectedWorkspace.workspaceId, linkedWorkspace.workspaceId)
        assertEquals(CloudAccountState.LINKED, environment.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals(selectedWorkspace.workspaceId, environment.cloudPreferencesStore.currentCloudSettings().linkedWorkspaceId)
        assertEquals("user@example.com", environment.cloudPreferencesStore.currentCloudSettings().linkedEmail)
        assertEquals(selectedWorkspace.workspaceId, environment.database.workspaceDao().loadAnyWorkspace()?.workspaceId)
        assertNotNull(environment.cloudPreferencesStore.loadCredentials())
        assertNull(
            environment.guestAiSessionStore.loadAnySession(
                configuration = com.flashcardsopensourceapp.data.local.model.makeOfficialCloudServiceConfiguration()
            )
        )
        assertEquals(1, remoteGateway.prepareGuestUpgradeCalls)
        assertEquals(1, remoteGateway.completeGuestUpgradeCalls)
    }

    @Test
    fun completeGuestUpgradeIntoNonEmptyWorkspaceReplacesLocalShellAndResetsSyncState() = runBlocking {
        val localWorkspaceId = environment.requireLocalWorkspaceId()
        environment.seedWorkspaceData(workspaceId = localWorkspaceId)
        environment.database.syncStateDao().insertSyncState(
            com.flashcardsopensourceapp.data.local.database.SyncStateEntity(
                workspaceId = localWorkspaceId,
                lastSyncCursor = "123",
                lastReviewSequenceId = 456L,
                hasHydratedHotState = true,
                hasHydratedReviewHistory = true,
                lastSyncAttemptAtMillis = 1_000L,
                lastSuccessfulSyncAtMillis = 2_000L,
                lastSyncError = "broken"
            )
        )
        val guestWorkspaceId = "guest-workspace"
        val selectedWorkspace = createCloudWorkspaceSummary(
            workspaceId = "workspace-linked",
            name = "Linked Workspace",
            createdAtMillis = 200L,
            isSelected = true
        )
        val remoteGateway = FakeCloudRemoteGateway.forGuestUpgrade(
            guestUpgradeMode = CloudGuestUpgradeMode.MERGE_REQUIRED,
            accountSnapshot = createCloudAccountSnapshot(
                userId = "user-1",
                email = "user@example.com",
                workspaces = listOf(selectedWorkspace)
            ),
            bootstrapRemoteIsEmpty = false
        )
        val repository = environment.createCloudAccountRepository(remoteGateway = remoteGateway)
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

        repository.completeGuestUpgrade(
            linkContext = linkContext,
            selection = CloudWorkspaceLinkSelection.Existing(workspaceId = selectedWorkspace.workspaceId)
        )

        assertEquals(selectedWorkspace.workspaceId, environment.database.workspaceDao().loadAnyWorkspace()?.workspaceId)
        assertEquals(0, environment.database.cardDao().observeCardsWithRelations().first().size)
        assertEquals(0, environment.database.reviewLogDao().countReviewLogs())
        assertNull(environment.database.syncStateDao().loadSyncState(localWorkspaceId))
        assertEquals(
            syncStateEntityWithEmptyProgress(workspaceId = selectedWorkspace.workspaceId),
            environment.database.syncStateDao().loadSyncState(selectedWorkspace.workspaceId)
        )
    }

    @Test
    fun completeGuestUpgradeIntoEmptyWorkspacePreservesLocalDataAndRecreatesSyncState() = runBlocking {
        val localWorkspaceId = environment.requireLocalWorkspaceId()
        val seededCardId = environment.seedWorkspaceData(workspaceId = localWorkspaceId)
        environment.database.syncStateDao().insertSyncState(
            com.flashcardsopensourceapp.data.local.database.SyncStateEntity(
                workspaceId = localWorkspaceId,
                lastSyncCursor = "123",
                lastReviewSequenceId = 456L,
                hasHydratedHotState = true,
                hasHydratedReviewHistory = true,
                lastSyncAttemptAtMillis = 1_000L,
                lastSuccessfulSyncAtMillis = 2_000L,
                lastSyncError = "broken"
            )
        )
        val guestWorkspaceId = "guest-workspace"
        val selectedWorkspace = createCloudWorkspaceSummary(
            workspaceId = "workspace-linked",
            name = "Linked Workspace",
            createdAtMillis = 200L,
            isSelected = true
        )
        val remoteGateway = FakeCloudRemoteGateway.forGuestUpgrade(
            guestUpgradeMode = CloudGuestUpgradeMode.MERGE_REQUIRED,
            accountSnapshot = createCloudAccountSnapshot(
                userId = "user-1",
                email = "user@example.com",
                workspaces = listOf(selectedWorkspace)
            ),
            bootstrapRemoteIsEmpty = true
        )
        val repository = environment.createCloudAccountRepository(remoteGateway = remoteGateway)
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

        repository.completeGuestUpgrade(
            linkContext = linkContext,
            selection = CloudWorkspaceLinkSelection.Existing(workspaceId = selectedWorkspace.workspaceId)
        )

        assertEquals(selectedWorkspace.workspaceId, environment.database.workspaceDao().loadAnyWorkspace()?.workspaceId)
        assertNotNull(environment.database.cardDao().loadCard(seededCardId))
        assertEquals(selectedWorkspace.workspaceId, environment.database.cardDao().loadCard(seededCardId)?.workspaceId)
        assertEquals(1, environment.database.reviewLogDao().countReviewLogs())
        assertNull(environment.database.syncStateDao().loadSyncState(localWorkspaceId))
        assertEquals(
            syncStateEntityWithEmptyProgress(workspaceId = selectedWorkspace.workspaceId),
            environment.database.syncStateDao().loadSyncState(selectedWorkspace.workspaceId)
        )
    }

    @Test
    fun switchLinkedWorkspaceToCreateNewReplacesCurrentLocalWorkspaceWhenRemoteWorkspaceIsEmpty() = runBlocking {
        val initialLocalWorkspaceId = environment.requireLocalWorkspaceId()
        val createdWorkspace = createCloudWorkspaceSummary(
            workspaceId = "workspace-new",
            name = "Personal",
            createdAtMillis = 300L,
            isSelected = true
        )
        val remoteGateway = FakeCloudRemoteGateway.forCreatedWorkspace(
            createdWorkspace = createdWorkspace,
            bootstrapRemoteIsEmpty = true
        )
        val repository = environment.createCloudAccountRepository(remoteGateway = remoteGateway)

        environment.prepareLinkedCloudIdentity(localWorkspaceId = initialLocalWorkspaceId)

        val linkedWorkspace = repository.completeLinkedWorkspaceTransition(CloudWorkspaceLinkSelection.CreateNew)

        assertEquals(createdWorkspace.workspaceId, linkedWorkspace.workspaceId)
        assertEquals(createdWorkspace.workspaceId, environment.cloudPreferencesStore.currentCloudSettings().activeWorkspaceId)
        assertEquals(createdWorkspace.workspaceId, environment.cloudPreferencesStore.currentCloudSettings().linkedWorkspaceId)
        assertEquals(createdWorkspace.workspaceId, environment.database.workspaceDao().loadAnyWorkspace()?.workspaceId)
    }

    @Test
    fun renameCurrentWorkspaceTargetsCreatedLinkedWorkspaceAfterCreateNewTransition() = runBlocking {
        val initialLocalWorkspaceId = environment.requireLocalWorkspaceId()
        val createdWorkspace = createCloudWorkspaceSummary(
            workspaceId = "workspace-new",
            name = "Personal",
            createdAtMillis = 300L,
            isSelected = true
        )
        val remoteGateway = FakeCloudRemoteGateway.forCreatedWorkspace(
            createdWorkspace = createdWorkspace,
            bootstrapRemoteIsEmpty = true
        )
        val repository = environment.createCloudAccountRepository(remoteGateway = remoteGateway)

        environment.prepareLinkedCloudIdentity(localWorkspaceId = initialLocalWorkspaceId)
        repository.completeLinkedWorkspaceTransition(CloudWorkspaceLinkSelection.CreateNew)

        val renamedWorkspace = repository.renameCurrentWorkspace(name = "Renamed Workspace")

        assertEquals(createdWorkspace.workspaceId, remoteGateway.renameWorkspaceIds.single())
        assertEquals("Renamed Workspace", renamedWorkspace.name)
        assertEquals("Renamed Workspace", environment.database.workspaceDao().loadAnyWorkspace()?.name)
    }

    @Test
    fun completeCloudLinkToExistingWorkspaceReplacesLocalShellAndKeepsRenameTargetAligned() = runBlocking {
        val linkedWorkspace = createCloudWorkspaceSummary(
            workspaceId = "workspace-linked",
            name = "Linked Workspace",
            createdAtMillis = 200L,
            isSelected = true
        )
        val remoteGateway = FakeCloudRemoteGateway.forAccountSnapshot(
            accountSnapshot = createCloudAccountSnapshot(
                userId = "user-1",
                email = "user@example.com",
                workspaces = listOf(linkedWorkspace)
            )
        )
        val repository = environment.createCloudAccountRepository(remoteGateway = remoteGateway)

        val linkContext = repository.verifyCode(
            challenge = createOtpChallenge(email = "user@example.com"),
            code = "123456"
        )
        repository.completeCloudLink(
            linkContext = linkContext,
            selection = CloudWorkspaceLinkSelection.Existing(workspaceId = linkedWorkspace.workspaceId)
        )

        val renamedWorkspace = repository.renameCurrentWorkspace(name = "Renamed Linked Workspace")

        assertEquals(linkedWorkspace.workspaceId, environment.cloudPreferencesStore.currentCloudSettings().activeWorkspaceId)
        assertEquals(linkedWorkspace.workspaceId, environment.cloudPreferencesStore.currentCloudSettings().linkedWorkspaceId)
        assertEquals(linkedWorkspace.workspaceId, environment.database.workspaceDao().loadAnyWorkspace()?.workspaceId)
        assertNotNull(environment.cloudPreferencesStore.loadCredentials())
        assertEquals(linkedWorkspace.workspaceId, remoteGateway.renameWorkspaceIds.single())
        assertEquals("Renamed Linked Workspace", renamedWorkspace.name)
    }

    @Test
    fun switchLinkedWorkspaceWaitsForForegroundSyncToFinish() = runBlocking {
        val initialLocalWorkspaceId = environment.requireLocalWorkspaceId()
        val fetchEntered = CompletableDeferred<Unit>()
        val releaseFetch = CompletableDeferred<Unit>()
        val remoteGateway = FakeCloudRemoteGateway.forBlockingFetch(
            onFetchCloudAccountEntered = fetchEntered,
            blockFetchCloudAccount = releaseFetch
        )
        val cloudRepository = environment.createCloudAccountRepository(remoteGateway = remoteGateway)
        val syncRepository = environment.createSyncRepository(remoteGateway = remoteGateway)

        environment.prepareLinkedCloudIdentity(localWorkspaceId = initialLocalWorkspaceId)

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
            environment.cloudPreferencesStore.currentCloudSettings().activeWorkspaceId
        )
    }
}
