package com.flashcardsopensourceapp.data.local.repository.cloudsync.guest

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.ai.remote.GuestCloudSessionCreator
import com.flashcardsopensourceapp.data.local.cloud.PendingGuestUpgradeState
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteException
import com.flashcardsopensourceapp.data.local.database.entities.SyncStateEntity
import com.flashcardsopensourceapp.data.local.model.ai.StoredGuestAiSession
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCredentialRecoveryReason
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCredentialRecoveryRequiredException
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCredentialRecoveryState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudGuestUpgradeCompletion
import com.flashcardsopensourceapp.data.local.model.cloud.CloudGuestUpgradeMode
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfigurationMode
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.model.cloud.makeOfficialCloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.CloudIdentityTestEnvironment
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.FakeCloudRemoteGateway
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.RestartedCloudGuestSessionRuntime
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.createCloudAccountSnapshot
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.createCloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.createStoredCloudCredentials
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.createStoredGuestAiSession
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.createSyncCardOutboxEntry
import java.net.SocketTimeoutException
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
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
    fun linkedStateWithMissingCredentialsMarksRecoveryAndPreservesLocalData() = runBlocking {
        val preservationState = seedCredentialRecoveryLocalData()
        val coordinator = environment.createCloudGuestSessionCoordinator(
            remoteGateway = FakeCloudRemoteGateway.standard()
        )
        environment.cloudPreferencesStore.updateCloudSettings(
            cloudState = CloudAccountState.LINKED,
            linkedUserId = "user-1",
            linkedWorkspaceId = preservationState.workspaceId,
            linkedEmail = "user@example.com",
            activeWorkspaceId = preservationState.workspaceId
        )

        coordinator.reconcilePersistedCloudState()

        val recoveryState = requireNotNull(environment.cloudPreferencesStore.loadCloudCredentialRecoveryState()) {
            "Expected missing linked credentials to create recovery state."
        }
        assertEquals(CloudCredentialRecoveryReason.LINKED_CREDENTIALS_MISSING, recoveryState.reason)
        assertEquals(CloudAccountState.LINKED, recoveryState.previousCloudState)
        assertEquals(preservationState.installationId, recoveryState.installationId)
        assertEquals("user-1", recoveryState.linkedUserId)
        assertEquals(preservationState.workspaceId, recoveryState.linkedWorkspaceId)
        assertEquals(preservationState.workspaceId, recoveryState.activeWorkspaceId)
        assertEquals("user@example.com", recoveryState.linkedEmail)
        assertEquals(CloudServiceConfigurationMode.OFFICIAL, recoveryState.configurationMode)
        assertEquals("https://api.flashcards-open-source-app.com/v1", recoveryState.apiBaseUrl)
        assertCredentialRecoveryPreservedLocalData(preservationState = preservationState)
        assertEquals(CloudAccountState.DISCONNECTED, environment.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals(preservationState.installationId, environment.cloudPreferencesStore.currentCloudSettings().installationId)
        assertEquals(preservationState.workspaceId, environment.cloudPreferencesStore.currentCloudSettings().activeWorkspaceId)
    }

    @Test
    fun linkedStateWithInvalidActiveWorkspaceAndMissingCredentialsMarksRecovery() = runBlocking {
        val preservationState = seedCredentialRecoveryLocalData()
        val coordinator = environment.createCloudGuestSessionCoordinator(
            remoteGateway = FakeCloudRemoteGateway.standard()
        )
        environment.cloudPreferencesStore.updateCloudSettings(
            cloudState = CloudAccountState.LINKED,
            linkedUserId = "user-1",
            linkedWorkspaceId = preservationState.workspaceId,
            linkedEmail = "user@example.com",
            activeWorkspaceId = "missing-workspace"
        )

        coordinator.reconcilePersistedCloudState()

        val recoveryState = requireNotNull(environment.cloudPreferencesStore.loadCloudCredentialRecoveryState()) {
            "Expected missing linked credentials to create recovery state after active workspace normalization."
        }
        assertEquals(CloudCredentialRecoveryReason.LINKED_CREDENTIALS_MISSING, recoveryState.reason)
        assertEquals(preservationState.workspaceId, recoveryState.linkedWorkspaceId)
        assertEquals(preservationState.workspaceId, recoveryState.activeWorkspaceId)
        assertCredentialRecoveryPreservedLocalData(preservationState = preservationState)
        assertEquals(CloudAccountState.DISCONNECTED, environment.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals(preservationState.workspaceId, environment.cloudPreferencesStore.currentCloudSettings().activeWorkspaceId)
    }

    @Test
    fun guestStateWithMissingSessionMarksRecoveryAndPreservesLocalData() = runBlocking {
        val preservationState = seedCredentialRecoveryLocalData()
        val coordinator = environment.createCloudGuestSessionCoordinator(
            remoteGateway = FakeCloudRemoteGateway.standard()
        )
        environment.cloudPreferencesStore.updateCloudSettings(
            cloudState = CloudAccountState.GUEST,
            linkedUserId = "guest-user",
            linkedWorkspaceId = preservationState.workspaceId,
            linkedEmail = null,
            activeWorkspaceId = preservationState.workspaceId
        )

        coordinator.reconcilePersistedCloudState()

        val recoveryState = requireNotNull(environment.cloudPreferencesStore.loadCloudCredentialRecoveryState()) {
            "Expected missing guest session to create recovery state."
        }
        assertEquals(CloudCredentialRecoveryReason.GUEST_SESSION_MISSING, recoveryState.reason)
        assertEquals(CloudAccountState.GUEST, recoveryState.previousCloudState)
        assertEquals(preservationState.installationId, recoveryState.installationId)
        assertEquals("guest-user", recoveryState.linkedUserId)
        assertEquals(preservationState.workspaceId, recoveryState.linkedWorkspaceId)
        assertEquals(preservationState.workspaceId, recoveryState.activeWorkspaceId)
        assertNull(recoveryState.linkedEmail)
        assertCredentialRecoveryPreservedLocalData(preservationState = preservationState)
        assertEquals(CloudAccountState.DISCONNECTED, environment.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals(preservationState.installationId, environment.cloudPreferencesStore.currentCloudSettings().installationId)
        assertEquals(preservationState.workspaceId, environment.cloudPreferencesStore.currentCloudSettings().activeWorkspaceId)
    }

    @Test
    fun guestStateWithInvalidActiveWorkspaceAndMissingSessionMarksRecovery() = runBlocking {
        val preservationState = seedCredentialRecoveryLocalData()
        val coordinator = environment.createCloudGuestSessionCoordinator(
            remoteGateway = FakeCloudRemoteGateway.standard()
        )
        environment.cloudPreferencesStore.updateCloudSettings(
            cloudState = CloudAccountState.GUEST,
            linkedUserId = "guest-user",
            linkedWorkspaceId = preservationState.workspaceId,
            linkedEmail = null,
            activeWorkspaceId = "missing-workspace"
        )

        coordinator.reconcilePersistedCloudState()

        val recoveryState = requireNotNull(environment.cloudPreferencesStore.loadCloudCredentialRecoveryState()) {
            "Expected missing guest session to create recovery state after active workspace normalization."
        }
        assertEquals(CloudCredentialRecoveryReason.GUEST_SESSION_MISSING, recoveryState.reason)
        assertEquals(preservationState.workspaceId, recoveryState.linkedWorkspaceId)
        assertEquals(preservationState.workspaceId, recoveryState.activeWorkspaceId)
        assertCredentialRecoveryPreservedLocalData(preservationState = preservationState)
        assertEquals(CloudAccountState.DISCONNECTED, environment.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals(preservationState.workspaceId, environment.cloudPreferencesStore.currentCloudSettings().activeWorkspaceId)
    }

    @Test
    fun activeRecoveryBlocksGuestSessionAutoCreation() = runBlocking {
        val localWorkspaceId = environment.requireLocalWorkspaceId()
        val recoveryState = CloudCredentialRecoveryState(
            reason = CloudCredentialRecoveryReason.GUEST_SESSION_MISSING,
            previousCloudState = CloudAccountState.GUEST,
            installationId = environment.cloudPreferencesStore.currentCloudSettings().installationId,
            linkedUserId = "guest-user",
            linkedWorkspaceId = localWorkspaceId,
            activeWorkspaceId = localWorkspaceId,
            linkedEmail = null,
            configurationMode = CloudServiceConfigurationMode.OFFICIAL,
            apiBaseUrl = "https://api.flashcards-open-source-app.com/v1",
            detectedAtMillis = 500L
        )
        val guestSessionCreator = RecordingGuestSessionCreator(
            session = createStoredGuestAiSession(
                workspaceId = "new-guest-workspace",
                configurationMode = CloudServiceConfigurationMode.OFFICIAL,
                apiBaseUrl = "https://api.flashcards-open-source-app.com/v1",
                guestToken = "new-guest-token",
                userId = "new-guest-user"
            )
        )
        val coordinator = environment.createCloudGuestSessionCoordinatorWithGuestSessionCreator(
            remoteGateway = FakeCloudRemoteGateway.standard(),
            guestSessionCreator = guestSessionCreator
        )
        environment.cloudPreferencesStore.saveCloudCredentialRecoveryState(recoveryState = recoveryState)

        try {
            coordinator.ensureGuestCloudSession(workspaceId = localWorkspaceId)
            throw AssertionError("Expected active recovery to block guest session creation.")
        } catch (error: CloudCredentialRecoveryRequiredException) {
            assertEquals(recoveryState, error.recoveryState)
        }

        assertEquals(0, guestSessionCreator.createGuestSessionCalls)
        assertNull(
            environment.guestAiSessionStore.loadAnySession(
                configuration = makeOfficialCloudServiceConfiguration()
            )
        )
    }

    @Test
    fun credentialRecoveryStatePersistsAcrossStoreRestart() = runBlocking {
        val localWorkspaceId = environment.requireLocalWorkspaceId()
        val recoveryState = CloudCredentialRecoveryState(
            reason = CloudCredentialRecoveryReason.LINKED_CREDENTIALS_MISSING,
            previousCloudState = CloudAccountState.LINKED,
            installationId = environment.cloudPreferencesStore.currentCloudSettings().installationId,
            linkedUserId = "user-1",
            linkedWorkspaceId = localWorkspaceId,
            activeWorkspaceId = localWorkspaceId,
            linkedEmail = "user@example.com",
            configurationMode = CloudServiceConfigurationMode.OFFICIAL,
            apiBaseUrl = "https://api.flashcards-open-source-app.com/v1",
            detectedAtMillis = 500L
        )
        environment.cloudPreferencesStore.saveCloudCredentialRecoveryState(recoveryState = recoveryState)

        val restartedRuntime = environment.createRestartedCloudGuestSessionRuntime(
            remoteGateway = FakeCloudRemoteGateway.standard()
        )

        assertEquals(recoveryState, restartedRuntime.cloudPreferencesStore.loadCloudCredentialRecoveryState())
    }

    @Test
    fun startupReconciliationFailsTransientGuestBootstrapFailureBeforeUnsafeGuestWorkspaceMigration() = runBlocking {
        val localWorkspaceId: String = environment.requireLocalWorkspaceId()
        val guestSession: StoredGuestAiSession = createStoredGuestAiSession(
            workspaceId = "remote-guest-workspace",
            configurationMode = CloudServiceConfigurationMode.OFFICIAL,
            apiBaseUrl = "https://api.flashcards-open-source-app.com/v1",
            guestToken = "guest-token",
            userId = "guest-user"
        )
        environment.cloudPreferencesStore.updateCloudSettings(
            cloudState = CloudAccountState.GUEST,
            linkedUserId = guestSession.userId,
            linkedWorkspaceId = guestSession.workspaceId,
            linkedEmail = null,
            activeWorkspaceId = guestSession.workspaceId
        )
        environment.guestAiSessionStore.saveSession(
            localWorkspaceId = guestSession.workspaceId,
            session = guestSession
        )
        val restartedRuntime: RestartedCloudGuestSessionRuntime =
            environment.createRestartedCloudGuestSessionRuntime(
                remoteGateway = FakeCloudRemoteGateway.forBootstrapPullError(
                    bootstrapPullError = SocketTimeoutException("startup bootstrap timed out")
                )
            )

        try {
            restartedRuntime.cloudGuestSessionCoordinator.reconcilePersistedCloudStateForStartup()
            throw AssertionError("Expected transient guest bootstrap failure to fail startup before unsafe migration.")
        } catch (error: IllegalStateException) {
            assertTrue(
                error.message?.contains("Startup cloud reconciliation could not finish") == true
            )
            assertTrue(
                error.message?.contains("startup bootstrap timed out") == true
            )
        }

        val syncState: SyncStateEntity = requireNotNull(
            environment.database.syncStateDao().loadSyncState(localWorkspaceId)
        )
        assertEquals(CloudAccountState.GUEST, restartedRuntime.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals(localWorkspaceId, restartedRuntime.cloudPreferencesStore.currentCloudSettings().activeWorkspaceId)
        assertEquals(
            guestSession.workspaceId,
            restartedRuntime.cloudPreferencesStore.currentCloudSettings().linkedWorkspaceId
        )
        assertEquals(localWorkspaceId, environment.database.workspaceDao().loadAnyWorkspace()?.workspaceId)
        assertNotNull(
            restartedRuntime.guestAiSessionStore.loadAnySession(
                configuration = makeOfficialCloudServiceConfiguration()
            )
        )
        assertTrue(
            syncState.lastSyncError?.contains("Startup cloud reconciliation could not finish") == true
        )
        assertTrue(
            syncState.lastSyncError?.contains("startup bootstrap timed out") == true
        )
    }

    @Test
    fun corruptCredentialRecoveryStateDoesNotPreventStoreRestartAndLoadsInvalidRecovery() = runBlocking {
        val localWorkspaceId = environment.requireLocalWorkspaceId()
        val metadataPreferences = environment.context.getSharedPreferences(
            "flashcards-cloud-metadata",
            Context.MODE_PRIVATE
        )
        assertTrue(
            metadataPreferences.edit()
                .putString("cloud-credential-recovery-state", "{")
                .commit()
        )

        val restartedRuntime = environment.createRestartedCloudGuestSessionRuntime(
            remoteGateway = FakeCloudRemoteGateway.standard()
        )

        val loadedRecoveryState = requireNotNull(restartedRuntime.cloudPreferencesStore.loadCloudCredentialRecoveryState())
        val observedRecoveryState = requireNotNull(
            restartedRuntime.cloudPreferencesStore.observeCloudCredentialRecoveryState().first()
        )
        restartedRuntime.cloudPreferencesStore.saveCredentials(
            credentials = createStoredCloudCredentials(idTokenExpiresAtMillis = Long.MAX_VALUE)
        )
        restartedRuntime.cloudPreferencesStore.updateCloudSettings(
            cloudState = CloudAccountState.LINKED,
            linkedUserId = "user-1",
            linkedWorkspaceId = localWorkspaceId,
            linkedEmail = "user@example.com",
            activeWorkspaceId = localWorkspaceId
        )

        restartedRuntime.cloudGuestSessionCoordinator.reconcilePersistedCloudState()

        assertEquals(CloudCredentialRecoveryReason.INVALID_STORED_STATE, loadedRecoveryState.reason)
        assertEquals(CloudCredentialRecoveryReason.INVALID_STORED_STATE, observedRecoveryState.reason)
        assertEquals(
            CloudCredentialRecoveryReason.INVALID_STORED_STATE,
            restartedRuntime.cloudPreferencesStore.loadCloudCredentialRecoveryState()?.reason
        )
        assertEquals("{", metadataPreferences.getString("cloud-credential-recovery-state", null))
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
        environment.cloudPreferencesStore.saveCloudCredentialRecoveryState(
            recoveryState = CloudCredentialRecoveryState(
                reason = CloudCredentialRecoveryReason.LINKED_CREDENTIALS_MISSING,
                previousCloudState = CloudAccountState.GUEST,
                installationId = environment.cloudPreferencesStore.currentCloudSettings().installationId,
                linkedUserId = guestSession.userId,
                linkedWorkspaceId = localWorkspaceId,
                activeWorkspaceId = localWorkspaceId,
                linkedEmail = null,
                configurationMode = CloudServiceConfigurationMode.OFFICIAL,
                apiBaseUrl = "https://api.flashcards-open-source-app.com/v1",
                detectedAtMillis = 500L
            )
        )
        assertEquals(CloudAccountState.GUEST, environment.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals(localWorkspaceId, environment.cloudPreferencesStore.currentCloudSettings().activeWorkspaceId)
        assertNotNull(environment.database.workspaceDao().loadWorkspaceById(localWorkspaceId))
        assertNull(environment.database.workspaceDao().loadWorkspaceById(linkedWorkspace.workspaceId))
        assertNull(environment.cloudPreferencesStore.loadCredentials())
        assertNotNull(environment.cloudPreferencesStore.loadPendingGuestUpgrade())
        assertNotNull(environment.cloudPreferencesStore.loadCloudCredentialRecoveryState())

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
        assertNull(restartedRuntime.cloudPreferencesStore.loadCloudCredentialRecoveryState())
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
        assertEquals(true, remoteGateway.bootstrapPullBodies.single().getBoolean("includeMediaAssets"))
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
    fun startupReconciliationFailsPendingGuestUpgradeHydrationTransientFailure() = runBlocking {
        val localWorkspaceId: String = environment.requireLocalWorkspaceId()
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
        val guestSession: StoredGuestAiSession = createStoredGuestAiSession(
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
        environment.cloudPreferencesStore.saveCloudCredentialRecoveryState(
            recoveryState = CloudCredentialRecoveryState(
                reason = CloudCredentialRecoveryReason.LINKED_CREDENTIALS_MISSING,
                previousCloudState = CloudAccountState.GUEST,
                installationId = environment.cloudPreferencesStore.currentCloudSettings().installationId,
                linkedUserId = guestSession.userId,
                linkedWorkspaceId = localWorkspaceId,
                activeWorkspaceId = localWorkspaceId,
                linkedEmail = null,
                configurationMode = CloudServiceConfigurationMode.OFFICIAL,
                apiBaseUrl = "https://api.flashcards-open-source-app.com/v1",
                detectedAtMillis = 500L
            )
        )
        val restartedRuntime: RestartedCloudGuestSessionRuntime =
            environment.createRestartedCloudGuestSessionRuntime(
                remoteGateway = FakeCloudRemoteGateway.forBootstrapPullError(
                    bootstrapPullError = SocketTimeoutException("pending guest upgrade hydration timed out")
                )
            )

        try {
            restartedRuntime.cloudGuestSessionCoordinator.reconcilePersistedCloudStateForStartup()
            throw AssertionError("Expected pending guest upgrade hydration failure to fail startup explicitly.")
        } catch (error: IllegalStateException) {
            assertTrue(
                error.message?.contains("Guest upgrade completed on the server") == true
            )
            assertTrue(
                error.message?.contains("pending guest upgrade hydration timed out") == true
            )
        }

        assertEquals(CloudAccountState.LINKED, restartedRuntime.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertEquals(
            linkedWorkspace.workspaceId,
            restartedRuntime.cloudPreferencesStore.currentCloudSettings().activeWorkspaceId
        )
        assertNotNull(restartedRuntime.cloudPreferencesStore.loadPendingGuestUpgrade())
        assertNotNull(restartedRuntime.cloudPreferencesStore.loadCredentials())
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

    @Test
    fun analyticsGuestIdentityLinkSendsStoredGuestTokenAndClearsStoredSessions() = runBlocking {
        val localWorkspaceId = environment.requireLocalWorkspaceId()
        val remoteGateway = FakeCloudRemoteGateway.standard()
        val coordinator = environment.createCloudGuestSessionCoordinator(remoteGateway = remoteGateway)
        environment.prepareLinkedCloudIdentity(localWorkspaceId = localWorkspaceId)
        storeAnalyticsOnlyGuestSession(guestToken = "analytics-guest-token")

        coordinator.linkAnalyticsGuestIdentityToSignedInAccount()

        assertEquals(listOf("analytics-guest-token"), remoteGateway.linkGuestIdentityGuestTokens)
        // The account's identity row is written by the first request that loads a request context,
        // so exactly one has to precede the link or it earns `409 ACCOUNT_REQUIRED`.
        assertEquals(1, remoteGateway.fetchCloudAccountCalls)
        assertNull(
            environment.guestAiSessionStore.loadAnySession(
                configuration = makeOfficialCloudServiceConfiguration()
            )
        )
    }

    @Test
    fun analyticsGuestIdentityLinkSkipsGuestSessionThatOwnsCloudData() = runBlocking {
        val localWorkspaceId = environment.requireLocalWorkspaceId()
        val remoteGateway = FakeCloudRemoteGateway.standard()
        val coordinator = environment.createCloudGuestSessionCoordinator(remoteGateway = remoteGateway)
        environment.prepareLinkedCloudIdentity(localWorkspaceId = localWorkspaceId)
        environment.guestAiSessionStore.saveSession(
            localWorkspaceId = null,
            session = createStoredGuestAiSession(
                workspaceId = "guest-workspace",
                configurationMode = CloudServiceConfigurationMode.OFFICIAL,
                apiBaseUrl = "https://api.flashcards-open-source-app.com/v1",
                guestToken = "cloud-guest-token",
                userId = "cloud-guest-user"
            )
        )

        coordinator.linkAnalyticsGuestIdentityToSignedInAccount()

        // That guest converts through `/guest-auth/upgrade/complete`, which writes the same identity
        // link; this route would revoke the session that flow still needs.
        assertTrue(remoteGateway.linkGuestIdentityGuestTokens.isEmpty())
        assertEquals(
            "cloud-guest-token",
            environment.guestAiSessionStore.loadAnySession(
                configuration = makeOfficialCloudServiceConfiguration()
            )?.guestToken
        )
    }

    @Test
    fun analyticsGuestIdentityLinkKeepsGuestTokenAndStopsRetryingWhenUpgradeIsRequired() = runBlocking {
        val localWorkspaceId = environment.requireLocalWorkspaceId()
        val remoteGateway = FakeCloudRemoteGateway.standard()
        remoteGateway.setLinkGuestIdentityError(
            error = createCloudRemoteError(
                statusCode = 409,
                errorCode = "GUEST_IDENTITY_LINK_UPGRADE_REQUIRED",
                path = "/guest-auth/identity/link"
            )
        )
        val coordinator = environment.createCloudGuestSessionCoordinator(remoteGateway = remoteGateway)
        environment.prepareLinkedCloudIdentity(localWorkspaceId = localWorkspaceId)
        storeAnalyticsOnlyGuestSession(guestToken = "analytics-guest-token")

        coordinator.linkAnalyticsGuestIdentityToSignedInAccount()

        // The token is kept: it names the owner of data only the upgrade flow can transfer.
        val retiredSession = environment.guestAiSessionStore.loadAnySession(
            configuration = makeOfficialCloudServiceConfiguration()
        )
        assertEquals("analytics-guest-token", retiredSession?.guestToken)
        assertEquals(false, retiredSession?.isAnalyticsOnly)

        coordinator.linkAnalyticsGuestIdentityToSignedInAccount()

        // Correcting the marker is what stops a link that can never succeed from being retried on
        // every app start and every sign-in.
        assertEquals(listOf("analytics-guest-token"), remoteGateway.linkGuestIdentityGuestTokens)
    }

    @Test
    fun analyticsGuestIdentityLinkDropsGuestTokenOwnedByAnotherAccount() = runBlocking {
        val localWorkspaceId = environment.requireLocalWorkspaceId()
        val remoteGateway = FakeCloudRemoteGateway.standard()
        remoteGateway.setLinkGuestIdentityError(
            error = createCloudRemoteError(
                statusCode = 409,
                errorCode = "GUEST_IDENTITY_LINK_OTHER_ACCOUNT",
                path = "/guest-auth/identity/link"
            )
        )
        val coordinator = environment.createCloudGuestSessionCoordinator(remoteGateway = remoteGateway)
        environment.prepareLinkedCloudIdentity(localWorkspaceId = localWorkspaceId)
        storeAnalyticsOnlyGuestSession(guestToken = "analytics-guest-token")

        coordinator.linkAnalyticsGuestIdentityToSignedInAccount()

        assertEquals(listOf("analytics-guest-token"), remoteGateway.linkGuestIdentityGuestTokens)
        // Terminal: the credential is not this install's, so it must not stay as an analytics one.
        assertNull(
            environment.guestAiSessionStore.loadAnySession(
                configuration = makeOfficialCloudServiceConfiguration()
            )
        )
    }

    @Test
    fun analyticsGuestIdentityLinkKeepsGuestTokenWhenTheLinkFailsRetryably() = runBlocking {
        val localWorkspaceId = environment.requireLocalWorkspaceId()
        val remoteGateway = FakeCloudRemoteGateway.standard()
        remoteGateway.setLinkGuestIdentityError(
            error = createCloudRemoteError(
                statusCode = 500,
                errorCode = null,
                path = "/guest-auth/identity/link"
            )
        )
        val coordinator = environment.createCloudGuestSessionCoordinator(remoteGateway = remoteGateway)
        environment.prepareLinkedCloudIdentity(localWorkspaceId = localWorkspaceId)
        storeAnalyticsOnlyGuestSession(guestToken = "analytics-guest-token")

        try {
            coordinator.linkAnalyticsGuestIdentityToSignedInAccount()
            throw AssertionError("Expected a retryable link failure to be rethrown.")
        } catch (error: CloudRemoteException) {
            assertEquals(500, error.statusCode)
        }

        // A 5xx leaves this guest's tail unclaimed, because a success is what says the link landed,
        // so the retry is mandatory and the token has to survive for it.
        val keptSession = environment.guestAiSessionStore.loadAnySession(
            configuration = makeOfficialCloudServiceConfiguration()
        )
        assertEquals("analytics-guest-token", keptSession?.guestToken)
        assertTrue(keptSession?.isAnalyticsOnly == true)
    }

    /**
     * The credential must belong to the account this install is linked to. Linking on a mismatch
     * would attribute the guest's whole pre-sign-in tail to the wrong account, and
     * `analytics.identity_links` is first-link-wins with no repair path — while answering the
     * mismatch the way `authenticatedSession()` does would destroy local data instead.
     */
    @Test
    fun analyticsGuestIdentityLinkBailsWhenTheCredentialIsForAnotherAccount() = runBlocking {
        val preservationState = seedCredentialRecoveryLocalData()
        val remoteGateway = FakeCloudRemoteGateway.forAccountSnapshot(
            accountSnapshot = createCloudAccountSnapshot(
                userId = "user-2",
                email = "other@example.com",
                workspaces = listOf(
                    createCloudWorkspaceSummary(
                        workspaceId = preservationState.workspaceId,
                        name = "Personal",
                        createdAtMillis = 100L,
                        isSelected = true
                    )
                )
            )
        )
        val coordinator = environment.createCloudGuestSessionCoordinator(remoteGateway = remoteGateway)
        environment.prepareLinkedCloudIdentity(localWorkspaceId = preservationState.workspaceId)
        storeAnalyticsOnlyGuestSession(guestToken = "analytics-guest-token")

        coordinator.linkAnalyticsGuestIdentityToSignedInAccount()

        assertTrue(remoteGateway.linkGuestIdentityGuestTokens.isEmpty())
        assertCredentialRecoveryPreservedLocalData(preservationState = preservationState)
        assertEquals(
            "analytics-guest-token",
            environment.guestAiSessionStore.loadAnySession(
                configuration = makeOfficialCloudServiceConfiguration()
            )?.guestToken
        )
    }

    /**
     * The background link runs unattended on every app start and after every sign-in. A deleted
     * account must therefore never reach a destructive local reset from here: sync answers that
     * condition by preserving local data, and nothing about analytics may pre-empt it.
     */
    @Test
    fun analyticsGuestIdentityLinkPreservesLocalDataWhenTheAccountIsDeleted() = runBlocking {
        val preservationState = seedCredentialRecoveryLocalData()
        val remoteGateway = FakeCloudRemoteGateway.forFetchAccountError(
            fetchAccountError = createCloudRemoteError(
                statusCode = 410,
                errorCode = "ACCOUNT_DELETED",
                path = "/me"
            )
        )
        val coordinator = environment.createCloudGuestSessionCoordinator(remoteGateway = remoteGateway)
        environment.prepareLinkedCloudIdentity(localWorkspaceId = preservationState.workspaceId)
        storeAnalyticsOnlyGuestSession(guestToken = "analytics-guest-token")

        coordinator.linkAnalyticsGuestIdentityToSignedInAccount()

        assertTrue(remoteGateway.linkGuestIdentityGuestTokens.isEmpty())
        assertCredentialRecoveryPreservedLocalData(preservationState = preservationState)
        assertEquals(
            preservationState.installationId,
            environment.cloudPreferencesStore.currentCloudSettings().installationId
        )
        assertEquals(CloudAccountState.LINKED, environment.cloudPreferencesStore.currentCloudSettings().cloudState)
        assertNotNull(environment.cloudPreferencesStore.loadCredentials())
        assertEquals(
            "analytics-guest-token",
            environment.guestAiSessionStore.loadAnySession(
                configuration = makeOfficialCloudServiceConfiguration()
            )?.guestToken
        )
    }

    /**
     * The creation idempotency key is minted once and kept until the session is committed, so a
     * retry reuses it and the server returns the same guest identity instead of minting a second
     * permanent one for the install.
     */
    @Test
    fun guestCloudSessionCreationRetryReusesPersistedIdempotencyKeyUntilSessionIsCommitted() = runBlocking {
        val guestSessionCreator = RecordingGuestSessionCreator(
            session = createStoredGuestAiSession(
                workspaceId = "new-guest-workspace",
                configurationMode = CloudServiceConfigurationMode.OFFICIAL,
                apiBaseUrl = "https://api.flashcards-open-source-app.com/v1",
                guestToken = "new-guest-token",
                userId = "new-guest-user"
            ),
            initialFailureCount = 1
        )
        val creationCoordinator = GuestCloudSessionCreationCoordinator(
            guestSessionStore = environment.guestAiSessionStore,
            guestSessionCreator = guestSessionCreator
        )
        val configuration = makeOfficialCloudServiceConfiguration()

        try {
            creationCoordinator.loadOrCreateGuestCloudSession(
                configuration = configuration,
                isAnalyticsOnly = true
            )
            throw AssertionError("Expected the first guest session creation to fail.")
        } catch (error: SocketTimeoutException) {
            assertEquals("Guest session creation failed.", error.message)
        }

        // Nothing is durably stored yet, so the key stays: dropping it would leave a server-side
        // guest that no later attempt can name.
        assertNotNull(environment.guestAiSessionStore.loadPendingCreationIdempotencyKey())

        val createdSession = creationCoordinator.loadOrCreateGuestCloudSession(
            configuration = configuration,
            isAnalyticsOnly = true
        )

        assertEquals(2, guestSessionCreator.createGuestSessionCalls)
        val presentedKeys = guestSessionCreator.createGuestSessionIdempotencyKeys
        assertEquals(presentedKeys.first(), presentedKeys.last())
        assertTrue(presentedKeys.first().matches(Regex("[0-9a-f]{32,200}")))
        assertTrue(createdSession.isAnalyticsOnly)
        assertEquals(
            "new-guest-token",
            environment.guestAiSessionStore.loadAnySession(configuration = configuration)?.guestToken
        )
        // Dropped only now, because rotation hands whoever presents the key a fresh valid token for
        // that guest's user and workspace.
        assertNull(environment.guestAiSessionStore.loadPendingCreationIdempotencyKey())
    }

    private fun storeAnalyticsOnlyGuestSession(guestToken: String) {
        environment.guestAiSessionStore.saveSession(
            localWorkspaceId = null,
            session = createStoredGuestAiSession(
                workspaceId = "analytics-guest-workspace",
                configurationMode = CloudServiceConfigurationMode.OFFICIAL,
                apiBaseUrl = "https://api.flashcards-open-source-app.com/v1",
                guestToken = guestToken,
                userId = "analytics-guest-user",
                isAnalyticsOnly = true
            )
        )
    }

    private fun createCloudRemoteError(
        statusCode: Int,
        errorCode: String?,
        path: String
    ): CloudRemoteException {
        return CloudRemoteException(
            message = "Cloud request failed with status $statusCode for $path",
            statusCode = statusCode,
            responseBody = JSONObject()
                .put("code", errorCode ?: JSONObject.NULL)
                .put("requestId", "request-1")
                .toString(),
            errorCode = errorCode,
            requestId = "request-1",
            syncConflict = null,
            androidObservationAlreadyCaptured = false
        )
    }

    private suspend fun seedCredentialRecoveryLocalData(): CredentialRecoveryPreservationState {
        val workspaceId = environment.requireLocalWorkspaceId()
        val installationId = environment.cloudPreferencesStore.currentCloudSettings().installationId
        val cardId = environment.seedWorkspaceData(workspaceId = workspaceId)
        val card = requireNotNull(environment.database.cardDao().loadCard(cardId = cardId)) {
            "Expected seeded card."
        }
        environment.database.outboxDao().insertOutboxEntry(
            createSyncCardOutboxEntry(
                outboxEntryId = "outbox-recovery-$workspaceId",
                workspaceId = workspaceId,
                installationId = installationId,
                card = card,
                createdAtMillis = 300L
            )
        )
        return CredentialRecoveryPreservationState(
            workspaceId = workspaceId,
            installationId = installationId,
            cardId = cardId
        )
    }

    private suspend fun assertCredentialRecoveryPreservedLocalData(
        preservationState: CredentialRecoveryPreservationState
    ) {
        assertEquals(
            preservationState.workspaceId,
            environment.database.workspaceDao().loadAnyWorkspace()?.workspaceId
        )
        assertEquals(1, environment.database.workspaceDao().countWorkspaces())
        assertEquals(1, environment.database.cardDao().loadCards(workspaceId = preservationState.workspaceId).count())
        assertNotNull(environment.database.cardDao().loadCard(cardId = preservationState.cardId))
        assertEquals(1, environment.database.reviewLogDao().countReviewLogs(workspaceId = preservationState.workspaceId))
        assertEquals(1, environment.database.outboxDao().countOutboxEntries())
    }
}

private data class CredentialRecoveryPreservationState(
    val workspaceId: String,
    val installationId: String,
    val cardId: String
)

/**
 * [initialFailureCount] fails that many attempts before succeeding, standing in for a creation whose
 * result never became durable — a lost response, or a persist that failed after the server had
 * already committed the guest.
 */
private class RecordingGuestSessionCreator(
    private val session: StoredGuestAiSession,
    private val initialFailureCount: Int = 0
) : GuestCloudSessionCreator {
    var createGuestSessionCalls: Int = 0
    val createGuestSessionIdempotencyKeys = mutableListOf<String>()

    override suspend fun createGuestSession(
        apiBaseUrl: String,
        configurationMode: CloudServiceConfigurationMode,
        idempotencyKey: String
    ): StoredGuestAiSession {
        createGuestSessionCalls += 1
        createGuestSessionIdempotencyKeys += idempotencyKey
        if (createGuestSessionCalls <= initialFailureCount) {
            throw SocketTimeoutException("Guest session creation failed.")
        }
        return session
    }
}
