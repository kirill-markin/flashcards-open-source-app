package com.flashcardsopensourceapp.data.local

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.cloud.PendingGuestUpgradeState
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudGuestUpgradeCompletion
import com.flashcardsopensourceapp.data.local.model.CloudGuestUpgradeMode
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfigurationMode
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.model.makeOfficialCloudServiceConfiguration
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class CloudGuestSessionCoordinatorTest {
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
    fun reconcilePersistedCloudStateNormalizesLegacyLinkingReadyWithoutResettingWorkspace() = runBlocking {
        val localWorkspaceId = environment.requireLocalWorkspaceId()
        val coordinator = environment.createCloudGuestSessionCoordinator(
            remoteGateway = FakeCloudRemoteGateway.standard()
        )
        environment.cloudPreferencesStore.saveCredentials(
            credentials = createStoredCloudCredentials(idTokenExpiresAtMillis = Long.MAX_VALUE)
        )
        environment.cloudPreferencesStore.updateCloudSettings(
            cloudState = CloudAccountState.LINKING_READY,
            linkedUserId = "user-1",
            linkedWorkspaceId = null,
            linkedEmail = "user@example.com",
            activeWorkspaceId = localWorkspaceId
        )

        coordinator.reconcilePersistedCloudState()

        assertEquals(CloudAccountState.DISCONNECTED, environment.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals(localWorkspaceId, environment.cloudPreferencesStore.currentCloudSettings().activeWorkspaceId)
        assertNull(environment.cloudPreferencesStore.currentCloudSettings().linkedUserId)
        assertNull(environment.cloudPreferencesStore.currentCloudSettings().linkedWorkspaceId)
        assertNull(environment.cloudPreferencesStore.currentCloudSettings().linkedEmail)
        assertNull(environment.cloudPreferencesStore.loadCredentials())
        assertEquals(localWorkspaceId, environment.database.workspaceDao().loadAnyWorkspace()?.workspaceId)
    }

    @Test
    fun startupReconciliationResumesPendingGuestUpgradeAfterBackendCompleteBeforeLocalSwitch() = runBlocking {
        val localWorkspaceId = environment.requireLocalWorkspaceId()
        val linkedWorkspace = createCloudWorkspaceSummary(
            workspaceId = "workspace-linked",
            name = "Linked Workspace",
            createdAtMillis = 200L,
            isSelected = true
        )
        val accountSnapshot = createCloudAccountSnapshot(
            userId = "user-1",
            email = "user@example.com",
            workspaces = listOf(linkedWorkspace)
        )
        val credentials = createStoredCloudCredentials(idTokenExpiresAtMillis = Long.MAX_VALUE)
        val guestSession = createStoredGuestAiSession(
            workspaceId = localWorkspaceId,
            configurationMode = CloudServiceConfigurationMode.OFFICIAL,
            apiBaseUrl = "https://api.flashcards-open-source-app.com/v1",
            guestToken = "guest-token",
            userId = "guest-user"
        )
        environment.cloudPreferencesStore.updateCloudSettings(
            cloudState = CloudAccountState.GUEST,
            linkedUserId = guestSession.userId,
            linkedWorkspaceId = localWorkspaceId,
            linkedEmail = null,
            activeWorkspaceId = localWorkspaceId
        )
        environment.guestAiSessionStore.saveSession(
            localWorkspaceId = localWorkspaceId,
            session = guestSession
        )
        environment.cloudPreferencesStore.savePendingGuestUpgrade(
            pendingGuestUpgradeState = PendingGuestUpgradeState(
                configuration = makeOfficialCloudServiceConfiguration(),
                credentials = credentials,
                accountSnapshot = accountSnapshot,
                guestSession = guestSession,
                guestUpgradeMode = CloudGuestUpgradeMode.MERGE_REQUIRED,
                selection = CloudWorkspaceLinkSelection.Existing(workspaceId = linkedWorkspace.workspaceId),
                completion = CloudGuestUpgradeCompletion(
                    workspace = linkedWorkspace,
                    reconciliation = null
                )
            )
        )
        assertEquals(CloudAccountState.GUEST, environment.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals(localWorkspaceId, environment.cloudPreferencesStore.currentCloudSettings().activeWorkspaceId)
        assertNotNull(environment.database.workspaceDao().loadWorkspaceById(localWorkspaceId))
        assertNull(environment.database.workspaceDao().loadWorkspaceById(linkedWorkspace.workspaceId))
        assertNull(environment.cloudPreferencesStore.loadCredentials())
        assertNotNull(environment.cloudPreferencesStore.loadPendingGuestUpgrade())

        val restartedRuntime = environment.createRestartedCloudGuestSessionRuntime(
            remoteGateway = FakeCloudRemoteGateway.forGuestUpgrade(
                guestUpgradeMode = CloudGuestUpgradeMode.MERGE_REQUIRED,
                accountSnapshot = accountSnapshot,
                bootstrapRemoteIsEmpty = false,
                guestUpgradeReconciliation = null
            )
        )

        restartedRuntime.cloudGuestSessionCoordinator.reconcilePersistedCloudStateForStartup()

        assertEquals(
            CloudAccountState.LINKED,
            restartedRuntime.cloudPreferencesStore.currentCloudSettings().cloudState
        )
        assertEquals(
            linkedWorkspace.workspaceId,
            restartedRuntime.cloudPreferencesStore.currentCloudSettings().linkedWorkspaceId
        )
        assertEquals(
            linkedWorkspace.workspaceId,
            restartedRuntime.cloudPreferencesStore.currentCloudSettings().activeWorkspaceId
        )
        assertEquals(linkedWorkspace.workspaceId, environment.database.workspaceDao().loadAnyWorkspace()?.workspaceId)
        assertNotNull(restartedRuntime.cloudPreferencesStore.loadCredentials())
        assertNull(restartedRuntime.cloudPreferencesStore.loadPendingGuestUpgrade())
        assertNull(
            restartedRuntime.guestAiSessionStore.loadAnySession(
                configuration = makeOfficialCloudServiceConfiguration()
            )
        )
    }

    @Test
    fun startupReconciliationResumesPendingGuestUpgradeAfterLocalShellReplacementBeforeCloudSettingsUpdate() = runBlocking {
        val guestWorkspaceId = environment.requireLocalWorkspaceId()
        val linkedWorkspace = createCloudWorkspaceSummary(
            workspaceId = "workspace-linked",
            name = "Linked Workspace",
            createdAtMillis = 200L,
            isSelected = true
        )
        val accountSnapshot = createCloudAccountSnapshot(
            userId = "user-1",
            email = "user@example.com",
            workspaces = listOf(linkedWorkspace)
        )
        val credentials = createStoredCloudCredentials(idTokenExpiresAtMillis = Long.MAX_VALUE)
        val guestSession = createStoredGuestAiSession(
            workspaceId = guestWorkspaceId,
            configurationMode = CloudServiceConfigurationMode.OFFICIAL,
            apiBaseUrl = "https://api.flashcards-open-source-app.com/v1",
            guestToken = "guest-token",
            userId = "guest-user"
        )
        environment.cloudPreferencesStore.updateCloudSettings(
            cloudState = CloudAccountState.GUEST,
            linkedUserId = guestSession.userId,
            linkedWorkspaceId = guestWorkspaceId,
            linkedEmail = null,
            activeWorkspaceId = guestWorkspaceId
        )
        environment.guestAiSessionStore.saveSession(
            localWorkspaceId = guestWorkspaceId,
            session = guestSession
        )
        environment.cloudPreferencesStore.savePendingGuestUpgrade(
            pendingGuestUpgradeState = PendingGuestUpgradeState(
                configuration = makeOfficialCloudServiceConfiguration(),
                credentials = credentials,
                accountSnapshot = accountSnapshot,
                guestSession = guestSession,
                guestUpgradeMode = CloudGuestUpgradeMode.MERGE_REQUIRED,
                selection = CloudWorkspaceLinkSelection.Existing(workspaceId = linkedWorkspace.workspaceId),
                completion = CloudGuestUpgradeCompletion(
                    workspace = linkedWorkspace,
                    reconciliation = null
                )
            )
        )
        val switchedWorkspace = environment.createSyncLocalStore().migrateLocalShellToLinkedWorkspace(
            workspace = linkedWorkspace,
            remoteWorkspaceIsEmpty = false
        )
        val remoteGateway = FakeCloudRemoteGateway.forGuestUpgrade(
            guestUpgradeMode = CloudGuestUpgradeMode.MERGE_REQUIRED,
            accountSnapshot = accountSnapshot,
            bootstrapRemoteIsEmpty = false,
            guestUpgradeReconciliation = null
        )

        assertEquals(linkedWorkspace.workspaceId, switchedWorkspace.workspaceId)
        assertEquals(CloudAccountState.GUEST, environment.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals(guestWorkspaceId, environment.cloudPreferencesStore.currentCloudSettings().activeWorkspaceId)
        assertNull(environment.database.workspaceDao().loadWorkspaceById(guestWorkspaceId))
        assertNotNull(environment.database.workspaceDao().loadWorkspaceById(linkedWorkspace.workspaceId))
        assertNull(environment.cloudPreferencesStore.loadCredentials())
        assertNotNull(environment.cloudPreferencesStore.loadPendingGuestUpgrade())

        val restartedRuntime = environment.createRestartedCloudGuestSessionRuntime(
            remoteGateway = remoteGateway
        )

        restartedRuntime.cloudGuestSessionCoordinator.reconcilePersistedCloudStateForStartup()

        assertEquals(0, remoteGateway.completeGuestUpgradeCalls)
        assertEquals(listOf(linkedWorkspace.workspaceId), remoteGateway.bootstrapPullWorkspaceIds)
        assertEquals(
            CloudAccountState.LINKED,
            restartedRuntime.cloudPreferencesStore.currentCloudSettings().cloudState
        )
        assertEquals(
            linkedWorkspace.workspaceId,
            restartedRuntime.cloudPreferencesStore.currentCloudSettings().linkedWorkspaceId
        )
        assertEquals(
            linkedWorkspace.workspaceId,
            restartedRuntime.cloudPreferencesStore.currentCloudSettings().activeWorkspaceId
        )
        assertEquals(linkedWorkspace.workspaceId, environment.database.workspaceDao().loadAnyWorkspace()?.workspaceId)
        assertNotNull(restartedRuntime.cloudPreferencesStore.loadCredentials())
        assertNull(restartedRuntime.cloudPreferencesStore.loadPendingGuestUpgrade())
        assertNull(
            restartedRuntime.guestAiSessionStore.loadAnySession(
                configuration = makeOfficialCloudServiceConfiguration()
            )
        )
    }

    @Test
    fun startupReconciliationFailsExplicitlyWhenPendingGuestUpgradeStateIsCorrupt() = runBlocking {
        val didWriteCorruptState = environment.context.getSharedPreferences(
            "flashcards-cloud-secrets",
            Context.MODE_PRIVATE
        ).edit()
            .putString("pending-guest-upgrade", "{")
            .commit()
        assertTrue(didWriteCorruptState)
        val coordinator = environment.createCloudGuestSessionCoordinator(
            remoteGateway = FakeCloudRemoteGateway.standard()
        )

        try {
            coordinator.reconcilePersistedCloudStateForStartup()
            throw AssertionError("Expected corrupt pending guest upgrade state to fail explicitly.")
        } catch (error: IllegalStateException) {
            assertTrue(
                error.message?.contains("Pending guest upgrade recovery state is corrupt and cannot be resumed.") == true
            )
        }
    }

    @Test
    fun guestSessionStoreClearsWorkspaceScopedSessionWhenStoredWorkspaceIdDoesNotMatchKey() {
        environment.guestAiSessionStore.saveSession(
            localWorkspaceId = "local-workspace",
            session = createStoredGuestAiSession(
                workspaceId = "remote-workspace",
                configurationMode = CloudServiceConfigurationMode.OFFICIAL,
                apiBaseUrl = "https://api.flashcards-open-source-app.com/v1",
                guestToken = "guest-token",
                userId = "guest-user"
            )
        )

        assertNull(
            environment.guestAiSessionStore.loadSession(
                localWorkspaceId = "local-workspace",
                configuration = makeOfficialCloudServiceConfiguration()
            )
        )
        assertNull(
            environment.guestAiSessionStore.loadAnySession(
                configuration = makeOfficialCloudServiceConfiguration()
            )
        )
    }

    @Test
    fun guestSessionStoreRebindsGuestSessionToRemoteWorkspaceKeyOnly() {
        val session = createStoredGuestAiSession(
            workspaceId = "remote-workspace",
            configurationMode = CloudServiceConfigurationMode.OFFICIAL,
            apiBaseUrl = "https://api.flashcards-open-source-app.com/v1",
            guestToken = "guest-token",
            userId = "guest-user"
        )
        environment.guestAiSessionStore.saveSession(
            localWorkspaceId = "local-workspace",
            session = session
        )

        environment.guestAiSessionStore.saveSession(
            localWorkspaceId = session.workspaceId,
            session = session
        )

        assertNull(
            environment.guestAiSessionStore.loadSession(
                localWorkspaceId = "local-workspace",
                configuration = makeOfficialCloudServiceConfiguration()
            )
        )
        assertEquals(
            session.workspaceId,
            environment.guestAiSessionStore.loadSession(
                localWorkspaceId = session.workspaceId,
                configuration = makeOfficialCloudServiceConfiguration()
            )?.workspaceId
        )
    }
}
