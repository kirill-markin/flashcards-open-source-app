package com.flashcardsopensourceapp.data.local.cloudidentity

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.cloud.CloudRemoteException
import com.flashcardsopensourceapp.data.local.cloud.syncWorkspaceForkRequiredErrorCode
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.model.SyncStatus
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LocalCloudAccountRepositoryLinkedWorkspaceTransitionTest {
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
    fun completeLinkedWorkspaceTransitionPreservesBlockedSyncStateWhenInitialSyncBlocks() = runBlocking {
        val initialLocalWorkspaceId = environment.requireLocalWorkspaceId()
        val installationId = environment.cloudPreferencesStore.currentCloudSettings().installationId
        val remoteGateway = FakeCloudRemoteGateway.forBootstrapPushScenario(
            bootstrapRemoteIsEmptyResponses = listOf(true, true, true, true),
            bootstrapPushErrors = listOf(
                createWorkspaceForkRequiredErrorWithoutPublicConflictDetails(
                    path = "/sync/bootstrap",
                    requestId = "request-transition-bootstrap-1"
                )
            )
        )
        val repository = environment.createCloudAccountRepository(remoteGateway = remoteGateway)
        val expectedMessage =
            "Cloud sync bootstrap push is blocked for workspace 'workspace-remote': backend did not provide public sync conflict details for automatic local id recovery. Reference: request-transition-bootstrap-1"

        environment.prepareLinkedCloudIdentity(localWorkspaceId = initialLocalWorkspaceId)

        try {
            repository.completeLinkedWorkspaceTransition(
                selection = CloudWorkspaceLinkSelection.Existing(workspaceId = "workspace-remote")
            )
            throw AssertionError("Expected linked workspace transition to fail when initial sync becomes blocked.")
        } catch (error: IllegalStateException) {
            assertTrue(error.message?.contains(expectedMessage) == true)
        }

        val persistedSyncState = requireNotNull(
            environment.database.syncStateDao().loadSyncState(workspaceId = "workspace-remote")
        ) {
            "Expected persisted sync state for workspace 'workspace-remote'."
        }
        val recreatedRepository = environment.createSyncRepository(remoteGateway = FakeCloudRemoteGateway.standard())
        val recreatedStatus = recreatedRepository.observeSyncStatus().first().status

        assertEquals(CloudAccountState.LINKED, environment.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals("workspace-remote", environment.cloudPreferencesStore.currentCloudSettings().activeWorkspaceId)
        assertEquals("workspace-remote", environment.cloudPreferencesStore.currentCloudSettings().linkedWorkspaceId)
        assertEquals(installationId, persistedSyncState.blockedInstallationId)
        assertEquals(expectedMessage, persistedSyncState.lastSyncError)
        assertNotNull(environment.cloudPreferencesStore.loadCredentials())
        assertTrue(recreatedStatus is SyncStatus.Blocked)
        assertEquals(expectedMessage, (recreatedStatus as SyncStatus.Blocked).message)
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

private fun createWorkspaceForkRequiredErrorWithoutPublicConflictDetails(
    path: String,
    requestId: String
): CloudRemoteException {
    return CloudRemoteException(
        message = "Cloud request failed with status 409 for $path",
        statusCode = 409,
        responseBody = JSONObject()
            .put("code", syncWorkspaceForkRequiredErrorCode)
            .put("requestId", requestId)
            .toString(),
        errorCode = syncWorkspaceForkRequiredErrorCode,
        requestId = requestId,
        syncConflict = null
    )
}
